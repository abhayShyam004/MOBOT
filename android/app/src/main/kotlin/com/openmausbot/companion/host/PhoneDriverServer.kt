package com.openmausbot.companion.host

import android.content.Context
import android.graphics.Bitmap
import android.util.Base64
import android.util.Log
import com.openmausbot.companion.service.CompanionAccessibilityService
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.InetAddress
import java.security.SecureRandom
import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Loopback HTTP driver server connecting the Node.js agent runtime to the native
 * Android CompanionAccessibilityService on device without runtime ADB dependencies.
 *
 * Implements Phase 35 native Android phone automation:
 * - Loopback only (127.0.0.1)
 * - Ephemeral port + per-boot capability token (PH_DRIVER_PORT / PH_DRIVER_TOKEN)
 * - Semantic UI hierarchy introspection & element targeting
 * - Native gesture dispatch (tap, scroll, swipe, keyevent)
 * - Native app launches via Android Intents
 * - API 30+ native screen capture
 */
class PhoneDriverServer private constructor(
    port: Int,
    private val token: String,
    private val context: Context,
) : NanoHTTPD(LOOPBACK.hostAddress, port) {

    private val stopping = AtomicBoolean(false)
    private val diagLog = ConcurrentLinkedDeque<String>()

    private fun log(line: String) {
        diagLog.addLast(line)
        while (diagLog.size > 300) diagLog.pollFirst()
        Log.i(TAG, line)
    }

    fun stopServer() {
        stopping.set(true)
        stop()
    }

    private fun reply(status: Response.Status, body: JSONObject): Response {
        return newFixedLengthResponse(
            status,
            "application/json; charset=utf-8",
            body.toString()
        )
    }

    private fun err(message: String, code: String = "ERROR"): JSONObject {
        return JSONObject().apply {
            put("ok", false)
            put("error", message)
            put("code", code)
        }
    }

    private fun readBody(session: IHTTPSession): JSONObject {
        val files = HashMap<String, String>()
        session.parseBody(files)
        val postData = files["postData"] ?: ""
        if (postData.isBlank()) return JSONObject()
        return try {
            JSONObject(JSONTokener(postData))
        } catch (_: Exception) {
            JSONObject()
        }
    }

    override fun serve(session: IHTTPSession): Response {
        if (stopping.get()) {
            return reply(Response.Status.SERVICE_UNAVAILABLE, err("Phone driver server is stopping"))
        }

        // Validate per-boot capability token
        val authHeader = session.headers["authorization"] ?: ""
        if (authHeader != "Bearer $token") {
            log("Security refusal: invalid or missing capability token")
            return reply(Response.Status.UNAUTHORIZED, err("Unauthorized: bad capability token", "ERR_AUTH"))
        }

        val uri = session.uri.trimEnd('/')
        val method = session.method

        return try {
            when {
                method == Method.GET && (uri == "" || uri == "/status") -> handleStatus()
                method == Method.GET && uri == "/screen" -> handleScreen()
                method == Method.POST && uri == "/tap" -> handleTap(readBody(session))
                method == Method.POST && uri == "/type" -> handleType(readBody(session))
                method == Method.POST && uri == "/scroll" -> handleScroll(readBody(session))
                method == Method.POST && uri == "/key" -> handleKey(readBody(session))
                method == Method.POST && uri == "/screenshot" -> handleScreenshot(readBody(session))
                method == Method.POST && (uri == "/open_app" || uri == "/launch") -> handleOpenApp(readBody(session))
                else -> reply(Response.Status.NOT_FOUND, err("Endpoint not found: ${session.method} ${session.uri}", "ERR_NOT_FOUND"))
            }
        } catch (e: Exception) {
            log("Unhandled driver error on $uri: ${e.message}")
            reply(Response.Status.INTERNAL_ERROR, err("Internal driver error: ${e.message}", "ERR_INTERNAL"))
        }
    }

    private fun handleStatus(): Response {
        val ready = CompanionAccessibilityService.isReady()
        val fg = CompanionAccessibilityService.getForegroundPackage()
        val json = JSONObject().apply {
            put("ok", true)
            put("connected", ready)
            put("accessibilityEnabled", ready)
            put("foregroundPackage", fg)
            put("version", "1.0.0")
            put(
                "reason",
                if (ready) "Native AccessibilityService is active and connected"
                else "AccessibilityService not enabled in Android Settings -> Accessibility"
            )
            put(
                "supportedActions",
                JSONArray().apply {
                    put("read_screen")
                    put("tap")
                    put("type_text")
                    put("scroll")
                    put("press_key")
                    put("open_app")
                    put("take_screenshot")
                }
            )
        }
        return reply(Response.Status.OK, json)
    }

    private fun handleScreen(): Response {
        if (!CompanionAccessibilityService.isReady()) {
            return reply(
                Response.Status.OK,
                err("ERR_ACCESSIBILITY_DISABLED: Accessibility service is not enabled in Android Settings.", "ACCESSIBILITY_DISABLED")
            )
        }
        val hierarchy = CompanionAccessibilityService.dumpHierarchy()
        hierarchy.put("ok", true)
        return reply(Response.Status.OK, hierarchy)
    }

    private fun handleTap(body: JSONObject): Response {
        if (!CompanionAccessibilityService.isReady()) {
            return reply(
                Response.Status.OK,
                err("ERR_ACCESSIBILITY_DISABLED: Accessibility service is not enabled in Android Settings.", "ACCESSIBILITY_DISABLED")
            )
        }

        // Semantic element targeting by id or text
        val targetText = body.optString("text", "").takeIf { it.isNotBlank() }
        val targetId = body.optString("id", "").takeIf { it.isNotBlank() }
        val exact = body.optBoolean("exact", false)

        if (targetText != null || targetId != null) {
            val success = CompanionAccessibilityService.clickNode(targetId, targetText, exact)
            if (success) {
                return reply(Response.Status.OK, JSONObject().apply {
                    put("ok", true)
                    put("message", "Tapped element '${targetText ?: targetId}'")
                })
            } else {
                return reply(Response.Status.OK, err("TARGET_NOT_FOUND: Element not found or not clickable", "TARGET_NOT_FOUND"))
            }
        }

        // Coordinate targeting
        if (body.has("x") && body.has("y")) {
            val x = body.getDouble("x").toFloat()
            val y = body.getDouble("y").toFloat()
            val success = CompanionAccessibilityService.clickCoordinates(x, y)
            if (success) {
                return reply(Response.Status.OK, JSONObject().apply {
                    put("ok", true)
                    put("message", "Tapped coordinates ($x, $y)")
                })
            } else {
                return reply(Response.Status.OK, err("ACTION_FAILED: Tap gesture dispatch failed", "ACTION_FAILED"))
            }
        }

        return reply(Response.Status.BAD_REQUEST, err("Invalid tap payload: requires text, id, or x/y coordinates", "INVALID_INPUT"))
    }

    private fun handleType(body: JSONObject): Response {
        if (!CompanionAccessibilityService.isReady()) {
            return reply(
                Response.Status.OK,
                err("ERR_ACCESSIBILITY_DISABLED: Accessibility service is not enabled in Android Settings.", "ACCESSIBILITY_DISABLED")
            )
        }

        val text = body.optString("text", "")
        if (text.isEmpty()) {
            return reply(Response.Status.BAD_REQUEST, err("text parameter is required", "INVALID_INPUT"))
        }

        val success = CompanionAccessibilityService.inputText(text)
        if (success) {
            return reply(Response.Status.OK, JSONObject().apply {
                put("ok", true)
                put("message", "Typed text into active input field")
            })
        } else {
            return reply(Response.Status.OK, err("ACTION_FAILED: No focused editable field found on screen", "TARGET_NOT_FOUND"))
        }
    }

    private fun handleScroll(body: JSONObject): Response {
        if (!CompanionAccessibilityService.isReady()) {
            return reply(
                Response.Status.OK,
                err("ERR_ACCESSIBILITY_DISABLED: Accessibility service is not enabled in Android Settings.", "ACCESSIBILITY_DISABLED")
            )
        }

        val direction = body.optString("direction", "down")
        val success = CompanionAccessibilityService.scroll(direction)
        if (success) {
            return reply(Response.Status.OK, JSONObject().apply {
                put("ok", true)
                put("message", "Scrolled screen $direction")
            })
        } else {
            return reply(Response.Status.OK, err("ACTION_FAILED: Scroll action failed", "ACTION_FAILED"))
        }
    }

    private fun handleKey(body: JSONObject): Response {
        if (!CompanionAccessibilityService.isReady()) {
            return reply(
                Response.Status.OK,
                err("ERR_ACCESSIBILITY_DISABLED: Accessibility service is not enabled in Android Settings.", "ACCESSIBILITY_DISABLED")
            )
        }

        val key = body.optString("key", "")
        if (key.isEmpty()) {
            return reply(Response.Status.BAD_REQUEST, err("key parameter is required", "INVALID_INPUT"))
        }

        val success = CompanionAccessibilityService.performGlobal(key)
        if (success) {
            return reply(Response.Status.OK, JSONObject().apply {
                put("ok", true)
                put("message", "Global action '$key' executed")
            })
        } else {
            return reply(Response.Status.OK, err("ACTION_FAILED: Unsupported or failed global action '$key'", "ACTION_NOT_SUPPORTED"))
        }
    }

    private fun handleScreenshot(body: JSONObject): Response {
        if (!CompanionAccessibilityService.isReady()) {
            return reply(
                Response.Status.OK,
                err("ERR_ACCESSIBILITY_DISABLED: Accessibility service is not enabled in Android Settings.", "ACCESSIBILITY_DISABLED")
            )
        }

        val latch = CountDownLatch(1)
        var capturedBitmap: Bitmap? = null
        var captureError: String? = null

        CompanionAccessibilityService.takeScreenshotCompat { bmp, error ->
            capturedBitmap = bmp
            captureError = error
            latch.countDown()
        }

        val finished = latch.await(4, TimeUnit.SECONDS)
        if (!finished || capturedBitmap == null) {
            return reply(
                Response.Status.OK,
                err(captureError ?: "Screenshot timed out or was blocked by FLAG_SECURE", "ERR_SCREEN_CAPTURE_BLOCKED")
            )
        }

        val bmp = capturedBitmap!!
        return try {
            val screenshotsDir = File(context.cacheDir, "screenshots").apply { mkdirs() }
            val screenshotFile = File(screenshotsDir, "screenshot_${System.currentTimeMillis()}.png")

            FileOutputStream(screenshotFile).use { out ->
                bmp.compress(Bitmap.CompressFormat.PNG, 95, out)
            }

            val json = JSONObject().apply {
                put("ok", true)
                put("path", screenshotFile.absolutePath)
                put("width", bmp.width)
                put("height", bmp.height)
                if (body.optBoolean("includeBase64", false)) {
                    val stream = ByteArrayOutputStream()
                    bmp.compress(Bitmap.CompressFormat.PNG, 85, stream)
                    put("base64", Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP))
                }
            }
            reply(Response.Status.OK, json)
        } catch (e: Exception) {
            reply(Response.Status.INTERNAL_ERROR, err("Failed to write screenshot: ${e.message}", "ACTION_FAILED"))
        } finally {
            bmp.recycle()
        }
    }

    private fun handleOpenApp(body: JSONObject): Response {
        val pkg = body.optString("packageName", "").trim()
        if (pkg.isEmpty()) {
            return reply(Response.Status.BAD_REQUEST, err("packageName parameter is required", "INVALID_INPUT"))
        }

        val launched = CompanionAccessibilityService.launchApp(context, pkg)
        if (!launched) {
            return reply(
                Response.Status.OK,
                err("APP_NOT_LAUNCHABLE: Could not resolve launch intent for package '$pkg'", "APP_NOT_LAUNCHABLE")
            )
        }

        // Wait up to 3 seconds for foreground package to switch
        var settled = false
        var currentFg = CompanionAccessibilityService.getForegroundPackage()
        val start = System.currentTimeMillis()
        while (System.currentTimeMillis() - start < 3000) {
            currentFg = CompanionAccessibilityService.getForegroundPackage()
            if (currentFg == pkg || currentFg.startsWith("$pkg.")) {
                settled = true
                break
            }
            try {
                Thread.sleep(150)
            } catch (_: InterruptedException) {
                break
            }
        }

        val json = JSONObject().apply {
            put("ok", true)
            put("launched", true)
            put("packageName", pkg)
            put("settled", settled)
            put("foregroundPackage", currentFg)
            put("message", "Application '$pkg' launched successfully")
        }
        return reply(Response.Status.OK, json)
    }

    companion object {
        private const val TAG = "PhoneDriverServer"
        val LOOPBACK: InetAddress = InetAddress.getByName("127.0.0.1")

        @Volatile
        private var current: PhoneDriverServer? = null

        @Volatile
        private var appContext: Context? = null

        /**
         * Start the loopback PhoneDriverServer on an ephemeral port.
         * Returns (port, token) for injection into Node harness environment.
         */
        fun start(context: Context): Pair<Int, String> {
            current?.let { return Pair(it.listeningPort, it.token) }
            appContext = context.applicationContext
            val server = PhoneDriverServer(0, newToken(), appContext!!)
            server.start(120_000, true)
            current = server
            Log.i(TAG, "PhoneDriverServer started on port ${server.listeningPort}")
            return Pair(server.listeningPort, server.token)
        }

        fun stopCurrent() {
            current?.stopServer()
            current = null
        }

        fun currentPort(): Int = current?.listeningPort ?: 0
        fun currentToken(): String = current?.token ?: ""

        private fun newToken(): String {
            val bytes = ByteArray(32)
            SecureRandom().nextBytes(bytes)
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }
}
