package com.openmausbot.companion.signer

/**
 * The signer's own record of how far each canonical memory store has advanced.
 *
 * ## Why this exists
 *
 * Per-record and manifest MACs prove *authenticity*: that a store was sealed by
 * this authority. They cannot prove *freshness*, because an old manifest is
 * still a validly sealed manifest. Until now a same-UID process could copy the
 * `records.json` + `records.integrity.json` pair from an earlier generation
 * back over the current ones and the store verified — the "paired rollback".
 *
 * The missing fact is "which generation was committed last", and it has to live
 * somewhere the agent cannot write. The signer's private directory is that
 * place: it is another Linux UID, and (measured on the SM-A075F) the app cannot
 * read, write or even list it.
 *
 * ## The rules
 *
 * A store's entry is `generation` + `digest` of the manifest that was committed
 * there, plus at most one `pending` candidate for the next generation.
 *
 *   - `prepare(g, d)` may only propose `committed.generation + 1`. Repeating a
 *     prepare for that same generation replaces the candidate: the anchor has
 *     not moved, so nothing has been promised to anyone yet.
 *   - `commit(g, d)` only succeeds when `(g, d)` is exactly the pending
 *     candidate, and is idempotent for the already-committed pair. It is the
 *     only operation that moves the generation.
 *   - `baseline(g, d)` is the one-time initialization for a store that has no
 *     entry yet. The service only calls it for an explicitly authorized boot,
 *     because a store that was never anchored cannot be shown to be the latest
 *     — baselining protects against *future* rollback only.
 *
 * The split between prepare and commit is what makes an interrupted write
 * survivable: a crash between them leaves the anchor where it was and a pending
 * candidate that a later read can either complete (if the manifest did reach
 * disk) or ignore (if it did not).
 *
 * This class is plain Kotlin on purpose: the whole state machine is unit-tested
 * on the JVM, and the file/crypto half lives in [SignerAnchorStore].
 */
internal class AnchorLedger {

    /** Thrown when a request would violate freshness. Never carries data. */
    class Refused(message: String) : SecurityException(message)

    class Entry(
        var generation: Long,
        var digest: String,
        var pending: Pending? = null,
    )

    data class Pending(val generation: Long, val digest: String)

    private val stores = LinkedHashMap<String, Entry>()

    /** Snapshot for persistence: sorted, so the bytes are canonical. */
    fun snapshot(): List<Triple<String, Entry, Pending?>> =
        stores.entries.sortedBy { it.key }.map { Triple(it.key, it.value, it.value.pending) }

    /** Replace all state from a verified on-disk snapshot. */
    fun restore(entries: List<EntryWithKey>) {
        stores.clear()
        for (entry in entries) {
            stores[entry.key] = Entry(entry.generation, entry.digest, entry.pending)
        }
    }

    data class EntryWithKey(
        val key: String,
        val generation: Long,
        val digest: String,
        val pending: Pending? = null,
    )

    fun head(storeKey: String): Entry? = stores[storeKey]

    fun isEmpty(): Boolean = stores.isEmpty()

    /**
     * Propose the next generation's manifest digest.
     *
     * A store with no entry may only prepare generation 1: that is a store whose
     * first manifest is being written, and there is nothing to roll back to. Any
     * later generation needs a baseline first.
     */
    fun prepare(storeKey: String, generation: Long, digest: String) {
        requireFresh(storeKey, generation, digest)
        val entry = stores[storeKey]
        if (entry == null) {
            if (generation != 1L) {
                throw Refused("store has no rollback anchor; generation $generation needs an authorized baseline")
            }
            stores[storeKey] = Entry(1, digest, null)
            return
        }
        if (generation != entry.generation + 1) {
            throw Refused("generation $generation is not the next generation after ${entry.generation}")
        }
        entry.pending = Pending(generation, digest)
    }

    /** Make the prepared candidate the committed generation. */
    fun commit(storeKey: String, generation: Long, digest: String) {
        requireFresh(storeKey, generation, digest)
        val entry = stores[storeKey] ?: throw Refused("store has no rollback anchor")
        if (entry.generation == generation && entry.digest == digest) {
            // Replay of a commit that already landed: idempotent on purpose, so
            // a retried write cannot fail just because the first one finished.
            entry.pending = null
            return
        }
        val pending = entry.pending
            ?: throw Refused("no prepared generation to commit (anchor at ${entry.generation})")
        if (pending.generation != generation || pending.digest != digest) {
            throw Refused("generation $generation does not match the prepared candidate")
        }
        entry.generation = generation
        entry.digest = digest
        entry.pending = null
    }

    /** One-time initialization for a store that predates anchoring. */
    fun baseline(storeKey: String, generation: Long, digest: String) {
        requireFresh(storeKey, generation, digest)
        if (stores.containsKey(storeKey)) {
            throw Refused("store already has a rollback anchor; a baseline would discard its history")
        }
        stores[storeKey] = Entry(generation, digest, null)
    }

    private fun requireFresh(storeKey: String, generation: Long, digest: String) {
        if (storeKey.isEmpty() || storeKey.length > 128) throw Refused("invalid store key")
        if (generation < 1) throw Refused("invalid generation $generation")
        if (!HEX_64.matches(digest)) throw Refused("invalid manifest digest")
    }

    private companion object {
        val HEX_64 = Regex("^[0-9a-f]{64}$")
    }
}
