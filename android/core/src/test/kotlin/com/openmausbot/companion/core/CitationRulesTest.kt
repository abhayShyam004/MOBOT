package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CitationRulesTest {
    @Test
    fun `extracts simple parenthesized page citation`() {
        val text = "The report says revenue grew 14% in FY2025, mainly due to cloud services (p. 7)."
        val citations = CitationRules.extractCitations(text)
        assertEquals(1, citations.size)
        assertEquals("p. 7", citations[0].label)
        assertEquals("7", citations[0].page)
        assertEquals(null, citations[0].document)
    }

    @Test
    fun `extracts page range citations`() {
        val text = "Detailed projections are outlined in the methodology section (pp. 12-14)."
        val citations = CitationRules.extractCitations(text)
        assertEquals(1, citations.size)
        assertEquals("p. 12-14", citations[0].label)
        assertEquals("12-14", citations[0].page)
    }

    @Test
    fun `extracts bracketed citations`() {
        val text = "Operating margins improved to 28% [p. 3] while debt was reduced [page 5]."
        val citations = CitationRules.extractCitations(text)
        assertEquals(2, citations.size)
        assertEquals("p. 3", citations[0].label)
        assertEquals("3", citations[0].page)
        assertEquals("p. 5", citations[1].label)
        assertEquals("5", citations[1].page)
    }

    @Test
    fun `extracts multi-document citations keeping documents distinguishable`() {
        val text = "FY24 revenue was \$10M (Annual_2024.pdf, p. 12), compared to \$14M in FY25 (Annual_2025.pdf, p. 8)."
        val citations = CitationRules.extractCitations(text)
        assertEquals(2, citations.size)
        assertEquals("Annual_2024.pdf • p. 12", citations[0].label)
        assertEquals("Annual_2024.pdf", citations[0].document)
        assertEquals("12", citations[0].page)

        assertEquals("Annual_2025.pdf • p. 8", citations[1].label)
        assertEquals("Annual_2025.pdf", citations[1].document)
        assertEquals("8", citations[1].page)
    }

    @Test
    fun `deduplicates repeated citations`() {
        val text = "Revenue grew 14% (p. 7), and EBITDA rose 18% (p. 7)."
        val citations = CitationRules.extractCitations(text)
        assertEquals(1, citations.size)
        assertEquals("p. 7", citations[0].label)
    }

    @Test
    fun `ignores unrelated text`() {
        val text = "This is a normal message about code with no page references."
        val citations = CitationRules.extractCitations(text)
        assertTrue(citations.isEmpty())
    }
}
