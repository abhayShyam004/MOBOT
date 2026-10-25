package com.openmausbot.companion.host

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The same contract [com.openmausbot.companion.terminal.PtyJniContractTest]
 * enforces for the PTY, for the bridge: `NativeIpc`'s `external fun`s and the
 * C symbols in `ombpty.c` must agree. Nothing in either toolchain enforces
 * it — a renamed method compiles cleanly on both sides and fails on the
 * phone as an UnsatisfiedLinkError at the first MAC request, one device
 * round trip later. The names are compared here, from the sources themselves.
 */
class NativeIpcJniContractTest {

    private fun moduleFile(relative: String): File {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        repeat(4) {
            val candidate = dir?.let { File(it, relative) }
            if (candidate != null && candidate.isFile) return candidate
            dir = dir?.parentFile
        }
        error("could not locate $relative from ${System.getProperty("user.dir")}")
    }

    private fun nativeMethods(): List<String> {
        val source = moduleFile("src/main/kotlin/com/openmausbot/companion/host/NativeIpc.kt").readText()
        return Regex("""external fun (\w+)\s*\(""").findAll(source).map { it.groupValues[1] }.toList()
    }

    private fun cSymbols(): List<String> {
        val source = moduleFile("src/main/jni/ombpty.c").readText()
        val prefix = "Java_com_openmausbot_companion_host_NativeIpc_"
        return Regex("""$prefix(\w+)\s*\(""").findAll(source).map { it.groupValues[1] }.toList()
    }

    @Test
    fun `every declared bridge native method has a C implementation, and nothing is unused`() {
        val declared = nativeMethods()
        val implemented = cSymbols()
        assertTrue(declared.isNotEmpty(), "NativeIpc declares no native methods")
        // Sorted comparison so a missing implementation and a stray symbol are
        // both reported, instead of one hiding behind the other.
        assertEquals(declared.sorted(), implemented.sorted())
    }

    @Test
    fun `the C symbols are named for the object that declares them`() {
        val source = moduleFile("src/main/jni/ombpty.c").readText()
        assertTrue(
            source.contains("Java_com_openmausbot_companion_host_NativeIpc_nativeListen"),
            "ombpty.c must define the listener entry point for NativeIpc",
        )
        assertTrue(
            source.contains("Java_com_openmausbot_companion_host_NativeIpc_nativeAcceptPeer"),
            "ombpty.c must define the peer-authenticating accept entry point for NativeIpc",
        )
        assertTrue(
            source.contains("Java_com_openmausbot_companion_host_NativeIpc_nativeSetCloexec"),
            "ombpty.c must define the close-on-exec entry point for NativeIpc",
        )
    }
}
