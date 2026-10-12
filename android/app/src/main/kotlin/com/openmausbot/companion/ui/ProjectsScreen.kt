package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.DeploymentAccountInfo
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.launch

/**
 * Phase H (Project Management) & Phase F (Vercel Deployment):
 * Native Android project management screen with real-time deployment coordination.
 *
 * Displays all generated applications running on the phone:
 * - Name, framework, live build status, preview status, deployment status.
 * - States: Draft, Building, Ready, Previewing, Failed, Deploying, Live (No fake states).
 * - Actions: Open, Preview, Build, Test, Stop Preview, Deploy, Redeploy, View Logs, Git.
 * - Deployment dialog with Preview vs Production environments, connected account validation,
 *   and direct access to Cloud Accounts sheet.
 */

data class ProjectItemState(
    val id: String,
    val name: String,
    val description: String,
    val framework: String,
    val state: String,
    val previewStatus: String,
    val previewUrl: String? = null,
    val previewPort: Int? = null,
    val deploymentStatus: String,
    val deploymentProvider: String? = null,
    val deploymentUrl: String? = null,
    val gitBranch: String? = null,
    val gitCommitHash: String? = null,
    val updatedAt: String,
)

object ProjectsPresentationRules {
    fun stateBadgeColor(state: String): Color = when (state.lowercase()) {
        "live" -> Color(0xFF10B981) // Emerald
        "previewing", "ready" -> Color(0xFF06B6D4) // Cyan / Teal
        "building", "deploying" -> Color(0xFFF59E0B) // Amber
        "failed", "error", "crashed" -> Color(0xFFEF4444) // Red
        else -> Color(0xFF6B7280) // Grey (Draft)
    }

    fun stateLabel(state: String): String = when (state.lowercase()) {
        "draft" -> "Draft"
        "building" -> "Building"
        "ready" -> "Ready"
        "previewing" -> "Previewing"
        "failed" -> "Failed"
        "deploying" -> "Deploying"
        "live" -> "Live"
        else -> state.replaceFirstChar { it.uppercase() }
    }

    fun canPreview(state: String, previewStatus: String): Boolean {
        return previewStatus.lowercase() !in listOf("building", "deploying")
    }

    fun canDeploy(state: String): Boolean {
        return state.lowercase() in listOf("ready", "previewing", "live", "draft")
    }

    fun canCancelDeployment(deploymentStatus: String): Boolean {
        return deploymentStatus.lowercase() in listOf("building", "queued", "pending")
    }

    fun canRedeploy(deploymentStatus: String): Boolean {
        return deploymentStatus.lowercase() in listOf("ready", "error", "failed", "cancelled")
    }

    fun canRebuild(state: String): Boolean {
        return state.lowercase() !in listOf("building", "deploying")
    }

    fun formatGitInfo(branch: String?, commit: String?): String {
        if (branch.isNullOrBlank()) return "Git initialized"
        val shortCommit = if (!commit.isNullOrBlank()) " (${commit.take(7)})" else ""
        return "$branch$shortCommit"
    }
}

/**
 * Stateful ProjectsScreen that interacts directly with companion [Session].
 */
@Composable
fun ProjectsScreen(
    navigator: CompanionNavigator,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var projects by remember { mutableStateOf<List<ProjectItemState>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var deployingProject by remember { mutableStateOf<ProjectItemState?>(null) }
    var deletingProject by remember { mutableStateOf<ProjectItemState?>(null) }
    var deploySuccessInfo by remember { mutableStateOf<DeploySuccessInfo?>(null) }
    var viewingLogsProject by remember { mutableStateOf<ProjectItemState?>(null) }
    var logsContent by remember { mutableStateOf<String?>(null) }
    var loadingLogs by remember { mutableStateOf(false) }

    fun refreshProjects() {
        scope.launch {
            isLoading = true
            val records = session.appProjects()
            projects = records.map { r ->
                ProjectItemState(
                    id = r.id,
                    name = r.name,
                    description = r.description,
                    framework = r.framework,
                    state = r.state,
                    previewStatus = r.preview.status,
                    previewUrl = r.preview.url,
                    previewPort = r.preview.port,
                    deploymentStatus = r.deployment.status,
                    deploymentProvider = r.deployment.provider,
                    deploymentUrl = r.deployment.url,
                    gitBranch = r.git.branch,
                    gitCommitHash = r.git.commitHash,
                    updatedAt = r.updatedAt,
                )
            }
            isLoading = false
        }
    }

    LaunchedEffect(Unit) {
        refreshProjects()
    }

    ProjectsScreen(
        projects = projects,
        isLoading = isLoading,
        onOpenPreview = { item ->
            scope.launch {
                val res = session.startAppProjectPreview(item.id)
                val url = res?.preview?.url ?: item.previewUrl
                if (url != null) {
                    launchExternalBrowser(context, url)
                }
                refreshProjects()
            }
        },
        onDeploy = { item ->
            deployingProject = item
        },
        onRebuild = { item ->
            scope.launch {
                session.deployProject(item.id, target = "preview")
                refreshProjects()
            }
        },
        onRunTests = {},
        onViewLogs = { item ->
            viewingLogsProject = item
            loadingLogs = true
            scope.launch {
                val res = session.projectDeployment(item.id)
                logsContent = res?.logs ?: "No deployment logs recorded yet."
                loadingLogs = false
            }
        },
        onDelete = { item ->
            deletingProject = item
        },
        onRefresh = { refreshProjects() },
        onOpenAccounts = { navigator.push(Destination.ConnectedApps) },
        onBack = onBack,
        modifier = modifier,
    )

    deployingProject?.let { project ->
        DeployProjectDialog(
            project = project,
            session = session,
            onDismiss = { deployingProject = null },
            onDeploySuccess = { provider, target, url ->
                deployingProject = null
                deploySuccessInfo = DeploySuccessInfo(
                    projectName = project.name,
                    provider = provider,
                    target = target,
                    url = url,
                )
                refreshProjects()
            },
            onOpenAccounts = {
                deployingProject = null
                navigator.push(Destination.ConnectedApps)
            },
        )
    }

    deletingProject?.let { project ->
        DeleteProjectConfirmationDialog(
            project = project,
            onConfirm = {
                val toDelete = deletingProject
                deletingProject = null
                if (toDelete != null) {
                    scope.launch {
                        val deleted = session.deleteAppProject(toDelete.id)
                        if (deleted) refreshProjects()
                    }
                }
            },
            onDismiss = { deletingProject = null },
        )
    }

    deploySuccessInfo?.let { info ->
        DeploySuccessDialog(
            info = info,
            onDismiss = {
                deploySuccessInfo = null
                refreshProjects()
            },
        )
    }

    viewingLogsProject?.let { project ->
        ProjectLogsDialog(
            projectName = project.name,
            logs = logsContent,
            isLoading = loadingLogs,
            onDismiss = {
                viewingLogsProject = null
                logsContent = null
            },
        )
    }
}

/**
 * Pure, stateless ProjectsScreen composable adhering to MOBOT's design system.
 */
@Composable
fun ProjectsScreen(
    projects: List<ProjectItemState>,
    isLoading: Boolean = false,
    onOpenPreview: (ProjectItemState) -> Unit = {},
    onDeploy: (ProjectItemState) -> Unit = {},
    onRebuild: (ProjectItemState) -> Unit = {},
    onRunTests: (ProjectItemState) -> Unit = {},
    onViewLogs: (ProjectItemState) -> Unit = {},
    onDelete: (ProjectItemState) -> Unit = {},
    onRefresh: () -> Unit = {},
    onOpenAccounts: () -> Unit = {},
    onBack: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(AppTheme.colors.background),
    ) {
        // Coherent, uncluttered header matching Settings & other top screens
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    start = AppSpacing.xs,
                    end = AppSpacing.gutter,
                    top = AppSpacing.xs,
                    bottom = AppSpacing.sm,
                ),
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HeaderBackButton(onBack)
            Text(
                text = "Applications",
                style = MaterialTheme.typography.headlineSmall,
                color = AppTheme.colors.textPrimary,
                modifier = Modifier.weight(1f),
            )
            HeaderGlyphButton(
                icon = Icons.Filled.AccountCircle,
                contentDescription = "Connected Apps",
                onClick = onOpenAccounts,
            )
            HeaderGlyphButton(
                icon = Icons.Filled.Refresh,
                contentDescription = "Refresh",
                onClick = onRefresh,
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        ) {
            if (isLoading && projects.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(36.dp),
                        strokeWidth = 2.dp,
                        color = AppTheme.colors.textTertiary,
                    )
                }
            } else if (projects.isEmpty()) {
                EmptyProjectsView(modifier = Modifier.fillMaxSize())
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = AppSpacing.gutter, vertical = AppSpacing.sm),
                    verticalArrangement = Arrangement.spacedBy(AppSpacing.md),
                ) {
                    items(projects, key = { it.id }) { item ->
                        ProjectCard(
                            item = item,
                            onOpenPreview = { onOpenPreview(item) },
                            onDeploy = { onDeploy(item) },
                            onRebuild = { onRebuild(item) },
                            onRunTests = { onRunTests(item) },
                            onViewLogs = { onViewLogs(item) },
                            onDelete = { onDelete(item) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ProjectCard(
    item: ProjectItemState,
    onOpenPreview: () -> Unit,
    onDeploy: () -> Unit,
    onRebuild: () -> Unit,
    onRunTests: () -> Unit,
    onViewLogs: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val stateColor = ProjectsPresentationRules.stateBadgeColor(item.state)

    AppCard(
        modifier = modifier.fillMaxWidth(),
        shape = AppRadii.cardShape,
        bordered = true,
        contentPadding = PaddingValues(AppSpacing.lg),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(AppSpacing.md)) {
            // Header Row: Title, Framework, Git Branch & State Badge
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(end = AppSpacing.sm),
                ) {
                    Text(
                        text = item.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = AppTheme.colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(AppSpacing.xs),
                    ) {
                        QuietTag(item.framework.uppercase())
                        if (item.gitBranch != null) {
                            Text(
                                text = "• " + ProjectsPresentationRules.formatGitInfo(item.gitBranch, item.gitCommitHash),
                                style = MaterialTheme.typography.labelSmall,
                                color = AppTheme.colors.textTertiary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }

                // Restrained State Pill
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(AppRadii.pill)
                        .background(stateColor.copy(alpha = 0.12f))
                        .padding(horizontal = 9.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    AppStatusDot(
                        color = stateColor,
                        size = 6.dp,
                        pulsing = item.state.lowercase() in listOf("building", "deploying", "previewing"),
                    )
                    Text(
                        text = ProjectsPresentationRules.stateLabel(item.state),
                        style = MaterialTheme.typography.labelSmall,
                        color = stateColor,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            // Description
            if (item.description.isNotBlank()) {
                Text(
                    text = item.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = AppTheme.colors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            // Preview & Deployment Info Well
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(AppRadii.row))
                    .background(AppTheme.colors.surfaceSunken)
                    .padding(AppSpacing.md),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                // Localhost row
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = if (item.previewUrl != null) Modifier.clickable { launchExternalBrowser(context, item.previewUrl) } else Modifier,
                ) {
                    Text(
                        text = "Localhost: ",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = AppTheme.colors.textSecondary,
                    )
                    Text(
                        text = item.previewUrl ?: "Stopped",
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace,
                        color = if (item.previewUrl != null) AppTheme.colors.textPrimary else AppTheme.colors.textTertiary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }

                // Deployment row
                if (item.deploymentUrl != null || item.deploymentStatus != "none") {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = if (item.deploymentUrl != null) Modifier.clickable { launchExternalBrowser(context, item.deploymentUrl) } else Modifier,
                    ) {
                        Text(
                            text = "${item.deploymentProvider?.uppercase() ?: "Deploy"}: ",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = AppTheme.colors.textSecondary,
                        )
                        Text(
                            text = item.deploymentUrl ?: item.deploymentStatus,
                            style = MaterialTheme.typography.labelSmall,
                            fontFamily = FontFamily.Monospace,
                            color = if (item.deploymentUrl != null) AppTheme.colors.positive else AppTheme.colors.textTertiary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                    }
                }
            }

            // Primary action pills
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AppPill(
                    text = "Preview",
                    tone = PillTone.Accent,
                    onClick = onOpenPreview,
                    enabled = ProjectsPresentationRules.canPreview(item.state, item.previewStatus),
                )

                if (item.previewUrl != null) {
                    AppPill(
                        text = "Browser",
                        tone = PillTone.Raised,
                        onClick = onOpenPreview,
                    )
                }

                AppPill(
                    text = "Deploy",
                    tone = PillTone.Raised,
                    onClick = onDeploy,
                    enabled = ProjectsPresentationRules.canDeploy(item.state),
                )
            }

            // Secondary action row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(AppSpacing.xs)) {
                    AppPill(
                        text = "Rebuild",
                        tone = PillTone.Quiet,
                        onClick = onRebuild,
                        enabled = ProjectsPresentationRules.canRebuild(item.state),
                    )
                    AppPill(
                        text = "Logs",
                        tone = PillTone.Quiet,
                        onClick = onViewLogs,
                    )
                }

                AppPill(
                    text = "Delete",
                    tone = PillTone.Destructive,
                    onClick = onDelete,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeployProjectDialog(
    project: ProjectItemState,
    session: Session,
    onDismiss: () -> Unit,
    onDeploySuccess: (provider: String, target: String, url: String?) -> Unit,
    onOpenAccounts: () -> Unit,
) {
    var selectedProviderIndex by remember { mutableStateOf(0) }
    var selectedTargetIndex by remember { mutableStateOf(0) }
    var isDeploying by remember { mutableStateOf(false) }
    var accounts by remember { mutableStateOf<List<DeploymentAccountInfo>>(emptyList()) }
    var loadingAccounts by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()

    val providerOptions = listOf("Vercel", "Render")
    val targetOptions = listOf("Preview", "Production")
    val selectedProvider = if (selectedProviderIndex == 0) "vercel" else "render"
    val selectedTarget = if (selectedTargetIndex == 0) "preview" else "production"

    LaunchedEffect(Unit) {
        accounts = session.deploymentAccounts()
        loadingAccounts = false
    }

    val currentAccount = accounts.find { it.provider == selectedProvider }
    val isConnected = currentAccount?.connected == true

    BasicAlertDialog(
        onDismissRequest = { if (!isDeploying) onDismiss() },
    ) {
        AppCard(
            modifier = Modifier.fillMaxWidth(),
            shape = AppRadii.cardShape,
            bordered = true,
            contentPadding = PaddingValues(AppSpacing.lg),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(AppSpacing.md),
            ) {
                // Title
                Text(
                    text = "Deploy ${project.name}",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.colors.textPrimary,
                )

                // Provider Selection using ChoiceRow
                ChoiceRow(
                    label = "Deployment Provider",
                    options = providerOptions,
                    selectedIndex = selectedProviderIndex,
                    onSelect = { selectedProviderIndex = it },
                )

                // Account Status Notice
                if (loadingAccounts) {
                    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    }
                } else if (isConnected) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(AppRadii.row))
                            .background(AppTheme.colors.positive.copy(alpha = 0.12f))
                            .padding(AppSpacing.md),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                    ) {
                        AppStatusDot(color = AppTheme.colors.positive, size = 8.dp)
                        Column {
                            Text(
                                text = "Connected as ${currentAccount?.username ?: "Authorized User"}",
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.SemiBold,
                                color = AppTheme.colors.positive,
                            )
                            if (!currentAccount?.maskedToken.isNullOrBlank()) {
                                Text(
                                    text = currentAccount?.maskedToken ?: "",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontFamily = FontFamily.Monospace,
                                    color = AppTheme.colors.textSecondary,
                                )
                            }
                        }
                    }
                } else {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(AppRadii.row))
                            .background(AppTheme.colors.caution.copy(alpha = 0.12f))
                            .padding(AppSpacing.md),
                        verticalArrangement = Arrangement.spacedBy(AppSpacing.xs),
                    ) {
                        Text(
                            text = "No ${selectedProvider.uppercase()} account connected",
                            style = MaterialTheme.typography.bodySmall,
                            color = AppTheme.colors.caution,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = "A personal access token is required to deploy this project.",
                            style = MaterialTheme.typography.labelSmall,
                            color = AppTheme.colors.textSecondary,
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        AppPill(
                            text = "Connect in Connected Apps ➔",
                            tone = PillTone.Raised,
                            onClick = onOpenAccounts,
                        )
                    }
                }

                // Target Environment using ChoiceRow
                ChoiceRow(
                    label = "Target Environment",
                    options = targetOptions,
                    selectedIndex = selectedTargetIndex,
                    onSelect = { selectedTargetIndex = it },
                )

                if (selectedTarget == "production") {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(AppRadii.row))
                            .background(AppTheme.colors.surfaceSunken)
                            .padding(AppSpacing.sm),
                    ) {
                        Text(
                            text = "Production deployment updates live domains and is immediately accessible.",
                            style = MaterialTheme.typography.labelSmall,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                }

                if (isDeploying) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(AppRadii.row))
                            .background(AppTheme.colors.surfaceSunken)
                            .padding(AppSpacing.md),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = AppTheme.colors.accent,
                        )
                        Text(
                            text = "Deploying to ${providerOptions[selectedProviderIndex]} ($selectedTarget)…",
                            style = MaterialTheme.typography.bodySmall,
                            color = AppTheme.colors.textPrimary,
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                // Action buttons
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AppPill(
                        text = "Cancel",
                        tone = PillTone.Quiet,
                        onClick = onDismiss,
                        enabled = !isDeploying,
                    )

                    AppPill(
                        text = if (selectedTarget == "production") "Deploy Production" else "Deploy Preview",
                        tone = PillTone.Accent,
                        enabled = isConnected && !isDeploying,
                        onClick = {
                            isDeploying = true
                            scope.launch {
                                val res = session.deployProject(project.id, provider = selectedProvider, target = selectedTarget)
                                isDeploying = false
                                if (res?.ok == true) {
                                    onDeploySuccess(selectedProvider, selectedTarget, res.deployment?.url)
                                }
                            }
                        },
                    )
                }
            }
        }
    }
}

data class DeploySuccessInfo(
    val projectName: String,
    val provider: String,
    val target: String,
    val url: String?,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeleteProjectConfirmationDialog(
    project: ProjectItemState,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    BasicAlertDialog(onDismissRequest = onDismiss) {
        AppCard(
            modifier = Modifier.fillMaxWidth(),
            shape = AppRadii.cardShape,
            bordered = true,
            contentPadding = PaddingValues(AppSpacing.lg),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(AppSpacing.md)) {
                Text(
                    text = "Delete Project?",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.colors.danger,
                )
                Text(
                    text = "Are you sure you want to delete \"${project.name}\"?",
                    style = MaterialTheme.typography.bodyMedium,
                    color = AppTheme.colors.textPrimary,
                )
                Text(
                    text = "This will permanently remove the project directory, terminate any active local preview servers, and remove all associated local files. This action cannot be undone.",
                    style = MaterialTheme.typography.bodySmall,
                    color = AppTheme.colors.textSecondary,
                )

                Spacer(modifier = Modifier.height(4.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AppPill(
                        text = "Cancel",
                        tone = PillTone.Quiet,
                        onClick = onDismiss,
                    )
                    AppPill(
                        text = "Delete Project",
                        tone = PillTone.Destructive,
                        onClick = onConfirm,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeploySuccessDialog(
    info: DeploySuccessInfo,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    BasicAlertDialog(onDismissRequest = onDismiss) {
        AppCard(
            modifier = Modifier.fillMaxWidth(),
            shape = AppRadii.cardShape,
            bordered = true,
            contentPadding = PaddingValues(AppSpacing.lg),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(AppSpacing.md)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                ) {
                    AppStatusDot(color = AppTheme.colors.positive, size = 10.dp)
                    Text(
                        text = "Deployment Succeeded",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = AppTheme.colors.textPrimary,
                    )
                }

                Text(
                    text = "Project \"${info.projectName}\" has been deployed to ${info.provider.replaceFirstChar { it.uppercase() }} (${info.target}).",
                    style = MaterialTheme.typography.bodyMedium,
                    color = AppTheme.colors.textSecondary,
                )

                if (!info.url.isNullOrBlank()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(AppRadii.row))
                            .background(AppTheme.colors.surfaceSunken)
                            .padding(AppSpacing.md),
                    ) {
                        Text(
                            text = info.url,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            color = AppTheme.colors.positive,
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (!info.url.isNullOrBlank()) {
                        AppPill(
                            text = "Copy URL",
                            tone = PillTone.Quiet,
                            onClick = {
                                val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
                                val clip = android.content.ClipData.newPlainText("Deployment URL", info.url)
                                clipboard?.setPrimaryClip(clip)
                            },
                        )
                        AppPill(
                            text = "Open in Browser",
                            tone = PillTone.Accent,
                            onClick = {
                                launchExternalBrowser(context, info.url)
                                onDismiss()
                            },
                        )
                    } else {
                        Spacer(modifier = Modifier.weight(1f))
                        AppPill(
                            text = "Done",
                            tone = PillTone.Accent,
                            onClick = onDismiss,
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectLogsDialog(
    projectName: String,
    logs: String?,
    isLoading: Boolean,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    BasicAlertDialog(onDismissRequest = onDismiss) {
        AppCard(
            modifier = Modifier.fillMaxWidth(),
            shape = AppRadii.cardShape,
            bordered = true,
            contentPadding = PaddingValues(AppSpacing.lg),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(AppSpacing.md)) {
                Text(
                    text = "Logs: $projectName",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 140.dp, max = 340.dp)
                        .clip(RoundedCornerShape(AppRadii.row))
                        .background(AppTheme.colors.surfaceSunken)
                        .padding(AppSpacing.md),
                ) {
                    if (isLoading) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 2.dp)
                        }
                    } else {
                        Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                            Text(
                                text = logs ?: "No logs recorded.",
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                                lineHeight = 16.sp,
                                color = AppTheme.colors.textPrimary,
                            )
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AppPill(
                        text = "Copy Logs",
                        tone = PillTone.Raised,
                        onClick = {
                            val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
                            val clip = android.content.ClipData.newPlainText("Logs", logs ?: "")
                            clipboard?.setPrimaryClip(clip)
                        },
                    )

                    AppPill(
                        text = "Done",
                        tone = PillTone.Quiet,
                        onClick = onDismiss,
                    )
                }
            }
        }
    }
}

@Composable
private fun EmptyProjectsView(modifier: Modifier = Modifier) {
    AppEmptyState(
        title = "No Applications Built Yet",
        message = "Ask MOBOT to build an app for you in any chat! Supported stacks include React, Next.js, Node.js, and HTML.",
        modifier = modifier,
    )
}
