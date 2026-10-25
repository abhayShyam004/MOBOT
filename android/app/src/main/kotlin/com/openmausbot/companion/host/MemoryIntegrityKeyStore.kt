package com.openmausbot.companion.host

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Log
import java.io.File
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory

/**
 * The canonical-memory HMAC authority.
 *
 * The long-lived key is an HMAC-SHA256 key generated inside the Android
 * Keystore. Its bytes are never exportable and never enter the Node process:
 * the host sends the exact canonical payloads over its stdout pipe and reads
 * the 32-byte MACs back over stdin (`HarnessHost` frame bridge). A copied data
 * directory, an agent file tool, or `adb run-as` finds no key to copy, and a
 * process that can run the packaged server but is not this harness has no way
 * to ask the Keystore for a MAC.
 *
 * The previous AES-wrapped key blob (`key.keystore`) is read only on the
 * migration boot so the old v1 manifests can be verified once; after the host
 * reports every store re-sealed, [retireLegacyKey] deletes the blob and its
 * wrapping alias. A fresh install never creates one.
 *
 * Failure policy: an unreadable Keystore key is reported and the host gets no
 * MACs, so memory fails closed with `ERR_MEMORY_INTEGRITY`. Nothing is ever
 * regenerated over an existing record set.
 */
object MemoryIntegrityKeyStore {

    private const val TAG = "MemoryIntegrity"

    /** Non-exportable HMAC key used for every record and manifest MAC. */
    const val HMAC_ALIAS = "omb_memory_integrity_hmac_v2"

    /** Retired wrapping key for the migration blob. */
    const val WRAP_ALIAS = "omb_memory_integrity_wrap_v1"
    const val WRAPPED_NAME = "key.keystore"

    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val VERSION = 1
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
    const val KEY_BYTES = 32

    /** The Keystore could not supply a usable key. Fail closed; never regenerate. */
    class Unavailable(message: String, cause: Throwable? = null) : Exception(message, cause)

    /** One log line; the security level is a device capability, not a secret. */
    fun describeSecurityLevel(): String = runCatching {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val entry = store.getEntry(HMAC_ALIAS, null) as? KeyStore.SecretKeyEntry
            ?: return "hmac key absent"
        val factory = SecretKeyFactory.getInstance(entry.secretKey.algorithm, ANDROID_KEYSTORE)
        val info = factory.getKeySpec(entry.secretKey, KeyInfo::class.java) as KeyInfo
        // Reported verbatim: 1 = software, 2 = TEE, 3 = StrongBox. The named
        // constants live on different classes across API levels; a security
        // claim should not depend on which spelling compiled.
        "level=${info.securityLevel}"
    }.getOrElse { "unavailable: ${it.javaClass.simpleName}" }

    /** Where the migration marker lives; set once at spawn. */
    @Volatile
    private var dataDir: File? = null

    /** Bind the data directory and make sure a usable key exists before the
     * host starts. A marker without its key means this install was restored
     * onto a device that does not have the Keystore entry: that must fail
     * loudly, not mint a key that cannot verify a single existing record. */
    fun prepare(dataDir: File): SecretKey {
        this.dataDir = dataDir
        return nativeKey()
    }

    /** Create the HMAC key once; subsequent calls return the same key. */
    fun nativeKey(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getEntry(HMAC_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val dir = dataDir
        if (dir != null && File(File(dir, "memory-integrity"), "native-provider.json").isFile) {
            throw Unavailable(
                "the Keystore HMAC key is missing but this install was already migrated (restored data or cleared Keystore)",
            )
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            HMAC_ALIAS,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
            .setKeySize(256)
            .build()
        generator.init(spec)
        val key = generator.generateKey()
        Log.i(TAG, "created a non-exportable HMAC key in the Android Keystore (${describeSecurityLevel()})")
        return key
    }

    /** HMAC-SHA256 over `${purpose}\n${payload}`, hex, computed inside the
     * Keystore. `purpose` must be one the memory store actually uses. */
    fun mac(purpose: String, payload: String): String {
        if (purpose != "record" && purpose != "manifest") {
            throw Unavailable("refusing an unknown MAC purpose")
        }
        val key = nativeKey()
        val input = "omb-memory-$purpose-v1\n".toByteArray(Charsets.UTF_8) + payload.toByteArray(Charsets.UTF_8)
        // Which provider exposes HmacSHA256 differs across Android releases and
        // Keystore backends; try the known spellings before failing closed. No
        // branch leaves the Keystore: `key` is a Keystore key in every one.
        var last: Throwable? = null
        for (provider in listOf("AndroidKeyStoreBCWorkaround", ANDROID_KEYSTORE, null)) {
            try {
                val mac = if (provider == null) Mac.getInstance("HmacSHA256") else Mac.getInstance("HmacSHA256", provider)
                mac.init(key)
                return mac.doFinal(input).joinToString("") { "%02x".format(it) }
            } catch (error: Throwable) {
                last = error
            }
        }
        throw Unavailable("the Keystore cannot compute HmacSHA256 on this device: ${last?.message}", last)
    }

    // ── legacy migration blob ──────────────────────────────────────────────

    fun legacyWrappedBlob(dataDir: File): File = File(File(dataDir, "memory-integrity"), WRAPPED_NAME)

    fun hasLegacyKey(dataDir: File): Boolean = legacyWrappedBlob(dataDir).isFile

    /** Unwrap the retired key for the one migration boot. Never regenerated. */
    fun legacyKey(dataDir: File): ByteArray {
        val blob = legacyWrappedBlob(dataDir)
        if (!blob.isFile) throw Unavailable("no legacy key blob to migrate")
        val bytes = blob.readBytes()
        if (bytes.size <= 1 + IV_BYTES) throw Unavailable("the legacy key blob is truncated")
        if (bytes[0].toInt() != VERSION) throw Unavailable("legacy key blob version ${bytes[0]} is unsupported")
        val iv = bytes.copyOfRange(1, 1 + IV_BYTES)
        val body = bytes.copyOfRange(1 + IV_BYTES, bytes.size)
        val plain = try {
            val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(javax.crypto.Cipher.DECRYPT_MODE, wrappingKey(), javax.crypto.spec.GCMParameterSpec(TAG_BITS, iv))
            cipher.doFinal(body)
        } catch (error: Exception) {
            throw Unavailable("the legacy key cannot be unwrapped on this device", error)
        }
        if (plain.size != KEY_BYTES) throw Unavailable("the legacy key is not $KEY_BYTES bytes")
        return plain
    }

    /** Delete the retired blob and wrapping key once the host has re-sealed
     * every store. Called on the migration frame and on later boots. */
    fun retireLegacyKey(dataDir: File) {
        val blob = legacyWrappedBlob(dataDir)
        if (blob.exists() && !blob.delete()) Log.w(TAG, "could not delete the retired key blob")
        runCatching {
            val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            if (store.containsAlias(WRAP_ALIAS)) store.deleteEntry(WRAP_ALIAS)
        }.onFailure { Log.w(TAG, "could not delete the retired wrapping key: ${it.javaClass.simpleName}") }
        Log.i(TAG, "retired the legacy wrapped key; the Keystore HMAC key is the only authority")
    }

    private fun wrappingKey(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getEntry(WRAP_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        throw Unavailable("the legacy key wrapping key is missing from the Keystore")
    }
}
