package com.openmausbot.companion.signer

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The caller-race matrix, run against the real state machine.
 *
 * Every case below is a way a same-UID process could try to become the signer's
 * client. The pid/uid facts a real Binder transaction carries are the arguments
 * here; what changes is which process is alive, which one receives the
 * challenge, and what happens across restarts.
 */
class SignerAuthorizationTest {

    /** A device stand-in: pid → (alive?, start time). */
    private class FakeIdentity : PeerIdentity {
        val processes = mutableMapOf<Int, Long>()

        fun spawn(pid: Int, start: Long) {
            processes[pid] = start
        }

        fun kill(pid: Int) {
            processes.remove(pid)
        }

        /** Same pid, new process — exactly what the kernel does after recycling. */
        fun recycle(pid: Int, start: Long) {
            processes[pid] = start
        }

        override fun alive(pid: Int): Boolean = processes.containsKey(pid)

        override fun startTime(pid: Int): Long? = processes[pid]

        override val mode: String = "starttime"
    }

    private var now = 1_000_000L
    private val identity = FakeIdentity()
    private val auth = SignerAuthorization(clock = { now }, identity = identity)

    private fun challengeFor(pid: Int): String {
        identity.spawn(pid, pid.toLong() * 10)
        return assertNotNull(auth.requestChallenge(pid), "a fresh signer must issue a challenge")
    }

    @Test
    fun `an unenrolled signer signs nothing`() {
        identity.spawn(42, 420)
        val refused = assertFailsWith<SignerAuthorization.Refused> { auth.authorize(42) }
        assertTrue(refused.message!!.contains("not enrolled"))
        assertFalse(auth.armed)
    }

    @Test
    fun `binding first confers nothing without the challenge`() {
        // The old attack: a same-UID process is the first binder. It can call
        // whatever it likes; without the challenge it never becomes the client.
        identity.spawn(700, 7000)
        assertFailsWith<SignerAuthorization.Refused> { auth.enroll(SignerAuthorization.PROTOCOL, null, 700) }
        assertFailsWith<SignerAuthorization.Refused> { auth.enroll(SignerAuthorization.PROTOCOL, "00", 700) }
        assertFailsWith<SignerAuthorization.Refused> { auth.authorize(700) }
        assertFalse(auth.armed)
    }

    @Test
    fun `the process that presents the challenge is the one that signs`() {
        val nonce = challengeFor(100)
        auth.enroll(SignerAuthorization.PROTOCOL, nonce, 100)
        assertTrue(auth.armed)
        auth.authorize(100)
        // Any other pid in the same UID is refused, even though it is alive and
        // holds the signature permission.
        identity.spawn(101, 1010)
        assertFailsWith<SignerAuthorization.Refused> { auth.authorize(101) }
    }

    @Test
    fun `a competing process cannot take over a live enrollment`() {
        val nonce = challengeFor(100)
        auth.enroll(SignerAuthorization.PROTOCOL, nonce, 100)
        identity.spawn(200, 2000)

        // A second process asks for its own challenge while the authority is
        // held by a live peer: none is issued, so there is nothing to present.
        assertNull(auth.requestChallenge(200))
        // And even the (now consumed) first challenge cannot be replayed.
        assertFailsWith<SignerAuthorization.Refused> { auth.enroll(SignerAuthorization.PROTOCOL, nonce, 200) }
        auth.authorize(100)
    }

    @Test
    fun `the challenge is single use`() {
        val nonce = challengeFor(100)
        auth.enroll(SignerAuthorization.PROTOCOL, nonce, 100)
        auth.disarm()
        // Replaying the same value after a disarm does not re-arm: it was burned.
        assertFailsWith<SignerAuthorization.Refused> { auth.enroll(SignerAuthorization.PROTOCOL, nonce, 100) }
    }

    @Test
    fun `an expired challenge is refused`() {
        val nonce = challengeFor(100)
        now += 120_001
        assertFailsWith<SignerAuthorization.Refused> { auth.enroll(SignerAuthorization.PROTOCOL, nonce, 100) }
        assertFalse(auth.armed)
    }

    @Test
    fun `an app restart re-enrolls and the old pid loses the authority`() {
        val first = challengeFor(100)
        auth.enroll(SignerAuthorization.PROTOCOL, first, 100)

        // The app process dies; the signer is told nothing, it just notices.
        identity.kill(100)
        assertFailsWith<SignerAuthorization.Refused> { auth.authorize(100) }
        assertFalse(auth.armed, "a vanished client must disarm the authority")

        // The restarted app asks again and gets a fresh challenge.
        identity.spawn(300, 3000)
        val second = assertNotNull(auth.requestChallenge(300))
        auth.enroll(SignerAuthorization.PROTOCOL, second, 300)
        auth.authorize(300)
        identity.spawn(100, 1000) // a recycled pid must not resurrect the old grant
        assertFailsWith<SignerAuthorization.Refused> { auth.authorize(100) }
    }

    @Test
    fun `a recycled pid cannot inherit the authority`() {
        val nonce = challengeFor(100)
        auth.enroll(SignerAuthorization.PROTOCOL, nonce, 100)
        // Same pid number, different process (different kernel start time).
        identity.recycle(100, 999_999L)
        val refused = assertFailsWith<SignerAuthorization.Refused> { auth.authorize(100) }
        assertTrue(refused.message!!.contains("reused"))
        assertFalse(auth.armed)
    }

    @Test
    fun `a disarmed signer refuses until it is enrolled again`() {
        val nonce = challengeFor(100)
        auth.enroll(SignerAuthorization.PROTOCOL, nonce, 100)
        auth.disarm()
        assertFailsWith<SignerAuthorization.Refused> { auth.authorize(100) }
        val again = challengeFor(100)
        auth.enroll(SignerAuthorization.PROTOCOL, again, 100)
        auth.authorize(100)
    }

    @Test
    fun `a protocol mismatch is refused before any pinning`() {
        val nonce = challengeFor(100)
        assertFailsWith<SignerAuthorization.Refused> { auth.enroll(1, nonce, 100) }
        assertFalse(auth.armed)
    }

    @Test
    fun `challenges are unpredictable and distinct`() {
        val seen = mutableSetOf<String>()
        repeat(32) {
            val value = assertNotNull(auth.requestChallenge(500 + it))
            assertEquals(64, value.length, "a challenge is 32 hex-encoded bytes")
            assertTrue(seen.add(value), "each challenge must be fresh")
        }
    }

    @Test
    fun `describe never carries the challenge`() {
        identity.spawn(100, 1000)
        val nonce = assertNotNull(auth.requestChallenge(100))
        val state = auth.describe()
        assertFalse(state.contains(nonce))
        assertTrue(state.contains("unarmed"))
        auth.enroll(SignerAuthorization.PROTOCOL, nonce, 100)
        assertTrue(auth.describe().contains("armed"))
        assertFalse(auth.describe().contains(nonce))
    }
}
