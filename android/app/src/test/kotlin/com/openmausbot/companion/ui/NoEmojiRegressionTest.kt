package com.openmausbot.companion.ui

import java.io.File
import java.util.regex.Pattern
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Regression test to strictly enforce the zero-emoji invariant across
 * all user-facing Android UI source code and XML resources.
 */
class NoEmojiRegressionTest {

    // Regex matching all emoji and decorative symbols
    private val emojiPattern = Pattern.compile(
        "[\\x{1F000}-\\x{1FFFF}]|[\\u2600-\\u27BF]|[\\u2300-\\u23FF]|[\\u2B50]|[\\u3030]|[\\u203C\\u2049]|[\\u2122\\u2139]|[\\u2194-\\u2199]|[\\u21A9-\\u21AA]"
    )

    @Test
    fun verifyNoEmojisInProductionAndroidCode() {
        val rootDirs = listOf(
            File("src/main/kotlin"),
            File("../core/src/main/kotlin")
        )

        val violations = mutableListOf<String>()

        for (rootDir in rootDirs) {
            if (!rootDir.exists()) continue
            rootDir.walkTopDown()
                .filter { it.isFile && (it.extension == "kt" || it.extension == "java") }
                .forEach { file ->
                    file.useLines { lines ->
                        lines.forEachIndexed { index, line ->
                            val matcher = emojiPattern.matcher(line)
                            if (matcher.find()) {
                                violations.add("${file.relativeTo(rootDir)}:${index + 1}: '${matcher.group()}' in: ${line.trim().take(80)}")
                            }
                        }
                    }
                }
        }

        assertTrue(
            violations.isEmpty(),
            "Found emojis in Android production code violating zero-emoji policy:\n" + violations.joinToString("\n")
        )
    }

    @Test
    fun verifyNoEmojisInAndroidXmlResources() {
        val resDir = File("src/main/res")
        if (!resDir.exists()) return

        val violations = mutableListOf<String>()
        resDir.walkTopDown()
            .filter { it.isFile && it.extension == "xml" }
            .forEach { file ->
                file.useLines { lines ->
                    lines.forEachIndexed { index, line ->
                        val matcher = emojiPattern.matcher(line)
                        if (matcher.find()) {
                            violations.add("${file.relativeTo(resDir)}:${index + 1}: '${matcher.group()}' in: ${line.trim().take(80)}")
                        }
                    }
                }
            }

        assertTrue(
            violations.isEmpty(),
            "Found emojis in Android XML resources violating zero-emoji policy:\n" + violations.joinToString("\n")
        )
    }

    @Test
    fun verifyStripEmojisSanitizesFlagsAndEmoticons() {
        val input = "Correct! 🇯🇵 Want another flag? 🚀 🤖"
        val output = stripEmojis(input)
        assertTrue(!output.contains("🇯🇵"), "Output must not contain flag emoji")
        assertTrue(!output.contains("🚀"), "Output must not contain rocket")
        assertTrue(!output.contains("🤖"), "Output must not contain robot")
        kotlin.test.assertEquals("Correct! Want another flag?", output)
    }
}
