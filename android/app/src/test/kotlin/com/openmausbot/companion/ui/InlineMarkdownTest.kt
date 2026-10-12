package com.openmausbot.companion.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The inline pass renders every bot message, so it gets the thorough tests.
 *
 * The supported set mirrors Foundation's `.inlineOnlyPreservingWhitespace`, which
 * is what `ios/App/MarkdownText.swift` hands its runs to: bold, italic, code
 * spans, strikethrough, links.
 */
class InlineMarkdownTest {

    private fun styles(source: String): List<Pair<String, Set<InlineStyle>>> =
        InlineMarkdown.parse(source).map { it.text to it.styles }

    @Test
    fun `plain text is one unstyled run`() {
        assertEquals(listOf("hello there" to emptySet<InlineStyle>()), styles("hello there"))
    }

    @Test
    fun `empty source produces nothing`() {
        assertEquals(emptyList(), InlineMarkdown.parse(""))
    }

    @Test
    fun `double asterisks are bold`() {
        assertEquals(
            listOf("a " to emptySet(), "b" to setOf(InlineStyle.BOLD), " c" to emptySet()),
            styles("a **b** c"),
        )
    }

    @Test
    fun `single asterisks are italic`() {
        assertEquals(listOf("b" to setOf(InlineStyle.ITALIC)), styles("*b*"))
    }

    @Test
    fun `triple asterisks are bold and italic`() {
        assertEquals(
            listOf("b" to setOf(InlineStyle.BOLD, InlineStyle.ITALIC)),
            styles("***b***"),
        )
    }

    @Test
    fun `underscores emphasise like asterisks`() {
        assertEquals(listOf("b" to setOf(InlineStyle.ITALIC)), styles("_b_"))
        assertEquals(listOf("b" to setOf(InlineStyle.BOLD)), styles("__b__"))
    }

    @Test
    fun `underscores inside a word are literal`() {
        assertEquals(listOf("snake_case_name" to emptySet<InlineStyle>()), styles("snake_case_name"))
    }

    @Test
    fun `emphasis nests`() {
        assertEquals(
            listOf(
                "bold " to setOf(InlineStyle.BOLD),
                "and italic" to setOf(InlineStyle.BOLD, InlineStyle.ITALIC),
            ),
            styles("**bold *and italic***"),
        )
    }

    @Test
    fun `strikethrough uses a double tilde`() {
        assertEquals(
            listOf("gone" to setOf(InlineStyle.STRIKE), " here" to emptySet()),
            styles("~~gone~~ here"),
        )
    }

    @Test
    fun `a single tilde is literal`() {
        assertEquals(listOf("~home" to emptySet<InlineStyle>()), styles("~home"))
    }

    @Test
    fun `code spans are monospaced and not reparsed`() {
        assertEquals(
            listOf("**not bold**" to setOf(InlineStyle.CODE)),
            styles("`**not bold**`"),
        )
    }

    @Test
    fun `double backticks let a backtick appear inside`() {
        assertEquals(listOf("a ` b" to setOf(InlineStyle.CODE)), styles("``a ` b``"))
    }

    @Test
    fun `one space is stripped from each end of a code span`() {
        assertEquals(listOf("`" to setOf(InlineStyle.CODE)), styles("`` ` ``"))
    }

    @Test
    fun `links carry a destination`() {
        val spans = InlineMarkdown.parse("see [the docs](https://example.com/a) now")
        assertEquals("the docs", spans[1].text)
        assertEquals("https://example.com/a", spans[1].link)
        assertNull(spans[0].link)
    }

    @Test
    fun `link titles are dropped`() {
        val spans = InlineMarkdown.parse("[x](https://example.com \"Title\")")
        assertEquals("https://example.com", spans.single().link)
    }

    @Test
    fun `angle bracket link destinations are unwrapped`() {
        val spans = InlineMarkdown.parse("[x](<https://example.com/a b>)")
        assertEquals("https://example.com/a b", spans.single().link)
    }

    @Test
    fun `link labels may carry emphasis`() {
        val spans = InlineMarkdown.parse("[**bold link**](https://example.com)")
        assertEquals("bold link", spans.single().text)
        assertEquals(setOf(InlineStyle.BOLD), spans.single().styles)
        assertEquals("https://example.com", spans.single().link)
    }

    @Test
    fun `escaped punctuation is literal`() {
        assertEquals(listOf("*not italic*" to emptySet<InlineStyle>()), styles("\\*not italic\\*"))
    }

    // Streaming: a reply grows one character at a time, and every prefix has to
    // render as the characters typed so far.

    @Test
    fun `an unterminated bold marker is literal`() {
        assertEquals(listOf("**half" to emptySet<InlineStyle>()), styles("**half"))
    }

    @Test
    fun `an unterminated code span is literal`() {
        assertEquals(listOf("`half" to emptySet<InlineStyle>()), styles("`half"))
    }

    @Test
    fun `an unterminated link is literal`() {
        assertEquals(listOf("[label](https://ex" to emptySet<InlineStyle>()), styles("[label](https://ex"))
        assertEquals(listOf("[label" to emptySet<InlineStyle>()), styles("[label"))
    }

    @Test
    fun `empty emphasis is literal`() {
        assertEquals(listOf("**" to emptySet<InlineStyle>()), styles("**"))
        assertEquals(listOf("****" to emptySet<InlineStyle>()), styles("****"))
    }

    @Test
    fun `growing a reply one character at a time never loses content characters`() {
        // The streaming invariant from `MarkdownTests.swift`: every prefix must
        // render, and the characters that are not syntax must all survive.
        val full = "Here is **bold**, `code`, ~~gone~~ and _more_ after."
        val markers = "*`~_".toSet()
        for (length in 0..full.length) {
            val prefix = full.take(length)
            val rendered = InlineMarkdown.plain(InlineMarkdown.parse(prefix))
            assertEquals(
                prefix.filterNot { it in markers },
                rendered.filterNot { it in markers },
                "prefix of $length characters lost or invented content: <$rendered>",
            )
        }
    }

    @Test
    fun `a link renders its label at every prefix`() {
        val full = "see [the docs](https://example.com/a) now"
        for (length in 0..full.length) {
            val rendered = InlineMarkdown.plain(InlineMarkdown.parse(full.take(length)))
            assertTrue(
                rendered.isNotEmpty() || length <= 1,
                "prefix of $length characters rendered nothing",
            )
            assertTrue(rendered.startsWith("see".take(maxOf(0, minOf(3, length)))))
        }
    }

    // Regression: a destination with an unescaped space is not a link. Accepting
    // one swallowed the text after it the moment `)` arrived, which is exactly
    // the content loss the streaming renderer must never cause.

    @Test
    fun `a destination containing a space is not a link`() {
        val spans = InlineMarkdown.parse("[x](https://e trailing text)")
        assertEquals("[x](https://e trailing text)", InlineMarkdown.plain(spans))
        assertTrue(spans.all { it.link == null })
    }

    @Test
    fun `a malformed link loses nothing at any prefix`() {
        val full = "before [x](https://e trailing text) after"
        for (length in 0..full.length) {
            val prefix = full.take(length)
            assertEquals(
                prefix,
                InlineMarkdown.plain(InlineMarkdown.parse(prefix)),
                "prefix of $length characters was not rendered verbatim",
            )
        }
    }

    @Test
    fun `an empty destination is still a link`() {
        // CommonMark and the desktop both accept these; rejecting them would
        // have shown the brackets instead of the label.
        for (source in listOf("[x]()", "[x](<>)", "[x](  )")) {
            val spans = InlineMarkdown.parse(source)
            assertEquals("x", InlineMarkdown.plain(spans), source)
            assertEquals("", spans.single().link, source)
        }
    }

    @Test
    fun `a parenthesis inside an angle destination does not close the link`() {
        assertEquals("b)c", InlineMarkdown.parse("[a](<b)c>)").single().link)
        assertEquals("a", InlineMarkdown.plain(InlineMarkdown.parse("[a](<b)c>)")))
    }

    @Test
    fun `unbalanced parentheses inside an angle destination are kept`() {
        val spans = InlineMarkdown.parse("[link](<foo(and(bar)>)")
        assertEquals("foo(and(bar)", spans.single().link)
        assertEquals("link", InlineMarkdown.plain(spans))
    }

    @Test
    fun `a parenthesis inside a quoted title does not close the link`() {
        val spans = InlineMarkdown.parse("""[x](/url "a)b")""")
        assertEquals("/url", spans.single().link)
        assertEquals("x", InlineMarkdown.plain(spans))
    }

    @Test
    fun `balanced parentheses are part of a bare destination`() {
        assertEquals(
            "https://e/foo(bar)",
            InlineMarkdown.parse("[x](https://e/foo(bar))").single().link,
        )
    }

    @Test
    fun `an unbalanced bare destination is not a link`() {
        val source = "[x](https://e/foo(bar)"
        assertEquals(source, InlineMarkdown.plain(InlineMarkdown.parse(source)))
    }

    @Test
    fun `a non-breaking space belongs to the destination`() {
        // CommonMark separators are spaces, tabs and line endings. A NBSP is an
        // ordinary character, so this is one long destination and no title.
        val nbsp = '\u00A0'
        val spans = InlineMarkdown.parse("[x](/url$nbsp\"title\")")
        assertEquals("/url$nbsp\"title\"", spans.single().link)
        assertEquals("x", InlineMarkdown.plain(spans))
    }

    @Test
    fun `a tab separates a destination from its title`() {
        assertEquals("/url", InlineMarkdown.parse("[x](/url\t\"title\")").single().link)
    }

    @Test
    fun `other Unicode spaces belong to the destination too`() {
        for (space in listOf('\u2007', '\u202F', '\u2009')) {
            val spans = InlineMarkdown.parse("[x](/url${space}tail)")
            assertEquals("/url${space}tail", spans.single().link, "U+%04X".format(space.code))
        }
    }

    @Test
    fun `a line ending inside an angle destination is not a link`() {
        for (source in listOf("[x](<foo\nbar>)", "[x](<foo\rbar>)")) {
            val spans = InlineMarkdown.parse(source)
            assertEquals(source, InlineMarkdown.plain(spans), source)
            assertTrue(spans.all { it.link == null }, source)
        }
    }

    @Test
    fun `a backslash cannot smuggle a line ending into an angle destination`() {
        // `\\` + LF is not an escape (a line ending is not escapable punctuation),
        // and the line ending is rejected before any escape is consumed.
        for (source in listOf("[x](<foo\\\nbar>)", "[x](<foo\\\rbar>)")) {
            val spans = InlineMarkdown.parse(source)
            assertTrue(spans.all { it.link == null }, source.replace("\n", "\\n"))
            assertEquals(source, InlineMarkdown.plain(spans))
        }
    }

    @Test
    fun `a backslash still escapes a closing angle bracket`() {
        assertEquals("foo>bar", InlineMarkdown.parse("""[x](<foo\>bar>)""").single().link)
    }

    @Test
    fun `a control character in a bare destination is not a link`() {
        val source = "[x](/ur\u0007l)"
        assertEquals(source, InlineMarkdown.plain(InlineMarkdown.parse(source)))
    }

    @Test
    fun `a single line ending may separate the components`() {
        assertEquals("/url", InlineMarkdown.parse("[x](/url\n\"title\")").single().link)
    }

    @Test
    fun `a blank line ends the link`() {
        val source = "[x](/url\n\n\"title\")"
        assertEquals(source, InlineMarkdown.plain(InlineMarkdown.parse(source)))
    }

    @Test
    fun `whitespace around the destination is allowed`() {
        assertEquals(
            "https://e",
            InlineMarkdown.parse("[x](  https://e  )").single().link,
        )
    }

    @Test
    fun `a quoted or parenthesised title after the destination is still a link`() {
        for (source in listOf(
            "[x](https://e \"t\")",
            "[x](https://e 't')",
            "[x](https://e (t))",
        )) {
            val spans = InlineMarkdown.parse(source)
            assertEquals("https://e", spans.single().link, source)
        }
    }

    @Test
    fun `a title must be exactly one title and nothing else`() {
        // Title-shaped only from its ends: the inner unescaped quote closes it,
        // and `junk "` is left over, so none of this is a link.
        for (source in listOf(
            """[x](https://e "t" junk ")""",
            """[x](https://e 't' junk ')""",
            """[x](https://e (t) junk (b))""",
            """[x](https://e "t" "u")""",
            """[x](https://e "t"junk)""",
            """[x](https://e junk "t")""",
        )) {
            val spans = InlineMarkdown.parse(source)
            assertEquals(source, InlineMarkdown.plain(spans), source)
            assertTrue(spans.all { it.link == null }, source)
        }
    }

    @Test
    fun `an escaped delimiter inside a title is still one title`() {
        val spans = InlineMarkdown.parse("""[x](https://e "a \" b")""")
        assertEquals("https://e", spans.single().link)
    }

    @Test
    fun `a malformed title loses nothing at any prefix`() {
        val full = """before [x](https://e "t" junk ") after"""
        for (length in 0..full.length) {
            val prefix = full.take(length)
            assertEquals(
                prefix,
                InlineMarkdown.plain(InlineMarkdown.parse(prefix)),
                "prefix of $length characters was not rendered verbatim",
            )
        }
    }

    @Test
    fun `an escaped angle bracket does not close the destination`() {
        val spans = InlineMarkdown.parse("""[x](<foo\>bar>)""")
        assertEquals("foo>bar", spans.single().link)
        assertEquals("x", InlineMarkdown.plain(spans))
    }

    @Test
    fun `an unclosed angle destination is literal`() {
        val source = "[x](<foo bar)"
        assertEquals(source, InlineMarkdown.plain(InlineMarkdown.parse(source)))
        assertTrue(InlineMarkdown.parse(source).all { it.link == null })
    }

    @Test
    fun `an escaped bracket that never closes the destination is not a link`() {
        // The backslash is markdown syntax and is consumed as an escape, so the
        // text shows `>` — but no character of content is lost and no link is
        // invented from a destination that never closed.
        val spans = InlineMarkdown.parse("""[x](<foo\>bar)""")
        assertTrue(spans.all { it.link == null })
        assertEquals("[x](<foo>bar)", InlineMarkdown.plain(spans))
    }

    @Test
    fun `escapes in a bare destination are resolved`() {
        val spans = InlineMarkdown.parse("""[x](https://e/a\)b)""")
        assertEquals("https://e/a)b", spans.single().link)
    }

    @Test
    fun `a bracket inside a code span does not end the link label`() {
        val spans = InlineMarkdown.parse("[see `a]b`](https://x)")
        assertEquals("https://x", spans.first().link)
        assertEquals("see a]b", InlineMarkdown.plain(spans))
        assertTrue(spans.all { it.link == "https://x" })
    }

    @Test
    fun `no span is empty`() {
        val spans = InlineMarkdown.parse("**a** `b` ~~c~~ [d](https://e) _f_")
        assertTrue(spans.all { it.text.isNotEmpty() })
    }

    @Test
    fun `a bare url is a link span carrying the full scheme`() {
        val spans = InlineMarkdown.parse("Read more: https://example.com/article")
        val link = spans.last()
        assertEquals("Read more: ", spans.first().text)
        assertEquals("https://example.com/article", link.text)
        assertEquals("https://example.com/article", link.link)
        assertNull(spans.first().link)
    }

    @Test
    fun `punctuation after a bare url does not join the destination`() {
        val spans = InlineMarkdown.parse("See https://example.com/a, and enjoy!")
        val link = spans.single { it.link != null }
        assertEquals("https://example.com/a", link.link)
        assertEquals("https://example.com/a", link.text)
        assertEquals(
            "See https://example.com/a, and enjoy!",
            InlineMarkdown.plain(spans),
            "punctuation must stay in the rendered text",
        )
    }

    @Test
    fun `sentence-ending period is not part of the url`() {
        assertEquals("https://example.com/a", linkDestination("Visit https://example.com/a."))
        assertEquals("https://example.com/a", linkDestination("Visit https://example.com/a. Next"))
    }

    @Test
    fun `query strings and fragments stay in the destination`() {
        assertEquals(
            "https://example.com/search?q=phase+8&lang=en",
            linkDestination("https://example.com/search?q=phase+8&lang=en"),
        )
        assertEquals(
            "https://example.com/doc#section-2",
            linkDestination("See https://example.com/doc#section-2 for details."),
        )
        assertEquals("https://example.com/p?a=1#top", linkDestination("https://example.com/p?a=1#top."))
    }

    @Test
    fun `url path parentheses are kept when balanced`() {
        assertEquals(
            "https://en.wikipedia.org/wiki/Python_(programming_language)",
            linkDestination("https://en.wikipedia.org/wiki/Python_(programming_language)"),
        )
        assertEquals("https://e/f(g)", linkDestination("at https://e/f(g) inside prose"))
    }

    @Test
    fun `prose closing parenthesis does not join the destination`() {
        assertEquals("https://e/a", linkDestination("(see https://e/a)"))
    }

    @Test
    fun `an unclosed parenthesis inside the url ends the link`() {
        assertEquals("https://e/a", linkDestination("https://e/a(b c"))
    }

    @Test
    fun `http is autolinked like https`() {
        assertEquals("http://example.net/x", linkDestination("http://example.net/x"))
    }

    @Test
    fun `the scheme is matched without case sensitivity`() {
        assertEquals("HTTPS://EXAMPLE.COM/A", linkDestination("HTTPS://EXAMPLE.COM/A"))
    }

    @Test
    fun `a url welded to a word does not link`() {
        assertNull(linkDestinationOrNull("wordhttps://example.com/a"))
    }

    @Test
    fun `a colon with no slashes is not a url`() {
        assertNull(linkDestinationOrNull("meet at 10:30"))
        assertNull(linkDestinationOrNull("ratio 2:1"))
    }

    @Test
    fun `a url inside a code span is not autolinked`() {
        val spans = InlineMarkdown.parse("run `curl https://e/x` now")
        val code = spans.single { InlineStyle.CODE in it.styles }
        assertNull(code.link)
        assertTrue(spans.all { it.link == null })
    }

    @Test
    fun `a bare url inside a markdown label is not re-linked`() {
        val spans = InlineMarkdown.parse("[label text](https://e/a)")
        assertEquals("https://e/a", spans.single().link)
        assertEquals("label text", spans.single().text)
    }

    @Test
    fun `a bare url neighbours emphasis and code spans`() {
        val spans = InlineMarkdown.parse("**bold** https://e/a `code`")
        assertEquals("https://e/a", spans.first { it.link != null }.link)
        assertEquals(
            "**bold** https://e/a `code".replace("*", "").replace("`", ""),
            InlineMarkdown.plain(spans).replace("*", "").replace("`", ""),
        )
    }

    @Test
    fun `multiple bare urls in one line each link`() {
        val spans = InlineMarkdown.parse("https://e/1 and https://e/2")
        assertEquals(listOf("https://e/1", "https://e/2"), spans.filter { it.link != null }.map { it.link })
    }

    @Test
    fun `a bare url keeps rendering every prefix while streaming`() {
        val full = "see https://example.com/a. done"
        for (length in 1..full.length) {
            val rendered = InlineMarkdown.plain(InlineMarkdown.parse(full.take(length)))
            assertEquals(full.take(length), rendered, "prefix of $length characters")
        }
    }

    @Test
    fun `a bare url is styled like any other link`() {
        val spans = InlineMarkdown.parse("go https://e/a now")
        val link = spans.single { it.link != null }
        assertTrue(link.styles.isEmpty(), "autolink label carries no emphasis of its own")
    }

    /** The destination of the one link in [source], for compact assertions. */
    private fun linkDestination(source: String): String =
        linkDestinationOrNull(source) ?: error("expected a link in <$source>")

    /** The destination of the one link in [source], or null when none rendered. */
    private fun linkDestinationOrNull(source: String): String? {
        val links = InlineMarkdown.parse(source).filter { it.link != null }
        if (links.isEmpty()) return null
        assertEquals(1, links.size, "expected exactly one link in <$source>")
        return links.single().link
    }
}
