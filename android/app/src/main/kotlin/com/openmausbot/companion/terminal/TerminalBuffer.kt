package com.openmausbot.companion.terminal

/**
 * A session's output, bounded by capacity and addressable by an absolute
 * cursor.
 *
 * The cursor is the part that matters. A reader that wants "the output since I
 * last looked" must be able to say so without holding a stream open, because
 * its reader is usually a bot's tool call that happens once and returns — the
 * session outlives it. `total` is the number of bytes ever produced, so the
 * cursor is stable across buffer trimming: a reader that fell behind by more
 * than the capacity gets the oldest retained bytes and is told (by comparing
 * its cursor against [oldest]) that it missed some.
 *
 * Synchronised: the pump thread writes while an HTTP thread or the UI reads.
 */
internal class TerminalBuffer(private val capacity: Int) {

    private val data = ByteArray(capacity)
    /** Index of the oldest retained byte. */
    private var start = 0
    private var size = 0

    /** Bytes ever appended — the cursor a reader holds. */
    var total: Long = 0L
        private set

    /** Oldest cursor still fully available. */
    val oldest: Long get() = synchronized(this) { total - size }

    val retained: Int get() = synchronized(this) { size }

    fun append(bytes: ByteArray, length: Int = bytes.size) {
        if (length <= 0) return
        synchronized(this) {
            if (length >= capacity) {
                // Only the newest capacity bytes can survive; copy the tail.
                System.arraycopy(bytes, length - capacity, data, 0, capacity)
                start = 0
                size = capacity
                total += length.toLong()
                return
            }
            val end = (start + size) % capacity
            val first = minOf(length, capacity - end)
            System.arraycopy(bytes, 0, data, end, first)
            if (length > first) System.arraycopy(bytes, first, data, 0, length - first)
            size += length
            if (size > capacity) {
                val overflow = size - capacity
                start = (start + overflow) % capacity
                size = capacity
            }
            total += length.toLong()
        }
    }

    /**
     * Bytes appended after [cursor], clamped into what is still retained.
     * Returns the bytes and the cursor to pass next time.
     */
    fun since(cursor: Long, maxBytes: Int = Int.MAX_VALUE): Pair<ByteArray, Long> = synchronized(this) {
        val base = total - size
        val from = maxOf(cursor, base)
        val available = (total - from).toInt().coerceAtMost(maxBytes).coerceAtLeast(0)
        if (available == 0) return@synchronized Pair(ByteArray(0), from)
        val offset = (from - base).toInt()
        val out = ByteArray(available)
        for (i in 0 until available) {
            out[i] = data[(start + offset + i) % capacity]
        }
        Pair(out, from + available)
    }

    /** The newest [maxBytes] bytes, oldest first — the screen's tail. */
    fun tail(maxBytes: Int): ByteArray = synchronized(this) {
        val take = minOf(maxBytes, size)
        if (take == 0) return@synchronized ByteArray(0)
        val from = (start + size - take) % capacity
        val out = ByteArray(take)
        val first = minOf(take, capacity - from)
        System.arraycopy(data, from, out, 0, first)
        if (take > first) System.arraycopy(data, 0, out, first, take - first)
        out
    }
}
