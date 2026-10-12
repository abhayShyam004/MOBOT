package com.openmausbot.companion.terminal

import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetAddress
import java.security.SecureRandom
import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The seam between the harness (a Node process) and the terminals this app
 * hosts.
 *
 * Same shape as [com.openmausbot.companion.host.BrowserDriverServer], for the
 * same reasons: the harness cannot fork a PTY (it is not the process that owns
 * one), and it must not be handed the app's internals. So this app owns the
 * sessions and answers a small loopback HTTP API with a per-boot capability
 * token — a token that reaches Node through the harness environment, which
 * carries paths and ports and never a credential, and which authorizes exactly
 * this child, on loopback only.
 *
 * Every endpoint answers `{ok:true, …}` or `{ok:false, error:"…"}` — the MCP
 * layer maps that onto tool results, so a refusal is a tool error the model can
 * read rather than an HTTP-level mystery.
 *
 * Read shape: `read` returns the output after a cursor plus the cursor to use
 * next, so a caller that looks once (a tool call, a screen that just appeared)
 * and a caller that looks continuously (the terminal surface) can share one
 * buffer without either of them owning a stream.
 */
class TerminalDriverServer private constructor(
    port: Int,
    private val token: String,
    private val sessions: TerminalSessions,
) : NanoHTTPD(LOOPBACK.hostAddress, port) {

    private val diag = ConcurrentLinkedDeque<String>()

    private fun log(line: String) {
        diag.addLast(line)
        while (diag.size > 400) diag.pollFirst()
        // Also logcat: the diag ring is only readable from inside the app, and
        // a terminal that will not start has to be diagnosable from `adb
        // logcat` (this is how every driver-side failure is investigated).
        android.util.Log.i("TerminalDriver", line)
    }

    // ── actions ─────────────────────────────────────────────────────────────

    private fun sessionJson(session: TerminalSession): JSONObject {
        val state = session.state.value
        return JSONObject()
            .put("id", session.id)
            .put("label", session.label)
            .put("command", session.command)
            .put("program", session.program)
            .put("botId", session.botId ?: JSONObject.NULL)
            .put("pid", session.pid)
            .put("rows", session.size.value.rows)
            .put("cols", session.size.value.cols)
            .put("cursor", session.cursor)
            .put("startedAt", session.startedAt)
            // Proof from the kernel, not from our bookkeeping: the program's
            // standard input really is a terminal.
            .put("terminal", session.isTerminal())
            .put(
                "state",
                JSONObject()
                    .put("running", state.running)
                    .put("exitCode", state.exitCode ?: JSONObject.NULL)
                    .put("signal", state.signal ?: JSONObject.NULL)
                    .put("closed", state.closed)
                    .put("error", state.error ?: JSONObject.NULL),
            )
    }

    private fun start(body: JSONObject): JSONObject {
        val program = body.optString("program", "")
        val args = body.optJSONArray("args")?.let { array ->
            (0 until array.length()).map { array.optString(it) }
        } ?: emptyList()
        val env = body.optJSONObject("env")?.let { object_ ->
            object_.keys().asSequence().associateWith { object_.optString(it) }
        } ?: emptyMap()
        val spec = TerminalSpec(
            program = program,
            args = args,
            env = env,
            cwd = body.optString("cwd", "").takeIf { it.isNotBlank() },
            rows = body.optInt("rows", 30),
            cols = body.optInt("cols", 80),
            label = body.optString("label", ""),
            command = body.optString("command", ""),
            botId = body.optString("botId", "").takeIf { it.isNotBlank() },
        )
        log("start: ${spec.command.ifBlank { spec.program }} (${spec.cols}x${spec.rows})")
        val session = try {
            sessions.start(spec)
        } catch (error: TerminalStartException) {
            log("start refused: ${error.message}")
            throw error
        } catch (error: Exception) {
            log("start failed: ${error.javaClass.simpleName}: ${error.message}")
            throw TerminalStartException(
                "the terminal could not be started: ${error.message ?: error.javaClass.simpleName}",
            )
        }
        if (body.optBoolean("show", true)) sessions.requestOpen(session.id)
        return JSONObject().put("session", sessionJson(session))
    }

    private fun requireSession(id: String): TerminalSession {
        require(id.matches(SESSION_ID)) { "invalid terminal session" }
        return sessions.get(id) ?: throw IllegalArgumentException("no such terminal session: $id")
    }

    private fun write(id: String, body: JSONObject): JSONObject {
        val session = requireSession(id)
        var written = 0
        val text = body.optString("text", "")
        if (text.isNotEmpty()) {
            val payload = TerminalText.toTerminalInput(text).toByteArray(Charsets.UTF_8)
            written += session.write(payload)
        }
        val keys = body.optJSONArray("keys")
        if (keys != null) {
            val names = (0 until keys.length()).map { keys.optString(it) }
            for (name in names) {
                val sequence = TerminalText.keySequence(name)
                    ?: throw IllegalArgumentException("unknown key: $name")
                written += session.write(sequence.toByteArray(Charsets.ISO_8859_1))
            }
        }
        if (body.optBoolean("enter", false)) {
            written += session.write(byteArrayOf(0x0d))
        }
        return JSONObject().put("written", written).put("session", sessionJson(session))
    }

    private fun read(id: String, body: JSONObject): JSONObject {
        val session = requireSession(id)
        val cursor = if (body.has("cursor")) body.optLong("cursor") else session.cursor
        val maxBytes = body.optInt("maxBytes", 65_536).coerceIn(256, 256 * 1024)
        val waitMs = body.optLong("waitMs", 0L).coerceIn(0L, 120_000L)
        val result = session.read(cursor, maxBytes, waitMs)
        return JSONObject()
            .put("data", result.text)
            .put("bytes", result.bytes)
            .put("cursor", result.cursor)
            .put("total", result.total)
            .put("missed", result.missed)
            .put("waited", result.waited)
            .put("session", sessionJson(session))
    }

    private fun resize(id: String, body: JSONObject): JSONObject {
        val session = requireSession(id)
        val size = session.resize(body.optInt("rows", session.size.value.rows), body.optInt("cols", session.size.value.cols))
        log("resize $id → ${size.cols}x${size.rows}")
        return JSONObject()
            .put("rows", size.rows)
            .put("cols", size.cols)
            .put("session", sessionJson(session))
    }

    private fun close(id: String, body: JSONObject): JSONObject {
        val before = requireSession(id)
        val json = sessionJson(before)
        sessions.close(id, force = body.optBoolean("force", false))
        val state = before.state.value
        return JSONObject()
            .put("closed", id)
            .put("session", json.put("state", JSONObject()
                .put("running", state.running)
                .put("exitCode", state.exitCode ?: JSONObject.NULL)
                .put("signal", state.signal ?: JSONObject.NULL)
                .put("closed", state.closed)))
    }

    private fun list(): JSONObject {
        val array = JSONArray()
        for (session in sessions.list()) array.put(sessionJson(session))
        return JSONObject().put("sessions", array)
    }

    // ── HTTP layer ──────────────────────────────────────────────────────────

    override fun serve(session: IHTTPSession): Response {
        if (stopping.get()) return reply(Response.Status.SERVICE_UNAVAILABLE, err("terminal driver is stopping"))
        if (session.headers["authorization"] != "Bearer $token") {
            return reply(Response.Status.UNAUTHORIZED, err("bad capability token"))
        }
        val parts = session.uri.trimEnd('/').split("/").filter { it.isNotEmpty() }
        return try {
            val body = readBody(session)
            val response = when {
                parts.size == 1 && parts[0] == "health" -> JSONObject()
                parts.size == 1 && parts[0] == "sessions" -> list()
                parts.size == 1 && parts[0] == "diag" -> JSONObject().put("diag", JSONArray(diag.toList()))
                parts.size == 1 && parts[0] == "start" -> start(body)
                parts.size == 2 && parts[0] == "session" -> sessionJson(requireSession(parts[1]))
                parts.size == 3 && parts[0] == "session" -> when (parts[2]) {
                    "write", "input" -> write(parts[1], body)
                    "read", "output" -> read(parts[1], body)
                    "resize" -> resize(parts[1], body)
                    "close" -> close(parts[1], body)
                    else -> throw IllegalArgumentException("unknown action ${parts[2]}")
                }
                else -> throw IllegalArgumentException("unknown route ${session.uri}")
            }
            reply(Response.Status.OK, response.put("ok", true).toString())
        } catch (error: Throwable) {
            reply(Response.Status.OK, err(error.message ?: error.javaClass.simpleName))
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

    fun stopServer() {
        stopping.set(true)
        stop()
    }

    companion object {
        val LOOPBACK: InetAddress = InetAddress.getByName("127.0.0.1")

        private val SESSION_ID = Regex("[A-Za-z0-9_-]{1,64}")

        @Volatile private var current: TerminalDriverServer? = null

        /** Bind an ephemeral loopback port. The harness reads the port and the
         *  token from its own environment (`AT_DRIVER_PORT`/`AT_DRIVER_TOKEN`)
         *  and hands them to the android_computer MCP server. */
        fun start(sessions: TerminalSessions): Pair<Int, String> {
            current?.let { return Pair(it.listeningPort, it.token) }
            val server = TerminalDriverServer(0, newToken(), sessions)
            server.start(120_000, true)
            current = server
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
