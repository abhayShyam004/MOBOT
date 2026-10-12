package com.openmausbot.companion.terminal

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * What a terminal's byte stream looks like on a phone, and what the keyboard
 * sends back. These are the rules a person actually sees: escape sequences that
 * would otherwise print as garbage, a progress line that redraws itself, a
 * program that colours its prompt.
 */
class TerminalTextTest {

    @Test
    fun `colour and cursor sequences are consumed, not printed`() {
        assertEquals("hello", TerminalText.render("\u001b[31mhello\u001b[0m"))
        assertEquals("x", TerminalText.render("\u001b[2J\u001b[Hx"))
        // OSC (a window title) ends at BEL.
        assertEquals("ok", TerminalText.render("\u001b]0;torlnk\u0007ok"))
        // A truncated sequence at the end of a chunk stays consumed: printing
        // its bytes would put them on screen for real.
        assertEquals("a", TerminalText.render("a\u001b[3"))
    }

    @Test
    fun `carriage return rewrites the line instead of stacking copies`() {
        assertEquals("one\ntwo", TerminalText.render("one\r\ntwo"))
        // A line rewritten twice keeps only the last painting of it.
        assertEquals("...100%", TerminalText.render("...10%\r...50%\r...100%"))
        // What a line-rewriting program actually sends: rewrite, then erase to
        // the end of the line.
        assertEquals("done", TerminalText.render("loading...\r\u001b[Kdone"))
        // Because this is a cursor, not a line reset, a SHORTER rewrite leaves
        // the tail of the longer line visible — which is exactly what a real
        // terminal shows, and why the erase above is the interesting case.
        assertEquals("doneing...", TerminalText.render("loading...\rdone"))
    }

    @Test
    fun `erase and cursor-home sequences clear what they say they clear`() {
        assertEquals("", TerminalText.render("first\u001b[2J"))
        assertEquals("x", TerminalText.render("\u001b[2J\u001b[Hx"))
        // `CSI H` with no parameters is home; `CSI r;c H` is a position, and a
        // position above the first line is the first line, not a new screen.
        assertEquals("ab", TerminalText.render("abcdef\u001b[1Hab\u001b[K"))
        assertEquals("abx\ncd", TerminalText.render("ab\ncd\u001b[1;3Hx"))
    }

    @Test
    fun `backspace rewinds within the line and stops at the line start`() {
        assertEquals("abX", TerminalText.render("abc\bX"))
        assertEquals("one\nX", TerminalText.render("one\n\bX"))
    }

    @Test
    fun `other control bytes are dropped, tabs and newlines survive`() {
        assertEquals("a\tb\nc", TerminalText.render("a\tb\u0007\nc"))
        assertEquals("b", TerminalText.render("\u0000\u0001b"))
    }

    @Test
    fun `a repainting prompt lands back at the start of its line`() {
        // What the Node REPL actually sends for a prompt on a terminal: move to
        // column 1, erase to the end of the screen, print the prompt, park the
        // cursor after it. Four of those must be one prompt, not four.
        val prompt = "\u001b[1G\u001b[0J> \u001b[3G"
        assertEquals("\n> ", TerminalText.render("\n" + prompt.repeat(4)))
        // A column move is a move, not a line reset: what follows overwrites.
        assertEquals("abXdef", TerminalText.render("abcdef\u001b[3GX"))
        // Back two, forward one, and up a line to overwrite the one above.
        assertEquals("abcdXf", TerminalText.render("abcdef\u001b[2DX"))
        assertEquals("abcdeX", TerminalText.render("abcdef\u001b[2D\u001b[1CX"))
        assertEquals("oneX\ntwo", TerminalText.render("one\ntwo\u001b[1A\u001b[4GX"))
        // Up past the top is the top, never an index error on real input.
        assertEquals("ab", TerminalText.render("a\u001b[9Ab"))
        // Erase above removes what is above the cursor; erase display, all of it.
        assertEquals("\nbbb", TerminalText.render("aaa\nbbb\r\u001b[1J"))
        assertEquals("", TerminalText.render("a\nb\nc\u001b[2J"))
        // A private mode (cursor hide) is consumed, not printed, and must not
        // disturb the cursor.
        assertEquals("hi", TerminalText.render("\u001b[?25lhi\u001b[?25h"))
    }

    @Test
    fun `the node repl's own banner and answer render as a person sees them`() {
        // Captured from a real PTY on the phone: the banner, four prompt
        // repaints, a typed line echoed back, and the coloured answer.
        val raw = "Welcome to Node.js v26.4.0.\r\n" +
            "Type \".help\" for more information.\r\n" +
            "\u001b[1G\u001b[0J> \u001b[3G".repeat(4) +
            "12345+0\r\r\n\u001b[33m12345\u001b[39m\r\n\u001b[1G\u001b[0J> \u001b[3G"
        assertEquals(
            "Welcome to Node.js v26.4.0.\n" +
                "Type \".help\" for more information.\n" +
                "> 12345+0\n" +
                "12345\n" +
                "> ",
            TerminalText.render(raw),
        )
    }

    @Test
    fun `named keys are the sequences a terminal sends`() {
        assertEquals("\r", TerminalText.keySequence("enter"))
        assertEquals("\r", TerminalText.keySequence("Return"))
        assertEquals("\u0003", TerminalText.keySequence("ctrl-c"))
        assertEquals("\u001b[A", TerminalText.keySequence("up"))
        assertEquals("\u007f", TerminalText.keySequence("backspace"))
        assertEquals(" ", TerminalText.keySequence("space"))
        assertNull(TerminalText.keySequence("definitely-not-a-key"))
    }

    @Test
    fun `typed newlines become the Enter key a program waits for`() {
        assertEquals("hi\rthere", TerminalText.toTerminalInput("hi\nthere"))
        assertEquals("hi\rthere", TerminalText.toTerminalInput("hi\r\nthere"))
    }
}
