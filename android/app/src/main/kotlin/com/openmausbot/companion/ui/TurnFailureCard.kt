package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import kotlinx.coroutines.launch
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.FailureCard
import com.openmausbot.companion.core.Message

/**
 * Which of a failure card's actions are worth offering for a failure kind.
 *
 * The rules are here, apart from the drawing, because they are decisions about
 * the failure rather than about the layout — and a wrong button is worse than a
 * missing one. Offering "Retry" on a missing CLI retries into the same wall;
 * offering "Provider settings" on a rate limit sends someone to edit a key that
 * is fine. So each kind answers for itself:
 *
 *  - **Retry** — everything except a setup failure, which is the one failure a
 *    retry cannot move. (The same call the desktop's error row makes.)
 *  - **Change model** — the kinds another model genuinely fixes: a limit, an
 *    exhausted balance, a model the account may not use, a model the provider
 *    no longer serves, a request the model rejected, and an unclassified
 *    failure where the model is the reasonable next variable. Not a network
 *    fault or a provider's own outage — changing models there is a guess.
 *  - **Provider settings** — the kinds whose remedy is configuration: a
 *    rejected sign-in, a refusal by account or model, an exhausted balance, an
 *    engine that needs installing or signing in, an endpoint that cannot be
 *    reached, a request the provider called malformed.
 *
 * A room has no model of its own, so its cards never offer [changeModel] — the
 * same reason a room's header opens room settings instead of a bot's models.
 * Whether an action can actually run at this moment (nothing to retry, a task
 * already busy) is the caller's business: it passes null.
 */
object FailureActions {
    /** Kinds where a different model is the move the failure itself suggests. */
    private val MODEL_KINDS: Set<String> = setOf(
        "rate_limit",
        "quota",
        "access",
        "model_unavailable",
        "invalid_request",
        "unknown",
    )

    /** Kinds whose remedy lives in Model providers. */
    private val SETTINGS_KINDS: Set<String> = setOf(
        "auth",
        "access",
        "quota",
        "model_unavailable",
        "invalid_request",
        "network",
        "setup",
    )

    fun retry(kind: String): Boolean = kind != "setup"

    fun changeModel(chat: Chat, kind: String): Boolean = chat is Chat.BotChat && kind in MODEL_KINDS

    fun providerSettings(kind: String): Boolean = kind in SETTINGS_KINDS

    fun editKey(kind: String): Boolean = kind in setOf("auth", "access")
}

/**
 * A turn that failed, as the conversation explains itself — the phone's half of
 * the desktop's error row, with the provider, the model and the way out.
 *
 * The card exists because the alternative was a truncated provider payload as
 * the bot's last word: machine output a person cannot act on, sitting where they
 * look for an answer. Everything drawn here was written by the harness
 * ([FailureCard]); the provider's own report never leaves the computer's log.
 *
 * It is deliberately the loudest thing in a transcript otherwise made of quiet
 * chips: a failed turn is not a tool step, it is the reason the message above it
 * has no reply. So it carries a surface, a warning mark, the headline, where it
 * happened, and — the part that makes it a card rather than an error line — the
 * one thing to do about it.
 */
@Composable
internal fun TurnFailureCard(
    chat: Chat,
    card: FailureCard,
    /** Null when there is nothing to run again, or the task is already busy. */
    onRetry: (() -> Unit)? = null,
    /** Null in a room, which has no one model to change. */
    onChangeModel: (() -> Unit)? = null,
    onOpenProviders: (() -> Unit)? = null,
) {
    val colors = AppTheme.colors
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    var showEditKeyDialog by remember { mutableStateOf(false) }
    var editingKey by remember { mutableStateOf("") }
    var keyUpdating by remember { mutableStateOf(false) }
    var keyError by remember { mutableStateOf<String?>(null) }
    var showDiagnostics by remember { mutableStateOf(false) }

    val severity = remember(card.kind, card.status) {
        ErrorSeverityClassifier.classify(card.kind, card.status)
    }

    val severityTint = when (severity) {
        ErrorSeverity.BLOCKING -> colors.danger
        ErrorSeverity.RECOVERABLE -> colors.caution
        ErrorSeverity.WARNING -> colors.caution
        ErrorSeverity.INFO -> colors.accent
    }

    val cardBorder = when (severity) {
        ErrorSeverity.BLOCKING -> colors.danger.copy(alpha = 0.35f)
        ErrorSeverity.RECOVERABLE -> colors.caution.copy(alpha = 0.35f)
        ErrorSeverity.WARNING -> colors.subtleBorder
        ErrorSeverity.INFO -> colors.subtleBorder
    }

    val where = listOfNotNull(
        card.provider?.takeIf { it.isNotBlank() },
        card.model?.takeIf { it.isNotBlank() },
    ).joinToString(" · ")
    Column(
        modifier = Modifier
            .widthIn(max = CHAT_CONTENT_MAX_WIDTH)
            .background(colors.surface, RoundedCornerShape(14.dp))
            .border(1.dp, cardBorder, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { showDiagnostics = !showDiagnostics },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(24.dp)
                    .background(severityTint.copy(alpha = 0.14f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.Warning,
                    contentDescription = null,
                    tint = severityTint,
                    modifier = Modifier.size(15.dp),
                )
            }
            Text(
                text = card.title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            card.status?.let { StatusTag(it) }
            if (onRetry != null && FailureActions.retry(card.kind)) {
                AppPill(text = "Retry", onClick = onRetry, tone = PillTone.Accent)
            }
            Text(
                text = if (showDiagnostics) "Hide" else "Details",
                style = MaterialTheme.typography.labelSmall,
                color = colors.textTertiary,
                modifier = Modifier
                    .clip(CircleShape)
                    .padding(horizontal = 6.dp, vertical = 4.dp),
            )
        }
        if (showDiagnostics) {
            if (where.isNotEmpty()) {
                Text(
                    text = where,
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.textTertiary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (card.detail.isNotBlank()) {
                Text(
                    text = card.detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }
            if (card.advice.isNotBlank()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surfaceRaised, AppRadii.smallShape)
                        .padding(AppSpacing.sm),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        text = WHAT_TO_DO,
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.textTertiary,
                    )
                    Text(
                        text = card.advice,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textPrimary,
                    )
                }
            }
            val actions = buildList {
                if (FailureActions.editKey(card.kind)) {
                    add(FailureAction("Edit API key", PillTone.Raised) {
                        editingKey = ""
                        keyError = null
                        showEditKeyDialog = true
                    })
                }
                if (onChangeModel != null && FailureActions.changeModel(chat, card.kind)) {
                    add(FailureAction("Change model", PillTone.Raised, onChangeModel))
                }
                if (onOpenProviders != null && FailureActions.providerSettings(card.kind)) {
                    add(FailureAction("Provider settings", PillTone.Raised, onOpenProviders))
                }
            }
            if (actions.isNotEmpty()) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                    verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                ) {
                    actions.forEach { action ->
                        AppPill(text = action.label, onClick = action.run, tone = action.tone)
                    }
                }
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.surfaceRaised, AppRadii.smallShape)
                    .padding(AppSpacing.sm),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = "Diagnostics (${card.kind}):",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.textTertiary,
                )
                Text(
                    text = card.detail.ifBlank { card.title },
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = colors.textSecondary,
                )
            }
        }
    }

    if (showEditKeyDialog) {
        val targetProvider = card.provider?.ifBlank { null } ?: "Provider"
        @OptIn(ExperimentalMaterial3Api::class)
        BasicAlertDialog(
            onDismissRequest = { if (!keyUpdating) showEditKeyDialog = false },
        ) {
            AppCard(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = AppSpacing.sm),
                shape = AppRadii.cardShape,
                bordered = true,
                contentPadding = PaddingValues(AppSpacing.lg),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(AppSpacing.md)) {
                    Text(
                        text = "Edit API key",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                        color = colors.textPrimary,
                    )
                    Text(
                        text = "Provider: $targetProvider${card.model?.let { " · $it" } ?: ""}",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                    AppTextField(
                        value = editingKey,
                        onValueChange = { editingKey = it },
                        label = "New API key",
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !keyUpdating,
                    )
                    keyError?.let { err ->
                        Text(
                            text = err,
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.danger,
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(
                            onClick = { showEditKeyDialog = false },
                            enabled = !keyUpdating,
                        ) {
                            Text("Cancel", color = colors.textSecondary)
                        }
                        Spacer(modifier = Modifier.width(AppSpacing.sm))
                        AppPill(
                            text = if (keyUpdating) "Saving…" else "Save & Test",
                            tone = PillTone.Accent,
                            enabled = editingKey.isNotBlank() && !keyUpdating,
                            onClick = {
                                scope.launch {
                                    keyUpdating = true
                                    keyError = null
                                    val targetId = card.instanceId
                                        ?: session.modelInstances().firstOrNull {
                                            it.instanceId.equals(card.provider, ignoreCase = true) ||
                                            it.driverKind.equals(card.provider, ignoreCase = true) ||
                                            (it.displayName?.equals(card.provider, ignoreCase = true) == true)
                                        }?.instanceId
                                    if (targetId != null) {
                                        val saved = session.saveProviderKey(targetId, null, editingKey.trim())
                                        if (saved != null) {
                                            session.testProviderModels(targetId)
                                            showEditKeyDialog = false
                                            onRetry?.invoke()
                                        } else {
                                            keyError = session.actionError ?: "Failed to verify API key"
                                        }
                                    } else {
                                        keyError = "Provider not found. Open Provider settings to configure."
                                    }
                                    keyUpdating = false
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

/** The card's own label over its advice, named for a test to hold. */
internal const val WHAT_TO_DO: String = "What to do"

private class FailureAction(val label: String, val tone: PillTone, val run: () -> Unit)

/** The status the provider answered with, as a small tinted tag. */
@Composable
private fun StatusTag(status: Int) {
    val colors = AppTheme.colors
    Text(
        text = status.toString(),
        style = MaterialTheme.typography.labelLarge,
        color = colors.danger,
        modifier = Modifier
            .background(colors.danger.copy(alpha = 0.12f), AppRadii.pill)
            .padding(horizontal = 9.dp, vertical = 3.dp),
    )
}

/**
 * The one sentence a failure reads as in the accessibility tree. Kept a function
 * so the announcement cannot drift from the card's visible parts.
 */
internal fun failureAnnouncement(card: FailureCard): String =
    "${card.title}. ${card.detail} ${card.advice}"

/**
 * What a failure card's Retry would run, or null when it must not offer one.
 *
 * Two rules, both about not lying to the reader:
 *
 *  - the request is the last one the person made at or before this failure, and
 *    only if it can be said again unchanged (a message with an attachment would
 *    either lose the file or leak a computer-local path);
 *  - nothing newer has been asked since. A card from three turns ago must not
 *    offer to run what came after it — that is a different request, and its own
 *    turn may well have answered it already.
 */
object RetryPlan {
    fun sourceFor(messages: List<Message>, cardId: String): Message? {
        val index = messages.indexOfFirst { it.id == cardId }
        if (index < 0) return null
        if (messages.drop(index + 1).any { it.role == Message.Role.USER }) return null
        return messages.take(index + 1)
            .asReversed()
            .firstOrNull { MessageActions.editableText(it) != null }
    }
}

/** Error severity levels adhering to MOBOT's visual hierarchy. */
enum class ErrorSeverity {
    INFO,
    WARNING,
    RECOVERABLE,
    BLOCKING,
}

object ErrorSeverityClassifier {
    fun classify(kind: String, status: Int?): ErrorSeverity = when {
        kind in setOf("auth", "access", "quota", "setup") || (status != null && status in 401..403) ->
            ErrorSeverity.BLOCKING
        kind in setOf("rate_limit", "network", "transient", "timeout") || (status != null && (status == 429 || status in 502..504)) ->
            ErrorSeverity.RECOVERABLE
        kind in setOf("model_unavailable", "invalid_request") ->
            ErrorSeverity.WARNING
        else ->
            ErrorSeverity.WARNING
    }
}

/**
 * A dedicated recovery card reflecting MOBOT's real orchestration recovery behavior:
 * - Recovering: "Recovering · MOBOT is retrying the failed step."
 * - Recovered: "Recovered · The task resumed."
 * - Recovery failed: "Recovery failed · The task could not continue automatically."
 */
enum class RecoveryStatus {
    RECOVERING,
    RECOVERED,
    FAILED,
}

private data class RecoveryConfig(
    val title: String,
    val detail: String,
    val tint: androidx.compose.ui.graphics.Color,
    val border: androidx.compose.ui.graphics.Color,
)

@Composable
fun RecoveryCard(
    status: RecoveryStatus,
    modifier: Modifier = Modifier,
    stepDescription: String? = null,
    onRetry: (() -> Unit)? = null,
) {
    val colors = AppTheme.colors
    val config = when (status) {
        RecoveryStatus.RECOVERING -> RecoveryConfig(
            title = "Recovering",
            detail = stepDescription ?: "MOBOT is retrying the failed step.",
            tint = colors.accent,
            border = colors.accent.copy(alpha = 0.35f),
        )
        RecoveryStatus.RECOVERED -> RecoveryConfig(
            title = "Recovered",
            detail = stepDescription ?: "The task resumed.",
            tint = colors.complete,
            border = colors.complete.copy(alpha = 0.35f),
        )
        RecoveryStatus.FAILED -> RecoveryConfig(
            title = "Recovery failed",
            detail = stepDescription ?: "The task could not continue automatically.",
            tint = colors.danger,
            border = colors.danger.copy(alpha = 0.35f),
        )
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(AppRadii.compactCardShape)
            .background(colors.elevatedSurface)
            .border(1.dp, config.border, AppRadii.compactCardShape)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            when (status) {
                RecoveryStatus.RECOVERING -> {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = config.tint,
                    )
                }
                RecoveryStatus.RECOVERED -> {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = null,
                        tint = config.tint,
                        modifier = Modifier.size(16.dp),
                    )
                }
                RecoveryStatus.FAILED -> {
                    Icon(
                        imageVector = Icons.Filled.Warning,
                        contentDescription = null,
                        tint = config.tint,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            Text(
                text = config.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = colors.textPrimary,
                modifier = Modifier.weight(1f),
            )
        }
        Text(
            text = config.detail,
            style = MaterialTheme.typography.bodySmall,
            color = colors.textSecondary,
        )
        if (status == RecoveryStatus.FAILED && onRetry != null) {
            AppPill(
                text = "Retry step",
                tone = PillTone.Accent,
                onClick = onRetry,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}
