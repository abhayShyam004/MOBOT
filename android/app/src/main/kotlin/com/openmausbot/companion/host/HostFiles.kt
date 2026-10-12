package com.openmausbot.companion.host

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.util.zip.ZipFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * First-run provisioning of the embedded MOBOT host.
 *
 * One asset is unpacked into app-private storage before the host can run:
 * the server bundle (`assets/host/server.zip`, built by
 * `scripts/prepare-android-host.mjs`, enterprise layer excluded).
 *
 * The JavaScript runtime itself is NOT unpacked anywhere: it ships as
 * `libnode_host.so` in `jniLibs` and therefore lands, extracted by the
 * package manager, in `applicationInfo.nativeLibraryDir` — one of the few
 * paths on modern Android a plain file may be exec'd from. The bundled
 * Termux libraries ride next to it with the same treatment, their
 * DT_NEEDED strings binary-patched at packaging time (same-length renames)
 * so they resolve under `lib*.so`-legal names in that directory.
 *
 * Every provisioning step is logged: native-runtime presence and execution
 * permission, per-library availability against the device ABI, extraction
 * milestones, the stamp verification result, and the exact extracted paths.
 * A provisioning failure names the exact missing artifact.
 */
object HostFiles {

    const val NODE_BINARY_NAME = "libnode_host.so"
    // Phase 4: the Android entry seeds the android_computer MCP server into
    // config.json before loading the upstream server (index-android.ts).
    const val SERVER_ENTRY = "index-android.js"

    private const val SERVER_ASSET = "host/server.zip"
    private const val SERVER_DIR_NAME = "host-server"
    private const val VERSION_STAMP = "server.version"
    private const val TAG = "HostFiles"

    /** File names the loader must find for the node process to start. */
    val requiredLibraries = listOf(
        "libz_1.so", "libcares.so", "libsqlite3.so", "libffi.so",
        "libcrypto_3.so", "libssl_3.so", "libicui18n_78.so",
        "libicuuc_78.so", "libicudata_78.so", "libc++_shared.so",
    )

    data class Provisioning(
        val nodeBinary: File,
        val serverEntry: File,
        val serverRoot: File,
    )

    /**
     * Verify native libraries, extract the server bundle if its stamp does
     * not match, and return everything the process supervisor needs. Throws
     * [HostProvisioningException] with a user-actionable message on failure —
     * a broken install must say so, not spin.
     */
    suspend fun provision(context: Context, assetStamp: String): Provisioning =
        withContext(Dispatchers.IO) {
            logI("provision: begin — device ABI list: ${Build.SUPPORTED_ABIS.joinToString(",")}")

            val nativeDir = context.applicationInfo.nativeLibraryDir
            logI("provision: nativeLibraryDir=$nativeDir")
            if (nativeDir == null) {
                throw HostProvisioningException(
                    "nativeLibraryDir is null — the package manager extracted no native libraries. " +
                        "This is the extractNativeLibs=false layout, in which .so files stay inside " +
                        "the APK and the embedded runtime has no on-disk location.",
                )
            }
            val node = File(nativeDir, NODE_BINARY_NAME)
            logI(
                "provision: runtime $NODE_BINARY_NAME exists=${node.isFile} " +
                    "size=${node.length()} canExecute=${node.canExecute()} canRead=${node.canRead()}",
            )
            if (!node.isFile || !node.canExecute()) {
                throw HostProvisioningException(
                    "embedded runtime missing or not executable in $nativeDir " +
                        "(device ABI: ${Build.SUPPORTED_ABIS.joinToString(",")}; " +
                        "was the APK built for this ABI and installed with legacy packaging?)",
                )
            }

            val present = requiredLibraries.filter { File(nativeDir, it).isFile }
            val missing = requiredLibraries - present.toSet()
            logI(
                "provision: native libraries present ${present.size}/${requiredLibraries.size}" +
                    if (missing.isEmpty()) "" else " — MISSING: $missing",
            )
            if (missing.isNotEmpty()) {
                throw HostProvisioningException("missing native libraries: $missing")
            }

            val serverRoot = File(context.filesDir, SERVER_DIR_NAME).apply { mkdirs() }
            val stampFile = File(serverRoot, VERSION_STAMP)
            val entry = File(serverRoot, SERVER_ENTRY)
            val existingStamp = stampFile.readTextSafe()
            val needsExtract = assetStamp != existingStamp || !entry.isFile
            logI(
                "provision: server stamp asset=${assetStamp.take(12)}… onDisk=" +
                    "${existingStamp?.take(12)}… entryExists=${entry.isFile} → " +
                    if (needsExtract) "extraction needed" else "extraction skipped (stamp matches)",
            )
            if (needsExtract) {
                val started = System.currentTimeMillis()
                logI("provision: extraction started → $serverRoot")
                extractServer(context, serverRoot)
                stampFile.writeText(assetStamp)
                val seconds = (System.currentTimeMillis() - started) / 1000.0
                logI("provision: extraction completed in $seconds s; stamp written")
            }
            if (!entry.isFile) {
                throw HostProvisioningException("server bundle extraction produced no entry point")
            }
            val jsFiles = serverRoot.walkTopDown().filter { it.isFile }.toList()
            logI(
                "provision: server bundle verified at ${serverRoot.canonicalPath} — " +
                    "${jsFiles.size} files, ${jsFiles.sumOf { it.length() } / 1024 / 1024} MB; " +
                    "entry ${SERVER_ENTRY} present",
            )
            Provisioning(nodeBinary = node, serverEntry = entry, serverRoot = serverRoot)
        }

    /** SHA-256 of the packaged bundle — the extraction stamp. */
    fun serverAssetStamp(context: Context): String =
        context.assets.open(SERVER_ASSET).use { input ->
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        }

    private fun extractServer(context: Context, serverRoot: File) {
        // Extract to a sibling temp dir, then swap: an interrupted extraction
        // must never leave a half-written server behind a fresh stamp.
        val tmp = File(context.filesDir, "$SERVER_DIR_NAME.tmp")
        tmp.deleteRecursively()
        tmp.mkdirs()
        context.assets.open(SERVER_ASSET).use { input ->
            val extracted = File.createTempFile("server", ".zip", context.cacheDir)
            try {
                extracted.outputStream().use { input.copyTo(it) }
                ZipFile(extracted).use { zip ->
                    val canonicalTmp = tmp.canonicalPath + File.separator
                    val entries = zip.entries()
                    while (entries.hasMoreElements()) {
                        val entry = entries.nextElement()
                        val out = File(tmp, entry.name)
                        // Zip-slip guard: entries must stay inside the temp root.
                        if (!out.canonicalPath.startsWith(canonicalTmp)) {
                            throw HostProvisioningException("host bundle contains an unsafe path: ${entry.name}")
                        }
                        if (entry.isDirectory) {
                            out.mkdirs()
                        } else {
                            out.parentFile?.mkdirs()
                            zip.getInputStream(entry).use { it.copyTo(out.outputStream()) }
                        }
                    }
                }
            } finally {
                extracted.delete()
            }
        }
        val old = File(context.filesDir, SERVER_DIR_NAME)
        if (old.exists()) old.deleteRecursively()
        if (!tmp.renameTo(old)) {
            // rename across the same directory should not fail; if it does,
            // fall back to copy so a quirk of the filesystem is not fatal.
            tmp.copyRecursively(old, overwrite = true)
            tmp.deleteRecursively()
        }
    }

    private fun File.readTextSafe(): String? =
        try { takeIf { isFile }?.readText() } catch (_: Exception) { null }

    private fun logI(message: String) = Log.i(TAG, message)
}

class HostProvisioningException(message: String) : RuntimeException(message)
