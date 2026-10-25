package com.openmausbot.companion.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.Process
import android.util.Log
import com.openmausbot.companion.signer.IMemorySigner
import org.json.JSONObject
import java.security.KeyStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.crypto.KeyGenerator
import javax.crypto.Mac

/**
 * Preview-only adversary: the same UID, a *different* process, and no
 * enrollment challenge.
 *
 * This exists to run the caller race on a real device instead of arguing about
 * it. It runs in `android:process=":race"`, so it shares the app's UID 10279 and
 * the same signature permission the harness holds, exactly as a surviving
 * pre-restart process would — and it tries, in order: to be handed a challenge,
 * to enroll with a guessed one, and to obtain a MAC for a forged but canonical
 * record.
 *
 * Nothing here is in the shipped build: the service is declared only in the
 * preview flavor's manifest and only logs. Everything it attempts is refused by
 * the signer itself, which is the point of the probe.
 *
 * Drive it with:
 *
 *   adb shell am force-stop com.openmausbot.companion.preview
 *   adb shell am force-stop com.openmausbot.companion.signer
 *   adb shell am start-foreground-service \
 *       -n com.openmausbot.companion.preview/com.openmausbot.companion.host.SignerRaceProbeService
 *   adb logcat -s SignerRaceProbe MemorySigner
 */
class SignerRaceProbeService : Service() {

    private companion object {
        const val TAG = "SignerRaceProbe"
        const val PROTOCOL = 2
        const val SIGNER_PACKAGE = "com.openmausbot.companion.signer"
        const val SIGNER_SERVICE = "$SIGNER_PACKAGE.MemorySignerService"
        /** Must match MemorySignerKey.ALIAS in the signer package. */
        const val SIGNER_ALIAS = "omb_memory_integrity_hmac_v3"
        const val CHANNEL = "signer-race-probe"
        const val FOREGROUND_ID = 0x5EED
    }

    private var connection: ServiceConnection? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Started by `am start-foreground-service` (a plain background start is
        // refused for a background app), so the contract is to post a
        // notification immediately — otherwise the platform kills the process
        // with ForegroundServiceDidNotStartInTimeException and the run looks
        // like an app crash instead of a probe result.
        promoteToForeground()
        Thread({ attempt() }, "signer-race-probe").start()
        return START_NOT_STICKY
    }

    private fun promoteToForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Signer race probe", NotificationManager.IMPORTANCE_LOW),
            )
        }
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Signer race probe")
            .setContentText("Testing the signing authority from a same-UID process")
            .setOngoing(true)
            .build()
        startForeground(FOREGROUND_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    }

    private fun attempt() {
        val pid = Process.myPid()
        val uid = Process.myUid()
        Log.i(TAG, "probe running as uid $uid pid $pid (main process is a different pid)")

        val latch = CountDownLatch(1)
        var remote: IMemorySigner? = null
        val conn = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                remote = IMemorySigner.Stub.asInterface(service)
                latch.countDown()
            }

            override fun onServiceDisconnected(name: ComponentName?) = Unit
        }
        connection = conn
        val bound = runCatching {
            bindService(
                Intent().setComponent(ComponentName(SIGNER_PACKAGE, SIGNER_SERVICE)),
                conn,
                BIND_AUTO_CREATE,
            )
        }.getOrElse { error ->
            Log.w(TAG, "bindService failed: ${error.javaClass.simpleName}: ${error.message}")
            false
        }
        latch.await(8, TimeUnit.SECONDS)
        val signer = remote
        if (!bound || signer == null) {
            Log.w(TAG, "RESULT bind=$bound binder=${signer != null} — could not reach the signer")
            finish(conn)
            return
        }

        // 1. Ask for a challenge. The signer will not hand this process one: the
        //    challenge goes to the app's manifest receiver, which is the main
        //    process, so the only effect is that the legitimate client enrolls.
        val asked = runCatching { signer.requestEnrollment() }
        Log.i(
            TAG,
            "requestEnrollment -> ${asked.getOrNull() ?: asked.exceptionOrNull()?.message}" +
                " (a fresh challenge is issued only when no live peer holds the authority)",
        )

        // 2. Present a guessed challenge. Nothing is returned to this process, so
        //    this is the best a caller with no challenge can do.
        val guessed = runCatching { signer.enroll(PROTOCOL, "00".repeat(32)) }
        Log.i(
            TAG,
            "enroll(guessed challenge) -> " + (
                if (guessed.isSuccess) "ACCEPTED" else refused(guessed.exceptionOrNull())
                ),
        )

        // 3. Ask for a MAC over a forged record that is shaped exactly like a
        //    canonical one, so nothing but authorization can stop it.
        val forged = JSONObject()
            .put("id", "forged-race-probe")
            .put("botId", "race-probe")
            .put("category", "stable_identity")
            .put("headline", "Injected by a same-UID process")
            .put("detail", "This record was never written by the canonical store.")
            .put("confidence", 0.99)
            .put("sourceTurnId", "race-probe")
            .put("createdAt", System.currentTimeMillis())
            .put("lastReinforcedAt", System.currentTimeMillis())
            .put("accessCount", 1)
            .put("sha256Hash", "0".repeat(64))
            .put("redacted", false)
            .toString()
        val mac = runCatching { signer.mac(PROTOCOL, 1, "record", arrayOf(forged)) }
        Log.i(
            TAG,
            "mac(forged record) -> " + (
                if (mac.isSuccess) "SIGNED: ${mac.getOrNull()}" else refused(mac.exceptionOrNull())
                ),
        )

        // 4. What the signer says about itself, and who it serves.
        val described = runCatching { signer.describe() }
        Log.i(TAG, "describe -> ${described.getOrNull() ?: described.exceptionOrNull()?.message}")

        // 5. The key itself. This process runs under the app UID, which is the
        //    same identity an agent shell has, so this is the honest answer to
        //    "can the main app use the signing key?" — with a real Keystore
        //    session, not an ART probe that never got that far.
        keystoreCheck()

        Log.i(TAG, "RESULT probe pid=$pid uid=$uid — expected: refused enrollment, refused MAC, peer=main process, no key in this UID")

        finish(conn)
    }

    private fun refused(error: Throwable?): String =
        "REFUSED ${error?.javaClass?.simpleName}: ${error?.message}"

    /**
     * The app UID's view of the signer's key.
     *
     * Android scopes Keystore keys to the UID that created them, so the alias
     * should simply not exist here. The lookalike below is the interesting
     * half: this UID *can* create a key with the same name, which is exactly
     * why the name must never be treated as the secret. It is deleted again so
     * the check stays repeatable and nothing is left behind.
     */
    private fun keystoreCheck() {
        runCatching {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val aliases = store.aliases().toList()
            Log.i(TAG, "keystore: uid=${Process.myUid()} aliases=$aliases")
            val entry = store.getEntry(SIGNER_ALIAS, null)
            Log.i(
                TAG,
                "keystore: getEntry($SIGNER_ALIAS)=" + (if (entry == null) "NULL" else "PRESENT (unexpected)"),
            )
            if (entry != null) return@runCatching

            val generator = KeyGenerator.getInstance("HmacSHA256", "AndroidKeyStore")
            generator.init(android.security.keystore.KeyGenParameterSpec
                .Builder(SIGNER_ALIAS, android.security.keystore.KeyProperties.PURPOSE_SIGN)
                .setKeySize(256)
                .build())
            val lookalike = generator.generateKey()
            val mac = Mac.getInstance("HmacSHA256", "AndroidKeyStoreBCWorkaround")
            mac.init(lookalike)
            val hex = mac.doFinal("omb-memory-record-v1\nprobe".toByteArray())
                .joinToString("") { "%02x".format(it) }
            Log.i(TAG, "keystore: a lookalike alias in this UID produces ${hex.take(16)}… — a different key")
            store.deleteEntry(SIGNER_ALIAS)
            Log.i(TAG, "keystore: lookalike deleted; this UID still cannot open the signer's key")
        }.onFailure { error ->
            Log.w(TAG, "keystore: probe failed ${error.javaClass.simpleName}: ${error.message}")
        }
    }

    private fun finish(conn: ServiceConnection) {
        runCatching { unbindService(conn) }
        connection = null
        stopSelf()
    }

    override fun onDestroy() {
        connection?.let { runCatching { unbindService(it) } }
        super.onDestroy()
    }
}
