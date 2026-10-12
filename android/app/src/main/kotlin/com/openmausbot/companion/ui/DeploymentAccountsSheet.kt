package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.DeploymentAccountInfo
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.launch

/**
 * Phase F (Vercel Deployment) & Phase G (Render Deployment):
 * User-facing account configuration and credential management sheet.
 *
 * Requirements:
 * - Pure API-based credential management without CLI dependency.
 * - Store credentials securely (mode 0600 on companion server).
 * - Never expose access tokens in plain text (always masked: e.g. "ver_...3456").
 * - Connect account with personal access token.
 * - Test connection against live provider API with instant status feedback.
 * - Sign out / disconnect account safely.
 * - Inspect connected account metadata (username, email, last tested timestamp).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeploymentAccountsSheet(
    session: Session,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var accounts by remember { mutableStateOf<List<DeploymentAccountInfo>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var actionMessage by remember { mutableStateOf<String?>(null) }

    fun refreshAccounts() {
        scope.launch {
            isLoading = true
            accounts = session.deploymentAccounts()
            isLoading = false
        }
    }

    LaunchedEffect(Unit) {
        refreshAccounts()
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = AppTheme.colors.surface,
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = AppSpacing.gutter)
                .padding(bottom = 32.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(AppSpacing.md),
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(
                        text = "Cloud Deployment",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = AppTheme.colors.textPrimary,
                    )
                    Text(
                        text = "Manage hosting provider credentials",
                        style = MaterialTheme.typography.bodySmall,
                        color = AppTheme.colors.textSecondary,
                    )
                }
                AppPill(
                    text = "Done",
                    tone = PillTone.Quiet,
                    onClick = onDismiss,
                )
            }

            if (actionMessage != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(AppRadii.row))
                        .background(AppTheme.colors.selected)
                        .padding(horizontal = AppSpacing.md, vertical = AppSpacing.sm),
                ) {
                    Text(
                        text = actionMessage ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        color = AppTheme.colors.textPrimary,
                    )
                }
            }

            if (isLoading && accounts.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(140.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(32.dp),
                        strokeWidth = 2.dp,
                        color = AppTheme.colors.textTertiary,
                    )
                }
            } else {
                val vercelAccount = accounts.find { it.provider == "vercel" } ?: DeploymentAccountInfo(provider = "vercel")
                val renderAccount = accounts.find { it.provider == "render" } ?: DeploymentAccountInfo(provider = "render")

                // Vercel Account Card (Phase F)
                ProviderAccountCard(
                    providerId = "vercel",
                    providerName = "Vercel",
                    providerTagline = "Next.js, React, Node.js & Static Sites",
                    tokenPlaceholder = "ver_xxxxxxxxxxxxxxxxxxxx",
                    tokenHelpUrl = "vercel.com/account/tokens",
                    accountInfo = vercelAccount,
                    onConnect = { token ->
                        val ok = session.connectDeploymentAccount("vercel", token)
                        if (ok) {
                            actionMessage = "Vercel account connected successfully."
                            refreshAccounts()
                        }
                        ok
                    },
                    onTest = {
                        val ok = session.testDeploymentAccount("vercel")
                        actionMessage = if (ok) "Vercel connection test passed." else "Vercel connection test failed."
                        refreshAccounts()
                        ok
                    },
                    onDisconnect = {
                        scope.launch {
                            val ok = session.disconnectDeploymentAccount("vercel")
                            if (ok) {
                                actionMessage = "Vercel account disconnected."
                                refreshAccounts()
                            }
                        }
                    },
                )

                // Render Account Card (Phase G)
                ProviderAccountCard(
                    providerId = "render",
                    providerName = "Render",
                    providerTagline = "Web Services & Full-Stack Apps",
                    tokenPlaceholder = "rnd_xxxxxxxxxxxxxxxxxxxx",
                    tokenHelpUrl = "dashboard.render.com/u/settings#api-keys",
                    accountInfo = renderAccount,
                    onConnect = { token ->
                        val ok = session.connectDeploymentAccount("render", token)
                        if (ok) {
                            actionMessage = "Render account connected successfully."
                            refreshAccounts()
                        }
                        ok
                    },
                    onTest = {
                        val ok = session.testDeploymentAccount("render")
                        actionMessage = if (ok) "Render connection test passed." else "Render connection test failed."
                        refreshAccounts()
                        ok
                    },
                    onDisconnect = {
                        scope.launch {
                            val ok = session.disconnectDeploymentAccount("render")
                            if (ok) {
                                actionMessage = "Render account disconnected."
                                refreshAccounts()
                            }
                        }
                    },
                )
            }
        }
    }
}

@Composable
internal fun ProviderAccountCard(
    providerId: String,
    providerName: String,
    providerTagline: String,
    tokenPlaceholder: String,
    tokenHelpUrl: String,
    accountInfo: DeploymentAccountInfo,
    onConnect: suspend (String) -> Boolean,
    onTest: suspend () -> Boolean,
    onDisconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var isConnecting by remember { mutableStateOf(false) }
    var tokenInput by remember { mutableStateOf("") }
    var isTesting by remember { mutableStateOf(false) }
    var isSaving by remember { mutableStateOf(false) }
    var cardError by remember { mutableStateOf<String?>(null) }

    AppCard(
        modifier = modifier.fillMaxWidth(),
        shape = AppRadii.cardShape,
        bordered = true,
        contentPadding = PaddingValues(AppSpacing.lg),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(AppSpacing.md)) {
            // Header Row: Provider name, Tagline & status pill
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(
                        text = providerName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = AppTheme.colors.textPrimary,
                    )
                    Text(
                        text = providerTagline,
                        style = MaterialTheme.typography.labelSmall,
                        color = AppTheme.colors.textSecondary,
                    )
                }

                // Status pill with AppStatusDot
                val statusColor = if (accountInfo.connected) AppTheme.colors.positive else AppTheme.colors.textTertiary
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(AppRadii.pill)
                        .background(statusColor.copy(alpha = 0.12f))
                        .padding(horizontal = 9.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    AppStatusDot(
                        color = statusColor,
                        size = 6.dp,
                    )
                    Text(
                        text = if (accountInfo.connected) "Connected" else "Not connected",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = statusColor,
                    )
                }
            }

            if (accountInfo.connected) {
                // Connected Account Metadata Well
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(AppRadii.row))
                        .background(AppTheme.colors.surfaceSunken)
                        .padding(AppSpacing.md),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    accountInfo.username?.takeIf { it.isNotBlank() }?.let { name ->
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Account", style = MaterialTheme.typography.labelSmall, color = AppTheme.colors.textSecondary)
                            Text(name, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.textPrimary)
                        }
                    }
                    accountInfo.email?.takeIf { it.isNotBlank() }?.let { email ->
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Email", style = MaterialTheme.typography.labelSmall, color = AppTheme.colors.textSecondary)
                            Text(email, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.textPrimary)
                        }
                    }
                    accountInfo.maskedToken?.takeIf { it.isNotBlank() }?.let { token ->
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Token", style = MaterialTheme.typography.labelSmall, color = AppTheme.colors.textSecondary)
                            Text(token, style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = AppTheme.colors.textPrimary)
                        }
                    }
                    accountInfo.lastTestedAt?.takeIf { it.isNotBlank() }?.let { date ->
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Last verified", style = MaterialTheme.typography.labelSmall, color = AppTheme.colors.textSecondary)
                            Text(date.take(19).replace("T", " "), style = MaterialTheme.typography.labelSmall, color = AppTheme.colors.textTertiary)
                        }
                    }
                }

                // Action buttons: Test connection, Sign out
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AppPill(
                        text = if (isTesting) "Testing…" else "Test Connection",
                        tone = PillTone.Raised,
                        enabled = !isTesting,
                        onClick = {
                            scope.launch {
                                isTesting = true
                                cardError = null
                                val ok = onTest()
                                isTesting = false
                                if (!ok) {
                                    cardError = "Connection test failed for $providerName. The access token was rejected (HTTP 401 Unauthorized or network error). Please verify your token has valid permissions."
                                }
                            }
                        },
                    )

                    AppPill(
                        text = "Sign Out",
                        tone = PillTone.Destructive,
                        onClick = onDisconnect,
                    )
                }
            } else {
                // Not Connected
                if (!isConnecting) {
                    AppPill(
                        text = "Connect $providerName Account",
                        tone = PillTone.Raised,
                        onClick = {
                            cardError = null
                            isConnecting = true
                        },
                    )
                } else {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(AppRadii.row))
                            .background(AppTheme.colors.surfaceSunken)
                            .padding(AppSpacing.md),
                        verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                    ) {
                        AppTextField(
                            value = tokenInput,
                            onValueChange = { tokenInput = it },
                            label = "Personal Access Token",
                            placeholder = tokenPlaceholder,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            helper = "Tokens are encrypted on-device. Obtain from $tokenHelpUrl",
                            modifier = Modifier.fillMaxWidth(),
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            AppPill(
                                text = "Cancel",
                                tone = PillTone.Quiet,
                                onClick = {
                                    tokenInput = ""
                                    isConnecting = false
                                },
                            )

                            AppPill(
                                text = if (isSaving) "Verifying…" else "Verify & Save",
                                tone = PillTone.Accent,
                                enabled = tokenInput.isNotBlank() && !isSaving,
                                onClick = {
                                    if (tokenInput.isNotBlank()) {
                                        scope.launch {
                                            isSaving = true
                                            cardError = null
                                            val ok = onConnect(tokenInput.trim())
                                            isSaving = false
                                            if (ok) {
                                                tokenInput = ""
                                                isConnecting = false
                                            } else {
                                                cardError = "Failed to connect $providerName account. The token was rejected by $providerName API or lacks deployment permissions."
                                            }
                                        }
                                    }
                                },
                            )
                        }
                    }
                }
            }

            // Inline Actionable Error Box
            if (cardError != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(AppRadii.row))
                        .background(AppTheme.colors.danger.copy(alpha = 0.12f))
                        .border(1.dp, AppTheme.colors.danger.copy(alpha = 0.4f), RoundedCornerShape(AppRadii.row))
                        .padding(AppSpacing.md),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(AppSpacing.xs)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.Warning,
                                    contentDescription = null,
                                    tint = AppTheme.colors.danger,
                                    modifier = Modifier.size(16.dp),
                                )
                                Text(
                                    text = "Authentication Failed",
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = AppTheme.colors.danger,
                                )
                            }
                            Box(
                                modifier = Modifier
                                    .size(24.dp)
                                    .clip(CircleShape)
                                    .clickable { cardError = null },
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.Close,
                                    contentDescription = "Dismiss error",
                                    tint = AppTheme.colors.textSecondary,
                                    modifier = Modifier.size(14.dp),
                                )
                            }
                        }
                        Text(
                            text = cardError ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = AppTheme.colors.textPrimary,
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                        ) {
                            AppPill(
                                text = "Copy Diagnostics",
                                tone = PillTone.Quiet,
                                onClick = {
                                    val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
                                    val clip = android.content.ClipData.newPlainText("Error Diagnostics", cardError ?: "")
                                    clipboard?.setPrimaryClip(clip)
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}
