package com.openmausbot.companion.host

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The app's half of enrollment, pinned in a unit test.
 *
 * The receiver is a dumb pipe on purpose: it forwards whatever challenge the
 * signer sent and makes no decision of its own. That is exactly why a forged
 * intent is harmless — this process presents the value to the signer and the
 * signer, which minted the only challenge it will accept, refuses it. The test
 * cannot prove the Binder refusal here (Robolectric has no signer package), so
 * it pins the two app-side facts that are testable: a broadcast never enrolls
 * this process by itself, and the component is reachable only by a sender that
 * holds the signature permission.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SignerEnrollmentReceiverTest {

    private val context: Context get() = RuntimeEnvironment.getApplication()

    private fun deliver(intent: Intent) {
        SignerEnrollmentReceiver().onReceive(context, intent)
    }

    @Test
    fun `a broadcast with no challenge is ignored`() {
        deliver(Intent().setComponent(ComponentName(context, SignerEnrollmentReceiver::class.java)))
        assertFalse(MemorySignerClient.isEnrolled)
    }

    @Test
    fun `a forged challenge does not enroll this process`() {
        // A same-UID process can send to this exported receiver; the signature
        // permission stops other apps, not a sibling process in the same UID.
        // What it cannot do is make the signer accept a value it never minted.
        val forged = ByteArray(32) { 0x41.toByte() }.joinToString("") { "%02x".format(it) }
        deliver(
            Intent()
                .setComponent(ComponentName(context, SignerEnrollmentReceiver::class.java))
                .putExtra("com.openmausbot.companion.extra.SIGNER_CHALLENGE", forged),
        )
        assertFalse(MemorySignerClient.isEnrolled)
    }

    @Test
    fun `the receiver is exported only behind the signer signature permission`() {
        val info = context.packageManager.getReceiverInfo(
            ComponentName(context, SignerEnrollmentReceiver::class.java),
            PackageManager.GET_META_DATA,
        )
        // Exported for the signer (a different UID); the permission is what
        // limits senders to an app built from the same certificate.
        assertTrue(info.exported)
        assertEquals("com.openmausbot.companion.permission.MEMORY_SIGNER", info.permission)
    }
}
