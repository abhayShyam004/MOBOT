package com.openmausbot.companion.core

enum class TableAlignment {
    LEFT, CENTER, RIGHT, NONE
}

sealed interface MarkdownBlock {
    data class Paragraph(val text: String) : MarkdownBlock
    data class Bullet(val indent: Int, val text: String) : MarkdownBlock
    data class Ordered(val indent: Int, val number: Int, val text: String) : MarkdownBlock
    data class Heading(val level: Int, val text: String) : MarkdownBlock
    data class Code(val language: String?, val text: String) : MarkdownBlock
    data class Quote(val text: String) : MarkdownBlock
    data object Rule : MarkdownBlock
    data class Table(
        val headers: List<String>,
        val alignments: List<TableAlignment>,
        val rows: List<List<String>>,
    ) : MarkdownBlock
    data class Image(
        val url: String,
        val alt: String? = null,
    ) : MarkdownBlock
}

private val IMAGE_BLOCK_REGEX = Regex("""^!\[([^\]]*)\]\(([^)]+)\)$""")
private val ATTACHED_IMAGE_TAG_REGEX = Regex("""^<attached-image[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*/>$""")
private val INLINE_IMAGE_REGEX = Regex("""!\[([^\]]*)\]\(([^)]+)\)""")

object Markdown {
    fun blocks(source: String): List<MarkdownBlock> {
        val blocks = mutableListOf<MarkdownBlock>()
        val paragraph = mutableListOf<String>()

        fun flushParagraph() {
            if (paragraph.isEmpty()) return
            blocks += MarkdownBlock.Paragraph(paragraph.joinToString(" "))
            paragraph.clear()
        }

        val lines = source
            .replace("\r\n", "\n")
            .replace("\r", "\n")
            .split('\n')
        var index = 0
        while (index < lines.size) {
            val line = lines[index++]
            val trimmed = line.trim()

            if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
                flushParagraph()
                val marker = trimmed.take(3)
                val language = trimmed.drop(3).trim().ifEmpty { null }
                val body = mutableListOf<String>()
                while (index < lines.size) {
                    val next = lines[index++]
                    if (next.trim().startsWith(marker)) break
                    body += next
                }
                blocks += MarkdownBlock.Code(language, body.joinToString("\n"))
                continue
            }

            if (trimmed.isEmpty()) {
                flushParagraph()
                continue
            }

            if (trimmed.length >= 3 && trimmed.first() in "-*_") {
                if (trimmed.all { it == trimmed.first() }) {
                    flushParagraph()
                    blocks += MarkdownBlock.Rule
                    continue
                }
            }

            // Strict Separation of Visual Telemetry (Official Phase 16):
            // Never render raw base64 data URIs or raw base64 encoded image dumps as ordinary Markdown text.
            if (trimmed.startsWith("data:image/") || (trimmed.startsWith("iVBORw0KGgo") && trimmed.length > 80)) {
                flushParagraph()
                continue
            }

            val imgMatch = IMAGE_BLOCK_REGEX.matchEntire(trimmed)
            if (imgMatch != null) {
                flushParagraph()
                val alt = imgMatch.groupValues[1].ifBlank { null }
                val url = imgMatch.groupValues[2].trim()
                if (!url.startsWith("data:image/") && !url.contains(";base64,")) {
                    blocks += MarkdownBlock.Image(url, alt)
                }
                continue
            }

            val tagMatch = ATTACHED_IMAGE_TAG_REGEX.matchEntire(trimmed)
            if (tagMatch != null) {
                flushParagraph()
                val url = tagMatch.groupValues[1].trim()
                val alt = tagMatch.groupValues.getOrNull(2)?.ifBlank { null }
                if (!url.startsWith("data:image/") && !url.contains(";base64,")) {
                    blocks += MarkdownBlock.Image(url, alt)
                }
                continue
            }

            val inlineMatch = INLINE_IMAGE_REGEX.find(line)
            if (inlineMatch != null) {
                flushParagraph()
                val before = line.substring(0, inlineMatch.range.first).trim()
                if (before.isNotEmpty()) {
                    blocks += MarkdownBlock.Paragraph(before)
                }
                val alt = inlineMatch.groupValues[1].ifBlank { null }
                val url = inlineMatch.groupValues[2].trim()
                if (!url.startsWith("data:image/") && !url.contains(";base64,")) {
                    blocks += MarkdownBlock.Image(url, alt)
                }
                val after = line.substring(inlineMatch.range.last + 1).trim()
                if (after.isNotEmpty()) {
                    paragraph += after
                }
                continue
            }

            heading(trimmed)?.let {
                flushParagraph()
                blocks += it
                continue
            }

            val tableResult = tableAt(index - 1, lines)
            if (tableResult != null) {
                flushParagraph()
                blocks += tableResult.first
                index = tableResult.second
                continue
            }

            if (trimmed.startsWith('>')) {
                flushParagraph()
                blocks += MarkdownBlock.Quote(trimmed.drop(1).trim())
                continue
            }

            listItem(line)?.let {
                flushParagraph()
                blocks += it
                continue
            }

            paragraph += trimmed
        }
        flushParagraph()
        return blocks
    }

    private fun tableAt(startIndex: Int, lines: List<String>): Pair<MarkdownBlock.Table, Int>? {
        val headerLine = lines[startIndex]
        val headerTrimmed = headerLine.trim()
        if (!headerTrimmed.contains('|')) return null
        if (startIndex + 1 >= lines.size) return null

        val separatorLine = lines[startIndex + 1]
        val separatorTrimmed = separatorLine.trim()
        if (!separatorTrimmed.contains('|')) return null

        val headers = splitTableRow(headerLine)
        if (headers.isEmpty()) return null
        if (headers.size == 1 && (!headerTrimmed.startsWith('|') || !headerTrimmed.endsWith('|'))) return null

        val alignments = parseSeparatorRow(separatorLine, headers.size) ?: return null

        var cur = startIndex + 2
        val rows = mutableListOf<List<String>>()
        while (cur < lines.size) {
            val nextLine = lines[cur]
            val nextTrimmed = nextLine.trim()
            if (nextTrimmed.isEmpty()) break
            if (nextTrimmed.startsWith("```") || nextTrimmed.startsWith("~~~")) break
            if (heading(nextTrimmed) != null) break
            if (!nextTrimmed.contains('|')) break

            val rowCells = splitTableRow(nextLine)
            val padded = headers.indices.map { colIdx ->
                rowCells.getOrElse(colIdx) { "" }
            }
            rows.add(padded)
            cur++
        }

        return Pair(MarkdownBlock.Table(headers, alignments, rows), cur)
    }

    private fun parseSeparatorRow(line: String, expectedColumns: Int): List<TableAlignment>? {
        val trimmed = line.trim()
        if (!trimmed.contains('-')) return null
        val cells = splitTableRow(line)
        if (cells.size != expectedColumns || cells.isEmpty()) return null
        val alignments = mutableListOf<TableAlignment>()
        for (cell in cells) {
            val s = cell.trim()
            val core = s.replace(" ", "").trim(':')
            if (core.isEmpty() || !core.all { it == '-' }) return null
            val leftColon = s.startsWith(':')
            val rightColon = s.endsWith(':')
            val alignment = when {
                leftColon && rightColon -> TableAlignment.CENTER
                leftColon -> TableAlignment.LEFT
                rightColon -> TableAlignment.RIGHT
                else -> TableAlignment.NONE
            }
            alignments.add(alignment)
        }
        return alignments
    }

    private fun splitTableRow(line: String): List<String> {
        var text = line.trim()
        if (text.startsWith('|')) text = text.substring(1)
        if (text.endsWith('|') && (text.length < 2 || text[text.length - 2] != '\\')) {
            text = text.dropLast(1)
        }

        val cells = mutableListOf<String>()
        val current = StringBuilder()
        var inCode = false
        var codeFenceLength = 0
        var escaped = false
        var i = 0

        while (i < text.length) {
            val c = text[i]
            if (escaped) {
                if (c != '|') current.append('\\')
                current.append(c)
                escaped = false
                i++
                continue
            }
            if (c == '\\') {
                escaped = true
                i++
                continue
            }
            if (c == '`') {
                var fence = 1
                while (i + fence < text.length && text[i + fence] == '`') {
                    fence++
                }
                if (!inCode) {
                    inCode = true
                    codeFenceLength = fence
                } else if (fence == codeFenceLength) {
                    inCode = false
                    codeFenceLength = 0
                }
                current.append(text.substring(i, i + fence))
                i += fence
                continue
            }
            if (c == '|' && !inCode) {
                cells.add(current.toString().trim())
                current.setLength(0)
                i++
                continue
            }
            current.append(c)
            i++
        }
        if (escaped) current.append('\\')
        cells.add(current.toString().trim())
        return cells
    }

    private fun heading(trimmed: String): MarkdownBlock.Heading? {
        val hashes = trimmed.takeWhile { it == '#' }.length
        if (hashes !in 1..6) return null
        val rest = trimmed.drop(hashes)
        if (!rest.startsWith(' ')) return null
        return MarkdownBlock.Heading(hashes, rest.trim())
    }

    private fun listItem(line: String): MarkdownBlock? {
        val leading = line.takeWhile { it == ' ' || it == '\t' }.length
        val indent = (leading / 2).coerceAtMost(4)
        val trimmed = line.trim()

        listOf("- ", "* ", "+ ").firstOrNull(trimmed::startsWith)?.let {
            return MarkdownBlock.Bullet(indent, trimmed.drop(2))
        }

        val digits = trimmed.takeWhile(Char::isDigit)
        if (digits.isNotEmpty() && digits.length <= 9) {
            val rest = trimmed.drop(digits.length)
            if (rest.startsWith(". ") || rest.startsWith(") ")) {
                return MarkdownBlock.Ordered(indent, digits.toIntOrNull() ?: 1, rest.drop(2))
            }
        }
        return null
    }
}
