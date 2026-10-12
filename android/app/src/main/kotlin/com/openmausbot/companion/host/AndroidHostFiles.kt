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

    fun serverEntry(): File = File(serverRoot, HostFiles.SERVER_ENTRY)
}
