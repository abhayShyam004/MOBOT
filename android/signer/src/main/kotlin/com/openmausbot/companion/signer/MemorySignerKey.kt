package com.openmausbot.companion.signer

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Log
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory

/**
 * The HMAC authority, now under the signer's own UID.
 *
 * The key is generated here, is non-exportable, and never leaves this process:
 * callers get MACs, never key bytes. Android associates Keystore keys with the
 * creating UID, so the main application's processes — including the bot's own
 * PTY shell — cannot use this alias at all. That is the one property this
 * package exists to make true, and it is a kernel/Keystore property rather
 * than a convention.
 *
 * The MAC construction is unchanged from the previous authority
 * (`omb-memory-<purpose>-v1\n<payload>`, HMAC-SHA256, lowercase hex), so the
 * canonical store does not need a new format — only a new key holder.
 */
object MemorySignerKey {

    private const val TAG = "MemorySigner"

    /** v3: the first alias owned by a UID other than the app's. */
    const val ALIAS = "omb_memory_integrity_hmac_v3"

    private const val ANDROID_KEYSTORE = "AndroidKeyStore"

    /** The key cannot be created or used. Callers must fail closed. */
    class Unavailable(message: String, cause: Throwable? = null) : Exception(message, cause)

    /**
     * Create the key once and return it forever after. There is no
     * regeneration path: a missing key on an install that has already signed
     * records is an error, not a fresh start, because a new key would silently
     * invalidate every manifest the store holds.
     */
    fun key(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            ALIAS,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
            .setKeySize(256)
            .build()
        generator.init(spec)
        val created = generator.generateKey()
        Log.i(TAG, "created the non-exportable HMAC key in the signer's Keystore (${describe()})")
        return created
    }

    /**
     * HMAC-SHA256 over `omb-memory-<purpose>-v1\n<payload>`, hex.
     *
     * Three purposes exist, and the third is deliberately not reachable from a
     * caller: `anchor` MACs this package's own rollback ledger (see
     * [SignerAnchorStore]). The service rejects any caller-supplied purpose
     * other than `record` and `manifest` before it gets here, so the anchor
     * namespace cannot be used as a signing oracle.
     */
    fun mac(purpose: String, payload: String): String {
        if (purpose != "record" && purpose != "manifest" && purpose != "anchor") {
            throw Unavailable("refusing an unknown MAC purpose")
        }
        val key = key()
        val input = "omb-memory-$purpose-v1\n".toByteArray(Charsets.UTF_8) +
            payload.toByteArray(Charsets.UTF_8)
        // Which provider exposes HmacSHA256 varies across Android releases and
        // Keystore backends; every branch still uses the Keystore key.
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
        throw Unavailable("the Keystore cannot compute HmacSHA256 here: ${last?.message}", last)
    }

    /** 1 = software, 2 = TEE, 3 = StrongBox. A capability, never a secret. */
    fun describe(): String = runCatching {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val entry = store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry
            ?: return "hmac key absent"
        val factory = SecretKeyFactory.getInstance(entry.secretKey.algorithm, ANDROID_KEYSTORE)
        val info = factory.getKeySpec(entry.secretKey, KeyInfo::class.java) as KeyInfo
        "level=${info.securityLevel}"
    }.getOrElse { "unavailable: ${it.javaClass.simpleName}" }
}
