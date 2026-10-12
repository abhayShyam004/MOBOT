package com.openmausbot.companion.terminal

/**
 * What a terminal's byte stream looks like on a phone screen, and what a phone
 * keyboard sends back.
 *
 * This is deliberately *not* a full terminal emulator: no scroll regions, no
 * alternate screen, no scrolling on overflow, no cell attributes. It is the
 * part of an emulator that decides whether the output is *readable*: a screen
 * model of lines and a cursor, escape sequences consumed instead of printed,
 * and carriage return / backspace / erase-line honoured the way a program that
 * redraws a line expects.
 *
 * That line model is why this is more than a strip-the-escapes pass:
 *
 *  * `\r` moves the cursor to column 0 of the current line, and later characters
 *    *overwrite* what was there — which is how a progress line renders as one
 *    line instead of a stack of copies, and why a short rewrite leaves the tail
 *    of a longer line visible, exactly as a real terminal shows it;
 *  * `\n` moves to the next line (`\r\n` therefore behaves as a line ending,
 *    and a lone `\n` as one too, which is what the kernel's ONLCR has already
 *    done to a program's newline before it reaches us);
 *  * `\b` moves back within the line;
 *  * the cursor movement sequences a redrawing program actually uses are
 *    honoured — `CSI n G` (column), `CSI n A`/`B`/`C`/`D` (up/down/forward/
 *    back) and `CSI r;c H` (position) — because a prompt that repaints itself
 *    with `CSI 1 G` must land back at the start of the line, not stack a copy
 *    of itself beside the last one;
 *  * `CSI K` (erase in line), `CSI J` (erase in display) and `CSI H` (cursor
 *    home) are honoured, because those are the sequences a line-rewriting or
 *    screen-clearing program actually uses;
 *  * every other escape sequence (including SGR colour, OSC titles) is consumed.
 *
 * A program that paints a full grid and repaints it every frame will render as
 * successive frames in a stream rather than as a painting. That is the honest
 * limitation of not being an emulator, and it is stated in the final report.
 */
internal object TerminalText {

    /**
     * Strip control sequences and apply CR/BS/TAB/erase so the result is what a
     * person would have seen.
     */
    fun render(raw: String): String {
        if (raw.isEmpty()) return ""
        val lines = ArrayList<StringBuilder>(16)
        lines.add(StringBuilder())
        var row = 0
        var col = 0

        fun line(): StringBuilder = lines[row]
        fun ensureRow(r: Int) {
            while (lines.size <= r) lines.add(StringBuilder())
        }
        fun newline() {
            row += 1
            ensureRow(row)
            col = 0
        }
        fun put(c: Char) {
            val current = line()
            while (current.length < col) current.append(' ')
            if (col < current.length) current.setCharAt(col, c) else current.append(c)
            col += 1
        }

        var i = 0
        while (i < raw.length) {
            val c = raw[i]
            when {
                c == '\u001b' -> {
                    val next = handleEscape(raw, i)
                    when (next.op) {
                        Op.CURSOR_POSITION -> {
                            row = (next.first - 1).coerceAtLeast(0)
                            ensureRow(row)
                            col = (next.second - 1).coerceAtLeast(0)
                        }
                        Op.CURSOR_UP -> row = (row - next.first).coerceAtLeast(0)
                        Op.CURSOR_DOWN -> {
                            row += next.first
                            ensureRow(row)
                        }
                        Op.CURSOR_COLUMN -> col = (next.first - 1).coerceAtLeast(0)
                        Op.CURSOR_FORWARD -> col += next.first
                        Op.CURSOR_BACK -> col = (col - next.first).coerceAtLeast(0)
                        Op.ERASE_LINE_FROM_CURSOR -> if (col < line().length) line().setLength(col)
                        Op.ERASE_LINE_TO_CURSOR -> {
                            for (j in 0 until minOf(col, line().length)) line().setCharAt(j, ' ')
                        }
                        Op.ERASE_LINE -> {
                            line().setLength(0)
                            col = 0
                        }
                        Op.ERASE_BELOW -> {
                            if (col < line().length) line().setLength(col)
                            for (j in row + 1 until lines.size) lines[j].setLength(0)
                        }
                        Op.ERASE_ABOVE -> {
                            for (j in 0 until minOf(row, lines.size)) lines[j].setLength(0)
                            for (j in 0 until minOf(col, line().length)) line().setCharAt(j, ' ')
                        }
                        Op.ERASE_SCREEN -> {
                            for (j in 0 until minOf(row, lines.size)) lines[j].setLength(0)
                            line().setLength(0)
                            col = 0
                        }
                        Op.NONE -> Unit
                    }
                    i = next.index
                }
                c == '\r' -> { col = 0; i++ }
                c == '\b' -> { if (col > 0) col -= 1; i++ }
                c == '\n' -> { newline(); i++ }
                c == '\t' -> { put('\t'); i++ }
                c.code in 0..0x1f || c.code == 0x7f -> i++
                else -> { put(c); i++ }
            }
        }
        // Trailing empty lines are how a stream ends, not content worth keeping
        // (a cleared screen would otherwise push the real output off the top).
        while (lines.size > 1 && lines.last().isEmpty()) lines.removeAt(lines.size - 1)
        return lines.joinToString("\n")
    }

    fun render(bytes: ByteArray): String = render(bytes.toString(Charsets.UTF_8))

    private enum class Op {
        NONE,
        CURSOR_POSITION,
        CURSOR_UP,
        CURSOR_DOWN,
        CURSOR_FORWARD,
        CURSOR_BACK,
        CURSOR_COLUMN,
        ERASE_LINE_FROM_CURSOR,
        ERASE_LINE_TO_CURSOR,
        ERASE_LINE,
        ERASE_BELOW,
        ERASE_ABOVE,
        ERASE_SCREEN,
    }

    /**
     * One consumed escape sequence: where parsing resumes, what it does, and
     * the numbers it carried. `first` is the line or repeat count and `second`
     * the column, already normalised to the 1-based form the sequences are
     * written in — a missing parameter means 1 for a cursor move and 0 for an
     * erase, which is what every terminal does and what readline relies on.
     */
    private class Escape(val index: Int, val op: Op, val first: Int = 0, val second: Int = 0)

    /**
     * Consume the escape sequence starting at [start] (which is known to be
     * `ESC`) and report what it does. Incomplete sequences consume the rest of
     * the chunk: printing their bytes would put them on screen.
     *
     * Cursor moves are clamped to the length of the chunk being rendered: a
     * sequence cannot legitimately move further than the data that carried it,
     * and without the clamp a 10-byte sequence could be made to allocate a
     * screen the size of a large integer.
     */
    private fun handleEscape(raw: String, start: Int): Escape {
        val after = start + 1
        val limit = raw.length.coerceAtLeast(1)
        if (after >= raw.length) return Escape(raw.length, Op.NONE)
        return when (raw[after]) {
            '[' -> {
                var i = after + 1
                val params = StringBuilder()
                var final = '\u0000'
                while (i < raw.length) {
                    val code = raw[i].code
                    if (code in 0x40..0x7e) { final = raw[i]; break }
                    params.append(raw[i])
                    i++
                }
                if (final == '\u0000') return Escape(raw.length, Op.NONE)
                // `CSI ? 25 l`, `CSI 4 ; 1 m` and any other shape parse the
                // same way: numbers where they exist, defaults where they do
                // not, and the sequence is consumed either way.
                val numbers = params.toString().split(';').map { part ->
                    part.trimStart('?', '>', '<', '=').trim().toIntOrNull() ?: 0
                }
                val first = numbers.getOrElse(0) { 0 }
                val second = numbers.getOrElse(1) { 0 }
                fun count(): Int = (if (first > 0) first else 1).coerceAtMost(limit)
                fun position(): Int = (if (first > 0) first else 1).coerceAtMost(limit)
                val op = when (final) {
                    'H', 'f' -> Op.CURSOR_POSITION
                    'A' -> Op.CURSOR_UP
                    'B' -> Op.CURSOR_DOWN
                    'C' -> Op.CURSOR_FORWARD
                    'D' -> Op.CURSOR_BACK
                    'G' -> Op.CURSOR_COLUMN
                    'K' -> when (first) {
                        1 -> Op.ERASE_LINE_TO_CURSOR
                        2 -> Op.ERASE_LINE
                        else -> Op.ERASE_LINE_FROM_CURSOR
                    }
                    'J' -> when (first) {
                        1 -> Op.ERASE_ABOVE
                        2, 3 -> Op.ERASE_SCREEN
                        else -> Op.ERASE_BELOW
                    }
                    else -> Op.NONE
                }
                return when (op) {
                    Op.CURSOR_POSITION ->
                        Escape(i + 1, op, position(), (if (second > 0) second else 1).coerceAtMost(limit))
                    Op.CURSOR_UP, Op.CURSOR_DOWN, Op.CURSOR_FORWARD, Op.CURSOR_BACK ->
                        Escape(i + 1, op, count())
                    Op.CURSOR_COLUMN -> Escape(i + 1, op, position())
                    else -> Escape(i + 1, op)
                }
            }
            ']', 'P', '^', '_' -> {
                // OSC / DCS / PM / APC: terminated by BEL or ST (ESC \).
                var i = after + 1
                while (i < raw.length) {
                    if (raw[i] == '\u0007') return Escape(i + 1, Op.NONE)
                    if (raw[i] == '\u001b' && i + 1 < raw.length && raw[i + 1] == '\\') {
                        return Escape(i + 2, Op.NONE)
                    }
                    i++
                }
                Escape(raw.length, Op.NONE)
            }
            else -> Escape((after + 1).coerceAtMost(raw.length), Op.NONE)
        }
    }

    /** What a terminal sends for each named key. The UI's key row and the
     *  agent's `keys` argument share this one table. */
    private val KEYS: Map<String, String> = mapOf(
        "enter" to "\r",
        "return" to "\r",
        "tab" to "\t",
        "backspace" to "\u007f",
        "delete" to "\u001b[3~",
        "escape" to "\u001b",
        "esc" to "\u001b",
        "space" to " ",
        "up" to "\u001b[A",
        "down" to "\u001b[B",
        "right" to "\u001b[C",
        "left" to "\u001b[D",
        "home" to "\u001b[H",
        "end" to "\u001b[F",
        "pageup" to "\u001b[5~",
        "pagedown" to "\u001b[6~",
        "shift-tab" to "\u001b[Z",
        "ctrlc" to "\u0003",
        "ctrl-c" to "\u0003",
        "ctrld" to "\u0004",
        "ctrl-d" to "\u0004",
        "ctrlz" to "\u001a",
        "ctrl-z" to "\u001a",
        "ctrll" to "\u000c",
        "ctrl-l" to "\u000c",
        "ctrla" to "\u0001",
        "ctrl-a" to "\u0001",
        "ctrle" to "\u0005",
        "ctrl-e" to "\u0005",
        "ctrlk" to "\u000b",
        "ctrl-k" to "\u000b",
        "ctrlu" to "\u0015",
        "ctrl-u" to "\u0015",
    )

    fun keySequence(name: String): String? = KEYS[name.trim().lowercase()]

    /**
     * Text on its way to a terminal: a newline is Enter (CR), not LF — a real
     * terminal's Enter key sends 0x0D, and that is what a line-based program is
     * waiting for.
     */
    fun toTerminalInput(text: String): String =
        text.replace("\r\n", "\n").replace("\n", "\r")
}
