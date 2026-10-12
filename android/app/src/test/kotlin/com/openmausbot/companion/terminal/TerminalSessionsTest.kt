package com.openmausbot.companion.terminal

import java.io.File
import java.io.IOException
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The session layer: what a session is, what starting one does, what reading
 * one means, and — the reason the whole subsystem exists — that a session is
 * not tied to whoever started it.
 *
 * The PTY is faked (FakePty) because a kernel PTY is a device fact, verified on
 * the phone; everything tested here is Kotlin logic, and every failure mode
 * that matters (a program that exits, a program that ignores the hangup, a
 * reader that falls behind) is reachable through the fake.
 */
class TerminalSessionsTest {

    private lateinit var root: File
    private lateinit var nativeDir: File
    private lateinit var home: File
    private lateinit var tmp: File
    private lateinit var program: File
    private lateinit var fake: FakePty
    private lateinit var sessions: TerminalSessions

    @BeforeTest
    fun setUp() {
        root = Files.createTempDirectory("omb-terminal-test").toFile()
        nativeDir = File(root, "native").apply { mkdirs() }
        home = File(root, "home").apply { mkdirs() }
        tmp = File(root, "tmp").apply { mkdirs() }
        // Stand-in for the APK's native library directory: the one place this
        // app is allowed to execute a program from.
        program = File(nativeDir, "libnode_host.so").apply {
            writeText("not really an elf")
            setExecutable(true)
        }
        fake = FakePty()
        var counter = 0
        sessions = TerminalSessions(
            pty = fake,
            homeDir = home,
            tmpDir = tmp,
            nativeLibraryDir = nativeDir,
            idFactory = { "t-${++counter}" },
        )
    }

    @AfterTest
    fun tearDown() {
        runCatching { sessions.closeAll() }
        root.deleteRecursively()
    }

    private fun startTorlnk(rows: Int = 30, cols: Int = 80): TerminalSession =
        sessions.start(
            TerminalSpec(
                program = program.absolutePath,
                args = listOf("--yes", "torlnk"),
                env = mapOf("OMB_NPX_SHIM" to "/server/android-npx-shim.js"),
                cwd = home.absolutePath,
                rows = rows,
                cols = cols,
                label = "torlnk",
                command = "npx --yes torlnk",
            ),
        )

    @Test
    fun `starting a session runs the program in a terminal the app owns`() {
        val session = startTorlnk()
        assertEquals("t-1", session.id)
        assertEquals("torlnk", session.label)
        assertEquals(program.absolutePath, fake.lastProgram)
        assertEquals(listOf(program.absolutePath, "--yes", "torlnk"), fake.lastArgv)
        assertEquals(home.absolutePath, fake.lastCwd)
        assertEquals(30, fake.lastSpawnRows)
        assertEquals(80, fake.lastSpawnCols)
        assertTrue(session.isTerminal())
        assertEquals(1, sessions.list().size)
        assertTrue(session.state.value.running)
    }

    @Test
    fun `the child environment says it has a terminal and keeps the caller's paths`() {
        startTorlnk()
        val env = fake.lastEnv.associate { it.substringBefore('=') to it.substringAfter('=') }
        // Without TERM a program decides it is talking to a dumb pipe, however
        // real the PTY is.
        assertEquals("xterm-256color", env["TERM"])
        assertEquals("truecolor", env["COLORTERM"])
        assertEquals(home.absolutePath, env["HOME"])
        assertEquals(tmp.absolutePath, env["TMPDIR"])
        assertEquals(nativeDir.absolutePath, env["LD_LIBRARY_PATH"])
        assertContains(env.getValue("PATH"), nativeDir.absolutePath)
        // What the caller asked for is passed through unchanged.
        assertEquals("/server/android-npx-shim.js", env["OMB_NPX_SHIM"])
    }

    @Test
    fun `typed text and named keys reach the program the way a terminal sends them`() {
        val session = startTorlnk()
        session.writeText("hi", enter = true)
        session.sendKeys(listOf("up", "enter"))
        session.interrupt()
        assertEquals("hi\r\u001b[A\r\u0003", fake.writtenText())
    }

    @Test
    fun `output arrives raw, and the screen shows it with escape sequences consumed`() {
        val session = startTorlnk()
        fake.feed("\u001b[32mready\u001b[0m\n> ")
        awaitUntil { session.cursor > 0 }
        assertEquals("\u001b[32mready\u001b[0m\n> ", session.read(0).text)
        awaitUntil { session.screen.value.contains("ready") }
        assertFalse(session.screen.value.contains("\u001b"))
        assertEquals("ready\n> ", session.screen.value)
    }

    @Test
    fun `the screen shows the newest output even when the program then goes quiet`() {
        // Found on a real device: a REPL answers in two chunks a few
        // milliseconds apart, then stops. The publish throttle dropped the
        // second chunk and, with nothing more arriving, never republished —
        // so the answer was invisible behind its own prompt forever.
        val session = startTorlnk()
        fake.feed("12345+0\r\n")
        fake.feed("12345\n> ")
        awaitUntil(what = "the second chunk to reach the screen") {
            session.screen.value == "12345+0\n12345\n> "
        }
    }

    @Test
    fun `a read returns only what happened since the last one`() {
        val session = startTorlnk()
        fake.feed("one\n")
        awaitUntil { session.cursor > 0 }
        val first = session.read(0)
        assertEquals("one\n", first.text)
        assertTrue(first.waited)
        fake.feed("two\n")
        awaitUntil { session.cursor > first.cursor }
        val second = session.read(first.cursor)
        assertEquals("two\n", second.text)
        // Nothing new: the reader is told so instead of being handed old bytes.
        val third = session.read(second.cursor)
        assertEquals("", third.text)
        assertFalse(third.waited)
        assertEquals(second.cursor, third.cursor)
    }

    @Test
    fun `a read can wait for output instead of asking again immediately`() {
        val session = startTorlnk()
        val cursor = session.cursor
        val printer = Thread {
            Thread.sleep(120)
            fake.feed("late\n")
        }
        printer.start()
        val result = session.read(cursor, waitMs = 3_000)
        printer.join()
        assertEquals("late\n", result.text)
        assertTrue(result.waited)
    }

    @Test
    fun `resizing reaches the program, and the session reports the new size`() {
        val session = startTorlnk()
        val size = session.resize(rows = 42, cols = 118)
        assertEquals(42, size.rows)
        assertEquals(118, size.cols)
        assertEquals(42 to 118, fake.resizes.poll())
        assertEquals(42, session.size.value.rows)
        // Out-of-range values are clamped, never passed through to a program.
        assertEquals(TerminalSession.MAX_ROWS, session.resize(rows = 99_999, cols = 99_999).rows)
        assertEquals(TerminalSession.MAX_COLS, session.size.value.cols)
    }

    @Test
    fun `a program that exits is reported with its status and its output is kept`() {
        val session = startTorlnk()
        fake.feed("goodbye\n")
        fake.exit(0)
        awaitUntil { !session.state.value.running }
        assertEquals(0, session.state.value.exitCode)
        assertNull(session.state.value.signal)
        assertFalse(session.state.value.closed)
        // The output it produced before exiting is still readable.
        assertEquals("goodbye\n", session.read(0).text)
    }

    @Test
    fun `a program killed by a signal is reported as stopped, not exited`() {
        val session = startTorlnk()
        fake.killedBy(11)
        awaitUntil { !session.state.value.running }
        assertEquals(11, session.state.value.signal)
        assertNull(session.state.value.exitCode)
    }

    @Test
    fun `closing hangs the program up, releases the terminal, and removes the session`() {
        val session = startTorlnk()
        sessions.close(session.id)
        assertContains(fake.signals.toList(), 1 to true)
        assertTrue(session.state.value.closed)
        assertFalse(session.state.value.running)
        assertTrue(fake.closedFds.isNotEmpty())
        assertNull(sessions.get(session.id))
        assertTrue(sessions.list().isEmpty())
    }

    @Test
    fun `a program that ignores the hangup is killed rather than left running`() {
        fake.ignoresHangup = true
        val session = startTorlnk()
        sessions.close(session.id)
        assertContains(fake.signals.toList(), 9 to true)
        assertFalse(session.state.value.running)
    }

    @Test
    fun `closing everything leaves nothing running`() {
        val first = startTorlnk()
        val second = startTorlnk()
        sessions.closeAll()
        assertTrue(sessions.list().isEmpty())
        for (session in listOf(first, second)) {
            assertTrue(session.state.value.closed)
            assertFalse(session.state.value.running)
        }
    }

    @Test
    fun `a program this phone may not run is refused before anything starts`() {
        val elsewhere = File(root, "elsewhere.sh").apply {
            writeText("#!/system/bin/sh\n")
            setExecutable(true)
        }
        val refused = assertFailsWith<TerminalStartException> {
            sessions.start(TerminalSpec(program = elsewhere.absolutePath))
        }
        assertContains(refused.message!!, "its own runtime and system programs")
        assertTrue(sessions.list().isEmpty())
        assertNull(fake.lastProgram)
    }

    @Test
    fun `a missing, non-executable, or relative program is refused with a reason`() {
        assertFailsWith<TerminalStartException> {
            sessions.start(TerminalSpec(program = File(nativeDir, "ghost").absolutePath))
        }
        val data = File(nativeDir, "notes.txt").apply { writeText("not a program") }
        assertFailsWith<TerminalStartException> {
            sessions.start(TerminalSpec(program = data.absolutePath))
        }
        assertFailsWith<TerminalStartException> {
            sessions.start(TerminalSpec(program = "npx"))
        }
    }

    @Test
    fun `a failed start registers nothing and holds no slot`() {
        fake.spawnFailure = IOException("the terminal's program could not be started: Permission denied")
        assertFailsWith<IOException> { startTorlnk() }
        assertTrue(sessions.list().isEmpty())
        // The slot is free: fixing the cause and trying again works.
        fake.spawnFailure = null
        assertEquals("t-1", startTorlnk().id)
    }

    @Test
    fun `the number of terminals at once is bounded`() {
        repeat(TerminalSessions.MAX_SESSIONS) { startTorlnk() }
        val refused = assertFailsWith<TerminalStartException> { startTorlnk() }
        assertContains(refused.message!!, "too many terminals")
        sessions.close(sessions.list().first().id)
        startTorlnk()
        assertEquals(TerminalSessions.MAX_SESSIONS, sessions.list().size)
    }

    @Test
    fun `a session outlives the turn that opened it`() {
        // The turn: start a program, return, and never speak to it again.
        val id = startTorlnk().id

        // The turn is over. The program keeps producing output, and a reader
        // that never saw the session start still gets everything it retained.
        fake.feed("still here\n")
        val fresh = sessions.get(id)!!
        awaitUntil { fresh.cursor > 0 }
        assertTrue(fresh.state.value.running)
        assertEquals("still here\n", fresh.read(0).text)

        // And the bot's next turn can answer it.
        fresh.writeText("yes", enter = true)
        assertContains(fake.writtenText(), "yes\r")
        assertEquals(1, sessions.list().size)
    }

    @Test
    fun `the registry asks for a live session to be shown and nothing else`() {
        val session = startTorlnk()
        sessions.requestOpen(session.id)
        assertEquals(session.id, sessions.openRequest.value)
        sessions.consumeOpenRequest()
        assertNull(sessions.openRequest.value)
        sessions.close(session.id)
        sessions.requestOpen(session.id)
        assertNull(sessions.openRequest.value)
    }
}
