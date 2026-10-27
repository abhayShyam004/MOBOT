package com.openmausbot.companion.core

import kotlinx.serialization.Serializable

@Serializable
data class UpdaterDownloadProgress(
    val downloadedBytes: Long = 0,
    val totalBytes: Long = 0,
    val percent: Int = 0,
)

@Serializable
data class UpdaterReleaseManifest(
    val version: String,
    val releaseTag: String,
    val name: String? = null,
    val downloadUrl: String,
    val fileName: String,
    val fileSizeBytes: Long = 0,
    val checksumSha256: String = "",
    val releaseNotes: String = "",
    val publishedAt: String = "",
    val channel: String = "stable",
    val versionCode: Long? = null,
    val packageName: String? = null,
)

@Serializable
data class StateValidation(
    val healthy: Boolean,
    val issues: List<String> = emptyList(),
    val schemaVersion: Int = 1,
    val botCount: Int = 0,
    val configValid: Boolean = false,
    val messagesDbValid: Boolean = false,
    val memoryDirectoryPresent: Boolean = false,
)

@Serializable
data class UpdaterStatusResponse(
    val status: String,
    val currentVersion: String,
    val currentVersionCode: Long? = null,
    val targetVersion: String? = null,
    val targetVersionCode: Long? = null,
    val targetPackageName: String? = null,
    val release: UpdaterReleaseManifest? = null,
    val downloadProgress: UpdaterDownloadProgress? = null,
    val lastCheckedAt: String? = null,
    val lastError: String? = null,
    val lastSnapshotPath: String? = null,
    val stagedApkPath: String? = null,
    val validation: StateValidation? = null,
)

@Serializable
data class UpdaterPrepareInstallResponse(
    val ok: Boolean,
    val stagedApkPath: String? = null,
    val snapshotPath: String? = null,
    val error: String? = null,
)
