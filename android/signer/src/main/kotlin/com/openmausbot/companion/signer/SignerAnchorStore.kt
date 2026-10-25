package com.openmausbot.companion.signer

import android.system.Os
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The anchor ledger, made durable in this package's private storage.
 *
 * The file is written through a temporary copy and an atomic rename, so a crash
 * either leaves the previous generation in place or the next one — never a
 * half-written ledger. It carries its own MAC, computed with the same
 * non-exportable Keystore key as everything else: a truncated or edited file is
 * detected instead of being read as "no anchor yet" (which is the state that
 * would otherwise re-open a baseline).
 *
 * Missing and corrupt are deliberately different. Missing means this signer has
 * never anchored anything — only possible on a fresh install, because the file
 * lives in a directory the app UID cannot touch. Corrupt means the trusted
 * state was damaged, and every operation then fails closed.
 */
internal class SignerAnchorStore(private val file: File) {

    private companion object {
        const val TAG = "MemorySigner"
        const val VERSION = 1
    }

    private val ledger = AnchorLedger()
    private val lock = Any()
    private var loaded = false

    private fun ensureLoaded() {
        if (loaded) return
        if (!file.exists()) {
            loaded = true
            return
        }
        val raw = runCatching { file.readText() }.getOrElse { error ->
            throw AnchorLedger.Refused("rollback anchor is unreadable: ${error.javaClass.simpleName}")
        }
        val parsed = runCatching { JSONObject(raw) }.getOrElse {
            throw AnchorLedger.Refused("rollback anchor is not valid JSON")
        }
        val body = parsed.optJSONObject("body") ?: throw AnchorLedger.Refused("rollback anchor has no body")
        val mac = parsed.optString("mac", "")
        val canonical = body.toString()
        val expected = runCatching { MemorySignerKey.mac("anchor", canonical) }.getOrElse { error ->
            throw AnchorLedger.Refused("rollback anchor cannot be verified: ${error.message}")
        }
        if (mac != expected) {
            throw AnchorLedger.Refused("rollback anchor failed its own MAC check")
        }
        if (body.optInt("v", -1) != VERSION) {
            throw AnchorLedger.Refused("rollback anchor has an unsupported version")
        }
        val stores = body.optJSONArray("stores") ?: JSONArray()
        val entries = ArrayList<AnchorLedger.EntryWithKey>(stores.length())
        for (index in 0 until stores.length()) {
            val store = stores.optJSONObject(index) ?: continue
            val pendingJson = store.optJSONObject("pending")
            entries.add(
                AnchorLedger.EntryWithKey(
                    key = store.optString("key"),
                    generation = store.optLong("generation"),
                    digest = store.optString("digest"),
                    pending = pendingJson?.let {
                        AnchorLedger.Pending(it.optLong("generation"), it.optString("digest"))
                    },
                ),
            )
        }
        ledger.restore(entries)
        loaded = true
        Log.i(TAG, "rollback anchor loaded: ${entries.size} store(s)")
    }

    private fun persist() {
        val stores = JSONArray()
        for ((key, entry, pending) in ledger.snapshot()) {
            val store = JSONObject()
                .put("key", key)
                .put("generation", entry.generation)
                .put("digest", entry.digest)
            if (pending != null) {
                store.put("pending", JSONObject().put("generation", pending.generation).put("digest", pending.digest))
            }
            stores.put(store)
        }
        val body = JSONObject().put("v", VERSION).put("stores", stores)
        val canonical = body.toString()
        val mac = MemorySignerKey.mac("anchor", canonical)
        val document = JSONObject().put("body", body).put("mac", mac).toString()

        file.parentFile?.mkdirs()
        val temp = File(file.parentFile, "${file.name}.tmp")
        temp.writeText(document)
        runCatching { Os.chmod(temp.absolutePath, 0x180 /* 0600 */) }
        if (!temp.renameTo(file)) {
            temp.delete()
            throw AnchorLedger.Refused("could not commit the rollback anchor")
        }
        runCatching { Os.chmod(file.absolutePath, 0x180) }
    }

    fun head(storeKey: String): AnchorLedger.Entry? = synchronized(lock) {
        ensureLoaded()
        ledger.head(storeKey)
    }

    fun prepare(storeKey: String, generation: Long, digest: String) = synchronized(lock) {
        ensureLoaded()
        ledger.prepare(storeKey, generation, digest)
        persist()
    }

    fun commit(storeKey: String, generation: Long, digest: String) = synchronized(lock) {
        ensureLoaded()
        ledger.commit(storeKey, generation, digest)
        persist()
    }

    fun baseline(storeKey: String, generation: Long, digest: String) = synchronized(lock) {
        ensureLoaded()
        ledger.baseline(storeKey, generation, digest)
        persist()
    }

    /** For the trust log: counts only, never digests of memory content. */
    fun describe(): String = synchronized(lock) {
        ensureLoaded()
        "stores=${ledger.snapshot().size}"
    }
}
