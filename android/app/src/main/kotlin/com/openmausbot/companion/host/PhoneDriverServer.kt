package com.openmausbot.companion.host

import android.Manifest
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.os.PowerManager
import android.provider.Settings
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

    // Centralized Background Execution & WakeLock Management (Official Phase 20)
    private var executionWakeLock: PowerManager.WakeLock? = null
    private var currentExecutionTaskId: String? = null
    private var currentExecutionSessionId: String? = null
    private var lastExecutionHeartbeatMs: Long = 0L

    @Synchronized
    private fun acquireExecutionWakeLock(taskId: String, sessionId: String, timeoutMs: Long = 10 * 60 * 1000L): JSONObject {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            ?: return err("PowerManager unavailable on device", "ERR_POWER_MANAGER_UNAVAILABLE")
        if (executionWakeLock == null) {
            executionWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MOBOT:BackgroundExecutionWakeLock").apply {
                setReferenceCounted(false)
            }
        }
        try {
            executionWakeLock?.acquire(timeoutMs)
            currentExecutionTaskId = taskId
            currentExecutionSessionId = sessionId
            lastExecutionHeartbeatMs = System.currentTimeMillis()
            log("Acquired BackgroundExecution WakeLock for task: $taskId, session: $sessionId (timeout: ${timeoutMs}ms)")
        } catch (e: Exception) {
            log("Failed to acquire execution WakeLock: ${e.message}")
            return err("Failed to acquire wake lock: ${e.message}", "ERR_WAKELOCK_FAILED")
        }
        return getBackgroundExecutionState()
    }

    @Synchronized
    private fun releaseExecutionWakeLock(taskId: String? = null): JSONObject {
        if (taskId != null && currentExecutionTaskId != null && taskId != currentExecutionTaskId) {
            log("Ignoring WakeLock release request for mismatched taskId: $taskId (current: $currentExecutionTaskId)")
        } else {
            if (executionWakeLock?.isHeld == true) {
                try {
                    executionWakeLock?.release()
                    log("Released BackgroundExecution WakeLock for task: $currentExecutionTaskId")
                } catch (e: Exception) {
                    log("Error releasing WakeLock: ${e.message}")
                }
            }
            currentExecutionTaskId = null
            currentExecutionSessionId = null
        }
        return getBackgroundExecutionState()
    }

    private fun getBackgroundExecutionState(): JSONObject {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val isWhitelisted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && pm != null) {
            pm.isIgnoringBatteryOptimizations(context.packageName)
        } else {
            true
        }
        val held = executionWakeLock?.isHeld == true
        val pid = android.os.Process.myPid()
        return JSONObject().apply {
            put("ok", true)
            put("sessionId", currentExecutionSessionId ?: "")
            put("activeTaskId", currentExecutionTaskId ?: "")
            put("foregroundServicePid", pid)
            put("wakelockHeld", held)
            put("batteryOptimizationWhitelisted", isWhitelisted)
            put("executionHeartbeatMs", if (held && lastExecutionHeartbeatMs > 0) lastExecutionHeartbeatMs else System.currentTimeMillis())
        }
    }

    private fun log(line: String) {
        diagLog.addLast(line)
        while (diagLog.size > 300) diagLog.pollFirst()
        Log.i(TAG, line)
    }

    fun stopServer() {
        stopping.set(true)
        releaseExecutionWakeLock()
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

    private fun isBitmapBlankOrBlack(bitmap: Bitmap): Boolean {
        val width = bitmap.width
        val height = bitmap.height
        if (width <= 0 || height <= 0) return true
        val sampleStepX = maxOf(1, width / 20)
        val sampleStepY = maxOf(1, height / 20)
        var allZero = true
        var maxLuminance = 0
        for (y in 0 until height step sampleStepY) {
            for (x in 0 until width step sampleStepX) {
                val pixel = bitmap.getPixel(x, y)
                val r = (pixel shr 16) and 0xff
                val g = (pixel shr 8) and 0xff
                val b = pixel and 0xff
                val lum = (r * 299 + g * 587 + b * 114) / 1000
                if (lum > maxLuminance) maxLuminance = lum
                if (r != 0 || g != 0 || b != 0) {
                    allZero = false
                }
            }
        }
        return allZero || maxLuminance < 2
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
                method == Method.POST && (uri == "/restore_host" || uri == "/restore_companion") -> handleRestoreHost(safeBody)
                method == Method.POST && (uri == "/setup_permission" || uri == "/open_settings") -> handleSetupPermission(safeBody)
                method == Method.GET && (uri == "/apps" || uri == "/launchable_apps") -> handleListApps()
                method == Method.POST && uri == "/reach/schedule" -> handleReachSchedule(safeBody)
                method == Method.POST && uri == "/reach/cancel" -> handleReachCancel(safeBody)
                method == Method.POST && uri == "/reach/snooze" -> handleReachSnooze(safeBody)
                method == Method.GET && uri == "/reach/events" -> handleReachList()
                method == Method.GET && uri == "/reach/status" -> handleReachStatus()
                // Official Phase 20: Background Execution & WakeLock Control
                method == Method.GET && uri == "/background/state" -> reply(Response.Status.OK, getBackgroundExecutionState())
                method == Method.POST && uri == "/background/acquire_wakelock" -> {
                    val taskId = safeBody.optString("taskId", "")
                    val sessionId = safeBody.optString("sessionId", "")
                    val timeoutMs = safeBody.optLong("timeoutMs", 600000L)
                    reply(Response.Status.OK, acquireExecutionWakeLock(taskId, sessionId, timeoutMs))
                }
                method == Method.POST && uri == "/background/release_wakelock" -> {
                    val taskId = safeBody.optString("taskId", "").takeIf { it.isNotEmpty() }
                    reply(Response.Status.OK, releaseExecutionWakeLock(taskId))
                }
                method == Method.POST && uri == "/background/heartbeat" -> {
                    lastExecutionHeartbeatMs = System.currentTimeMillis()
                    reply(Response.Status.OK, getBackgroundExecutionState())
                }
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
        val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val isKeyguardLocked = km?.isKeyguardLocked == true
        val isScreenInteractive = pm?.isInteractive == true
        val json = JSONObject().apply {
            put("ok", true)
            put("connected", ready)
            put("accessibilityEnabled", ready)
            put("foregroundPackage", fg)
            put("keyguardLocked", isKeyguardLocked)
            put("screenInteractive", isScreenInteractive)
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
                    put("setup_permission")
                    put("list_apps")
                    put("restore_host")
                    put("reach_schedule")
                    put("reach_cancel")
                    put("reach_snooze")
                    put("reach_events")
                    put("reach_status")
                    put("background_execution")
                    put("acquire_wakelock")
                    put("release_wakelock")
                }
            )
        }
        return reply(Response.Status.OK, json)
    }

    private fun handleRestoreHost(body: JSONObject): Response {
        return try {
            val pm = context.packageManager
            val intent = pm.getLaunchIntentForPackage(context.packageName)?.apply {
                flags = (flags and Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED.inv()) or
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            } ?: return reply(Response.Status.INTERNAL_ERROR, err("Launch intent unavailable for ${context.packageName}", "RESTORE_FAILED"))

            val targetContext = CompanionAccessibilityService.instance ?: context
            targetContext.startActivity(intent)

            var settled = false
            var currentFg = CompanionAccessibilityService.getForegroundPackage()
            val start = System.currentTimeMillis()
            while (System.currentTimeMillis() - start < 3000) {
                currentFg = CompanionAccessibilityService.getForegroundPackage()
                if (currentFg == context.packageName || currentFg.startsWith("${context.packageName}.")) {
                    settled = true
                    break
                }
                try {
                    Thread.sleep(150)
                } catch (_: InterruptedException) {
                    break
                }
            }

            reply(Response.Status.OK, JSONObject().apply {
                put("ok", true)
                put("restored", settled)
                put("foregroundPackage", currentFg)
                put("packageName", context.packageName)
                put("message", if (settled) "Restored ${context.packageName} to foreground" else "Restoration dispatched, foreground is $currentFg")
            })
        } catch (e: Exception) {
            reply(Response.Status.INTERNAL_ERROR, err("Failed to restore host: ${e.message}", "ACTION_FAILED"))
        }
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

        val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (pm?.isInteractive == false || km?.isKeyguardLocked == true) {
            return reply(
                Response.Status.OK,
                JSONObject().apply {
                    put("ok", false)
                    put("code", "ERR_SCREEN_LOCKED")
                    put("error", "ERR_SCREEN_LOCKED: Device screen is locked or turned off. Interactive UI gestures require the screen to be awake and unlocked.")
                    put("keyguardLocked", km?.isKeyguardLocked == true)
                    put("screenInteractive", pm?.isInteractive == true)
                }
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

        val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (pm?.isInteractive == false || km?.isKeyguardLocked == true) {
            return reply(
                Response.Status.OK,
                JSONObject().apply {
                    put("ok", false)
                    put("code", "ERR_SCREEN_LOCKED")
                    put("error", "ERR_SCREEN_LOCKED: Device screen is locked or turned off. Text injection requires the screen to be awake and unlocked.")
                    put("keyguardLocked", km?.isKeyguardLocked == true)
                    put("screenInteractive", pm?.isInteractive == true)
                }
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

        val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (pm?.isInteractive == false || km?.isKeyguardLocked == true) {
            return reply(
                Response.Status.OK,
                JSONObject().apply {
                    put("ok", false)
                    put("code", "ERR_SCREEN_LOCKED")
                    put("error", "ERR_SCREEN_LOCKED: Device screen is locked or turned off. Scroll gestures require the screen to be awake and unlocked.")
                    put("keyguardLocked", km?.isKeyguardLocked == true)
                    put("screenInteractive", pm?.isInteractive == true)
                }
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

        val rawBmp = capturedBitmap!!
        if (isBitmapBlankOrBlack(rawBmp)) {
            rawBmp.recycle()
            return reply(
                Response.Status.OK,
                err("ERR_SCREEN_CAPTURE_BLANK: Screen capture produced an all-black or blank frame", "ERR_SCREEN_CAPTURE_BLANK")
            )
        }

        // Phase 23 Invariant: Scrub sensitive secure fields (passwords, PINs) before network transmission
        val sensitiveBounds = CompanionAccessibilityService.getSensitiveFieldBounds()
        val bmp = if (sensitiveBounds.isNotEmpty()) {
            val mutableBmp = rawBmp.copy(Bitmap.Config.ARGB_8888, true)
            val canvas = Canvas(mutableBmp)
            val paint = Paint().apply {
                color = Color.DKGRAY
                style = Paint.Style.FILL
            }
            for (r in sensitiveBounds) {
                canvas.drawRect(r, paint)
            }
            rawBmp.recycle()
            mutableBmp
        } else {
            rawBmp
        }
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
                val stream = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.PNG, 85, stream)
                put("base64", Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP))
            }
            reply(Response.Status.OK, json)
        } catch (e: Exception) {
            reply(Response.Status.INTERNAL_ERROR, err("Failed to write screenshot: ${e.message}", "ACTION_FAILED"))
        } finally {
            bmp.recycle()
        }
    }

    private fun resolveTargetPackage(input: String): String {
        val trimmed = input.trim()
        val pm = context.packageManager
        // 1. If exact package name has a launch intent, return it immediately
        if (pm.getLaunchIntentForPackage(trimmed) != null) {
            return trimmed
        }
        val lower = trimmed.lowercase()
        val normalizedInput = lower.replace(Regex("[^a-z0-9]"), "")

        // 2. Dynamic Discovery: Query all installed launcher activities on the device
        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val activities = pm.queryIntentActivities(launcherIntent, 0)

        // Pass 2a: Exact case-insensitive match on app label
        for (info in activities) {
            val label = info.loadLabel(pm)?.toString()?.trim() ?: ""
            if (label.equals(trimmed, ignoreCase = true)) {
                return info.activityInfo.packageName
            }
        }

        // Pass 2b: Normalized alphanumeric match on app label (e.g. "playstore" -> "Play Store", "myfiles" -> "My Files")
        if (normalizedInput.isNotEmpty()) {
            for (info in activities) {
                val label = info.loadLabel(pm)?.toString() ?: ""
                val normLabel = label.lowercase().replace(Regex("[^a-z0-9]"), "")
                if (normLabel == normalizedInput) {
                    return info.activityInfo.packageName
                }
            }
        }

        // Pass 2c: App label starts with or contains requested name as word
        for (info in activities) {
            val label = info.loadLabel(pm)?.toString()?.lowercase() ?: ""
            if (label.startsWith(lower) || label.split(Regex("\\s+")).any { it == lower }) {
                return info.activityInfo.packageName
            }
        }

        // Pass 2d: Package name suffix or subcomponent matches (e.g. "chrome" -> "com.android.chrome", "deskclock" -> "com.google.android.deskclock")
        for (info in activities) {
            val pkgName = info.activityInfo.packageName.lowercase()
            val suffix = pkgName.substringAfterLast('.')
            if (suffix == lower || suffix == normalizedInput) {
                return info.activityInfo.packageName
            }
        }

        // Pass 2e: Package name contains requested query
        for (info in activities) {
            val pkgName = info.activityInfo.packageName.lowercase()
            if (pkgName.contains(lower) || (normalizedInput.length >= 4 && pkgName.contains(normalizedInput))) {
                return info.activityInfo.packageName
            }
        }

        // 3. Optional generic alias fallback for common terms
        val genericAliases = mapOf(
            "browser" to "com.android.chrome",
            "internet" to "com.android.chrome",
            "email" to "com.google.android.gm",
            "mail" to "com.google.android.gm",
            "sms" to "com.google.android.apps.messaging",
            "texting" to "com.google.android.apps.messaging",
            "store" to "com.android.vending",
            "settings" to "com.android.settings"
        )
        val aliasTarget = genericAliases[lower] ?: genericAliases[normalizedInput]
        if (aliasTarget != null && pm.getLaunchIntentForPackage(aliasTarget) != null) {
            return aliasTarget
        }

        return trimmed
    }

    private fun handleOpenApp(body: JSONObject): Response {
        val rawInput = body.optString("packageName", "").ifEmpty { body.optString("name", "") }.trim()
        if (rawInput.isEmpty()) {
            return reply(Response.Status.BAD_REQUEST, err("packageName or name parameter is required", "INVALID_INPUT"))
        }

        val pkg = resolveTargetPackage(rawInput)

        val launched = CompanionAccessibilityService.launchApp(context, pkg)
        if (!launched) {
            return reply(
                Response.Status.OK,
                err("APP_NOT_LAUNCHABLE: Could not resolve launch intent for application '$rawInput' (resolved package: '$pkg')", "APP_NOT_LAUNCHABLE")
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

        val accessibilityReady = CompanionAccessibilityService.isReady()
        if (!settled) {
            if (accessibilityReady) {
                // Accessibility is active, but target package never became foreground
                val json = JSONObject().apply {
                    put("ok", false)
                    put("code", "ERR_APP_LAUNCH_NOT_VERIFIED")
                    put("error", "ERR_APP_LAUNCH_NOT_VERIFIED: Target application '$pkg' did not become foreground (current: '$currentFg')")
                    put("launched", false)
                    put("packageName", pkg)
                    put("settled", false)
                    put("foregroundPackage", currentFg)
                }
                return reply(Response.Status.OK, json)
            } else {
                // Launch intent was dispatched, but foreground state cannot be confirmed because Accessibility Service is disabled
                val json = JSONObject().apply {
                    put("ok", true)
                    put("launched", true)
                    put("packageName", pkg)
                    put("settled", false)
                    put("foregroundPackage", "unknown")
                    put("accessibilityEnabled", false)
                    put("message", "Application '$pkg' launch intent was dispatched, but foreground state could not be verified because Accessibility Service is not enabled")
                }
                return reply(Response.Status.OK, json)
            }
        }

        val json = JSONObject().apply {
            put("ok", true)
            put("launched", true)
            put("packageName", pkg)
            put("settled", true)
            put("foregroundPackage", currentFg)
            put("message", "Application '$pkg' launched and confirmed in foreground")
        }
        return reply(Response.Status.OK, json)
    }

    private fun handleSetupPermission(body: JSONObject): Response {
        val type = body.optString("type", "accessibility").lowercase()
        return try {
            val intent = when (type) {
                "accessibility" -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                "app_settings" -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                else -> Intent(Settings.ACTION_SETTINGS)
            }.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val targetContext = CompanionAccessibilityService.instance ?: context
            targetContext.startActivity(intent)
            reply(Response.Status.OK, JSONObject().apply {
                put("ok", true)
                put("type", type)
                put("opened", true)
                put("message", "Opened $type settings on device")
            })
        } catch (e: Exception) {
            reply(Response.Status.INTERNAL_ERROR, err("Failed to open settings: ${e.message}", "ACTION_FAILED"))
        }
    }

    private fun handleListApps(): Response {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolveInfos = pm.queryIntentActivities(intent, 0)
        val appsArray = JSONArray()
        for (info in resolveInfos) {
            val label = info.loadLabel(pm)?.toString() ?: ""
            val packageName = info.activityInfo.packageName
            val activityName = info.activityInfo.name
            appsArray.put(JSONObject().apply {
                put("name", label)
                put("packageName", packageName)
                put("activityName", activityName)
            })
        }
        return reply(Response.Status.OK, JSONObject().apply {
            put("ok", true)
            put("count", appsArray.length())
            put("apps", appsArray)
        })
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
        val botName = body.optString("botName", "MOBOT").trim().ifEmpty { "MOBOT" }

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
            recurrence = recurrence,
            botName = botName
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
