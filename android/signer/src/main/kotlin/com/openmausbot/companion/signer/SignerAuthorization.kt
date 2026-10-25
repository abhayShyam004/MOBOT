package com.openmausbot.companion.signer

import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants

import java.security.SecureRandom

/**
 * Who may sign, decided without trusting whichever process happens to call
 * first.
 *
 * ## Why pinning the first caller was not enough
 *
 * Binder hands this service exactly two facts about a transaction: a uid and a
 * pid. The uid is the app's, and it is shared by the harness, the Node host,
 * and every agent shell — so it says "somewhere in the main app" and nothing
 * more. The pid is kernel-true *for the transaction*, but nothing on the device
 * tells the signer which pid is the trusted host: `/proc` is mounted
 * `hidepid=invisible`, this package is a different UID, and a pid arriving in a
 * request is a claim, not evidence.
 *
 * Pinning the first binder therefore made startup order the authority. A
 * same-UID process that outlived the harness — or simply got there first after
 * a signer restart — could take the pin and mint MACs for forged records.
 *
 * ## The enrollment nonce
 *
 * This class closes that gap with a value the attacker cannot obtain: a random
 * per-boot nonce that the signer **mints and delivers itself**, as an explicit
 * broadcast to one manifest receiver in the calling app's package. Only the
 * app's own component receives it (an explicit component is not delivered to
 * dynamically registered receivers, which is the one way a same-UID process
 * could have listened), the value is never written to disk, never returned by
 * any Binder call, and single-use.
 *
 * Enrollment is what arms the authority, and the pid that presents the nonce is
 * pinned at that moment. A same-UID process can bind, call, and even trigger a
 * fresh nonce — it will still be the *app's* receiver that receives it, so the
 * pin lands on the app's main process and every other pid is refused. The race
 * stops mattering because arriving first no longer confers anything.
 *
 * The residual is stated instead of hidden: code executing *inside* the app's
 * main process is not distinguishable from the harness, but such code already
 * owns the canonical store itself.
 */
internal class SignerAuthorization(
    private val clock: () -> Long = System::currentTimeMillis,
    private val identity: PeerIdentity = ProcPeerIdentity,
    private val nonceTtlMs: Long = 120_000L,
    private val nonceBytes: Int = 32,
    private val random: SecureRandom = SecureRandom(),
) {

    /** Why an operation was refused. Never carries the nonce itself. */
    class Refused(message: String) : SecurityException(message)

    /** Which peer is authorized, as far as this process can tell. */
    private var armedPid: Int = 0
    private var armedStart: Long? = null

    /** The outstanding enrollment challenge, if any. */
    private var nonce: String? = null
    private var nonceIssuedAt: Long = 0

    /** Challenges issued since this process started; a bound on churn. */
    private var issued: Int = 0
    private val issueLimit = 512

    val armed: Boolean get() = armedPid != 0

    /** True when the authorized peer still exists. */
    private fun peerAlive(): Boolean = armedPid != 0 && identity.alive(armedPid)

    /**
     * Issue a challenge for [callerPid] to have delivered to its own package.
     *
     * Returns null when the authority is already held by a live peer: a second
     * process asking for enrollment must not be handed a challenge that would
     * let it take over a running one. A dead pin (the app was restarted) or an
     * unarmed signer always gets a fresh challenge, which is what keeps the
     * authority working across restarts without letting a stale process keep it.
     */
    fun requestChallenge(callerPid: Int): String? {
        if (armed && peerAlive()) return null
        if (issued >= issueLimit) throw Refused("too many enrollment challenges issued")
        issued += 1
        // A new challenge supersedes any previous one: only the most recent is
        // honored, so a leaked-and-stale nonce buys nothing.
        val fresh = ByteArray(nonceBytes).also { random.nextBytes(it) }.toHex()
        nonce = fresh
        nonceIssuedAt = clock()
        return fresh
    }

    /**
     * Arm the authority for the process that presents the current challenge.
     *
     * The caller pid is the kernel's, taken from the transaction that carried
     * the nonce — never from an argument.
     */
    fun enroll(protocol: Int, presented: String?, callerPid: Int) {
        if (protocol != PROTOCOL) throw Refused("unsupported signer protocol $protocol")
        if (armed && peerAlive()) {
            throw Refused("the signing authority is already held by pid $armedPid")
        }
        val expected = nonce ?: throw Refused("no enrollment challenge is outstanding")
        if (clock() - nonceIssuedAt > nonceTtlMs) {
            nonce = null
            throw Refused("the enrollment challenge expired")
        }
        if (presented == null || !constantTimeEquals(expected, presented)) {
            throw Refused("the enrollment challenge does not match")
        }
        // Single use: the challenge dies with the enrollment that consumed it.
        nonce = null
        nonceIssuedAt = 0
        armedPid = callerPid
        armedStart = identity.startTime(callerPid)
    }

    /**
     * Check a MAC request against the enrolled peer.
     *
     * Three independent facts must hold: the authority is armed, the caller pid
     * is the enrolled one, and — where `/proc` is readable — the pid still
     * names the same process (start time), so a recycled pid cannot inherit the
     * authority. A pid that has been recycled disarms the authority rather than
     * silently continuing with the old grant.
     */
    fun authorize(callerPid: Int) {
        if (!armed) throw Refused("the signing authority is not enrolled")
        if (callerPid != armedPid) throw Refused("pid $callerPid is not the enrolled signer client")
        if (!identity.alive(callerPid)) {
            disarm()
            throw Refused("the enrolled client pid $callerPid is gone")
        }
        val start = identity.startTime(callerPid)
        val pinned = armedStart
        if (start != null && pinned != null && start != pinned) {
            disarm()
            throw Refused("pid $callerPid was reused by another process")
        }
    }

    /** For tests and for a signer that must stop signing immediately. */
    fun disarm() {
        armedPid = 0
        armedStart = null
    }

    /** A capability statement for the trust log: never a secret. */
    fun describe(): String {
        val state = when {
            !armed -> "unarmed"
            peerAlive() -> "armed"
            else -> "armed-stale"
        }
        // Whether pid recycling is detectable here is a property of the device,
        // not of who is enrolled.
        val peer = if (armedPid == 0) "none" else armedPid.toString()
        return "state=$state peer=$peer identity=${identity.mode}"
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (index in a.indices) diff = diff or (a[index].code xor b[index].code)
        return diff == 0
    }

    companion object {
        const val PROTOCOL = 2
    }
}

/** What this process can learn about another pid. */
internal interface PeerIdentity {
    fun alive(pid: Int): Boolean

    /** Kernel start time of [pid], or null when it cannot be read. */
    fun startTime(pid: Int): Long?

    /** `starttime` when pid recycling is detectable here, else `liveness-only`. */
    val mode: String
}

/**
 * The device's answer.
 *
 * `/proc/<pid>/stat` carries field 22 (start time in clock ticks), which is the
 * only cheap way to tell a live process from a recycled pid. Reading it needs
 * neither `hidepid` visibility nor `readproc`: the file itself is world
 * readable, and this device answers it for a pid in another application UID
 * (measured on the SM-A075F — see the Phase 12 report). When it does not
 * answer, [alive] still works across UIDs through `kill(pid, 0)`: a dead pid is
 * `ESRCH`, a live one this UID may not signal is `EPERM`.
 */
internal object ProcPeerIdentity : PeerIdentity {

    /** Probed once on our own pid: it is a property of the device's `/proc`. */
    override val mode: String by lazy {
        if (startTime(android.os.Process.myPid()) != null) "starttime" else "liveness-only"
    }

    override fun alive(pid: Int): Boolean {
        if (pid <= 0) return false
        if (startTime(pid) != null) return true
        return try {
            // Signal 0 only checks permission and existence.
            Os.kill(pid, 0)
            true
        } catch (error: ErrnoException) {
            error.errno != OsConstants.ESRCH
        }
    }

    override fun startTime(pid: Int): Long? {
        if (pid <= 0) return null
        val stat = runCatching { java.io.File("/proc/$pid/stat").readText() }.getOrNull() ?: return null
        // comm may contain spaces and parentheses; fields resume after the last
        // ')'. Field 3 (state) is then the first token, so start time (field 22)
        // is at index 19 of the remainder.
        val close = stat.lastIndexOf(')')
        if (close < 0 || close + 2 >= stat.length) return null
        val fields = stat.substring(close + 2).trim().split(' ')
        return fields.getOrNull(19)?.toLongOrNull()
    }
}
