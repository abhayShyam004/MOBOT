package com.openmausbot.companion.ui

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.ActionableRecovery
import com.openmausbot.companion.core.CauseConfidence
import com.openmausbot.companion.core.StructuredAppError

/**
 * Universal Actionable Error Sheet for MOBOT.
 *
 * Guarantees every failure clearly answers the three core user questions:
 * 1. What failed?
 * 2. Why did it fail? (Confirmed vs Possible cause)
 * 3. What to do next? (Numbered actionable steps)
 *
 * Replaces cryptic one-line red errors with an accessible, high-fidelity native sheet
 * providing sanitized technical diagnostics and immediate recovery actions.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ActionableErrorBottomSheet(
    error: StructuredAppError,
    onDismiss: () -> Unit,
    onRetry: (() -> Unit)? = null,
    onFixAutomatically: ((String) -> Unit)? = null,
    onOpenSettings: (() -> Unit)? = null,
    onViewLogs: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current
    val colors = AppTheme.colors
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var diagnosticsExpanded by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
        dragHandle = null,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = AppSpacing.lg, vertical = AppSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(AppSpacing.md),
        ) {
            // Header: Warning Glyph, Headline, Category, and Close Button
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(AppSpacing.md),
            ) {
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .background(colors.danger.copy(alpha = 0.14f), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Warning,
                        contentDescription = null,
                        tint = colors.danger,
                        modifier = Modifier.size(20.dp),
                    )
                }

                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(AppSpacing.xs),
                    ) {
                        Text(
                            text = error.category.name.replace("_", " "),
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.textTertiary,
                            fontWeight = FontWeight.Bold,
                        )
                        error.diagnostics.statusCode?.let { code ->
                            Text(
                                text = "• HTTP $code",
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.danger,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                    Text(
                        text = error.headline,
                        style = MaterialTheme.typography.titleLarge,
                        color = colors.textPrimary,
                        fontWeight = FontWeight.Bold,
                    )
                }

                IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = "Dismiss",
                        tint = colors.textSecondary,
                    )
                }
            }

            // 1. What failed?
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.surfaceRaised, AppRadii.cardShape)
                    .padding(AppSpacing.md),
                verticalArrangement = Arrangement.spacedBy(AppSpacing.xs),
            ) {
                Text(
                    text = "WHAT FAILED",
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.textTertiary,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = error.operation,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textPrimary,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            // 2. Why did it fail? (With Confirmed vs Possible badge)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.surfaceRaised, AppRadii.cardShape)
                    .padding(AppSpacing.md),
                verticalArrangement = Arrangement.spacedBy(AppSpacing.xs),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = "WHY IT FAILED",
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.textTertiary,
                        fontWeight = FontWeight.Bold,
                    )

                    // Confidence Badge
                    val isConfirmed = error.confidence == CauseConfidence.CONFIRMED
                    val badgeBg = if (isConfirmed) colors.positive.copy(alpha = 0.16f) else colors.caution.copy(alpha = 0.16f)
                    val badgeColor = if (isConfirmed) colors.positive else colors.caution
                    val badgeText = if (isConfirmed) "CONFIRMED CAUSE" else "POSSIBLE CAUSE"

                    Box(
                        modifier = Modifier
                            .background(badgeBg, AppRadii.pill)
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                    ) {
                        Text(
                            text = badgeText,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = badgeColor,
                        )
                    }
                }

                Text(
                    text = error.explanation,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textPrimary,
                )
            }

            // 3. What to do next? (Numbered concrete steps)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.surfaceRaised, AppRadii.cardShape)
                    .padding(AppSpacing.md),
                verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
            ) {
                Text(
                    text = "WHAT TO DO NEXT",
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.textTertiary,
                    fontWeight = FontWeight.Bold,
                )

                error.nextSteps.forEachIndexed { index, step ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(22.dp)
                                .background(colors.accent.copy(alpha = 0.12f), CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "${index + 1}",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = colors.accent,
                            )
                        }
                        Text(
                            text = step,
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.textPrimary,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            // Expandable Technical Diagnostics
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, colors.hairline, AppRadii.cardShape)
                    .clip(AppRadii.cardShape),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(role = Role.Button) {
                            diagnosticsExpanded = !diagnosticsExpanded
                        }
                        .padding(AppSpacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = "Technical Diagnostics",
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.textPrimary,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(AppSpacing.xs),
                    ) {
                        Text(
                            text = if (diagnosticsExpanded) "Hide" else "Show details",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                        Icon(
                            imageVector = if (diagnosticsExpanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                            contentDescription = null,
                            tint = colors.textSecondary,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }

                AnimatedVisibility(visible = diagnosticsExpanded) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(colors.surfaceSunken)
                            .padding(AppSpacing.md),
                        verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                    ) {
                        Text(
                            text = "Timestamp: ${error.diagnostics.timestamp}",
                            fontSize = 11.sp,
                            color = colors.textTertiary,
                            fontFamily = FontFamily.Monospace,
                        )
                        error.diagnostics.turnId?.let {
                            Text(
                                text = "Turn ID: $it",
                                fontSize = 11.sp,
                                color = colors.textTertiary,
                                fontFamily = FontFamily.Monospace,
                            )
                        }
                        error.diagnostics.correlationId?.let {
                            Text(
                                text = "Correlation ID: $it",
                                fontSize = 11.sp,
                                color = colors.textTertiary,
                                fontFamily = FontFamily.Monospace,
                            )
                        }

                        Text(
                            text = "Raw Message:",
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.textTertiary,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = error.diagnostics.rawMessage,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            color = colors.textPrimary,
                        )

                        error.diagnostics.sanitizedLogs?.let { logs ->
                            Text(
                                text = "Sanitized Output / Logs:",
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.textTertiary,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                text = logs,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                                color = colors.textSecondary,
                            )
                        }

                        error.diagnostics.stackTrace?.let { stack ->
                            Text(
                                text = "Stack Trace:",
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.textTertiary,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                text = stack.take(800),
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                                color = colors.textSecondary,
                            )
                        }

                        Spacer(Modifier.height(AppSpacing.xs))
                        AppPill(
                            text = "Copy Diagnostic Report",
                            tone = PillTone.Raised,
                            onClick = {
                                clipboardManager.setText(AnnotatedString(error.toDiagnosticReport()))
                                Toast.makeText(context, "Diagnostic report copied to clipboard", Toast.LENGTH_SHORT).show()
                            },
                        )
                    }
                }
            }

            // Action Buttons
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
            ) {
                if (error.canRetry && onRetry != null) {
                    AppPill(
                        text = "Retry",
                        tone = PillTone.Accent,
                        onClick = {
                            onDismiss()
                            onRetry()
                        },
                    )
                }

                if (error.actions.contains(ActionableRecovery.FIX_AUTOMATICALLY) && onFixAutomatically != null) {
                    AppPill(
                        text = "Fix automatically",
                        tone = PillTone.Accent,
                        onClick = {
                            val prompt = error.retryPrompt ?: "Please fix the error: ${error.headline}. ${error.explanation}"
                            onDismiss()
                            onFixAutomatically(prompt)
                        },
                    )
                }

                if (error.actions.contains(ActionableRecovery.OPEN_SETTINGS) && onOpenSettings != null) {
                    AppPill(
                        text = "Open settings",
                        tone = PillTone.Raised,
                        onClick = {
                            onDismiss()
                            onOpenSettings()
                        },
                    )
                }

                if (error.actions.contains(ActionableRecovery.VIEW_LOGS) && onViewLogs != null) {
                    AppPill(
                        text = "View logs",
                        tone = PillTone.Raised,
                        onClick = {
                            onDismiss()
                            onViewLogs()
                        },
                    )
                }

                AppPill(
                    text = "Copy details",
                    tone = PillTone.Quiet,
                    onClick = {
                        clipboardManager.setText(AnnotatedString(error.toDiagnosticReport()))
                        Toast.makeText(context, "Copied diagnostic report", Toast.LENGTH_SHORT).show()
                    },
                )

                TextButton(onClick = onDismiss) {
                    Text("Dismiss", color = colors.textSecondary)
                }
            }
            Spacer(Modifier.height(36.dp))
        }
    }
}
