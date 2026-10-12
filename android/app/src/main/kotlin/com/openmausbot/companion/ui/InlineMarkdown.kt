package com.openmausbot.companion.ui

/** One styled run of inline text. */
data class InlineSpan(
    val text: String,
    val styles: Set<InlineStyle> = emptySet(),
    val link: String? = null,
)

enum class InlineStyle { BOLD, ITALIC, CODE, STRIKE }

/**
 * The inline half of markdown, in-house.
 *
 * `Markdown.blocks` (`:core`) already split the source into paragraphs, headings,
 * list items, quotes and fences; this walks one block's text and produces styled
 * runs. iOS hands the same job to Foundation
 * (`AttributedString(markdown:options:.inlineOnlyPreservingWhitespace)`), whose
 * supported set is bold, italic, code spans, strikethrough and links — so that is
 * exactly the set understood here. Markwon would be a 300KB dependency and a
 * second block parser competing with `:core`'s.
 *
 * Two rules matter more than completeness, because this renders a reply while it
 * is still being typed:
 *
 * - An **unterminated** marker is literal text. A half-written `[label](` shows
 *   the characters the model has sent so far rather than vanishing until the
 *   bracket closes.
 * - Code-span content is never re-parsed, so a snippet full of `*` stays a
 *   snippet.
 */
object InlineMarkdown {

    fun parse(source: String): List<InlineSpan> =
        merge(render(source, emptySet(), null))

    /** Flatten the runs back to the text they render. */
    fun plain(spans: List<InlineSpan>): String = spans.joinToString("") { it.text }

    private fun render(
        source: String,
        styles: Set<InlineStyle>,
        link: String?,
        suppressAutolink: Boolean = false,
    ): List<InlineSpan> {
        val out = mutableListOf<InlineSpan>()
        val buffer = StringBuilder()
        var index = 0

        fun flush() {
            if (buffer.isEmpty()) return
            out += InlineSpan(buffer.toString(), styles, link)
            buffer.setLength(0)
        }

        while (index < source.length) {
            val character = source[index]

            // Escapes first: a backslashed punctuation mark is that character.
            if (character == '\\' && index + 1 < source.length && source[index + 1] in ESCAPABLE) {
                buffer.append(source[index + 1])
                index += 2
                continue
            }

            // A bare URL — `https://…` / `http://…` — is a link without the
            // bracket syntax. Inside a code span or an existing link it is
            // skipped: `` `https://x` `` is a snippet and `[l](https://x)` has
            // already named its destination, and neither should be re-read.
            // The scheme must open a word — `shttp://…` is one funny word, not
            // a scheme with a letter welded to its front.
            if (link == null &&
                !suppressAutolink &&
                (character == 'h' || character == 'H') &&
                !isWordCharacter(source.getOrNull(index - 1))
            ) {
                val colon = bareUrlSchemeColon(source, index)
                if (colon >= 0) {
                    val bare = scanBareUrl(source, index, colon)
                    if (bare != null) {
                        flush()
                        out += InlineSpan(source.substring(index, bare.end), styles, bare.destination)
                        index = bare.end
                        continue
                    }
                }
            }

            if (character == '`') {
                val fence = runLength(source, index, '`')
                val close = findCodeClose(source, index + fence, fence)
                if (close >= 0) {
                    flush()
                    out += InlineSpan(
                        stripCodeSpacing(source.substring(index + fence, close)),
                        styles + InlineStyle.CODE,
                        link,
                    )
                    index = close + fence
                    continue
                }
                buffer.append(character)
                index += 1
                continue
            }

            if (character == '~' && runLength(source, index, '~') >= 2) {
                val close = findRun(source, index + 2, '~', 2)
                if (close > index + 2) {
                    flush()
                    out += render(source.substring(index + 2, close), styles + InlineStyle.STRIKE, link)
                    index = close + 2
                    continue
                }
                buffer.append(character)
                index += 1
                continue
            }

            if (character == '*' || character == '_') {
                val run = runLength(source, index, character)
                val width = minOf(run, 3)
                // `_` does not open or close inside a word — snake_case_names are
                // not emphasis. `*` may, exactly as GFM has it.
                val opensHere = character == '*' || !isWordCharacter(source.getOrNull(index - 1))
                val closeStart = if (opensHere) {
                    findEmphasisClose(source, index + width, character, width)
                } else {
                    -1
                }
                // Close at the *end* of the closing run, so a longer run leaves
                // its surplus inside: `**bold *and italic***` is bold wrapping
                // an italic, not bold followed by a stray asterisk.
                val close = if (closeStart < 0) {
                    -1
                } else {
                    closeStart + (runLength(source, closeStart, character) - width)
                }
                if (close >= index + width) {
                    val inner = source.substring(index + width, close)
                    if (inner.isNotEmpty()) {
                        flush()
                        out += render(inner, styles + emphasisStyles(width), link)
                        index = close + width
                        continue
                    }
                }
                buffer.append(character)
                index += 1
                continue
            }

            if (character == '[') {
                val labelEnd = findLabelClose(source, index + 1)
                if (labelEnd >= 0 && source.getOrNull(labelEnd + 1) == '(') {
                    val tail = parseLinkTail(source, labelEnd + 2)
                    if (tail != null) {
                        flush()
                        out += render(source.substring(index + 1, labelEnd), styles, tail.destination)
                        index = tail.end + 1
                        continue
                    }
                    // A tail that will not parse is the half-typed link, and the
                    // invariant above says it renders as the characters it is
                    // made of. The URL inside a failed tail must not be
                    // autolinked either: `…](https://e` mid-stream would
                    // otherwise flash a link that vanishes the moment `)`
                    // arrives. The label and tail render as one suppressed run —
                    // emphasis and escapes still apply, autolinking does not.
                    buffer.append(character)
                    flush()
                    val tailEnd = failedTailEnd(source, labelEnd + 2)
                    out += render(source.substring(index + 1, tailEnd), styles, null, suppressAutolink = true)
                    index = tailEnd
                    continue
                }
                buffer.append(character)
                index += 1
                continue
            }

            buffer.append(character)
            index += 1
        }

        flush()
        return out
    }

    private fun emphasisStyles(width: Int): Set<InlineStyle> = when (width) {
        1 -> setOf(InlineStyle.ITALIC)
        2 -> setOf(InlineStyle.BOLD)
        else -> setOf(InlineStyle.BOLD, InlineStyle.ITALIC)
    }

    private fun merge(spans: List<InlineSpan>): List<InlineSpan> {
        val out = mutableListOf<InlineSpan>()
        for (span in spans) {
            if (span.text.isEmpty()) continue
            val last = out.lastOrNull()
            if (last != null && last.styles == span.styles && last.link == span.link) {
                out[out.lastIndex] = last.copy(text = last.text + span.text)
            } else {
                out += span
            }
        }
        return out
    }

    private fun runLength(source: String, from: Int, character: Char): Int {
        var length = 0
        while (from + length < source.length && source[from + length] == character) length += 1
        return length
    }

    /** A code span closes on a backtick run of exactly the opening length. */
    private fun findCodeClose(source: String, from: Int, fence: Int): Int {
        var index = from
        while (index < source.length) {
            if (source[index] == '`') {
                val run = runLength(source, index, '`')
                if (run == fence) return index
                index += run
                continue
            }
            index += 1
        }
        return -1
    }

    /** Next run of [character] at least [width] long, skipping escapes and code spans. */
    private fun findRun(source: String, from: Int, character: Char, width: Int): Int {
        var index = from
        while (index < source.length) {
            val current = source[index]
            if (current == '\\' && index + 1 < source.length) {
                index += 2
                continue
            }
            if (current == '`') {
                val fence = runLength(source, index, '`')
                val close = findCodeClose(source, index + fence, fence)
                index = if (close >= 0) close + fence else index + fence
                continue
            }
            if (current == character) {
                val run = runLength(source, index, character)
                if (run >= width) return index
                index += run
                continue
            }
            index += 1
        }
        return -1
    }

    /** As [findRun], plus the `_` intraword rule on the closing side. */
    private fun findEmphasisClose(source: String, from: Int, character: Char, width: Int): Int {
        var search = from
        while (search < source.length) {
            val at = findRun(source, search, character, width)
            if (at < 0) return -1
            val closesHere = character == '*' ||
                !isWordCharacter(source.getOrNull(at + runLength(source, at, character)))
            if (closesHere) return at
            search = at + runLength(source, at, character)
        }
        return -1
    }

    private fun isWordCharacter(character: Char?): Boolean =
        character != null && (character.isLetterOrDigit() || character == '_')

    private fun findLabelClose(source: String, from: Int): Int {
        var depth = 0
        var index = from
        while (index < source.length) {
            val current = source[index]
            // A bracket inside a code span is text, not structure: the label of
            // [see `a]b`](url) ends at the second `]`, not the first.
            if (current == '`') {
                val fence = runLength(source, index, '`')
                val close = findCodeClose(source, index + fence, fence)
                index = if (close >= 0) close + fence else index + fence
                continue
            }
            when {
                current == '\\' && index + 1 < source.length -> index += 1
                current == '[' -> depth += 1
                current == ']' -> {
                    if (depth == 0) return index
                    depth -= 1
                }
            }
            index += 1
        }
        return -1
    }


    private data class LinkTail(val destination: String, val end: Int)

    /** Just past the `)` closing a failed inline tail, or the source's end. */
    private fun failedTailEnd(source: String, from: Int): Int {
        var index = from
        var depth = 0
        while (index < source.length) {
            when (source[index]) {
                '(' -> depth += 1
                ')' -> if (depth == 0) return index + 1 else depth -= 1
            }
            index += 1
        }
        return source.length
    }

    /** The path/query/fragment alphabet: anything but ASCII whitespace or control. */
    private fun isUrlCharacter(character: Char): Boolean =
        character.code >= 0x20 &&
            character.code != 0x7F &&
            character != ' ' &&
            character != '\t'

    /** Characters a bare URL never ends on; see [BARE_URL_TRAILING]. */
    private fun isTrailingPunctuation(character: Char): Boolean =
        character in BARE_URL_TRAILING

    private val BARE_URL_TRAILING = charArrayOf('.', ',', ':', ';', '!', '?', '"', '\'', ')', ']', '}')

    /**
     * When the `http` at [index] begins a bare-URL scheme, the index of its
     * colon; −1 when it does not. Accepts `http`/`https` in either case, and
     * insists the next character really is the colon so an ordinary sentence
     * word is never mistaken for the start of a scheme.
     */
    private fun bareUrlSchemeColon(source: String, index: Int): Int {
        val rest = source.length - index
        if (rest >= 8 &&
            source.regionMatches(index + 4, "://", 0, 3, ignoreCase = true) &&
            source.regionMatches(index, "http", 0, 4, ignoreCase = true)
        ) {
            return index + 4
        }
        if (rest < 9 ||
            !source.regionMatches(index + 5, "://", 0, 3, ignoreCase = true) ||
            !source.regionMatches(index, "https", 0, 5, ignoreCase = true)
        ) {
            return -1
        }
        return index + 5
    }

    /**
     * Scan one bare-URL candidate: [index] sits on the colon that closes the
     * scheme, [schemeStart] on the scheme's first letter. Returns null when
     * there is no linkable run here.
     *
     * The run is the colon, the `//`, and then the URL body: every
     * non-whitespace, non-control character, with two URL-aware refinements.
     * Parentheses only count when balanced — Wikipedia's
     * `Python_(programming_language)` survives whole, while the prose `)` after
     * a link does not join and an open `(` the body never closes ends the link
     * just before it. And the trailing run of sentence punctuation is left off
     * the destination, because a URL does not end a sentence for you. A body of
     * nothing is not a URL.
     */
    private fun scanBareUrl(source: String, schemeStart: Int, index: Int): BareUrl? {
        if (source.getOrNull(index) != ':') return null
        if (source.getOrNull(index + 1) != '/' || source.getOrNull(index + 2) != '/') return null
        val start = index + 3
        var scan = start
        var depth = 0
        while (scan < source.length) {
            val current = source[scan]
            if (!isUrlCharacter(current)) break
            if (current == '(') {
                depth += 1
            } else if (current == ')') {
                if (depth == 0) break
                depth -= 1
            }
            scan += 1
        }
        var end = scan
        if (depth != 0) {
            // An open `(` the body never closed is prose, not URL: the link
            // ends just before it, keeping the pairs that did close.
            var closes = 0
            for (position in end - 1 downTo start) {
                when (source[position]) {
                    ')' -> closes += 1
                    '(' -> if (closes > 0) closes -= 1 else {
                        end = position
                        break
                    }
                }
            }
        }
        while (end > start) {
            val last = source[end - 1]
            if (last == ')') {
                // A `)` only leaves the destination when it closes a `(` the
                // URL itself opened; surplus ones are the writer's punctuation.
                val opens = source.countCharacter('(', start, end)
                val closes = source.countCharacter(')', start, end)
                if (opens >= closes) break
                end -= 1
                continue
            }
            if (!isTrailingPunctuation(last)) break
            end -= 1
        }
        if (end <= start) return null
        // The destination keeps its scheme: `LocalMessageLink.resolve` sends
        // scheme-less values down the desktop-file path, which is the one route
        // a web URL must never take.
        return BareUrl(source.substring(schemeStart, end), end)
    }

    private fun String.countCharacter(character: Char, from: Int, until: Int): Int {
        var count = 0
        for (position in from until until) if (this[position] == character) count += 1
        return count
    }

    private data class BareUrl(val destination: String, val end: Int)

    /**
     * CommonMark's inline-link tail — `'(' ws? destination? (ws title)? ws? ')'`
     * — read in one pass from just after the `(`, ending at the index of the
     * closing `)`.
     *
     * One pass, rather than "find the closing paren, then parse what is inside",
     * because a `)` is only the closing paren when it is not inside an angle
     * destination or a quoted title. `[a](<b)c>)`, `[link](<foo(and(bar)>)` and
     * `[x](/url "a)b")` are all links the desktop renders, and scanning for the
     * bracket first rejected every one of them.
     *
     * Returning null is how a not-a-link renders as the characters it is made
     * of, which is the invariant a half-typed reply depends on.
     */
    private fun parseLinkTail(source: String, from: Int): LinkTail? {
        var index = skipSeparators(source, from) ?: return null
        val destination: String

        if (index < source.length && source[index] == '<') {
            // Angle destinations may hold anything but an unescaped `<` or `>`
            // and a line ending — parentheses and spaces included.
            var scan = index + 1
            var close = -1
            while (scan < source.length) {
                val current = source[scan]
                // Rejected before any escape is consumed: a backslash may hide a
                // `>` but it may not hide a line ending, and `\` + newline would
                // otherwise smuggle one past this check.
                if (current == '<' || isLineEnding(current)) return null
                if (current == '\\' &&
                    scan + 1 < source.length &&
                    source[scan + 1] in ESCAPABLE
                ) {
                    scan += 2
                    continue
                }
                if (current == '>') {
                    close = scan
                    break
                }
                scan += 1
            }
            if (close < 0) return null
            destination = unescape(source.substring(index + 1, close))
            index = close + 1
        } else {
            // A bare destination runs to whitespace or to the `)` that closes the
            // link, and may hold parentheses only in balanced pairs or escaped.
            val start = index
            var depth = 0
            loop@ while (index < source.length) {
                val current = source[index]
                when {
                    current == '\\' && index + 1 < source.length && source[index + 1] in ESCAPABLE ->
                        index += 2
                    // Only the grammar's separators end a destination. A
                    // non-breaking space is an ordinary character and belongs to
                    // the URL, exactly as the desktop reads it.
                    isSeparator(current) || isLineEnding(current) -> break@loop
                    isControl(current) -> return null
                    current == '(' -> {
                        depth += 1
                        index += 1
                    }
                    current == ')' -> {
                        if (depth == 0) break@loop
                        depth -= 1
                        index += 1
                    }
                    else -> index += 1
                }
            }
            if (depth != 0) return null
            destination = unescape(source.substring(start, index))
        }

        // An empty destination is legal: `[x]()` and `[x](<>)` are links on the
        // desktop, and rejecting them would drop the label.
        val afterDestination = index
        index = skipSeparators(source, index) ?: return null
        if (index > afterDestination && index < source.length && source[index] in TITLE_OPENERS) {
            index = titleEnd(source, index) ?: return null
        }
        index = skipSeparators(source, index) ?: return null
        return if (index < source.length && source[index] == ')') {
            LinkTail(destination, index)
        } else {
            null
        }
    }

    /**
     * The index just past a title beginning at [from], or null when it never
     * closes — so `[x](/url "a" junk ")` is text, not a link that swallows
     * `junk`.
     */
    private fun titleEnd(source: String, from: Int): Int? {
        val open = source[from]
        val close = if (open == '(') ')' else open
        var index = from + 1
        while (index < source.length) {
            val current = source[index]
            if (current == '\\' && index + 1 < source.length && source[index + 1] in ESCAPABLE) {
                index += 2
                continue
            }
            if (current == close) return index + 1
            // A parenthesised title may hold neither bracket unescaped.
            if (open == '(' && current == '(') return null
            index += 1
        }
        return null
    }

    /**
     * The separators the link grammar allows between components: spaces, tabs,
     * and at most one line ending. Returns null when more than one line ending
     * was crossed — that is a blank line, which ends the link.
     *
     * Deliberately not `Char.isWhitespace()`, which also matches a non-breaking
     * space; CommonMark counts that as an ordinary character, so `[x](/url "t")`
     * written with a NBSP is one long destination, not a destination and a title.
     */
    private fun skipSeparators(source: String, from: Int): Int? {
        var index = from
        var lineEndings = 0
        while (index < source.length) {
            val current = source[index]
            when {
                isSeparator(current) -> index += 1
                current == '\r' -> {
                    lineEndings += 1
                    index += 1
                    if (index < source.length && source[index] == '\n') index += 1
                }
                current == '\n' -> {
                    lineEndings += 1
                    index += 1
                }
                else -> return if (lineEndings > 1) null else index
            }
        }
        return if (lineEndings > 1) null else index
    }

    private fun isSeparator(character: Char): Boolean = character == ' ' || character == '\t'

    private fun isLineEnding(character: Char): Boolean = character == '\n' || character == '\r'

    private fun isControl(character: Char): Boolean =
        character.code < 0x20 || character.code == 0x7F

    private val TITLE_OPENERS = setOf('"', '\'', '(')


    /** Backslash escapes are resolved in destinations, as CommonMark resolves them. */
    private fun unescape(source: String): String {
        if ('\\' !in source) return source
        val out = StringBuilder(source.length)
        var index = 0
        while (index < source.length) {
            val current = source[index]
            if (current == '\\' && index + 1 < source.length && source[index + 1] in ESCAPABLE) {
                out.append(source[index + 1])
                index += 2
                continue
            }
            out.append(current)
            index += 1
        }
        return out.toString()
    }

    /** CommonMark: one space is stripped from each end when both are present. */
    private fun stripCodeSpacing(raw: String): String {
        if (raw.length >= 2 && raw.first() == ' ' && raw.last() == ' ' && raw.isNotBlank()) {
            return raw.substring(1, raw.length - 1)
        }
        return raw
    }

    private val ESCAPABLE: Set<Char> =
        "\\`*_{}[]()#+-.!|~<>\"'$%&,/:;=?@^".toSet()
}
