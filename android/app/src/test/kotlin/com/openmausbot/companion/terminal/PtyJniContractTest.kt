package com.openmausbot.companion.terminal

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Kotlin `external fun`s and the C symbols must agree, and nothing in
 * either toolchain enforces it: a renamed method or a renamed C function
 * compiles cleanly on both sides and fails on the phone as an
 * UnsatisfiedLinkError at the first terminal command — which is exactly how
 * this was discovered the first time, one device round trip later.
 *
 * So the names are compared here, in the JVM suite, from the sources
 * themselves. It is a static check, and it is the whole contract: JNI resolves
 * `Java_<class>_<method>` with underscores escaped, which for this package,
 * this class and these method names is a direct concatenation.
 */
class PtyJniContractTest {

    private val jniClass = "NativePty"

    private fun moduleFile(relative: String): File {
        // Gradle runs unit tests with the module directory as the working
        // directory, but the source is found wherever the module is, so walk up
        // rather than assume a path depth.
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        repeat(4) {
            val candidate = dir?.let { File(it, relative) }
            if (candidate != null && candidate.isFile) return candidate
            dir = dir?.parentFile
        }
        error("could not locate $relative from ${System.getProperty("user.dir")}")
    }

    private fun nativeMethods(): List<String> {
        val source = moduleFile("src/main/kotlin/com/openmausbot/companion/terminal/PtyNative.kt").readText()
        return Regex("""external fun (\w+)\s*\(""").findAll(source).map { it.groupValues[1] }.toList()
    }

    private fun cSymbols(): List<String> {
        val source = moduleFile("src/main/jni/ombpty.c").readText()
        val prefix = "Java_com_openmausbot_companion_terminal_${jniClass}_"
        return Regex("""$prefix(\w+)\s*\(""").findAll(source).map { it.groupValues[1] }.toList()
    }

    @Test
    fun `every declared native method has a C implementation, and nothing is unused`() {
        val declared = nativeMethods()
        val implemented = cSymbols()
        assertTrue(declared.isNotEmpty(), "PtyNative declares no native methods")
        // Sorted comparison so a missing implementation and a stray symbol are
        // both reported, instead of one hiding behind the other.
        assertEquals(declared.sorted(), implemented.sorted())
    }

    @Test
    fun `the C symbols are named for the object that declares them`() {
        val source = moduleFile("src/main/kotlin/com/openmausbot/companion/terminal/PtyNative.kt").readText()
        assertTrue(
            Regex("""object $jniClass\b""").containsMatchIn(source),
            "ombpty.c exports Java_com_openmausbot_companion_terminal_${jniClass}_*, but no such object exists",
        )
        // And the library name the code loads matches the file the build
        // script produces: libombpty.so.
        assertTrue(source.contains("""System.loadLibrary("ombpty")"""))
    }
}
