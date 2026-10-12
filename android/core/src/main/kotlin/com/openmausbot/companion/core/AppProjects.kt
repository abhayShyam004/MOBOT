package com.openmausbot.companion.core

import kotlinx.serialization.Serializable

/**
 * Phase C (Full-Stack App Builder) data models for generated applications running
 * directly on the device's embedded runtime.
 */
@Serializable
data class AppProjectPreview(
    val status: String = "stopped",
    val port: Int? = null,
    val url: String? = null,
    val pid: Int? = null,
)

@Serializable
data class AppProjectDeployment(
    val status: String = "none",
    val provider: String? = null,
    val url: String? = null,
    val deploymentId: String? = null,
)

@Serializable
data class AppProjectGit(
    val initialized: Boolean = false,
    val branch: String? = null,
    val commitHash: String? = null,
    val clean: Boolean = true,
    val lastCommitMessage: String? = null,
)

@Serializable
data class AppEnvVarMetadata(
    val key: String,
    val isSecret: Boolean = false,
    val description: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class AppProjectFileItem(
    val path: String,
    val isDir: Boolean = false,
    val size: Long = 0L,
)

@Serializable
data class AppProjectRecord(
    val id: String,
    val name: String,
    val description: String = "",
    val framework: String = "html",
    val language: String = "javascript",
    val runtime: String = "node",
    val createdAt: String = "",
    val updatedAt: String = "",
    val state: String = "draft",
    val preview: AppProjectPreview = AppProjectPreview(),
    val deployment: AppProjectDeployment = AppProjectDeployment(),
    val git: AppProjectGit = AppProjectGit(),
    val env: List<AppEnvVarMetadata> = emptyList(),
    val entryPoint: String? = null,
)

@Serializable
data class AppProjectListResponse(
    val projects: List<AppProjectRecord> = emptyList(),
)

@Serializable
data class AppProjectDetailResponse(
    val ok: Boolean = true,
    val project: AppProjectRecord,
    val files: List<AppProjectFileItem> = emptyList(),
)

@Serializable
data class CreateAppProjectRequest(
    val name: String,
    val id: String? = null,
    val description: String? = null,
    val framework: String = "html",
    val initGit: Boolean = true,
)

@Serializable
data class DeploymentAccountInfo(
    val provider: String,
    val connected: Boolean = false,
    val username: String? = null,
    val email: String? = null,
    val teamId: String? = null,
    val teamName: String? = null,
    val maskedToken: String? = null,
    val lastTestedAt: String? = null,
)

@Serializable
data class DeploymentAccountsResponse(
    val accounts: List<DeploymentAccountInfo> = emptyList(),
)

@Serializable
data class ConnectDeploymentAccountRequest(
    val token: String,
)

@Serializable
data class DeployProjectRequest(
    val provider: String = "vercel",
    val target: String = "preview",
)

@Serializable
data class DeployProjectResponse(
    val ok: Boolean = true,
    val projectId: String,
    val deployment: AppProjectDeployment? = null,
    val error: String? = null,
    val logs: String? = null,
)

@Serializable
data class DeploymentPromptResponse(
    val question: String,
    val options: List<String> = emptyList(),
    val connectedProviders: List<String> = emptyList(),
)

@Serializable
data class AppProjectPreviewActionResponse(
    val ok: Boolean = true,
    val projectId: String,
    val preview: AppProjectPreview? = null,
    val error: String? = null,
)

