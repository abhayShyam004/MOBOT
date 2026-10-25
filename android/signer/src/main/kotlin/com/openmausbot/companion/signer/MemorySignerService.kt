package com.openmausbot.companion.signer

import android.app.Service
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Binder
import android.os.IBinder
import android.os.Process
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * The signing authority, and the caller check that goes with it.
 *
 * ## What a UID boundary can and cannot say
 *
 * A separate UID protects the *key*: Android binds Keystore keys to the UID
 * that created them, so no process of the main app — harness, Node host, or
 * the bot's own PTY shell — can use this alias, whatever code it runs.
 *
 * It says nothing about *callers*. Binder hands this service a caller uid and
 * a caller pid; both the harness and any other process in the main app share
 * that uid, so the uid proves only "somewhere in the main app", and nothing on
 * the device tells this service which pid is the trusted host. That is why the
 * authority is not handed to the first transaction any more: see
 * [SignerAuthorization] for the enrollment challenge that decides it instead.
 *
 * ## What a caller can and cannot do
 *
 *   - bind, and learn the protocol version: yes, gated by the signature
 *     permission (i.e. by the app's certificate).
 *   - ask for an enrollment challenge: yes — and it is delivered to the app's
 *     own receiver, so asking gains a competing process nothing.
 *   - enroll: only by presenting the challenge, in the transaction whose
 *     kernel pid then becomes the authorized client.
 *   - MAC: only from that pid, only for canonical record/manifest payloads,
 *     only while the challenge's owner is still alive and the pid has not been
 *     recycled.
 *
 * A signer that is not enrolled signs nothing. A signer whose client vanished
 * disarms itself and waits to be enrolled again, so an app restart recovers
 * without ever widening the set of processes that may sign.
 */
class MemorySignerService : Service() {

    private companion object {
        const val TAG = "MemorySigner"
        const val PROTOCOL = SignerAuthorization.PROTOCOL
        const val PERMISSION = "com.openmausbot.companion.permission.MEMORY_SIGNER"
        /** The receiver class every caller package that wants to sign must host. */
        const val ENROLL_RECEIVER = "com.openmausbot.companion.host.SignerEnrollmentReceiver"
        const val ENROLL_EXTRA = "com.openmausbot.companion.extra.SIGNER_CHALLENGE"
        /** The manifest versions this authority seals: v3 (per-record MACs)
         *  for stores that have not migrated yet, v4 (one authenticated Merkle
         *  root) for every new seal. A v4 payload must carry `root` and
         *  `botId`; a v3 payload must carry its record MAC map. */
        const val SIGNER_VERSION = 3
        const val MERKLE_VERSION = 4
        fun supportedManifestVersion(version: Int): Boolean =
            version == SIGNER_VERSION || version == MERKLE_VERSION
        const val MAX_PAYLOADS = 512
        const val MAX_PAYLOAD_CHARS = 64 * 1024
        const val MAX_TOTAL_CHARS = 1024 * 1024
    }

    private val authority = SignerAuthorization()

    /** The rollback anchor, in this package's own storage. */
    private val anchors by lazy { SignerAnchorStore(java.io.File(filesDir, "rollback-anchor.json")) }

    /** Highest request id seen from the enrolled caller; replay is anything ≤ this. */
    private var lastRequestId: Int = 0

    private val binder = object : IMemorySigner.Stub() {

        override fun protocolVersion(): Int = PROTOCOL

        override fun requestEnrollment(): Boolean {
            val caller = authorizeCaller()
            val challenge = authority.requestChallenge(caller.pid) ?: run {
                Log.i(TAG, "pid ${caller.pid} asked for enrollment while ${authority.describe()} — no challenge issued")
                return false
            }
            deliverChallenge(caller.pkg, challenge)
            Log.i(TAG, "issued an enrollment challenge to ${caller.pkg} for pid ${caller.pid} (${authority.describe()})")
            return true
        }

        override fun enroll(protocol: Int, nonce: String?): Boolean {
            val caller = authorizeCaller()
            return try {
                authority.enroll(protocol, nonce, caller.pid)
                // A signer that cannot sign must say so at enrollment, not fail
                // halfway through the caller's first write.
                runCatching { MemorySignerKey.key() }
                    .onSuccess {
                        lastRequestId = 0
                        Log.i(
                            TAG,
                            "enrolled pid ${caller.pid} (${caller.pkg}) as the signing authority; " +
                                "key ${MemorySignerKey.describe()}; ${authority.describe()}",
                        )
                    }
                    .onFailure { error ->
                        authority.disarm()
                        Log.e(TAG, "signing authority unavailable: ${error.javaClass.simpleName}: ${error.message}")
                        throw SignerAuthorization.Refused("the Keystore key is unavailable: ${error.message}")
                    }
                true
            } catch (error: SignerAuthorization.Refused) {
                Log.w(TAG, "refused enrollment from uid ${caller.uid} pid ${caller.pid}: ${error.message}")
                throw error
            }
        }

        override fun describe(): String {
            val caller = authorizeCaller()
            val state = authority.describe()
            Log.d(TAG, "describe requested by ${caller.pkg}/${caller.pid}: $state")
            return "$state ${MemorySignerKey.describe()}"
        }

        override fun mac(protocol: Int, id: Int, purpose: String, payloads: Array<out String>?): String {
            val caller = authorizeCaller()
            authority.authorize(caller.pid)
            if (protocol != PROTOCOL) throw SecurityException("unsupported signer protocol $protocol")
            if (id <= lastRequestId) throw SecurityException("stale signing request $id")
            if (purpose != "record" && purpose != "manifest") {
                throw SecurityException("refusing an unknown MAC purpose")
            }
            val batch = payloads ?: throw IllegalArgumentException("no payloads")
            if (batch.isEmpty() || batch.size > MAX_PAYLOADS) {
                throw IllegalArgumentException("payload batch size ${batch.size} is outside 1..$MAX_PAYLOADS")
            }
            var total = 0
            for (payload in batch) {
                if (payload.length > MAX_PAYLOAD_CHARS) throw IllegalArgumentException("payload is too large")
                total += payload.length
                if (total > MAX_TOTAL_CHARS) throw IllegalArgumentException("batch is too large")
                if (!validPayload(purpose, payload)) {
                    throw IllegalArgumentException("payload is not a canonical $purpose")
                }
            }
            val macs = JSONArray()
            for (payload in batch) macs.put(MemorySignerKey.mac(purpose, payload))
            lastRequestId = id
            return macs.toString()
        }

        override fun anchorHead(protocol: Int, storeKey: String?): String {
            val call = authorizedForAnchor(protocol, storeKey)
            val entry = anchors.head(call.store)
                ?: return "none"
            val json = JSONObject()
                .put("generation", entry.generation)
                .put("digest", entry.digest)
            entry.pending?.let {
                json.put("pending", JSONObject().put("generation", it.generation).put("digest", it.digest))
            }
            return json.toString()
        }

        /**
         * The only way to obtain a manifest MAC under this authority.
         *
         * MAC and preparation are one operation on purpose: the digest the
         * anchor records is exactly the digest the returned MAC covers, so a
         * caller cannot prepare one candidate and then write a different one.
         */
        override fun prepareManifest(protocol: Int, id: Int, storeKey: String?, payload: String?): String {
            val call = authorizedForAnchor(protocol, storeKey)
            if (payload == null) throw IllegalArgumentException("no manifest payload")
            if (!validPayload("manifest", payload)) throw IllegalArgumentException("payload is not a canonical manifest")
            val parsed = runCatching { JSONObject(payload) }.getOrNull()
                ?: throw IllegalArgumentException("payload is not a canonical manifest")
            if (!supportedManifestVersion(parsed.optInt("version", -1))) {
                throw SecurityException("manifest version ${parsed.optInt("version", -1)} is not supported")
            }
            val generation = parsed.optLong("seq", 0)
            val digest = parsed.optString("digest", "")
            val mac = MemorySignerKey.mac("manifest", payload)
            anchors.prepare(call.store, generation, digest)
            Log.i(TAG, "prepared generation $generation (${anchors.describe()}) from pid ${call.caller.pid}")
            return mac
        }

        override fun commitManifest(protocol: Int, storeKey: String?, generation: Long, digest: String?): Boolean {
            val call = authorizedForAnchor(protocol, storeKey)
            if (digest == null) throw IllegalArgumentException("no digest")
            anchors.commit(call.store, generation, digest)
            Log.i(TAG, "committed generation $generation (${anchors.describe()}) from pid ${call.caller.pid}")
            return true
        }

        override fun baselineManifest(protocol: Int, storeKey: String?, payload: String?, mac: String?): Boolean {
            val call = authorizedForAnchor(protocol, storeKey)
            if (payload == null || mac == null) throw IllegalArgumentException("no manifest to baseline")
            if (!validPayload("manifest", payload)) throw IllegalArgumentException("payload is not a canonical manifest")
            val parsed = runCatching { JSONObject(payload) }.getOrNull()
                ?: throw IllegalArgumentException("payload is not a canonical manifest")
            if (!supportedManifestVersion(parsed.optInt("version", -1))) {
                throw SecurityException("manifest version ${parsed.optInt("version", -1)} is not supported")
            }
            // A baseline must start from a manifest this key actually produced:
            // recompute its MAC rather than trusting the caller's claim.
            if (MemorySignerKey.mac("manifest", payload) != mac) {
                throw SecurityException("the manifest MAC does not verify; refusing to baseline it")
            }
            anchors.baseline(call.store, parsed.optLong("seq", 0), parsed.optString("digest", ""))
            Log.i(TAG, "baselined generation ${parsed.optLong("seq", 0)} (${anchors.describe()}) from pid ${call.caller.pid}")
            return true
        }

        /** An anchor call: the enrolled caller plus the store it is about. */
        private fun authorizedForAnchor(protocol: Int, storeKey: String?): AnchorCall {
            val caller = authorizeCaller()
            authority.authorize(caller.pid)
            if (protocol != PROTOCOL) throw SecurityException("unsupported signer protocol $protocol")
            if (storeKey == null || storeKey.isEmpty() || storeKey.length > 128) {
                throw IllegalArgumentException("invalid store key")
            }
            return AnchorCall(caller, storeKey)
        }
    }

    /**
     * Binding is gated by the manifest permission, not here: `onBind` runs as
     * this process, so `Binder.getCallingUid()` inside it reports the signer's
     * own uid, not the binder's (measured: it answered 10280). The real caller
     * identity exists only inside a transaction, which is where every check
     * below runs.
     */
    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        authority.disarm()
        Log.i(TAG, "signing authority disarmed with the service")
        super.onDestroy()
    }

    private class Caller(val uid: Int, val pid: Int, val pkg: String)

    private class AnchorCall(val caller: Caller, val store: String)

    /**
     * The checks that apply to every transaction regardless of enrollment:
     * the caller is an application, it holds the signature permission, and its
     * uid maps to a package. Deliberately says nothing about *which* process it
     * is — that is the authority's job.
     */
    private fun authorizeCaller(): Caller {
        val callerUid = Binder.getCallingUid()
        val callerPid = Binder.getCallingPid()
        if (callerUid == Process.myUid() || callerUid < Process.FIRST_APPLICATION_UID) {
            throw SecurityException("uid $callerUid is not an application")
        }
        if (checkCallingPermission(PERMISSION) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("the signature permission is not held")
        }
        val pkg = packageManager.getNameForUid(callerUid)
            ?: throw SecurityException("uid $callerUid does not name a package")
        return Caller(callerUid, callerPid, pkg)
    }

    /**
     * Hand the challenge to the manifest receiver in the caller's package.
     *
     * Explicit component: Android delivers it only to that declared receiver, so
     * a dynamically registered listener in the same package — the one way a
     * competing same-UID process could have overheard it — receives nothing.
     * The receiver requires this same signature permission of its *senders*,
     * and this package is the one that declares it — so the channel is open in
     * exactly the two directions it needs to be, and closed to every app that
     * is not built from the same certificate.
     */
    private fun deliverChallenge(pkg: String, challenge: String) {
        val intent = Intent().apply {
            component = ComponentName(pkg, ENROLL_RECEIVER)
            putExtra(ENROLL_EXTRA, challenge)
            // 0x01000000 = FLAG_RECEIVER_INCLUDE_BACKGROUND (hidden platform
            // flag): a caller whose process is not in a foreground state still
            // gets the challenge. Neither flag makes the intent less targeted —
            // the explicit component still decides who receives it.
            addFlags(0x01000000)
            addFlags(0x00200000) // FLAG_INCLUDE_STOPPED_PACKAGES
        }
        sendBroadcast(intent)
    }

    /** The same shape check the harness applies, repeated here because this is
     *  the component that holds the key and it must not rely on its caller. */
    private fun validPayload(purpose: String, payload: String): Boolean {
        val parsed = runCatching { JSONObject(payload) }.getOrNull() ?: return false
        if (purpose == "record") {
            return listOf(
                "id", "botId", "category", "headline", "detail", "confidence", "sourceTurnId",
                "createdAt", "lastReinforcedAt", "accessCount", "sha256Hash", "redacted",
            ).all { parsed.has(it) }
        }
        // v3 authenticates every record MAC; v4 authenticates one Merkle root
        // over the canonical records and names the bot/namespace it covers, so
        // identical content cannot be moved to another store.
        val version = parsed.optInt("version", -1)
        val required = if (version >= MERKLE_VERSION) {
            listOf("count", "digest", "seq", "version", "root", "botId")
        } else {
            listOf("count", "digest", "macs", "seq", "version")
        }
        return required.all { parsed.has(it) }
    }
}
