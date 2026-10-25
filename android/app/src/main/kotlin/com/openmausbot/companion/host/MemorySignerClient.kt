package com.openmausbot.companion.host

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.util.Log
import com.openmausbot.companion.signer.IMemorySigner
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The app's client for the separate-UID signing authority.
 *
 * The signer is a second application package with its own UID that owns a
 * non-exportable Keystore HMAC key. This process and everything it spawns —
 * the Node host, and through it the bot's own shell — run under the app's UID
 * and therefore cannot touch that key.
 *
 * Being in the app is not enough to sign. The signer mints a single-use
 * challenge, delivers it to [SignerEnrollmentReceiver] (an explicit broadcast
 * to this app's own component), and only the process that presents it over
 * Binder becomes the authorized client. This class is that client: it binds,
 * asks for a challenge, presents the one that arrives, and reports
 * [isEnrolled] so the harness never starts a host that would seal memory with
 * an authority it does not actually hold.
 *
 * Re-enrollment is driven by the signer as well: when this process dies the
 * signer notices its client is gone and will issue a fresh challenge to the
 * next caller's package, which is how an app restart gets its authority back
 * without any process being able to inherit the old one.
 */
internal object MemorySignerClient {

    private const val TAG = "MemorySigner"
    private const val SIGNER_PACKAGE = "com.openmausbot.companion.signer"
    private const val SIGNER_SERVICE = "$SIGNER_PACKAGE.MemorySignerService"
    private const val PROTOCOL = 2
    private const val RETRY_MS = 500L

    /** The AIDL surface, once bound. */
    @Volatile private var signer: IMemorySigner? = null
    @Volatile private var connected = false
    /** True only after the signer accepted our enrollment challenge. */
    @Volatile private var enrolled = false
    /** The challenge waiting to be presented, if one arrived before the bind. */
    @Volatile private var challenge: String? = null
    @Volatile private var appContext: Context? = null
    private val connectLatch = CountDownLatch(1)
    private val enrollLatch = CountDownLatch(1)
    private val requestSeq = AtomicInteger(0)
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "memory-signer-enroll").apply { isDaemon = true }
    }

    class Unavailable(message: String, cause: Throwable? = null) : Exception(message, cause)

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            // A null binder is not a signer: treat it exactly like an absent
            // package so nothing downstream has to reason about a half-bound
            // authority (and so a Robolectric unit run, which answers binds
            // with a null binder, behaves like a device with no signer).
            val remote = IMemorySigner.Stub.asInterface(service)
            if (remote == null) {
                reset("the signer returned no binder")
                return
            }
            signer = remote
            connected = true
            connectLatch.countDown()
            Log.i(TAG, "attached to the separate-UID signer (protocol ${runCatching { remote?.protocolVersion() }.getOrNull()})")
            val pending = challenge
            if (pending != null) {
                enroll(remote, pending)
            } else {
                requestChallenge(remote)
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            reset("the separate-UID signer disconnected")
        }

        override fun onBindingDied(name: ComponentName?) {
            reset("the separate-UID signer's binding died")
            rebind()
        }
    }

    private fun reset(reason: String) {
        signer = null
        connected = false
        enrolled = false
        Log.w(TAG, "$reason; MACs fail closed until it returns")
    }

    /**
     * Bind at app start. The signer decides the authority by enrollment, so the
     * order in which processes appear no longer matters — but binding early
     * still gets the challenge round trip out of the way before the host needs
     * its first MAC.
     */
    fun install(context: Context) {
        appContext = context.applicationContext
        if (connected || signer != null) return
        val intent = Intent().setComponent(ComponentName(SIGNER_PACKAGE, SIGNER_SERVICE))
        val started = runCatching {
            appContext?.bindService(intent, connection, Context.BIND_AUTO_CREATE)
        }.getOrElse { error ->
            Log.i(TAG, "no separate-UID signer installed (${error.javaClass.simpleName}); using the in-app Keystore authority")
            null
        }
        if (started == false) {
            Log.i(TAG, "no separate-UID signer installed; using the in-app Keystore authority")
        }
        connectLatch.countDown()
    }

    private fun rebind() {
        val context = appContext ?: return
        if (connected) return
        worker.execute {
            runCatching { context.bindService(
                Intent().setComponent(ComponentName(SIGNER_PACKAGE, SIGNER_SERVICE)),
                connection,
                Context.BIND_AUTO_CREATE,
            ) }
        }
    }

    /** Called from [SignerEnrollmentReceiver] with the signer's challenge. */
    fun onChallenge(context: Context, nonce: String) {
        appContext = context.applicationContext
        challenge = nonce
        val remote = signer
        if (remote == null) {
            // The bind is still in flight (or died); it presents the challenge
            // as soon as it is connected.
            install(context)
            return
        }
        enroll(remote, nonce)
    }

    private fun requestChallenge(remote: IMemorySigner) {
        worker.execute {
            runCatching { remote.requestEnrollment() }
                .onFailure { error ->
                    Log.w(TAG, "could not request an enrollment challenge: ${error.javaClass.simpleName}: ${error.message}")
                    reset("the enrollment request failed")
                }
        }
    }

    private fun enroll(remote: IMemorySigner, nonce: String) {
        worker.execute {
            val accepted = runCatching { remote.enroll(PROTOCOL, nonce) }
                .onFailure { error ->
                    Log.w(TAG, "enrollment refused: ${error.javaClass.simpleName}: ${error.message}")
                }
                .getOrDefault(false)
            if (accepted) {
                enrolled = true
                enrollLatch.countDown()
                Log.i(TAG, "enrolled with the separate-UID signer: ${runCatching { remote.describe() }.getOrNull()}")
            } else {
                // A stale challenge (signer restarted) or a lost race: ask for a
                // fresh one. The signer delivers it to this component again.
                challenge = null
                requestChallenge(remote)
            }
        }
    }

    /**
     * True when a signer package is installed on this device, whether or not
     * this process is enrolled yet. Distinguishes "no authority here" from
     * "the authority exists and is still starting": measured on the Galaxy
     * A07, the first boot after a reinstall brought the signer service up about
     * 5.4 s after the app, and a fixed 5 s wait gave up ~40 ms before
     * enrollment completed.
     */
    fun installed(context: Context? = appContext): Boolean {
        val ctx = context ?: return false
        return runCatching {
            ctx.packageManager.resolveService(
                Intent().setComponent(ComponentName(SIGNER_PACKAGE, SIGNER_SERVICE)),
                0,
            ) != null
        }.getOrDefault(false)
    }

    /** How long an installed signer gets to finish enrollment on a cold start. */
    private const val INSTALLED_WAIT_MS = 20_000L

    /**
     * True only when a signer is installed *and* it accepted this process's
     * enrollment. A bound-but-unenrolled signer is not an authority.
     *
     * An installed signer gets [INSTALLED_WAIT_MS] to finish enrolling; giving
     * up while it is still starting would make this host seal with the weaker
     * in-app authority, which a store the signer already sealed must refuse.
     * Absent signer → the historical in-app authority, as before.
     */
    fun ready(timeoutMs: Long = 5_000): Boolean {
        if (enrolled) return true
        val installed = installed()
        val wait = if (installed) maxOf(timeoutMs, INSTALLED_WAIT_MS) else timeoutMs
        val deadline = System.currentTimeMillis() + wait
        while (System.currentTimeMillis() < deadline) {
            if (enrolled) return true
            if (challenge != null && signer == null) {
                // Nothing connected yet; the connection presents it on arrival.
                connectLatch.await(RETRY_MS, TimeUnit.MILLISECONDS)
            } else {
                enrollLatch.await(RETRY_MS, TimeUnit.MILLISECONDS)
            }
        }
        if (!enrolled && installed) {
            Log.e(
                TAG,
                "the separate-UID signer is installed but enrollment did not complete in ${wait} ms; " +
                    "this boot will not hold the signing authority and signer-sealed stores fail closed",
            )
        }
        return enrolled
    }

    /** True when this process currently holds the signing authority. */
    val isEnrolled: Boolean get() = enrolled

    /**
     * The signer's rollback anchor for one store: `"none"` or
     * `{"generation":N,"digest":"…","pending":{…}}`.
     */
    fun anchorHead(storeKey: String): String {
        val remote = requireRemote()
        return try {
            remote.anchorHead(PROTOCOL, storeKey)
        } catch (error: Throwable) {
            throw Unavailable("the signer refused an anchor read: ${error.message}", error)
        }
    }

    /**
     * Prepare the next generation and get the manifest MAC in the same call.
     * The signer records the digest as pending, so the MAC it returns is bound
     * to exactly the generation the anchor will accept.
     */
    fun prepareManifest(storeKey: String, payload: String): String {
        val remote = requireRemote()
        val id = requestSeq.incrementAndGet()
        return try {
            remote.prepareManifest(PROTOCOL, id, storeKey, payload)
        } catch (error: Throwable) {
            throw Unavailable("the signer refused to prepare a manifest: ${error.message}", error)
        }
    }

    /** Promote the prepared generation. Idempotent on the signer side. */
    fun commitManifest(storeKey: String, generation: Long, digest: String): Boolean {
        val remote = requireRemote()
        return try {
            remote.commitManifest(PROTOCOL, storeKey, generation, digest)
        } catch (error: Throwable) {
            throw Unavailable("the signer refused to commit generation $generation: ${error.message}", error)
        }
    }

    /** Establish the first anchor for a store that predates anchoring. */
    fun baselineManifest(storeKey: String, payload: String, mac: String): Boolean {
        val remote = requireRemote()
        return try {
            remote.baselineManifest(PROTOCOL, storeKey, payload, mac)
        } catch (error: Throwable) {
            throw Unavailable("the signer refused to baseline this store: ${error.message}", error)
        }
    }

    private fun requireRemote(): IMemorySigner {
        val remote = signer ?: throw Unavailable("the separate-UID signer is not attached")
        if (!enrolled) throw Unavailable("this process is not enrolled with the separate-UID signer")
        return remote
    }

    /**
     * MAC one batch of canonical payloads. Throws [Unavailable] when the
     * signer is absent or refuses: the caller must fail closed, never fall
     * back to a weaker authority mid-flight.
     */
    fun mac(purpose: String, payloads: List<String>): List<String> {
        val remote = signer ?: throw Unavailable("the separate-UID signer is not attached")
        if (!enrolled) throw Unavailable("this process is not enrolled with the separate-UID signer")
        val id = requestSeq.incrementAndGet()
        val encoded = try {
            remote.mac(PROTOCOL, id, purpose, payloads.toTypedArray())
        } catch (error: Throwable) {
            throw Unavailable("the signer refused a MAC request: ${error.message}", error)
        }
        val parsed = org.json.JSONArray(encoded)
        return (0 until parsed.length()).map { parsed.getString(it) }
    }
}
