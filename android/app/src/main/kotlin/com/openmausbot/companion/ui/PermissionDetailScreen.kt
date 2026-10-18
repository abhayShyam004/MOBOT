package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.AgentPermissions
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.launch

data class PermissionDomainSpec(
    val id: String,
    val title: String,
    val subtitle: String,
    val description: String,
    val icon: ImageVector,
    val controlledTools: List<String>,
    val securityBoundaries: List<String>,
)

object PermissionDomainCatalog {
    val TERMINAL = PermissionDomainSpec(
        id = "terminal",
        title = "Terminal & Shell Execution",
        subtitle = "Command-line execution & subprocesses",
        description = "Authorizes MOBOT to execute shell commands, run background scripts, and spawn build or test processes.",
        icon = Icons.Default.Lock,
        controlledTools = listOf(
            "run_command", "run_shell", "process_start", "process_stop",
            "process_list", "terminal_start", "project_run", "project_build",
            "build_run", "test_run", "repair_run_cycle"
        ),
        securityBoundaries = listOf(
            "Host shell execution boundary is enforced at the server driver level.",
            "Revocation immediately disallows CLI tools like Bash in Claude, OpenAI, and ACP runtimes.",
            "All subprocess executions are terminated and cannot be scheduled when revoked.",
            "Internal MOBOT companion daemon services remain completely isolated and functional."
        ),
    )

    val FILESYSTEM = PermissionDomainSpec(
        id = "filesystem",
        title = "Filesystem Read & Write",
        subtitle = "Workspace file access and modification",
        description = "Authorizes MOBOT to inspect, create, edit, and delete files inside designated project workspaces.",
        icon = Icons.Default.Lock,
        controlledTools = listOf(
            "workspace_read", "workspace_write", "workspace_delete", "workspace_mkdir",
            "workspace_move", "workspace_copy", "artifact_create", "artifact_write",
            "project_create", "project_read", "project_write", "project_delete"
        ),
        securityBoundaries = listOf(
            "File operations outside the designated workspace are strictly isolated.",
            "Revocation blocks ReadFile, WriteFile, and EditFile across all model engines.",
            "MOBOT configuration database and transcript history reside in protected app storage.",
            "Tool execution attempts to touch files return explicit permission denied errors."
        ),
    )

    val BROWSER = PermissionDomainSpec(
        id = "browser",
        title = "Browser & Network",
        subtitle = "Web searches, URL inspection, and network access",
        description = "Authorizes MOBOT to perform web searches, retrieve external URLs, and automate web page navigation.",
        icon = Icons.Default.Lock,
        controlledTools = listOf(
            "http_fetch", "web_search", "Fetch", "WebSearch",
            "browser_open", "browser_screenshot", "browser_navigate",
            "resource_inspect", "resource_fetch", "preview_start"
        ),
        securityBoundaries = listOf(
            "SSRF protections guard against access to private loopback ranges and sensitive local networks.",
            "Revocation immediately prevents network fetches and WebView automation sessions.",
            "Local client-server synchronization traffic for the companion app is isolated and exempt.",
            "Zero external connections can be initiated on behalf of the agent when disabled."
        ),
    )

    val COMPOSIO = PermissionDomainSpec(
        id = "composio",
        title = "Composio Integrations",
        subtitle = "Connected cloud apps and SaaS actions",
        description = "Authorizes MOBOT to execute actions on connected external apps like GitHub, Gmail, Slack, and Linear.",
        icon = Icons.Default.Lock,
        controlledTools = listOf(
            "mcp__composio", "composio_github", "composio_gmail",
            "composio_slack", "composio_calendar", "composio_linear"
        ),
        securityBoundaries = listOf(
            "Requires valid Composio authorization configured in Settings -> Connected Services.",
            "Revocation disconnects tool access without deleting stored credentials.",
            "Every action requires prior authorization before dispatching to external APIs.",
            "If unconfigured, state is truthfully flagged as Requires configuration."
        ),
    )

    fun forDomain(id: String): PermissionDomainSpec = when (id.lowercase()) {
        "terminal" -> TERMINAL
        "filesystem" -> FILESYSTEM
        "browser" -> BROWSER
        "composio" -> COMPOSIO
        else -> TERMINAL
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PermissionDetailScreen(
    domainId: String,
    session: Session,
    agentPermissions: AgentPermissions?,
    onPermissionsUpdated: (AgentPermissions) -> Unit,
    onBack: () -> Unit,
    onOpenConnectedServices: (() -> Unit)? = null,
) {
    val spec = remember(domainId) { PermissionDomainCatalog.forDomain(domainId) }
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var confirmRevokeOpen by remember { mutableStateOf(false) }

    val currentState = when (spec.id) {
        "terminal" -> agentPermissions?.terminal ?: "granted"
        "filesystem" -> agentPermissions?.filesystem ?: "granted"
        "browser" -> agentPermissions?.browser ?: "granted"
        "composio" -> agentPermissions?.composio ?: "requires_configuration"
        else -> "granted"
    }

    val isGranted = currentState == "granted"
    val isRequiresConfig = currentState == "requires_configuration"
    val isRestricted = currentState == "restricted"

    val (statusLabel, pillBg, pillFg) = when {
        isGranted -> Triple("Granted", Color(0xFFE8F5E9), Color(0xFF2E7D32))
        isRequiresConfig -> Triple("Requires configuration", Color(0xFFFFF3E0), Color(0xFFE65100))
        isRestricted -> Triple("Restricted", Color(0xFFFFF3E0), Color(0xFFE65100))
        else -> Triple("Denied", Color(0xFFFFEBEE), Color(0xFFC62828))
    }

    SettingsSubPage(
        title = spec.title,
        subtitle = spec.subtitle,
        onBack = onBack,
    ) {
        // 1. Hero Status Card
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(AppTheme.colors.surface)
                .border(
                    width = 1.dp,
                    color = AppTheme.colors.border.copy(alpha = 0.5f),
                    shape = RoundedCornerShape(24.dp),
                )
                .padding(22.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = spec.title,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = AppTheme.colors.textPrimary,
                    )
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(pillBg)
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Text(
                            text = statusLabel,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = pillFg,
                        )
                    }
                }

                Text(
                    text = spec.description,
                    fontSize = 13.5.sp,
                    color = AppTheme.colors.textSecondary,
                    lineHeight = 19.sp,
                )

                // Action controls
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp),
                    horizontalArrangement = Arrangement.End,
                ) {
                    if (isRequiresConfig) {
                        Button(
                            onClick = { onOpenConnectedServices?.invoke() },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = AppTheme.colors.accent,
                                contentColor = AppTheme.colors.onAccent,
                            ),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Text(
                                text = "Configure in Connected Services",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    } else if (isGranted) {
                        OutlinedButton(
                            onClick = { confirmRevokeOpen = true },
                            enabled = !saving,
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = Color(0xFFC62828),
                            ),
                            border = ButtonDefaults.outlinedButtonBorder.copy(
                                brush = androidx.compose.ui.graphics.SolidColor(Color(0xFFC62828).copy(alpha = 0.6f)),
                            ),
                        ) {
                            if (saving) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                    color = Color(0xFFC62828),
                                )
                            } else {
                                Text(
                                    text = "Revoke Access",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    } else {
                        Button(
                            onClick = {
                                scope.launch {
                                    saving = true
                                    session.setAgentPermission(spec.id, "granted")?.let {
                                        it.agentPermissions?.let(onPermissionsUpdated)
                                    }
                                    saving = false
                                }
                            },
                            enabled = !saving,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = AppTheme.colors.accent,
                                contentColor = AppTheme.colors.onAccent,
                            ),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            if (saving) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                    color = AppTheme.colors.onAccent,
                                )
                            } else {
                                Text(
                                    text = "Grant Access",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    }
                }
            }
        }

        // 2. Controlled Tools Section
        SettingsSection(title = "Controlled Operations & Tools") {
            Box(modifier = Modifier.padding(16.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "The following tools are strictly gated by this execution policy:",
                        fontSize = 13.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        spec.controlledTools.forEach { tool ->
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(AppTheme.colors.surfaceRaised)
                                    .padding(horizontal = 9.dp, vertical = 5.dp),
                            ) {
                                Text(
                                    text = tool,
                                    fontSize = 12.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = AppTheme.colors.textPrimary,
                                )
                            }
                        }
                    }
                }
            }
        }

        // 3. Security Boundaries & Safety
        SettingsSection(title = "Security Boundaries & Runtime Isolation") {
            Box(modifier = Modifier.padding(16.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    spec.securityBoundaries.forEach { boundary ->
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Box(
                                modifier = Modifier
                                    .padding(top = 5.dp)
                                    .size(6.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(AppTheme.colors.textSecondary),
                            )
                            Text(
                                text = boundary,
                                fontSize = 13.sp,
                                color = AppTheme.colors.textPrimary,
                                lineHeight = 18.sp,
                            )
                        }
                    }
                }
            }
        }
    }

    if (confirmRevokeOpen) {
        AlertDialog(
            onDismissRequest = { confirmRevokeOpen = false },
            title = {
                Text(
                    text = "Revoke ${spec.title}?",
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                )
            },
            text = {
                Text(
                    text = "When revoked, MOBOT will be blocked from invoking any tools in this domain at runtime. Ongoing turns attempting these operations will fail immediately.",
                    fontSize = 13.5.sp,
                    color = AppTheme.colors.textSecondary,
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        confirmRevokeOpen = false
                        scope.launch {
                            saving = true
                            session.setAgentPermission(spec.id, "denied")?.let {
                                it.agentPermissions?.let(onPermissionsUpdated)
                            }
                            saving = false
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFC62828),
                        contentColor = Color.White,
                    ),
                ) {
                    Text("Revoke")
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmRevokeOpen = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}
