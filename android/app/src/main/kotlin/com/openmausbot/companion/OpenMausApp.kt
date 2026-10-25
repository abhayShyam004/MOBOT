package com.openmausbot.companion

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.lifecycle.ProcessLifecycleOwner
import com.openmausbot.companion.audio.VoicePreviewPlayer
import com.openmausbot.companion.avatar.AvatarImageStore
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.discovery.NsdDiscovery
import com.openmausbot.companion.host.BrowserDriverServer
import com.openmausbot.companion.host.AndroidHostFiles
import com.openmausbot.companion.host.HarnessService
import com.openmausbot.companion.host.HarnessHost
import com.openmausbot.companion.host.HarnessHostPort
import com.openmausbot.companion.host.MemorySignerClient
import com.openmausbot.companion.host.StandaloneConnectionStore
import com.openmausbot.companion.host.StandaloneTokenStore
import com.openmausbot.companion.lifecycle.AlwaysOnConnectionService
import com.openmausbot.companion.lifecycle.AlwaysOnConnectionState
import com.openmausbot.companion.lifecycle.ServiceProcessAnchor
import com.openmausbot.companion.lifecycle.SessionLingerController
import com.openmausbot.companion.lifecycle.installSessionLinger
import com.openmausbot.companion.notifications.ForegroundObserver
import com.openmausbot.companion.notifications.LocalNotificationPoster
import com.openmausbot.companion.permissions.CompanionPermissions
import com.openmausbot.companion.sharing.ShareInbox
import com.openmausbot.companion.storage.AlwaysOnPreferences
import com.openmausbot.companion.storage.DataStoreConnectionStore
import com.openmausbot.companion.storage.OnboardingPreferences
import com.openmausbot.companion.storage.KeystoreTokenStore
import com.openmausbot.companion.terminal.TerminalDriverServer
import com.openmausbot.companion.terminal.TerminalSessions
import com.openmausbot.companion.ui.FilePreviews
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Application entry: owns the long-lived [Session] and wires
 * [ProcessLifecycleOwner] the way iOS `scenePhase` drives connect and linger.
 */
class OpenMausApp : Application() {
    private val appJob = SupervisorJob()
    val appScope = CoroutineScope(appJob + Dispatchers.Main.immediate)

    lateinit var session: Session
        private set
    lateinit var notifications: LocalNotificationPoster
        private set
    lateinit var discovery: NsdDiscovery
        private set
    lateinit var permissions: CompanionPermissions
        private set

    /**
     * One instance for the whole process: [Session] writes the first-pair
     * education marker into it as part of committing a pairing, and the root
     * router reads it to decide whether that step is due.
     */
    lateinit var onboarding: OnboardingPreferences
        private set
    lateinit var avatars: AvatarImageStore
        private set
    lateinit var voicePreview: VoicePreviewPlayer
        private set
    lateinit var linger: SessionLingerController
        private set
    lateinit var shareInbox: ShareInbox
        private set
    lateinit var alwaysOn: AlwaysOnPreferences
        private set

    /**
     * The embedded MOBOT host: this phone's own computer. Process
     * supervisor owned by the Application, observed by the foreground
     * service and the diagnostics UI; independent of any Activity.
     */
    lateinit var harnessHost: HarnessHost
        private set

    /**
     * The interactive terminals this phone is hosting.
     *
     * Application-scoped on purpose — this is what "the process survives the
     * turn" means in practice. A bot's turn starts a session and ends; the chat
     * screen, the terminal surface and any Activity may come and go; the PTY,
     * the program and its output buffer live here, in the one object that no
     * screen owns.
     */
    lateinit var terminalSessions: TerminalSessions
        private set

    override fun onCreate() {
        super.onCreate()
        shareInbox = ShareInbox()
        ShareInbox.cleanStale(cacheDir)
        // Launch stays non-blocking. The preview store awaits the shared
        // completion barrier on its own IO coroutine before writing anything.
        FilePreviews.startStaleCleanup(this, appScope)
        notifications = LocalNotificationPoster(this)
        discovery = NsdDiscovery(this)
        permissions = CompanionPermissions(this)
        onboarding = OnboardingPreferences(this)
        // Bind the separate-UID signing authority *before* the host exists: the
        // signer pins its trusted caller to the first process that binds it,
        // and every agent shell is a descendant of the host spawned below.
        MemorySignerClient.install(this)
        val hostPort = HarnessHostPort(this)
        harnessHost = HarnessHost(appScope, AndroidHostFiles(this), hostPort)
        session = Session(
            scope = appScope,
            connectionStore = StandaloneConnectionStore(DataStoreConnectionStore(this), hostPort),
            tokenStore = StandaloneTokenStore(KeystoreTokenStore(this)),
            onboardingStore = onboarding,
            deviceNameProvider = {
                // User-visible device name; Settings.Global.DEVICE_NAME on API 25+.
                android.provider.Settings.Global.getString(contentResolver, "device_name")
                    ?.takeIf { it.isNotBlank() }
                    ?: android.os.Build.MODEL
            },
            notificationSink = notifications,
            localHostReadyProvider = { harnessHost.awaitReady() },
        )
        avatars = AvatarImageStore(fetch = session::avatarData)
        voicePreview = VoicePreviewPlayer(this)

        // iOS resets the avatar cache inside signOut. Observe Unpaired here so
        // the platform cache cannot outlive the pairing that minted its URLs.
        appScope.launch {
            session.status
                .map { it is Session.Status.Unpaired }
                .distinctUntilChanged()
                .collect { unpaired ->
                    if (unpaired) avatars.clearBlocking()
                }
        }

        // Foreground reconnects; background lingers. Cutting the stream at
        // onStop would drop a turn that completes seconds after Home — the
        // notification is produced by this stream and nothing else.
        // `session.linger()` on iOS (`ios/App/CompanionApp.swift:26`).
        linger = installSessionLinger(
            lifecycle = ProcessLifecycleOwner.get().lifecycle,
            session = session,
            scope = appScope,
            anchor = ServiceProcessAnchor(this),
            alwaysOn = { AlwaysOnConnectionState.active },
        )

        // Whether this app is in front of the person is half of suppression: a
        // conversation that is still "open" behind the launcher is not being
        // read, and the linger above keeps the stream alive after Home exactly
        // so a turn that finishes there can still be announced. Process
        // lifecycle, not Activity lifecycle: a rotation recreates the Activity
        // and must not read as leaving.
        ProcessLifecycleOwner.get().lifecycle.addObserver(ForegroundObserver(notifications))

        alwaysOn = AlwaysOnPreferences(this)

        // The terminals. Created before the host starts, because the host hands
        // the driver's loopback port and capability token to the harness in its
        // own environment (AT_DRIVER_PORT / AT_DRIVER_TOKEN) — the same handoff
        // the browser driver uses, and paths/ports only, never a credential.
        val terminalFiles = AndroidHostFiles(this)
        terminalSessions = TerminalSessions(
            homeDir = terminalFiles.homeDir(),
            tmpDir = terminalFiles.tmpDir(),
            nativeLibraryDir = File(applicationInfo.nativeLibraryDir ?: filesDir.absolutePath),
            log = { message: String -> android.util.Log.i("TerminalSessions", message) },
        )
        TerminalSessions.instance = terminalSessions
        TerminalDriverServer.start(terminalSessions)

        // The standalone host. Started unconditionally: this phone IS the
        // computer in this build. HarnessService holds the foreground
        // notification Android requires for long-running work and keeps the
        // process alive through backgrounding; the host itself outlives the
        // UI entirely.
        // Phase 7: the browser driver (owns the bots' WebViews) must outlive
        // the harness process and every Activity — app scope, started once.
        // Session WebViews attach to the resumed Activity's decor: an
        // unattached WebView never spawns its renderer on several OEM builds.
        BrowserDriverServer.start(this, AndroidHostFiles(this).browserSessionsDir())
        registerActivityLifecycleCallbacks(object : NoopLifecycle() {
            override fun onActivityResumed(a: Activity) {
                BrowserDriverServer.attachWindow(a.window)
            }
        })
        HarnessService.start(this)
        // Covers the case where the process was relaunched (not booted) while
        // the setting was on — e.g. the OS killed the whole app under memory
        // pressure and the user (or a notification tap) reopened it. A device
        // reboot is covered separately by AlwaysOnBootReceiver, which can run
        // before anything ever constructs this Application's Activity.
        if (alwaysOn.enabled.value) {
            AlwaysOnConnectionService.start(this)
        }
    }

    /** Boilerplate carrier for the one lifecycle hook above. */
    private open class NoopLifecycle : ActivityLifecycleCallbacks {
        override fun onActivityCreated(a: Activity, s: Bundle?) {}
        override fun onActivityStarted(a: Activity) {}
        override fun onActivityResumed(a: Activity) {}
        override fun onActivityPaused(a: Activity) {}
        override fun onActivityStopped(a: Activity) {}
        override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
        override fun onActivityDestroyed(a: Activity) {}
    }
}
