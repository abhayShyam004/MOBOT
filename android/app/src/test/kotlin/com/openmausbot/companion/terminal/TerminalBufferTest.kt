package com.openmausbot.companion.terminal

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The output buffer is what makes a session readable by a caller that was not
 * there when the output was produced — a bot's tool call in a later turn, or a
 * screen that has just been opened. The cursor is the whole contract.
 */
class TerminalBufferTest {

    private fun buffer(capacity: Int = 64) = TerminalBuffer(capacity)

    @Test
    fun `a reader that never looked before gets everything`() {
        val buffer = buffer()
        buffer.append("first ".toByteArray())
        buffer.append("second".toByteArray())
        val (bytes, cursor) = buffer.since(0)
        assertEquals("first second", String(bytes))
        assertEquals(12L, cursor)
        assertEquals(12L, buffer.total)
    }

    @Test
    fun `a cursor returns only what was appended after it`() {
        val buffer = buffer()
        buffer.append("one".toByteArray())
        val (_, afterOne) = buffer.since(0)
        buffer.append("two".toByteArray())
        val (bytes, afterTwo) = buffer.since(afterOne)
        assertEquals("two", String(bytes))
        assertEquals(6L, afterTwo)
        val (nothing, same) = buffer.since(afterTwo)
        assertTrue(nothing.isEmpty())
        assertEquals(6L, same)
    }

    @Test
    fun `a reader that fell off the end is told, and gets the oldest retained bytes`() {
        val buffer = buffer(capacity = 8)
        buffer.append("0123456789".toByteArray())
        assertEquals(10L, buffer.total)
        assertEquals(2L, buffer.oldest)
        val (bytes, cursor) = buffer.since(0)
        assertEquals("23456789", String(bytes))
        assertEquals(10L, cursor)
    }

    @Test
    fun `appending more than the capacity keeps the newest bytes in order`() {
        val buffer = buffer(capacity = 5)
        buffer.append("abc".toByteArray())
        buffer.append("defg".toByteArray())
        assertEquals(7L, buffer.total)
        assertEquals("cdefg", String(buffer.tail(64)))
        assertEquals("cdefg", String(buffer.since(0).first))
    }

    @Test
    fun `a partial read leaves the rest for the next one`() {
        val buffer = buffer()
        buffer.append("abcdef".toByteArray())
        val (bytes, cursor) = buffer.since(0, maxBytes = 3)
        assertEquals("abc", String(bytes))
        assertEquals(3L, cursor)
        assertEquals("def", String(buffer.since(cursor).first))
        assertFalse(buffer.since(0).first.isEmpty())
    }

    @Test
    fun `tail is the newest window, oldest first`() {
        val buffer = buffer()
        buffer.append("0123456789".toByteArray())
        assertEquals("789", String(buffer.tail(3)))
        assertEquals("0123456789", String(buffer.tail(100)))
    }
}
