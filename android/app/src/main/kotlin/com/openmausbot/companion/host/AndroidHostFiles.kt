package com.openmausbot.companion.host

import android.content.Context
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Production [HarnessHost.Files]: everything lives under app-private storage.
 *
 * Layout (nothing below `home/` is exposed to any bot beyond its own
 * workspace — the host's own sandboxing rules apply exactly as on desktop):
 *
 * ```
 * filesDir/
 *   host-server/          extracted server bundle (stamped by asset hash)
 *   host/
 *     home/               process HOME (server writes .openmausbot here unless redirected)
 *     data/               OMB_DATA_DIR — transcripts, config, bot state
 *     tmp/                TMPDIR
 * ```
 */
class AndroidHostFiles(private val context: Context) : HarnessHost.Files {

    private val root get() = File(context.filesDir, "host")
    private val serverRoot get() = File(context.filesDir, "host-server")

    override suspend fun provision(): HostFiles.Provisioning =
        withContext(Dispatchers.IO) {
            HostFiles.provision(context, HostFiles.serverAssetStamp(context))
        }

    override fun dataDir(): File = File(root, "data").apply { mkdirs() }
    override fun homeDir(): File = File(root, "home").apply { mkdirs() }
    override fun tmpDir(): File = File(root, "tmp").apply { mkdirs() }

    /** Phase 7: per-bot browser session state root (profile dirs live here). */
    override fun browserSessionsDir(): File = File(root, "browser-sessions").apply { mkdirs() }

    override fun appVersion(): String = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "1.1.2"
    }.getOrDefault("1.1.2")

    override fun appVersionCode(): Long = runCatching {
        val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            pInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            pInfo.versionCode.toLong()
        }
    }.getOrDefault(10102L)

    override fun appPackageName(): String = context.packageName

    fun serverEntry(): File = File(serverRoot, HostFiles.SERVER_ENTRY)

    /**
     * Crash-injection switch, read **only** in a preview build.
     *
     * `adb shell settings put global omb_crash_point after-manifest` makes the
     * next canonical write die at that transition, which is how the commit
     * protocol is verified against the real writer on the device. The setting
     * is ignored by every other package — the official app never reads it —
     * and the host does nothing with a value it does not recognise.
     */
    override fun crashPoint(): String? {
        if (!context.packageName.endsWith(".preview")) return null
        return runCatching {
            android.provider.Settings.Global.getString(context.contentResolver, "omb_crash_point")
        }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() }
    }
}
