package com.openmausbot.companion.ui

import com.openmausbot.companion.terminal.FakePty
import com.openmausbot.companion.terminal.TerminalSessions
import com.openmausbot.companion.terminal.TerminalSpec
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Which terminal is on screen, and what leaving it means.
 *
 * The rules here are the ones a person experiences: the terminal a bot opens is
 * put in front of them, leaving it does not end the program, and a session that
 * has been closed is never shown — including when the screen was showing it.
 */
class TerminalPresentationTest {

    private lateinit var root: File
    private lateinit var nativeDir: File
    private lateinit var program: File
    private lateinit var fake: FakePty
    private lateinit var sessions: TerminalSessions

    @BeforeTest
    fun setUp() {
        root = Files.createTempDirectory("omb-terminal-ui-test").toFile()
        nativeDir = File(root, "native").apply { mkdirs() }
        File(root, "home").mkdirs()
        File(root, "tmp").mkdirs()
        program = File(nativeDir, "libnode_host.so").apply {
            writeText("not really an elf")
            setExecutable(true)
        }
        fake = FakePty()
        var counter = 0
        sessions = TerminalSessions(
            pty = fake,
            homeDir = File(root, "home"),
            tmpDir = File(root, "tmp"),
            nativeLibraryDir = nativeDir,
            idFactory = { "t-${++counter}" },
        )
    }

    @AfterTest
    fun tearDown() {
        runCatching { sessions.closeAll() }
        root.deleteRecursively()
    }

    private fun open(): String =
        sessions.start(
            TerminalSpec(program = program.absolutePath, label = "torlnk", command = "npx --yes torlnk"),
        ).id

    @Test
    fun `a bot opening a terminal puts it in front of the person`() {
        val presentation = TerminalPresentation(sessions)
        val id = open()
        sessions.requestOpen(id)
        assertEquals(id, sessions.openRequest.value)

        presentation.consumeOpenRequest(sessions.openRequest.value)
        assertTrue(presentation.visible)
        assertEquals(id, presentation.selectedId)
        assertEquals(id, presentation.selected?.id)
        // Consumed: a recomposition cannot re-open something the person left.
        assertNull(sessions.openRequest.value)
    }

    @Test
    fun `leaving the surface never ends the program`() {
        val presentation = TerminalPresentation(sessions)
        val id = open()
        sessions.requestOpen(id)
        presentation.consumeOpenRequest(sessions.openRequest.value)

        presentation.leave()
        assertFalse(presentation.visible)
        assertEquals(id, sessions.get(id)?.id)
        assertTrue(sessions.get(id)!!.state.value.running)

        // Returning to it shows the same session, still running.
        presentation.show(id)
        assertTrue(presentation.visible)
        assertTrue(presentation.selected!!.state.value.running)
    }

    @Test
    fun `the surface follows a session that was closed underneath it`() {
        val presentation = TerminalPresentation(sessions)
        val first = open()
        val second = open()
        presentation.show(first)

        sessions.close(first)
        presentation.reconcile()
        assertEquals(second, presentation.selectedId)
        assertTrue(presentation.visible)

        sessions.close(second)
        presentation.reconcile()
        assertNull(presentation.selectedId)
        assertFalse(presentation.visible)
    }

    @Test
    fun `a recreated screen finds the same running terminal`() {
        val before = TerminalPresentation(sessions)
        val id = open()
        before.show(id)
        fake.feed("still working\n")

        // The Activity is recreated: the presentation is gone, the registry is
        // not. This is the whole reason sessions are owned at app scope.
        val after = TerminalPresentation(sessions)
        after.reconcile()
        assertEquals(id, after.selectedId)
        assertFalse(after.visible)
        after.show(id)
        assertTrue(after.visible)
        assertTrue(after.selected!!.state.value.running)
    }

    @Test
    fun `a second terminal is reachable and stays the one the person was in`() {
        val presentation = TerminalPresentation(sessions)
        val first = open()
        val second = open()
        presentation.show(first)

        // The chip for the second one opens the second one — not whichever
        // session happened to be first in the registry.
        presentation.show(second)
        assertEquals(second, presentation.selectedId)

        presentation.leave()
        assertFalse(presentation.visible)
        // Leaving does not forget which terminal it was: the chip that is
        // marked, and the one a single tap returns to, is the same one.
        assertEquals(second, presentation.selectedId)
        assertEquals(second, sessions.get(second)?.id)
        assertTrue(sessions.get(first)!!.state.value.running)
        assertTrue(sessions.get(second)!!.state.value.running)
    }

    @Test
    fun `a bot opening a second terminal swaps the surface to it`() {
        val presentation = TerminalPresentation(sessions)
        val first = open()
        sessions.requestOpen(first)
        presentation.consumeOpenRequest(sessions.openRequest.value)
        assertEquals(first, presentation.selectedId)

        val second = open()
        sessions.requestOpen(second)
        presentation.consumeOpenRequest(sessions.openRequest.value)
        assertEquals(second, presentation.selectedId)
        assertTrue(presentation.visible)
    }

    @Test
    fun `showing a session that does not exist does nothing`() {
        val presentation = TerminalPresentation(sessions)
        presentation.show("t-does-not-exist")
        assertFalse(presentation.visible)
        assertNull(presentation.selectedId)
    }
}
