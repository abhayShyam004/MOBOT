package com.openmausbot.companion.host

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import com.openmausbot.companion.browser.BrowserSecurity
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetAddress
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Phase 7 (Browser): the app-side owner of the bots' WebViews.
 *
 * The embedded harness's `android_browser` MCP server drives this server over
 * loopback HTTP with a per-boot capability token. The token reaches the Node
 * child through the harness env — which carries paths/ports only, never a
 * credential (Phase 4 rule, unchanged). Per-bot isolation is real: one
 * androidx.webkit Profile per bot session, each with its own CookieManager,
 * localStorage and IndexedDB — bot A never inherits bot B's state. No
 * JavascriptInterface bridge exists in either direction; `evaluateJavascript`
 * returning text is the only JS path, and page code can call nothing.
 *
 * Every endpoint answers `{ok:true, ...}` on success or
 * `{ok:false, error:"…"}` with HTTP 200 on a failed action — the MCP server
 * maps that shape onto tool results, so a refused action is a tool error the
 * model can read, never an HTTP-level mystery.
 */
class BrowserDriverServer private constructor(
    port: Int,
    private val token: String,
    private val sessionsRoot: File,
    /** Test-only escape hatch: the device driver injects the fixture site's
     *  port so its deterministic pages are loadable. Absent in production —
     *  loopback stays fully refused. Set via [Companion.setFixturePort]. */
    private val fixturePort: Int = -1,
) : NanoHTTPD(LOOPBACK.hostAddress, port) {

    private val main = Handler(Looper.getMainLooper())
    private val webViews = ConcurrentHashMap<String, WebView>()
    /** Last main-frame load error per session, surfaced by open()/status(). */
    private val loadErrors = ConcurrentHashMap<String, String>()
    // Bounded ring of WebView lifecycle/error callbacks, exposed on /diag.
    // A stalled load is otherwise indistinguishable between "renderer never
    // started", "network refused", and "page hung" — the device driver reads
    // this instead of guessing.
    private val diagLog = java.util.concurrent.ConcurrentLinkedDeque<String>()

    private fun log(line: String) {
        diagLog.addLast(line)
        while (diagLog.size > 400) diagLog.pollFirst()
    }
    // ── session identity ────────────────────────────────────────────────────

    /** Stable, filesystem-safe per-bot profile name — a fixed-length digest,
     *  never the raw bot id (same identity shape as upstream's restore key). */
    fun sessionNameFor(botId: String): String {
        require(botId.matches(Regex("[A-Za-z0-9_-]{1,96}"))) { "Invalid bot id." }
        val digest = MessageDigest.getInstance("SHA-256").digest(botId.toByteArray(Charsets.UTF_8))
        return "omb-" + digest.joinToString("") { "%02x".format(it) }.take(32)
    }

    private fun requireSessionName(name: String) {
        require(name.matches(Regex("[a-z0-9-]{3,64}"))) { "Invalid browser session." }
    }

    // ── main-thread WebView lifecycle ───────────────────────────────────────

    /** Run [block] with the session's WebView on the main thread. When
     *  [create] is false and no session exists, the action fails loudly. */
    private fun withWebView(name: String, create: Boolean, block: (WebView) -> Unit) {
        requireSessionName(name)
        val done = CountDownLatch(1)
        val error = arrayOfNulls<String>(1)
        main.post {
            try {
                val existing = webViews[name]
                val view = existing ?: if (create) createWebView(name).also { webViews[name] = it } else
                    throw IllegalArgumentException("no such browser session: $name")
                block(view)
            } catch (e: Throwable) {
                error[0] = e.message ?: e.javaClass.simpleName
            } finally {
                done.countDown()
            }
        }
        if (!done.await(20, TimeUnit.SECONDS)) throw IllegalStateException("browser action timed out")
        error[0]?.let { throw IllegalArgumentException(it) }
    }

    private fun createWebView(name: String): WebView {
        // An Activity context is REQUIRED, not preferred: a WebView built on
        // the Application context gets a renderer connection with no foreground
        // anchor, so under memory pressure the OS reaps the renderer instantly
        // and every load stalls (~30% progress forever — observed on ARM32 and
        // a swap-exhausted ARM64). The resumed activity registered via
        // [Companion.attachWindow] is the correct owner.
        val activityWindow = hostWindow
        val context = (activityWindow?.context as? android.app.Activity) ?: activityWindow?.context
            ?: appContext
            ?: throw IllegalStateException("BrowserDriverServer is not started")
        ProfileStore.getInstance().getOrCreateProfile(name)
        val view = WebView(context)
        WebViewCompat.setProfile(view, name)
        view.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            safeBrowsingEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(v: WebView, progress: Int) { log("$name progress=$progress") }
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                log("$name console ${message.messageLevel()}: ${message.message()} @${message.lineNumber()}")
                return true
            }
        }
        // Only http/https may ever load; file/content/intent URLs die here.
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                val allowed = url.startsWith("http://") || url.startsWith("https://")
                if (!allowed) view.stopLoading()
                log("$name shouldOverride url=$url allowed=$allowed")
                return !allowed
            }

            override fun onPageStarted(v: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                log("$name onPageStarted url=$url")
            }

            override fun onPageFinished(v: WebView, url: String?) { log("$name onPageFinished url=$url") }

            override fun onReceivedHttpError(v: WebView, req: WebResourceRequest, res: WebResourceResponse) {
                log("$name httpError main=${req.isForMainFrame} status=${res.statusCode} url=${req.url}")
            }

            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                super.onReceivedError(view, req, err)
                val detail = "${err.description} (code ${err.errorCode}) url=${req.url} main=${req.isForMainFrame}"
                log("$name onReceivedError $detail")
                if (req.isForMainFrame) loadErrors[name] = detail
            }

            // A dead renderer must be a readable failure, never a silent
            // stall: destroy the view so the next action recreates it.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                loadErrors[name] = "renderer process gone (did the OS kill it under memory pressure?)"
                log("$name onRenderProcessGone crashed=${detail.didCrash()} priority=${detail.rendererPriorityAtExit()}")
                main.post {
                    webViews.remove(name)?.let { dead ->
                        (dead.parent as? ViewGroup)?.removeView(dead)
                        dead.destroy()
                    }
                }
                return true
            }
        }
        // Deliberate v1 contract: downloads are refused rather than
        // half-sandboxed. The MCP layer documents this per tool so the model
        // can tell the user instead of silently losing a file.
        view.setDownloadListener { _: String?, _: String?, _: String?, _: String?, _: Long? -> }
        // A WebView that is never attached to a window never spawns its
        // renderer on several OEM builds: loads never settle and
        // evaluateJavascript callbacks never fire. Attach the session view to
        // the resumed Activity's decor (zero-size is unnecessary — the bot's
        // browser is the user's own Computer view anyway) BEFORE the first
        // loadUrl, and re-parent on Activity recreation.
        val attached = attachToHostWindow(view)
        log("$name created attached=$attached ctxActivity=${context is android.app.Activity}")
        return view
    }

    /** Attach (or re-parent) [view] to the current host window's decor view.
     *  Runs on the main thread; if no window is registered yet the view is
     *  adopted by [attachWindow] on the next Activity resume. A WebView that
     *  stays unattached never spawns its renderer, so the adoption pass is
     *  load-bearing, not cosmetic. */
    private fun attachToHostWindow(view: WebView): Boolean {
        val decor = hostWindow?.decorView as? ViewGroup ?: return false
        if (view.parent === decor) return true
        view.parent?.let { (it as ViewGroup).removeView(view) }
        decor.addView(view, 0, ViewGroup.LayoutParams(1080, 1920))
        view.translationX = -10000f
        view.isFocusable = false
        view.isClickable = false
        return true
    }
    private fun destroy(name: String) {
        requireSessionName(name)
        main.post {
            webViews.remove(name)?.let { view ->
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
            }
            ProfileStore.getInstance().deleteProfile(name)
        }
    }

    // ── actions ─────────────────────────────────────────────────────────────

    private fun open(name: String, url: String): JSONObject {
        checkUrl(url)
        loadErrors.remove(name)
        log("$name open url=$url")
        if (fixturePort > 0 && url.contains("127.0.0.1:$fixturePort")) {
            log("$name fixture load: renderer is the phone's own WebView (loopback fixture port $fixturePort)")
        }
        withWebView(name, create = true) { it.loadUrl(url) }
        // Wait (bounded) for the load to settle before answering, then report
        // the view's REAL final state. `settled:false` means the deadline hit
        // first — never a silent pass: the caller (and the model) can see a
        // page that never finished.
        val settled = awaitLoad(name)
        val out = JSONObject().put("url", url).put("session", name).put("settled", settled)
        withWebView(name, create = false) { view ->
            out.put("currentUrl", view.url ?: "").put("title", view.title ?: "").put("progress", view.progress)
            out.put("attached", view.isAttachedToWindow).put("size", "${view.width}x${view.height}")
        }
        loadErrors[name]?.let { out.put("loadError", it) }
        return out
    }

    /** Poll the view's progress on the main thread until it hits 100 or the
     *  deadline passes. Returns whether the load actually settled — a hung
     *  page must be visible as such, never silently swallowed. */
    private fun awaitLoad(name: String, timeoutMs: Long = 20_000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val done = arrayOf(true)
            val latch = CountDownLatch(1)
            main.post {
                try { done[0] = (webViews[name]?.progress ?: 100) >= 100 } finally { latch.countDown() }
            }
            latch.await(5, TimeUnit.SECONDS)
            if (done[0]) return true
            Thread.sleep(200)
        }
        return false
    }

    private fun status(name: String): JSONObject {
        val out = JSONObject()
        withWebView(name, create = false) { view ->
            out.put("url", view.url ?: "")
            out.put("title", view.title ?: "")
            out.put("canGoBack", view.canGoBack())
            out.put("canGoForward", view.canGoForward())
            out.put("progress", view.progress)
        }
        return out
    }

    private fun nav(name: String, step: (WebView) -> Unit): JSONObject {
        withWebView(name, create = false) { view -> view.post { step(view) } }
        return JSONObject().put("session", name)
    }

    /** Bounded page text; the cap keeps a heavy page from flooding context
     *  (the MCP server applies its own smaller budget on top). */
    private fun text(name: String, maxChars: Int): JSONObject {
        val cap = maxChars.coerceIn(200, 60_000)
        val view = viewOf(name, create = false) ?: throw IllegalArgumentException("no such browser session: $name")
        val value = evalScript(view, "(function(){var t=document.body?document.body.innerText:'';return t.length>$cap?t.slice(0,$cap)+'\\n[truncated after $cap characters]':t;})()")
        return JSONObject().put("text", value)
    }

    /** Interactive DOM: elements with refs (@eN) the model can act on — the
     *  small subset of the tree that matters for agentic work. */
    private fun dom(name: String, maxElements: Int): JSONObject {
        val cap = maxElements.coerceIn(10, 400)
        val view = viewOf(name, create = false) ?: throw IllegalArgumentException("no such browser session: $name")
        val value = evalScript(view, DOM_SCRIPT.replace("__CAP__", cap.toString()))
        if (value.isBlank() || value == "null") {
            throw IllegalStateException("the page returned no DOM (script error or empty document)")
        }
        return JSONObject().put("page", JSONObject(value))
    }

    private fun click(name: String, ref: String): JSONObject = actOn(name, ref, "e.click();return 'clicked @' + IDX;")
        .let { JSONObject().put("clicked", ref) }

    private fun type(name: String, ref: String, text: String, clear: Boolean): JSONObject {
        val payload = JSONObject.quote(text)
        val clearJs = if (clear) "e.value='';" else ""
        actOn(name, ref, "${clearJs}e.value+=($payload);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 'typed into @' + IDX;")
        return JSONObject().put("typed", ref)
    }

    /** Click/type against a DOM ref: re-queries the same interactive-element
     *  list the dom() tool advertised, so refs stay meaningful. */
    private fun actOn(name: String, ref: String, tail: String): JSONObject {
        val i = ref.removePrefix("@e").toIntOrNull()
            ?: throw IllegalArgumentException("ref must be @eN (from the dom tool)")
        require(i in 0..999) { "ref out of range" }
        val view = viewOf(name, create = false) ?: throw IllegalArgumentException("no such browser session: $name")
        val value = evalScript(view, "(function(){var IDX=$i;var els=document.querySelectorAll($INTERACTIVE);var e=els[IDX];if(!e)return 'no element @'+IDX;e.scrollIntoView({block:'center'});$tail})()")
        // An empty value means the page script never ran (it threw): report it
        // instead of claiming the element was clicked/typed into.
        if (value.isEmpty() || value == "null") {
            throw IllegalStateException("ref @e$i did not resolve on this page — call dom first")
        }
        return JSONObject().put("result", value)
    }

    /** Controlled JS evaluation in the page's own context; result is text.
     *  This is the only JS path — no bridge exists in either direction. */
    private fun evalJs(name: String, expression: String): JSONObject {
        val view = viewOf(name, create = false) ?: throw IllegalArgumentException("no such browser session: $name")
        return JSONObject().put("result", evalScript(view, expression))
    }

    private fun screenshot(name: String): ByteArray {
        val captured = arrayOfNulls<ByteArray>(1)
        val latch = CountDownLatch(1)
        val error = arrayOfNulls<String>(1)
        main.post {
            try {
                val view = webViews[name] ?: throw IllegalArgumentException("no such browser session: $name")
                val w = view.width.takeIf { it > 0 } ?: 720
                val h = view.height.takeIf { it > 0 } ?: 1280
                val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                val oldTranslation = view.translationX
                view.translationX = 0f
                view.draw(Canvas(b))
                view.translationX = oldTranslation
                if (isBitmapBlankOrBlack(b)) {
                    b.recycle()
                    throw IllegalStateException("ERR_SCREEN_CAPTURE_BLANK: WebView render resulted in blank or all-black frame")
                }
                val stream = ByteArrayOutputStream()
                b.compress(Bitmap.CompressFormat.JPEG, 70, stream)
                b.recycle()
                captured[0] = stream.toByteArray()
            } catch (e: Throwable) {
                error[0] = e.message ?: e.javaClass.simpleName
            } finally {
                latch.countDown()
            }
        }
        if (!latch.await(20, TimeUnit.SECONDS)) throw IllegalStateException("screenshot timed out")
        error[0]?.let { throw IllegalArgumentException(it) }
        return captured[0] ?: throw IllegalStateException("screenshot produced no image")
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

    private fun cookies(name: String): JSONObject {
        val out = JSONObject()
        withWebView(name, create = false) { view ->
            val profile = ProfileStore.getInstance().getProfile(name)
            val raw = profile?.cookieManager?.getCookie(view.url ?: "https://") ?: ""
            val jar = JSONArray()
            raw.split(";").map { it.trim() }.filter { it.isNotEmpty() }.forEach { jar.put(it) }
            out.put("cookies", jar)
        }
        return out
    }

    private fun clearSession(name: String): JSONObject {
        withWebView(name, create = false) { view -> view.clearHistory() }
        // CookieManager calls must run on the thread the WebView stack owns
        // (the main thread) — the HTTP thread may not touch them.
        val cleared = CountDownLatch(1)
        main.post {
            try { ProfileStore.getInstance().getProfile(name)?.cookieManager?.removeAllCookies(null) } finally { cleared.countDown() }
        }
        cleared.await(10, TimeUnit.SECONDS)
        sessionDataDir(name).deleteRecursively()
        return JSONObject().put("cleared", name)
    }

    private fun closeSession(name: String): JSONObject {
        destroy(name)
        return JSONObject().put("closed", name)
    }

    private fun sessionDataDir(name: String): File {
        requireSessionName(name)
        return File(sessionsRoot, name).apply { mkdirs() }
    }

    // ── JS plumbing ─────────────────────────────────────────────────────────

    /** The session's WebView, creating it on the main thread when [create].
     *  Only the map is touched here — never a WebView method — so this is safe
     *  from the HTTP thread. Returns null when absent and !create. */
    private fun viewOf(name: String, create: Boolean): WebView? {
        webViews[name]?.let { return it }
        if (!create) return null
        val created = arrayOfNulls<WebView>(1)
        val error = arrayOfNulls<String>(1)
        val latch = CountDownLatch(1)
        main.post {
            try {
                // Re-check inside the critical section: two concurrent
                // creates for one session must yield ONE WebView — a leaked
                // second keeps its renderer and profile alive with no owner
                // (withWebView below makes the same re-check).
                created[0] = webViews[name] ?: createWebView(name).also { webViews[name] = it }
            } catch (e: Throwable) { error[0] = e.message ?: e.javaClass.simpleName }
            finally { latch.countDown() }
        }
        if (!latch.await(20, TimeUnit.SECONDS)) throw IllegalStateException("browser action timed out")
        error[0]?.let { throw IllegalArgumentException(it) }
        return created[0] ?: throw IllegalArgumentException("no such browser session: $name")
    }

    /** Run [script] in the page and return its value.
     *
     *  MUST NOT be called on the main thread: evaluateJavascript delivers its
     *  callback on the main looper, so blocking main while waiting here
     *  deadlocks until the timeout (the "page script timed out" failure of the
     *  first device runs — the page had loaded fine). */
    private fun evalScript(view: WebView, script: String): String {
        val value = arrayOfNulls<String>(1)
        val done = CountDownLatch(1)
        main.post {
            try {
                view.evaluateJavascript(script) { raw ->
                    value[0] = decodeJsString(raw)
                    done.countDown()
                }
            } catch (e: Throwable) {
                done.countDown()
            }
        }
        if (!done.await(15, TimeUnit.SECONDS)) {
            log("evaluateJavascript timed out (url=${view.url}) — renderer never answered")
            throw IllegalStateException("page script timed out")
        }
        return value[0] ?: ""
    }

    /** evaluateJavascript answers a JSON string literal; decode it properly
     *  (JSONTokener handles \u, \n, quotes) instead of a lossy regex strip. */
    private fun decodeJsString(value: String): String {
        val trimmed = value.trim()
        return if (trimmed.startsWith("\"")) JSONTokener(trimmed).nextValue().toString() else trimmed
    }

    private fun checkUrl(url: String) {
        require(url.startsWith("http://") || url.startsWith("https://")) { "only http and https URLs are allowed" }
        require(BrowserSecurity.isSafeWebUrl(url, fixturePort)) { "requests to private/loopback addresses are not allowed" }
    }

    private fun isPrivateHost(host: String): Boolean = BrowserSecurity.isPrivateHost(host)

    // ── HTTP layer ──────────────────────────────────────────────────────────

    override fun serve(session: IHTTPSession): Response {
        if (stopping.get()) return reply(Response.Status.SERVICE_UNAVAILABLE, err("browser driver is stopping"))
        if (session.headers["authorization"] != "Bearer $token") {
            return reply(Response.Status.UNAUTHORIZED, err("bad capability token"))
        }
        val parts = session.uri.trimEnd('/').split("/").filter { it.isNotEmpty() }
        return try {
            val body = readBody(session)
            val response = when {
                parts.size == 1 && parts[0] == "sessions" -> {
                    val names = JSONArray()
                    for (key in webViews.keys()) names.put(key)
                    JSONObject().put("sessions", names)
                }
                parts.size == 1 && parts[0] == "diag" -> {
                    val lines = JSONArray()
                    for (line in diagLog) lines.put(line)
                    JSONObject().put("diag", lines).put("fixturePort", fixturePort)
                }
                parts.size == 3 && parts[0] == "session" -> when (parts[2]) {
                    "open", "navigate" -> open(parts[1], body.getString("url"))
                    "status" -> status(parts[1])
                    "back" -> nav(parts[1]) { if (it.canGoBack()) it.goBack() }
                    "forward" -> nav(parts[1]) { if (it.canGoForward()) it.goForward() }
                    "text" -> text(parts[1], body.optInt("maxChars", 20_000))
                    "dom" -> dom(parts[1], body.optInt("maxElements", 120))
                    "click" -> click(parts[1], body.getString("ref"))
                    "type" -> type(parts[1], body.getString("ref"), body.getString("text"), body.optBoolean("clear", true))
                    "eval" -> evalJs(parts[1], body.getString("expression"))
                    "cookies" -> cookies(parts[1])
                    "clear" -> clearSession(parts[1])
                    "persist" -> withWebView(parts[1], create = false) { }
                        .let {
                            // flush() is a CookieManager call: main thread only.
                            val done = CountDownLatch(1)
                            main.post {
                                try { ProfileStore.getInstance().getProfile(parts[1])?.cookieManager?.flush() } finally { done.countDown() }
                            }
                            done.await(10, TimeUnit.SECONDS)
                            JSONObject().put("persisted", parts[1])
                        }
                    "close" -> closeSession(parts[1])
                    "screenshot" -> {
                        val bytes = screenshot(parts[1])
                        val input = java.io.ByteArrayInputStream(bytes)
                        return newFixedLengthResponse(Response.Status.OK, "image/jpeg", input, bytes.size.toLong())
                    }
                    else -> throw IllegalArgumentException("unknown action ${parts[2]}")
                }
                else -> throw IllegalArgumentException("unknown route ${session.uri}")
            }
            reply(Response.Status.OK, response.put("ok", true).toString())
        } catch (e: Throwable) {
            reply(Response.Status.OK, err(e.message ?: e.javaClass.simpleName))
        }
    }

    private fun readBody(session: IHTTPSession): JSONObject {
        val map = HashMap<String, String>()
        session.parseBody(map)
        val raw = map["postData"] ?: return JSONObject()
        return if (raw.isBlank()) JSONObject() else JSONObject(raw)
    }

    private fun reply(status: Response.Status, body: String): Response =
        newFixedLengthResponse(status, "application/json", body)

    private fun err(message: String): String =
        JSONObject().put("ok", false).put("error", message.take(300)).toString()

    private val stopping = AtomicBoolean(false)

    fun stopAll() {
        stopping.set(true)
        webViews.keys().toList().forEach { destroy(it) }
        stop()
    }

    companion object {
        val LOOPBACK: InetAddress = InetAddress.getByName("127.0.0.1")

        /** The driver binds an ephemeral loopback port; the harness reads the
         *  chosen port + capability token from its own env (AB_DRIVER_PORT /
         *  AB_DRIVER_TOKEN) and hands them to the android_browser MCP server. */
        @Volatile private var current: BrowserDriverServer? = null
        @Volatile private var appContext: Context? = null

        /** Test-only: open exactly one loopback port (the fixture site the
         *  device driver serves). Read once at [start] from the app-private
         *  marker file the device driver plants (files/browser-fixture-port);
         *  production never plants it and the default stays total refusal.
         *  The file is removed immediately after being read. */
        fun start(context: Context, sessionsRoot: File): Pair<Int, String> {
            current?.let { return Pair(it.listeningPort, it.token) }
            appContext = context.applicationContext
            val marker = File(context.filesDir, "browser-fixture-port")
            val injected = marker.takeIf { it.exists() }?.readText()?.trim()?.toIntOrNull() ?: -1
            if (marker.exists()) marker.delete()
            val server = BrowserDriverServer(0, newToken(), sessionsRoot, injected)
            server.start(120_000, true)
            current = server
            return Pair(server.listeningPort, server.token)
        }

        fun stopCurrent() {
            current?.stopAll()
            current = null
        }

        /** The env handoff values for the harness's android_browser server.
         *  0/empty before start — the harness refuses to mount browser tools
         *  without them (fail closed, say why). */
        fun currentPort(): Int = current?.listeningPort ?: 0
        fun currentToken(): String = current?.token ?: ""

        /** True while any bot session WebView is live — MainActivity shows
         *  itself over the keyguard while this holds (an untraversed WebView
         *  behind a stopped activity stalls page loads on some OEM builds). */
        fun hasLiveSessions(): Boolean = (current?.webViews?.size ?: 0) > 0

        /** The live WebView of a session, for the Compose take-control view.
         *  Callers must touch it on the main thread only. */
        fun attachedWebView(sessionName: String): WebView? = current?.webViews?.get(sessionName)

        /** Adopts a bot session's WebView for interactive display in InAppBrowserSurface.
         *  Detaches from decorView and resets translation so it renders on screen. */
        fun adoptSessionWebView(sessionName: String): WebView? {
            val server = current ?: return null
            val view = server.webViews[sessionName] ?: return null
            (view.parent as? ViewGroup)?.removeView(view)
            view.translationX = 0f
            view.isFocusable = true
            view.isClickable = true
            return view
        }

        /** Releases an adopted session WebView back to the background decorView holder. */
        fun releaseSessionWebView(sessionName: String, view: WebView) {
            val server = current ?: return
            if (server.webViews[sessionName] === view) {
                server.attachToHostWindow(view)
            }
        }

        /** The window whose decor view hosts the bots' session WebViews. The
         *  app registers this on every Activity resume: an unattached WebView
         *  never spawns its renderer on several OEM builds. */
        @Volatile
        private var hostWindow: android.view.Window? = null

        fun attachWindow(window: android.view.Window?) {
            hostWindow = window
            val server = current ?: return
            if (window != null) {
                server.main.post {
                    // Adopt in TWO directions: re-parent views that were
                    // created while no window was registered (open-then-resume
                    // ordering — the device driver does exactly this), and
                    // create ones whose session exists in the profile store
                    // but whose WebView was never built.
                    for (name in server.webViews.keys.toList()) {
                        server.webViews[name]?.let { v ->
                            if (!server.attachToHostWindow(v)) {
                                server.webViews.remove(name)
                                v.destroy()
                            }
                        }
                    }
                }
            }
        }

        fun sessionNameForBot(botId: String): String? = current?.sessionNameFor(botId)

        private fun newToken(): String {
            val bytes = ByteArray(32)
            SecureRandom().nextBytes(bytes)
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }
}

/** One query for every element the dom/click/type tools address, kept in one
 *  place so the advertised refs and the acted-on refs can never diverge. */
private const val INTERACTIVE = "'a,button,input,select,textarea,[role=button]'"

private val DOM_SCRIPT = "(function(){var els=document.querySelectorAll($INTERACTIVE);var out=[];" +
    "for(var i=0;i<els.length&&out.length<__CAP__;i++){var e=els[i];var r=e.getBoundingClientRect();" +
    "if(r.width===0&&r.height===0)continue;" +
    "out.push({ref:'@e'+i,tag:e.tagName.toLowerCase(),text:(e.innerText||e.value||e.getAttribute('aria-label')||'').slice(0,80)," +
    "href:e.href||null,input:['INPUT','TEXTAREA','SELECT'].indexOf(e.tagName)>=0,type:e.type||null});}" +
    "return JSON.stringify({count:els.length,elements:out});})()"
