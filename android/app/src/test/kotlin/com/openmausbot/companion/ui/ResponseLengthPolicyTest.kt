package com.openmausbot.companion.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ResponseLengthPolicyTest {

    @Test
    fun `empty and blank text have zero word count`() {
        assertEquals(0, ResponseLengthPolicy.countWords(""))
        assertEquals(0, ResponseLengthPolicy.countWords("   \n\t  "))
    }

    @Test
    fun `standard conversational words are counted accurately`() {
        assertEquals(2, ResponseLengthPolicy.countWords("Hello world"))
        assertEquals(12, ResponseLengthPolicy.countWords("Python is a high-level programming language known for readability and clean syntax."))
    }

    @Test
    fun `structured response blocks are excluded from conversational word count`() {
        val textWithStructured = """
            Here are the top candidates.
            ```structured
            {
              "version": 1,
              "components": [
                {
                  "id": "res-1",
                  "type": "result",
                  "data": { "title": "Senior Engineer", "company": "Acme", "salary": "150k" }
                }
              ]
            }
            ```
            Let me know which one you prefer.
        """.trimIndent()

        // Conversational: "Here are the top candidates. Let me know which one you prefer." = 12 words
        assertEquals(12, ResponseLengthPolicy.countWords(textWithStructured))
    }

    @Test
    fun `detects explicit user requests for detail or comprehensive answers`() {
        assertTrue(ResponseLengthPolicy.isDetailedException("Please explain in detail how this works"))
        assertTrue(ResponseLengthPolicy.isDetailedException("Be comprehensive and give me full explanation"))
        assertTrue(ResponseLengthPolicy.isDetailedException("Don't keep it short, give me everything"))
        assertTrue(ResponseLengthPolicy.isDetailedException("Write a report on renewable energy"))
        assertTrue(ResponseLengthPolicy.isDetailedException("Show code for the API handler"))

        assertFalse(ResponseLengthPolicy.isDetailedException("Hello there"))
        assertFalse(ResponseLengthPolicy.isDetailedException("Find me a laptop under 60k"))
        assertFalse(ResponseLengthPolicy.isDetailedException("What did you find?"))
    }

    @Test
    fun `detects content exceptions such as code fences and markdown tables`() {
        val codeResponse = "Here is the code:\n```kotlin\nfun main() { println(\"test\") }\n```"
        assertTrue(ResponseLengthPolicy.isContentException(codeResponse))

        val tableResponse = "Here is the table:\n| Name | Value |\n|---|---|\n| A | 1 |"
        assertTrue(ResponseLengthPolicy.isContentException(tableResponse))

        val plainResponse = "Here is the summary of the latest events."
        assertFalse(ResponseLengthPolicy.isContentException(plainResponse))
    }

    @Test
    fun `default max words constant is 99 words (under 100 words)`() {
        assertEquals(99, ResponseLengthPolicy.DEFAULT_MAX_WORDS)
    }
}
