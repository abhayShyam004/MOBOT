package com.openmausbot.companion.host

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.openmausbot.companion.permissions.CompanionPermissions
import com.openmausbot.companion.reach.ReachEvent
import com.openmausbot.companion.reach.ReachEventType
import com.openmausbot.companion.reach.ReachScheduler
import com.openmausbot.companion.reach.ReachStore
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

    private fun parseRequestBody(session: IHTTPSession): Pair<JSONObject?, String?> {
        val contentLength = session.headers["content-length"]?.toLongOrNull() ?: 0L
        if (contentLength > MAX_BODY_BYTES) {
            return Pair(null, "Payload too large: exceeds $MAX_BODY_BYTES bytes")
        }
        val files = HashMap<String, String>()
        session.parseBody(files)
        val postData = files["postData"] ?: ""
        if (postData.isBlank()) return Pair(JSONObject(), null)
        if (postData.length > MAX_BODY_BYTES) {
            return Pair(null, "Payload too large: exceeds $MAX_BODY_BYTES bytes")
        }
        return try {
            Pair(JSONObject(JSONTokener(postData)), null)
        } catch (e: Exception) {
            Pair(null, "Malformed JSON payload: ${e.message}")
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

        val (body, parseErr) = if (method == Method.POST) parseRequestBody(session) else Pair(JSONObject(), null)
        if (parseErr != null) {
            val code = if (parseErr.startsWith("Payload too large")) "ERR_PAYLOAD_TOO_LARGE" else "ERR_MALFORMED_JSON"
            return reply(Response.Status.BAD_REQUEST, err(parseErr, code))
        }
        val safeBody = body ?: JSONObject()

        return try {
            when {
                method == Method.GET && (uri == "" || uri == "/status") -> handleStatus()
                method == Method.GET && uri == "/screen" -> handleScreen()
                (method == Method.GET || method == Method.POST) && uri == "/location" -> handleLocation(safeBody)
                method == Method.POST && uri == "/tap" -> handleTap(safeBody)
                method == Method.POST && uri == "/type" -> handleType(safeBody)
                method == Method.POST && uri == "/scroll" -> handleScroll(safeBody)
                method == Method.POST && uri == "/key" -> handleKey(safeBody)
                method == Method.POST && uri == "/screenshot" -> handleScreenshot(safeBody)
                method == Method.POST && (uri == "/open_app" || uri == "/launch") -> handleOpenApp(safeBody)
                method == Method.POST && uri == "/reach/schedule" -> handleReachSchedule(safeBody)
                method == Method.POST && uri == "/reach/cancel" -> handleReachCancel(safeBody)
                method == Method.POST && uri == "/reach/snooze" -> handleReachSnooze(safeBody)
                method == Method.GET && uri == "/reach/events" -> handleReachList()
                method == Method.GET && uri == "/reach/status" -> handleReachStatus()
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
                    put("get_location")
                    put("reach_schedule")
                    put("reach_cancel")
                    put("reach_snooze")
                    put("reach_events")
                    put("reach_status")
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
            val result = CompanionAccessibilityService.clickNode(targetId, targetText, exact)
            return when (result) {
                is CompanionAccessibilityService.ClickResult.Success -> reply(Response.Status.OK, JSONObject().apply {
                    put("ok", true)
                    put("message", "Tapped element '${targetText ?: targetId}'")
                })
                is CompanionAccessibilityService.ClickResult.Disappeared -> reply(Response.Status.OK, err(
                    "ERR_NODE_DISAPPEARED: Target node vanished or changed text before action",
                    "ERR_NODE_DISAPPEARED"
                ))
                is CompanionAccessibilityService.ClickResult.Restricted -> reply(Response.Status.OK, err(
                    "ERR_SECURITY_RESTRICTED: Accessibility actions are prohibited on system permission dialogs",
                    "ERR_SECURITY_RESTRICTED"
                ))
                is CompanionAccessibilityService.ClickResult.NotEnabled -> reply(Response.Status.OK, err(
                    "TARGET_DISABLED: Target element is disabled",
                    "TARGET_DISABLED"
                ))
                is CompanionAccessibilityService.ClickResult.NotFound -> reply(Response.Status.OK, err(
                    "TARGET_NOT_FOUND: Element not found or not clickable",
                    "TARGET_NOT_FOUND"
                ))
            }
        }

        val gestureType = body.optString("gesture", "tap").lowercase()

        // Coordinate swipe vector targeting (Phase 35 AndroidGestureAction)
        if (gestureType == "swipe" && body.has("swipeVector")) {
            val sv = body.getJSONObject("swipeVector")
            val startX = sv.optDouble("startX", 0.0).toFloat()
            val startY = sv.optDouble("startY", 0.0).toFloat()
            val endX = sv.optDouble("endX", 0.0).toFloat()
            val endY = sv.optDouble("endY", 0.0).toFloat()
            val durationMs = sv.optLong("durationMs", 300L)
            val success = CompanionAccessibilityService.swipeCoordinates(startX, startY, endX, endY, durationMs)
            return if (success) {
                reply(Response.Status.OK, JSONObject().apply {
                    put("ok", true)
                    put("message", "Swiped from ($startX, $startY) to ($endX, $endY)")
                })
            } else {
                reply(Response.Status.OK, err("ACTION_FAILED: Swipe gesture dispatch failed", "ACTION_FAILED"))
            }
        }

        // Coordinate targeting
        if (body.has("x") && body.has("y")) {
            val x = body.getDouble("x").toFloat()
            val y = body.getDouble("y").toFloat()
            val success = when (gestureType) {
                "double_tap" -> CompanionAccessibilityService.doubleTapCoordinates(x, y)
                "long_press" -> CompanionAccessibilityService.longPressCoordinates(x, y)
                else -> CompanionAccessibilityService.clickCoordinates(x, y)
            }
            if (success) {
                return reply(Response.Status.OK, JSONObject().apply {
                    put("ok", true)
                    put("message", "Executed $gestureType at coordinates ($x, $y)")
                })
            } else {
                return reply(Response.Status.OK, err("ACTION_FAILED: $gestureType gesture dispatch failed", "ACTION_FAILED"))
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
            // Prune old screenshots to strictly bound storage: retain at most 10 recent captures
            val existing = screenshotsDir.listFiles { f -> f.extension == "png" } ?: emptyArray()
            if (existing.size >= 10) {
                existing.sortedBy { it.lastModified() }
                    .take(existing.size - 9)
                    .forEach { it.delete() }
            }

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

    private fun handleLocation(body: JSONObject): Response {
        val permissions = CompanionPermissions(context)
        if (!permissions.locationGranted()) {
            return reply(Response.Status.OK, JSONObject().apply {
                put("ok", false)
                put("status", "PERMISSION_DENIED")
                put("error", "ERR_LOCATION_PERMISSION_REVOKED: Android location permission is not granted or has been revoked")
                put("code", "ERR_LOCATION_PERMISSION_REVOKED")
                put("policyNotice", "Location permission has been denied or revoked. Grant Location permission in Android Settings to enable live location context.")
            })
        }

        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        if (lm == null) {
            return reply(Response.Status.OK, JSONObject().apply {
                put("ok", false)
                put("status", "UNKNOWN")
                put("error", "LocationManager service is unavailable on this device")
                put("code", "SERVICE_UNAVAILABLE")
            })
        }

        val refresh = body.optBoolean("refresh", false)
        var freshLocation: Location? = null

        if (refresh && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val latch = CountDownLatch(1)
            val cancelSignal = CancellationSignal()
            try {
                val provider = if (try { lm.isProviderEnabled(LocationManager.GPS_PROVIDER) } catch (e: Exception) { false }) {
                    LocationManager.GPS_PROVIDER
                } else if (try { lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) } catch (e: Exception) { false }) {
                    LocationManager.NETWORK_PROVIDER
                } else {
                    LocationManager.PASSIVE_PROVIDER
                }
                lm.getCurrentLocation(
                    provider,
                    cancelSignal,
                    context.mainExecutor
                ) { loc ->
                    freshLocation = loc
                    latch.countDown()
                }
                latch.await(3, TimeUnit.SECONDS)
            } catch (e: Exception) {
                log("getCurrentLocation failed: ${e.message}")
            }
        }

        var bestLocation: Location? = freshLocation
        if (bestLocation == null) {
            val candidateProviders = listOf(
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.PASSIVE_PROVIDER
            )
            for (p in candidateProviders) {
                try {
                    val candidate = lm.getLastKnownLocation(p) ?: continue
                    if (bestLocation == null || candidate.time > bestLocation!!.time) {
                        bestLocation = candidate
                    }
                } catch (e: SecurityException) {
                    // Handled
                }
            }
        }

        if (bestLocation == null) {
            return reply(Response.Status.OK, JSONObject().apply {
                put("ok", false)
                put("status", "UNKNOWN")
                put("error", "No location fix available from device providers")
                put("code", "LOCATION_UNAVAILABLE")
            })
        }

        val locJson = JSONObject().apply {
            put("latitude", bestLocation!!.latitude)
            put("longitude", bestLocation!!.longitude)
            put("accuracyMeters", bestLocation!!.accuracy.toDouble())
            put("timestampMs", bestLocation!!.time)
            put("provenance", "DEVICE_LIVE")
            put("provider", bestLocation!!.provider ?: "fused")
        }

        return reply(Response.Status.OK, JSONObject().apply {
            put("ok", true)
            put("status", "AVAILABLE")
            put("location", locJson)
        })
    }

    private fun handleReachSchedule(body: JSONObject): Response {
        val typeStr = body.optString("type", "call_reminder")
        val title = body.optString("title", "").trim()
        val message = body.optString("message", "").trim()
        val triggerTimeMs = body.optLong("triggerTimeMs", 0L)
        val snoozeMinutes = body.optInt("snoozeMinutes", 10)
        val recurrence = if (body.has("recurrence") && !body.isNull("recurrence")) body.getString("recurrence") else null

        if (title.isBlank()) {
            return reply(Response.Status.BAD_REQUEST, err("Missing required 'title'", "ERR_INVALID_PARAMS"))
        }
        if (triggerTimeMs <= 0L) {
            return reply(Response.Status.BAD_REQUEST, err("Missing or invalid 'triggerTimeMs'", "ERR_INVALID_PARAMS"))
        }

        val event = ReachEvent(
            type = ReachEventType.fromString(typeStr),
            title = title,
            message = message,
            triggerTimeMs = triggerTimeMs,
            snoozeMinutes = snoozeMinutes,
            recurrence = recurrence
        )

        val scheduler = ReachScheduler.getInstance(context)
        val scheduled = scheduler.schedule(event)
        if (!scheduled) {
            return reply(Response.Status.INTERNAL_ERROR, err("Failed to schedule reach event with AlarmManager", "ERR_SCHEDULER_FAILED"))
        }

        return reply(Response.Status.OK, JSONObject().apply {
            put("ok", true)
            put("event", event.toJson())
        })
    }

    private fun handleReachCancel(body: JSONObject): Response {
        val id = body.optString("id", "").trim()
        if (id.isBlank()) {
            return reply(Response.Status.BAD_REQUEST, err("Missing required 'id'", "ERR_INVALID_PARAMS"))
        }
        val scheduler = ReachScheduler.getInstance(context)
        val cancelled = scheduler.cancel(id)
        return reply(Response.Status.OK, JSONObject().apply {
            put("ok", true)
            put("cancelled", cancelled)
            put("id", id)
        })
    }

    private fun handleReachSnooze(body: JSONObject): Response {
        val id = body.optString("id", "").trim()
        val snoozeMinutes = body.optInt("snoozeMinutes", 10)
        if (id.isBlank()) {
            return reply(Response.Status.BAD_REQUEST, err("Missing required 'id'", "ERR_INVALID_PARAMS"))
        }
        val scheduler = ReachScheduler.getInstance(context)
        val snoozed = scheduler.snooze(id, snoozeMinutes)
        if (snoozed == null) {
            return reply(Response.Status.NOT_FOUND, err("Event not found or failed to snooze", "ERR_EVENT_NOT_FOUND"))
        }
        return reply(Response.Status.OK, JSONObject().apply {
            put("ok", true)
            put("event", snoozed.toJson())
        })
    }

    private fun handleReachList(): Response {
        val store = ReachStore.getInstance(context)
        val events = store.getAllEvents()
        val array = JSONArray()
        events.forEach { array.put(it.toJson()) }
        return reply(Response.Status.OK, JSONObject().apply {
            put("ok", true)
            put("events", array)
        })
    }

    private fun handleReachStatus(): Response {
        val scheduler = ReachScheduler.getInstance(context)
        val exactAlarmPermitted = scheduler.isExactAlarmPermitted()
        val notifManager = androidx.core.app.NotificationManagerCompat.from(context)
        val notificationsEnabled = notifManager.areNotificationsEnabled()

        return reply(Response.Status.OK, JSONObject().apply {
            put("ok", true)
            put("exactAlarmPermitted", exactAlarmPermitted)
            put("notificationsEnabled", notificationsEnabled)
            put("canSchedule", exactAlarmPermitted)
            put("version", "1.0.0")
        })
    }

    companion object {
        private const val TAG = "PhoneDriverServer"
        private const val MAX_BODY_BYTES = 256 * 1024L // 256 KB request size boundary
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
