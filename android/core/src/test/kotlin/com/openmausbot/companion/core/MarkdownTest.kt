package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MarkdownTest {
    @Test
    fun plainTextIsOneParagraph() {
        assertEquals(listOf(MarkdownBlock.Paragraph("just a reply")), Markdown.blocks("just a reply"))
    }

    @Test
    fun emptyInputProducesNothing() {
        assertEquals(emptyList(), Markdown.blocks(""))
        assertEquals(emptyList(), Markdown.blocks("\n\n  \n"))
    }

    @Test
    fun softBreaksBecomeSpaces() {
        assertEquals(
            listOf(MarkdownBlock.Paragraph("one line and its continuation")),
            Markdown.blocks("one line\nand its continuation"),
        )
    }

    @Test
    fun blankLineSeparatesParagraphs() {
        assertEquals(
            listOf(MarkdownBlock.Paragraph("first"), MarkdownBlock.Paragraph("second")),
            Markdown.blocks("first\n\nsecond"),
        )
    }

    @Test
    fun headingLevels() {
        assertEquals(listOf(MarkdownBlock.Heading(1, "Title")), Markdown.blocks("# Title"))
        assertEquals(listOf(MarkdownBlock.Heading(3, "Deeper")), Markdown.blocks("### Deeper"))
    }

    @Test
    fun hashWithoutSpaceIsNotAHeading() {
        assertEquals(listOf(MarkdownBlock.Paragraph("#hashtag")), Markdown.blocks("#hashtag"))
        assertEquals(listOf(MarkdownBlock.Paragraph("####### seven")), Markdown.blocks("####### seven"))
    }

    @Test
    fun bulletMarkers() {
        assertEquals(
            listOf(
                MarkdownBlock.Bullet(0, "one"),
                MarkdownBlock.Bullet(0, "two"),
                MarkdownBlock.Bullet(0, "three"),
            ),
            Markdown.blocks("- one\n* two\n+ three"),
        )
    }

    @Test
    fun nestedBulletsCountIndent() {
        assertEquals(
            listOf(
                MarkdownBlock.Bullet(0, "top"),
                MarkdownBlock.Bullet(1, "nested"),
                MarkdownBlock.Bullet(2, "deeper"),
            ),
            Markdown.blocks("- top\n  - nested\n    - deeper"),
        )
    }

    @Test
    fun orderedListsKeepTheirNumbers() {
        assertEquals(
            listOf(
                MarkdownBlock.Ordered(0, 1, "first"),
                MarkdownBlock.Ordered(0, 2, "second"),
                MarkdownBlock.Ordered(0, 10, "tenth"),
            ),
            Markdown.blocks("1. first\n2. second\n10) tenth"),
        )
    }

    @Test
    fun numberWithoutDelimiterIsProse() {
        assertEquals(listOf(MarkdownBlock.Paragraph("2026 was the year")), Markdown.blocks("2026 was the year"))
        assertEquals(listOf(MarkdownBlock.Paragraph("3.14 is pi")), Markdown.blocks("3.14 is pi"))
    }

    @Test
    fun inlineSyntaxSurvivesTheSplit() {
        assertEquals(
            listOf(MarkdownBlock.Bullet(0, "**bold** and `code` and [link](https://x.test)")),
            Markdown.blocks("- **bold** and `code` and [link](https://x.test)"),
        )
    }

    @Test
    fun fencedCodeKeepsLanguageAndWhitespace() {
        assertEquals(
            listOf(MarkdownBlock.Code("swift", "let x = 1\n    indented")),
            Markdown.blocks("```swift\nlet x = 1\n    indented\n```"),
        )
    }

    @Test
    fun fenceWithoutLanguage() {
        assertEquals(listOf(MarkdownBlock.Code(null, "plain")), Markdown.blocks("```\nplain\n```"))
    }

    @Test
    fun unclosedFenceRunsToTheEnd() {
        assertEquals(
            listOf(MarkdownBlock.Paragraph("here:"), MarkdownBlock.Code("py", "print(1)")),
            Markdown.blocks("here:\n```py\nprint(1)"),
        )
    }

    @Test
    fun fenceContentIsNotReparsed() {
        assertEquals(
            listOf(MarkdownBlock.Code(null, "# not a heading\n- not a bullet")),
            Markdown.blocks("```\n# not a heading\n- not a bullet\n```"),
        )
    }

    @Test
    fun quote() {
        assertEquals(listOf(MarkdownBlock.Quote("quoted")), Markdown.blocks("> quoted"))
    }

    @Test
    fun horizontalRules() {
        assertEquals(listOf(MarkdownBlock.Rule), Markdown.blocks("---"))
        assertEquals(listOf(MarkdownBlock.Rule), Markdown.blocks("***"))
        assertEquals(listOf(MarkdownBlock.Rule), Markdown.blocks("___"))
    }

    @Test
    fun ruleNeedsThreeAndNothingElse() {
        assertEquals(listOf(MarkdownBlock.Paragraph("--")), Markdown.blocks("--"))
        assertEquals(listOf(MarkdownBlock.Paragraph("-- dashes --")), Markdown.blocks("-- dashes --"))
    }

    @Test
    fun crlfDoesNotCreatePhantomBlocks() {
        assertEquals(
            listOf(MarkdownBlock.Paragraph("one two")),
            Markdown.blocks("one\r\ntwo"),
        )
        assertEquals(
            listOf(MarkdownBlock.Code(null, "one\ntwo")),
            Markdown.blocks("```\r\none\r\ntwo\r\n```"),
        )
    }

    @Test
    fun partialInputAlwaysRendersSomething() {
        listOf("#", "# ", "# Head", "- ", "- it", "**bo", "```", "```sw\nlet", "[link](htt").forEach {
            assertTrue(Markdown.blocks(it).isNotEmpty(), "dropped everything for $it")
        }
    }

    @Test
    fun noPrefixOfAReplyLosesCharacters() {
        val reply = "# Result\n\nRan **two** checks:\n\n- `pnpm test` passed\n- `pnpm lint` passed\n\n```sh\npnpm test\n```\n\n> nothing else to report"
        for (length in 1..reply.length) {
            val partial = reply.take(length)
            val rendered = Markdown.blocks(partial).joinToString(separator = "", transform = ::text)
            val sent = partial.filter { !it.isWhitespace() && it !in "#->`*_" }
            val shown = rendered.filter { !it.isWhitespace() && it !in "#->`*_" }
            assertEquals(sent, shown, "lost content at $length characters")
        }
    }

    @Test
    fun basicTableParsing() {
        val src = """
            | Name | Age |
            |---|---:|
            | Alice | 20 |
            | Bob | 25 |
        """.trimIndent()

        val blocks = Markdown.blocks(src)
        assertEquals(1, blocks.size)
        val table = blocks.first() as MarkdownBlock.Table
        assertEquals(listOf("Name", "Age"), table.headers)
        assertEquals(listOf(TableAlignment.NONE, TableAlignment.RIGHT), table.alignments)
        assertEquals(listOf(listOf("Alice", "20"), listOf("Bob", "25")), table.rows)
    }

    @Test
    fun tableWithProseBeforeAndAfter() {
        val src = """
            Here are the projects:

            | Project | Status |
            |:---|:---:|
            | Omb | Active |

            Conclusion paragraph.
        """.trimIndent()

        val blocks = Markdown.blocks(src)
        assertEquals(3, blocks.size)
        assertTrue(blocks[0] is MarkdownBlock.Paragraph)
        assertEquals("Here are the projects:", (blocks[0] as MarkdownBlock.Paragraph).text)
        assertTrue(blocks[1] is MarkdownBlock.Table)
        val table = blocks[1] as MarkdownBlock.Table
        assertEquals(listOf("Project", "Status"), table.headers)
        assertEquals(listOf(TableAlignment.LEFT, TableAlignment.CENTER), table.alignments)
        assertEquals(listOf(listOf("Omb", "Active")), table.rows)
        assertTrue(blocks[2] is MarkdownBlock.Paragraph)
        assertEquals("Conclusion paragraph.", (blocks[2] as MarkdownBlock.Paragraph).text)
    }

    @Test
    fun tableWithLinksAndFormattingInsideCells() {
        val src = """
            | Project | Repository | Notes |
            |---|---|---|
            | **OpenMausBot** | [GitHub](https://github.com/test) | `v0.1` |
        """.trimIndent()

        val blocks = Markdown.blocks(src)
        assertEquals(1, blocks.size)
        val table = blocks.first() as MarkdownBlock.Table
        assertEquals(listOf("Project", "Repository", "Notes"), table.headers)
        assertEquals(listOf(listOf("**OpenMausBot**", "[GitHub](https://github.com/test)", "`v0.1`")), table.rows)
    }

    @Test
    fun multipleTablesWithHeadings() {
        val src = """
            # Section 1
            | A | B |
            |---|---|
            | 1 | 2 |

            ## Section 2
            | C | D |
            |---|---|
            | 3 | 4 |
        """.trimIndent()

        val blocks = Markdown.blocks(src)
        assertEquals(4, blocks.size)
        assertTrue(blocks[0] is MarkdownBlock.Heading)
        assertTrue(blocks[1] is MarkdownBlock.Table)
        assertTrue(blocks[2] is MarkdownBlock.Heading)
        assertTrue(blocks[3] is MarkdownBlock.Table)
    }

    @Test
    fun exactScreenshotPortfolioTableRegression() {
        val src = """
            Here is the portfolio overview:

            | Rank | Project | Type / Stack | Main Purpose | Why It Stands Out | Recognition |
            |---:|---|---|---|---|---|
            | 1 | OpenMausBot | TypeScript · Open source | AI-agent platform | Most technically ambitious | Best flagship project |
            | 2 | Flocus V2 | Web application | Pomodoro productivity app | Strong user-facing product | Best user-facing product |
            | 3 | qa-service | Python · FastAPI · FAISS · SQLite | RAG QA service | Strong backend/AI implementation | Best technical/backend project |

            That summarizes all three projects.
        """.trimIndent()

        val blocks = Markdown.blocks(src)
        assertEquals(3, blocks.size)
        assertEquals(MarkdownBlock.Paragraph("Here is the portfolio overview:"), blocks[0])
        val table = blocks[1] as MarkdownBlock.Table
        assertEquals(listOf("Rank", "Project", "Type / Stack", "Main Purpose", "Why It Stands Out", "Recognition"), table.headers)
        assertEquals(listOf(TableAlignment.RIGHT, TableAlignment.NONE, TableAlignment.NONE, TableAlignment.NONE, TableAlignment.NONE, TableAlignment.NONE), table.alignments)
        assertEquals(3, table.rows.size)
        assertEquals(listOf("1", "OpenMausBot", "TypeScript · Open source", "AI-agent platform", "Most technically ambitious", "Best flagship project"), table.rows[0])
        assertEquals(listOf("2", "Flocus V2", "Web application", "Pomodoro productivity app", "Strong user-facing product", "Best user-facing product"), table.rows[1])
        assertEquals(listOf("3", "qa-service", "Python · FastAPI · FAISS · SQLite", "RAG QA service", "Strong backend/AI implementation", "Best technical/backend project"), table.rows[2])
        assertEquals(MarkdownBlock.Paragraph("That summarizes all three projects."), blocks[2])

        // Verify that raw table separator or edge pipes are NOT emitted as ordinary paragraphs
        blocks.filterIsInstance<MarkdownBlock.Paragraph>().forEach { p ->
            assertTrue(!p.text.contains("|---"), "Paragraph leaked table separator syntax: ${p.text}")
            assertTrue(!p.text.contains("| Rank |"), "Paragraph leaked table header syntax: ${p.text}")
        }
    }

    private fun text(block: MarkdownBlock): String = when (block) {
        is MarkdownBlock.Paragraph -> block.text
        is MarkdownBlock.Bullet -> block.text
        is MarkdownBlock.Ordered -> block.number.toString() + block.text
        is MarkdownBlock.Heading -> block.text
        is MarkdownBlock.Code -> block.language.orEmpty() + block.text
        is MarkdownBlock.Quote -> block.text
        MarkdownBlock.Rule -> ""
        is MarkdownBlock.Table -> block.headers.joinToString("") + block.rows.flatten().joinToString("")
        is MarkdownBlock.Image -> block.url
    }

    @Test
    fun `parses inline and attached images as distinct blocks`() {
        val markdown = """
            Here is the chart:
            ![Chart](attachment:chart.png)
            And an attached image tag:
            <attached-image path="/api/attachments/photo.jpg" name="photo.jpg" />
            Done!
        """.trimIndent()
        val blocks = Markdown.blocks(markdown)
        assertEquals(5, blocks.size)
        assertTrue(blocks[0] is MarkdownBlock.Paragraph)
        assertEquals("Here is the chart:", (blocks[0] as MarkdownBlock.Paragraph).text)
        assertTrue(blocks[1] is MarkdownBlock.Image)
        assertEquals("attachment:chart.png", (blocks[1] as MarkdownBlock.Image).url)
        assertEquals("Chart", (blocks[1] as MarkdownBlock.Image).alt)
        assertTrue(blocks[2] is MarkdownBlock.Paragraph)
        assertEquals("And an attached image tag:", (blocks[2] as MarkdownBlock.Paragraph).text)
        assertTrue(blocks[3] is MarkdownBlock.Image)
        assertEquals("/api/attachments/photo.jpg", (blocks[3] as MarkdownBlock.Image).url)
        assertEquals("photo.jpg", (blocks[3] as MarkdownBlock.Image).alt)
        assertTrue(blocks[4] is MarkdownBlock.Paragraph)
        assertEquals("Done!", (blocks[4] as MarkdownBlock.Paragraph).text)
    }

    @Test
    fun `rejects raw base64 data URIs and raw image dumps while preserving clean text`() {
        val rawBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        val markdown = """
            Valid synthesized response text before.
            ![Prohibited Screen](data:image/png;base64,$rawBase64)
            data:image/png;base64,$rawBase64
            $rawBase64
            Valid synthesized response text after.
        """.trimIndent()
        val blocks = Markdown.blocks(markdown)
        assertEquals(2, blocks.size)
        assertTrue(blocks[0] is MarkdownBlock.Paragraph)
        assertEquals("Valid synthesized response text before.", (blocks[0] as MarkdownBlock.Paragraph).text)
        assertTrue(blocks[1] is MarkdownBlock.Paragraph)
        assertEquals("Valid synthesized response text after.", (blocks[1] as MarkdownBlock.Paragraph).text)
        assertTrue(blocks.none { it is MarkdownBlock.Image })
    }
}
