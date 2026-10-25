package com.openmausbot.companion.host

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Receives the separate-UID signer's enrollment challenge.
 *
 * The signer sends this as an **explicit** broadcast to this component only, so
 * the value lands in this app's process and nowhere else: an explicit component
 * is not delivered to dynamically registered receivers, which is the one way a
 * competing process sharing this UID could have listened for it. The receiver's
 * signature permission keeps every other app out.
 *
 * This is the whole of the app's side of "which process may sign": the challenge
 * arrives here, [MemorySignerClient] presents it over Binder, and the signer
 * pins the kernel pid of that transaction — this process, because this is where
 * the app runs.
 */
class SignerEnrollmentReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val challenge = intent.getStringExtra(EXTRA_CHALLENGE)
        if (challenge.isNullOrEmpty()) {
            Log.w(TAG, "enrollment broadcast carried no challenge; ignoring")
            return
        }
        Log.i(TAG, "received an enrollment challenge from the separate-UID signer")
        MemorySignerClient.onChallenge(context.applicationContext, challenge)
    }

    private companion object {
        const val TAG = "MemorySigner"
        /** Must match the constant in the signer's MemorySignerService. */
        const val EXTRA_CHALLENGE = "com.openmausbot.companion.extra.SIGNER_CHALLENGE"
    }
}
