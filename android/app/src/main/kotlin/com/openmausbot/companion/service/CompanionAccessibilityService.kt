package com.openmausbot.companion.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.ColorSpace
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Native Android Accessibility Service for user-authorized phone automation.
 *
 * Implements Phase 35 (Android-as-Computer) foundation:
 * - Semantic UI hierarchy observation without ADB
 * - High-precision gesture input injection (tap, swipe, scroll)
 * - Safe text input setting via AccessibilityNodeInfo.ACTION_SET_TEXT
 * - Global navigation controls (back, home, recents, notifications)
 * - Native screenshot acquisition via API 30+ takeScreenshot API
 * - Explicit user-controlled lifecycle (Settings -> Accessibility -> Installed Services)
 */
class CompanionAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "CompanionAccessibilityService connected and ready")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val pkg = event.packageName?.toString()
            if (!pkg.isNullOrBlank()) {
                activePackage = pkg
            }
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "CompanionAccessibilityService interrupted")
    }

    override fun onDestroy() {
        if (instance === this) {
            instance = null
        }
        super.onDestroy()
        Log.i(TAG, "CompanionAccessibilityService destroyed")
    }

    /** Result of a semantic node interaction */
    sealed class ClickResult {
        object Success : ClickResult()
        object NotFound : ClickResult()
        object Disappeared : ClickResult()
        object Restricted : ClickResult()
        object NotEnabled : ClickResult()
    }

    companion object {
        private const val TAG = "CompanionAccessibility"

        /**
         * Security Invariant (Phase 35): Accessibility actions must never interact
         * with system permission dialogues attempting to silently grant dangerous permissions.
         */
        val RESTRICTED_SYSTEM_PACKAGES = setOf(
            "com.android.permissioncontroller",
            "com.google.android.permissioncontroller",
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
            "com.samsung.android.packageinstaller",
            "com.samsung.android.permissioncontroller"
        )

        @Volatile
        internal var instance: CompanionAccessibilityService? = null

        @Volatile
        private var activePackage: String? = null

        /** Whether the accessibility service is actively connected and authorized */
        fun isReady(): Boolean = instance != null

        /** Retrieve currently active foreground package name */
        fun getForegroundPackage(): String {
            val service = instance ?: return "unknown"
            val rootPkg = service.rootInActiveWindow?.packageName?.toString()
            if (!rootPkg.isNullOrBlank() && rootPkg != "unknown") {
                return rootPkg
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try {
                    val windows = service.windows
                    for (win in windows) {
                        if (win.isFocused || win.isActive) {
                            val winPkg = win.root?.packageName?.toString()
                            if (!winPkg.isNullOrBlank()) {
                                return winPkg
                            }
                        }
                    }
                } catch (_: Exception) {}
            }
            return activePackage ?: "unknown"
        }

        /** Returns true if active foreground window is a restricted system permission dialogue */
        fun isRestrictedWindow(): Boolean {
            val pkg = getForegroundPackage().lowercase()
            return RESTRICTED_SYSTEM_PACKAGES.any { pkg.startsWith(it) }
        }


        /**
         * Dump active window UI hierarchy as semantic JSON nodes.
         * Extracts visible bounds, clickable/editable state, resource IDs, and text labels.
         */
        fun dumpHierarchy(): JSONObject {
            val service = instance ?: return JSONObject().apply {
                put("currentPackage", "unknown")
                put("nodeCount", 0)
                put("nodes", JSONArray())
            }

            val root = service.rootInActiveWindow
            val nodes = JSONArray()
            val fgPackage = activePackage ?: root?.packageName?.toString() ?: "unknown"

            if (root != null) {
                val count = traverse(root, nodes, 0, 200)
                return JSONObject().apply {
                    put("currentPackage", fgPackage)
                    put("nodeCount", count)
                    put("nodes", nodes)
                }
            }

            return JSONObject().apply {
                put("currentPackage", fgPackage)
                put("nodeCount", 0)
                put("nodes", nodes)
            }
        }

        /**
         * Collect bounding boxes of all password/PIN/sensitive credential input fields
         * on the active window for visual scrubbing before network transmission.
         */
        fun getSensitiveFieldBounds(): List<Rect> {
            val service = instance ?: return emptyList()
            val root = service.rootInActiveWindow ?: return emptyList()
            val boundsList = mutableListOf<Rect>()
            collectSensitiveBounds(root, boundsList)
            return boundsList
        }

        private fun isNodeSensitive(node: AccessibilityNodeInfo): Boolean {
            if (node.isPassword) return true
            val id = node.viewIdResourceName?.lowercase() ?: ""
            if (id.contains("password") || id.contains("pin_entry") || id.contains("passcode") || id.contains("secret")) return true
            val cls = node.className?.toString()?.lowercase() ?: ""
            if (cls.contains("password")) return true
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                val inputType = node.inputType
                val isPasswordInput = (inputType and 0x80) != 0 || // TYPE_TEXT_VARIATION_PASSWORD
                    (inputType and 0x90) != 0 || // TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                    (inputType and 0xe0) != 0 || // TYPE_TEXT_VARIATION_WEB_PASSWORD
                    (inputType and 0x12) != 0    // TYPE_NUMBER_VARIATION_PASSWORD
                if (isPasswordInput) return true
            }
            return false
        }

        private fun collectSensitiveBounds(node: AccessibilityNodeInfo, list: MutableList<Rect>) {
            if (isNodeSensitive(node)) {
                val rect = Rect()
                node.getBoundsInScreen(rect)
                if (rect.width() > 0 && rect.height() > 0) {
                    list.add(rect)
                }
            }
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                collectSensitiveBounds(child, list)
            }
        }

        private fun traverse(
            node: AccessibilityNodeInfo,
            list: JSONArray,
            currentCount: Int,
            maxNodes: Int
        ): Int {
            if (currentCount >= maxNodes) return currentCount
            var count = currentCount

            val text = node.text?.toString() ?: ""
            val desc = node.contentDescription?.toString() ?: ""
            val id = node.viewIdResourceName ?: ""
            val className = node.className?.toString() ?: ""
            val isEnabled = node.isEnabled
            val isClickable = node.isClickable
            val isEditable = node.isEditable
            val isScrollable = node.isScrollable
            val isFocusable = node.isFocusable
            val isFocused = node.isFocused

            val isSensitive = isNodeSensitive(node)
            val safeText = if (isSensitive) "[PROTECTED]" else text
            val safeDesc = if (isSensitive) "[PROTECTED]" else desc

            if (safeText.isNotBlank() || safeDesc.isNotBlank() || id.isNotBlank() || isClickable || isEditable || isScrollable || isSensitive) {
                val rect = Rect()
                node.getBoundsInScreen(rect)
                val boundsArray = JSONArray().apply {
                    put(rect.left)
                    put(rect.top)
                    put(rect.right)
                    put(rect.bottom)
                }
                val boundsObj = JSONObject().apply {
                    put("left", rect.left)
                    put("top", rect.top)
                    put("right", rect.right)
                    put("bottom", rect.bottom)
                }

                val nodeId = "node_${rect.left}_${rect.top}_${rect.right}_${rect.bottom}_$count"
                val obj = JSONObject().apply {
                    put("nodeId", nodeId)
                    put("text", safeText)
                    put("description", safeDesc)
                    put("id", id)
                    put("className", className)
                    put("bounds", boundsArray)
                    put("boundsObj", boundsObj)
                    put("clickable", isClickable)
                    put("isClickable", isClickable)
                    put("focusable", isFocusable)
                    put("focused", isFocused)
                    put("scrollable", isScrollable)
                    put("editable", isEditable)
                    put("isEditable", isEditable)
                    put("isEnabled", isEnabled)
                    put("isPassword", isSensitive)
                    put("package", node.packageName?.toString() ?: "")
                    put("packageName", node.packageName?.toString() ?: "")
                }
                list.put(obj)
                count++
            }

            val childCount = node.childCount
            for (i in 0 until childCount) {
                if (count >= maxNodes) break
                val child = node.getChild(i) ?: continue
                count = traverse(child, list, count, maxNodes)
            }
            return count
        }

        /**
         * Click a semantic node matching the provided view ID or text/contentDescription.
         * Traverses to clickable ancestors if the matching node itself does not consume clicks.
         * Enforces permission dialogue security invariants and checks target validity.
         */
        fun clickNode(targetId: String?, targetText: String?, exact: Boolean = false): ClickResult {
            val service = instance ?: return ClickResult.NotFound
            if (isRestrictedWindow()) {
                Log.w(TAG, "Security refusal: attempt to interact with restricted system window ${getForegroundPackage()}")
                return ClickResult.Restricted
            }
            val root = service.rootInActiveWindow ?: return ClickResult.NotFound
            val candidates = mutableListOf<AccessibilityNodeInfo>()

            if (!targetId.isNullOrBlank()) {
                val byId = root.findAccessibilityNodeInfosByViewId(targetId)
                if (byId != null) candidates.addAll(byId)
            }

            if (candidates.isEmpty() && !targetText.isNullOrBlank()) {
                val needle = targetText.lowercase().trim()
                val allNodes = mutableListOf<AccessibilityNodeInfo>()
                collectAllNodes(root, allNodes, 250)
                for (node in allNodes) {
                    val text = (node.text?.toString() ?: "").lowercase()
                    val desc = (node.contentDescription?.toString() ?: "").lowercase()
                    if (exact) {
                        if (text == needle || desc == needle) candidates.add(node)
                    } else {
                        if (text.contains(needle) || desc.contains(needle)) candidates.add(node)
                    }
                }
            }

            if (candidates.isEmpty()) return ClickResult.NotFound

            for (target in candidates) {
                // Invariant: target must be enabled
                if (!target.isEnabled) return ClickResult.NotEnabled

                // Invariant: verify node has not disappeared or changed text before action
                if (!targetText.isNullOrBlank()) {
                    val currentText = (target.text?.toString() ?: "").lowercase()
                    val currentDesc = (target.contentDescription?.toString() ?: "").lowercase()
                    val needle = targetText.lowercase().trim()
                    if (!currentText.contains(needle) && !currentDesc.contains(needle)) {
                        return ClickResult.Disappeared
                    }
                }

                var current: AccessibilityNodeInfo? = target
                while (current != null) {
                    if (current.isClickable) {
                        val ok = current.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        return if (ok) ClickResult.Success else ClickResult.NotFound
                    }
                    current = current.parent
                }
            }

            return ClickResult.NotFound
        }

        private fun collectAllNodes(
            node: AccessibilityNodeInfo,
            out: MutableList<AccessibilityNodeInfo>,
            limit: Int
        ) {
            if (out.size >= limit) return
            out.add(node)
            for (i in 0 until node.childCount) {
                if (out.size >= limit) break
                val child = node.getChild(i) ?: continue
                collectAllNodes(child, out, limit)
            }
        }

        private fun dispatchGestureSync(service: CompanionAccessibilityService, gesture: GestureDescription): Boolean {
            val latch = CountDownLatch(1)
            var success = false
            val dispatched = service.dispatchGesture(
                gesture,
                object : GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) {
                        success = true
                        latch.countDown()
                    }
                    override fun onCancelled(gestureDescription: GestureDescription?) {
                        success = false
                        latch.countDown()
                    }
                },
                null
            )
            if (!dispatched) return false
            try {
                latch.await(3, TimeUnit.SECONDS)
            } catch (_: InterruptedException) {
                return false
            }
            return success
        }

        /**
         * Dispatch a tap gesture at the specified screen coordinates.
         */
        fun clickCoordinates(x: Float, y: Float): Boolean {
            val service = instance ?: return false
            if (isRestrictedWindow()) return false
            val path = Path().apply { moveTo(x, y); lineTo(x, y) }
            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
                .build()
            return dispatchGestureSync(service, gesture)
        }

        /**
         * Dispatch double tap gesture at screen coordinates.
         */
        fun doubleTapCoordinates(x: Float, y: Float): Boolean {
            val service = instance ?: return false
            if (isRestrictedWindow()) return false
            val path1 = Path().apply { moveTo(x, y); lineTo(x, y) }
            val path2 = Path().apply { moveTo(x, y); lineTo(x, y) }
            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path1, 0, 40))
                .addStroke(GestureDescription.StrokeDescription(path2, 100, 40))
                .build()
            return dispatchGestureSync(service, gesture)
        }

        /**
         * Dispatch long press gesture at screen coordinates (600ms hold).
         */
        fun longPressCoordinates(x: Float, y: Float): Boolean {
            val service = instance ?: return false
            if (isRestrictedWindow()) return false
            val path = Path().apply { moveTo(x, y); lineTo(x, y) }
            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 600))
                .build()
            return dispatchGestureSync(service, gesture)
        }

        /**
         * Dispatch swipe gesture with explicit coordinates and duration.
         */
        fun swipeCoordinates(startX: Float, startY: Float, endX: Float, endY: Float, durationMs: Long): Boolean {
            val service = instance ?: return false
            if (isRestrictedWindow()) return false
            val path = Path().apply { moveTo(startX, startY); lineTo(endX, endY) }
            val duration = durationMs.coerceIn(50, 2000)
            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, duration))
                .build()
            return dispatchGestureSync(service, gesture)
        }

        /**
         * Input text into currently focused editable field via ACTION_SET_TEXT.
         */
        fun inputText(text: String): Boolean {
            val service = instance ?: return false
            if (isRestrictedWindow()) return false
            val root = service.rootInActiveWindow ?: return false
            val focus = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                ?: findFirstEditable(root)
                ?: return false

            val arguments = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            return focus.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
        }

        private fun findFirstEditable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
            if (node.isEditable) return node
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                val found = findFirstEditable(child)
                if (found != null) return found
            }
            return null
        }

        /**
         * Perform scroll in direction (forward, backward, up, down) or fallback to swipe gesture.
         */
        fun scroll(direction: String): Boolean {
            val service = instance ?: return false
            if (isRestrictedWindow()) return false
            val root = service.rootInActiveWindow ?: return false
            val scrollable = findFirstScrollable(root)
            val norm = direction.lowercase()

            if (scrollable != null) {
                val action = if (norm == "forward" || norm == "down" || norm == "right") {
                    AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                } else {
                    AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                }
                if (scrollable.performAction(action)) return true
            }

            // Fallback to gesture swipe
            val dm = service.resources.displayMetrics
            val width = dm.widthPixels.toFloat()
            val height = dm.heightPixels.toFloat()

            val (startX, startY, endX, endY) = when (norm) {
                "up" -> listOf(width / 2f, height * 0.75f, width / 2f, height * 0.25f)
                "down" -> listOf(width / 2f, height * 0.25f, width / 2f, height * 0.75f)
                "left" -> listOf(width * 0.75f, height / 2f, width * 0.25f, height / 2f)
                "right" -> listOf(width * 0.25f, height / 2f, width * 0.75f, height / 2f)
                else -> listOf(width / 2f, height * 0.75f, width / 2f, height * 0.25f)
            }

            val path = Path().apply {
                moveTo(startX, startY)
                lineTo(endX, endY)
            }
            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 300))
                .build()

            val latch = CountDownLatch(1)
            var success = false

            val dispatched = service.dispatchGesture(
                gesture,
                object : GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) {
                        success = true
                        latch.countDown()
                    }

                    override fun onCancelled(gestureDescription: GestureDescription?) {
                        success = false
                        latch.countDown()
                    }
                },
                null
            )

            if (!dispatched) return false
            try {
                latch.await(3, TimeUnit.SECONDS)
            } catch (_: InterruptedException) {
                return false
            }
            return success
        }

        private fun findFirstScrollable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
            if (node.isScrollable) return node
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                val found = findFirstScrollable(child)
                if (found != null) return found
            }
            return null
        }

        /**
         * Perform global Android action (back, home, recents, notifications).
         */
        fun performGlobal(actionName: String): Boolean {
            val service = instance ?: return false
            if (isRestrictedWindow()) return false
            val action = when (actionName.lowercase()) {
                "back" -> GLOBAL_ACTION_BACK
                "home" -> GLOBAL_ACTION_HOME
                "recents", "recent", "app_switch" -> GLOBAL_ACTION_RECENTS
                "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
                else -> return false
            }
            return service.performGlobalAction(action)
        }

        /**
         * Capture screenshot natively via AccessibilityService (API 30+).
         */
        fun takeScreenshotCompat(callback: (Bitmap?, String?) -> Unit) {
            val service = instance
            if (service == null) {
                callback(null, "ERR_ACCESSIBILITY_DISABLED: Accessibility service is not enabled")
                return
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val handler = Handler(Looper.getMainLooper())
                val executor = java.util.concurrent.Executor { command -> handler.post(command) }
                service.takeScreenshot(
                    Display.DEFAULT_DISPLAY,
                    executor,
                    object : TakeScreenshotCallback {
                        override fun onSuccess(screenshotResult: ScreenshotResult) {
                            val buffer = screenshotResult.hardwareBuffer
                            try {
                                val colorSpace = screenshotResult.colorSpace
                                val bitmap = Bitmap.wrapHardwareBuffer(buffer, colorSpace)
                                    ?.copy(Bitmap.Config.ARGB_8888, false)
                                if (bitmap != null) {
                                    callback(bitmap, null)
                                } else {
                                    callback(null, "Failed to copy hardware buffer to software bitmap")
                                }
                            } catch (e: Exception) {
                                callback(null, "Bitmap conversion failed: ${e.message}")
                            } finally {
                                buffer.close()
                            }
                        }

                        override fun onFailure(errorCode: Int) {
                            val reason = when (errorCode) {
                                ERROR_TAKE_SCREENSHOT_INTERNAL_ERROR -> "Internal screenshot error"
                                ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY -> "Invalid display"
                                ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> "Interval time too short"
                                2 -> "No end of frame"
                                else -> "Screenshot error code: $errorCode"
                            }
                            callback(null, reason)
                        }
                    }
                )
            } else {
                callback(null, "takeScreenshot requires Android 11+ (API 30+)")
            }
        }

        /**
         * Launch application natively via Android Intent without shell am start or ADB.
         */
        fun launchApp(context: Context, packageName: String): Boolean {
            return try {
                val intent = context.packageManager.getLaunchIntentForPackage(packageName) ?: return false
                intent.flags = (intent.flags and Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED.inv()) or
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                val targetContext = instance ?: context
                targetContext.startActivity(intent)
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to launch package $packageName: ${e.message}")
                false
            }
        }
    }
}
