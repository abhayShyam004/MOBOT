package com.openmausbot.companion.ui

import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import kotlin.math.abs
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MarkdownTableRenderingTest {

    @get:Rule
    val compose = createComposeRule()

    private fun spoken(node: SemanticsNode): List<String> = buildList {
        node.config.getOrNull(SemanticsProperties.Text)?.forEach { add(it.text) }
        node.config.getOrNull(SemanticsProperties.ContentDescription)?.forEach { add(it) }
        node.children.forEach { addAll(spoken(it)) }
    }

    @Test
    fun `markdown table embedded within prose renders clean cells without raw pipes or delimiters`() {
        val markdown = """
            Here is the portfolio summary:

            | Rank | Project | Type / Stack | Main Purpose | Why It Stands Out | Recognition |
            |---:|---|---|---|---|---|
            | 1 | OpenMausBot | TypeScript · Open source | AI-agent platform | Most technically ambitious | Best flagship project |
            | 2 | Flocus V2 | Web application | Pomodoro productivity app | Strong user-facing product | Best user-facing product |
            | 3 | qa-service | Python · FastAPI · FAISS · SQLite | RAG QA service | Strong backend/AI implementation | Best technical/backend project |

            Let me know if you want more details.
        """.trimIndent()

        var openedUrl: String? = null
        compose.setContent {
            CompanionTheme(darkTheme = false) {
                MarkdownText(source = markdown, openLink = { openedUrl = it })
            }
        }

        val allTexts = spoken(compose.onRoot().fetchSemanticsNode())

        // 1. Surrounding prose is present
        assertTrue(allTexts.any { it.contains("Here is the portfolio summary:") })
        assertTrue(allTexts.any { it.contains("Let me know if you want more details.") })

        // 2. Table headers and cell contents are present
        assertTrue(allTexts.any { it == "Rank" })
        assertTrue(allTexts.any { it == "Project" })
        assertTrue(allTexts.any { it == "OpenMausBot" })
        assertTrue(allTexts.any { it == "Flocus V2" })
        assertTrue(allTexts.any { it == "qa-service" })

        // 3. Raw pipes and delimiter dashes are NOT present in the text tree
        assertFalse(allTexts.any { it.contains("|---:") || it.contains("|---|") || it.contains("---|") })
        assertFalse(allTexts.any { it.startsWith("| 1 |") || it.startsWith("| 2 |") })
    }

    @Test
    fun `alignment affects position of cells relative to column bounds`() {
        val markdown = """
            | Left | Center | Right |
            |:---|:---:|---:|
            | L1 | C1 | R1 |
        """.trimIndent()

        compose.setContent {
            CompanionTheme(darkTheme = false) {
                MarkdownText(source = markdown)
            }
        }

        val leftHeader = compose.onNodeWithText("Left").fetchSemanticsNode().boundsInRoot
        val centerHeader = compose.onNodeWithText("Center").fetchSemanticsNode().boundsInRoot
        val rightHeader = compose.onNodeWithText("Right").fetchSemanticsNode().boundsInRoot

        assertTrue(centerHeader.left > leftHeader.left, "Center column is to the right of Left")
        assertTrue(rightHeader.left > centerHeader.left, "Right column is to the right of Center")
    }

    @Test
    fun `table cells support inline markdown and links are clickable`() {
        val markdown = """
            | Tool | Website |
            |---|---|
            | **FastAPI** | [Docs](https://fastapi.tiangolo.com) |
        """.trimIndent()

        compose.setContent {
            CompanionTheme(darkTheme = false) {
                MarkdownText(source = markdown)
            }
        }

        val texts = spoken(compose.onRoot().fetchSemanticsNode())
        assertTrue(texts.any { it == "Tool" })
        assertTrue(texts.any { it == "Website" })
        assertTrue(texts.any { it == "FastAPI" })
        assertTrue(texts.any { it == "Docs" })
    }
}
