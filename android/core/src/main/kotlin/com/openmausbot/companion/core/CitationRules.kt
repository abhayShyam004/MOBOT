package com.openmausbot.companion.core

/**
 * Native citation extracted from bot messages answering from attached documents or PDFs.
 * Follows Phase M (PDF / Document Intelligence) requirements:
 * - page-aware references
 * - multiple distinct PDFs distinguishable
 * - native citations exposed in UI
 */
data class NativeCitation(
    val label: String,
    val page: String,
    val document: String? = null,
)

object CitationRules {
    private val PAREN_CITATION_REGEX = Regex(
        """\((?:(?:([A-Za-z0-9_.\- ]+\.(?:pdf|txt|md|csv|docx?|xlsx?)),\s*)?(?:[Pp]ages?|[Pp]{1,2}\.?)\s*(\d+(?:[-–]\d+)?))\)"""
    )
    private val BRACKET_CITATION_REGEX = Regex(
        """\[(?:(?:([A-Za-z0-9_.\- ]+\.(?:pdf|txt|md|csv|docx?|xlsx?)),\s*)?(?:[Pp]ages?|[Pp]{1,2}\.?)\s*(\d+(?:[-–]\d+)?))\]"""
    )

    /**
     * Extracts distinct page citations from reply text, preserving document attribution
     * when multiple documents are referenced.
     */
    fun extractCitations(text: String): List<NativeCitation> {
        if (text.isBlank() || (!text.contains("p.") && !text.contains("pp.") && !text.contains("page", ignoreCase = true))) {
            return emptyList()
        }

        val found = mutableListOf<NativeCitation>()
        val seen = mutableSetOf<String>()

        fun record(match: MatchResult) {
            val doc = match.groups[1]?.value?.trim()
            val page = match.groups[2]?.value?.trim() ?: return
            val label = if (!doc.isNullOrBlank()) "$doc • p. $page" else "p. $page"
            val key = "${doc.orEmpty()}::$page"
            if (seen.add(key)) {
                found += NativeCitation(label = label, page = page, document = doc)
            }
        }

        PAREN_CITATION_REGEX.findAll(text).forEach(::record)
        BRACKET_CITATION_REGEX.findAll(text).forEach(::record)

        return found.take(8)
    }
}
