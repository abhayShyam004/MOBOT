package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.CapabilityConfig
import kotlinx.coroutines.launch

/**
 * Phase K: Global Specialized AI Capabilities Screen
 *
 * Dedicated Settings → Models / Capabilities interface for specialized models
 * (Image Generation, Video Generation, Audio Generation, Speech/TTS, Vision, etc.).
 * Global and shared across all bots.
 */

object SpecializedCapabilitiesPresentationRules {
    fun titleFor(id: String): String = when (id) {
        "image_generation" -> "Image Generation"
        "video_generation" -> "Video Generation"
        "audio_generation" -> "Audio Generation"
        "speech_tts" -> "Speech & TTS"
        "music_generation" -> "Music Generation"
        "vision_understanding" -> "Vision Intelligence"
        "video_understanding" -> "Video Intelligence"
        "audio_understanding" -> "Audio Understanding"
        else -> id.replace("_", " ").replaceFirstChar { it.uppercase() }
    }

    fun categoryFor(id: String): String = when (id) {
        "image_generation", "video_generation", "audio_generation", "music_generation" -> "Generation"
        "speech_tts" -> "Speech & Audio"
        else -> "Multimodal Intelligence"
    }

    fun statusBadge(config: CapabilityConfig): Pair<String, Color> {
        return if (!config.enabled) {
            "Disabled" to Color(0xFF6B7280)
        } else if (config.hasApiKey == true || config.provider == "android_local") {
            "Active" to Color(0xFF10B981)
        } else {
            "Needs API Key" to Color(0xFFF59E0B)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpecializedCapabilitiesScreen(onBack: () -> Unit) {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    val colors = AppTheme.colors

    var capabilities by remember { mutableStateOf<List<CapabilityConfig>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var editingCapability by remember { mutableStateOf<CapabilityConfig?>(null) }

    fun reload() {
        scope.launch {
            loading = true
            capabilities = session.capabilities()
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        reload()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .backdrop(motif = BackdropMotif.SETTINGS, band = 180.dp),
    ) {
        // Header with HeaderBackButton and standard typography
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = AppSpacing.xs, end = AppSpacing.gutter, top = AppSpacing.xs, bottom = AppSpacing.md),
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HeaderBackButton(onBack)
            Text(
                text = "Specialized capabilities",
                style = MaterialTheme.typography.headlineSmall,
                color = colors.textPrimary,
            )
        }

        if (loading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = colors.accent)
            }
        } else {
            val categories = remember(capabilities) {
                capabilities.groupBy { SpecializedCapabilitiesPresentationRules.categoryFor(it.id) }
            }

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = AppSpacing.gutter)
                    .padding(bottom = 48.dp),
                verticalArrangement = Arrangement.spacedBy(AppSpacing.lg),
            ) {
                categories.forEach { (catName, items) ->
                    AppSectionHeader(text = catName)

                    Column(verticalArrangement = Arrangement.spacedBy(AppSpacing.sm)) {
                        items.forEach { cap ->
                            CapabilityCard(
                                config = cap,
                                onToggle = { enabled ->
                                    scope.launch {
                                        session.updateCapability(
                                            id = cap.id,
                                            enabled = enabled,
                                            provider = cap.provider,
                                            model = cap.model,
                                        )
                                        reload()
                                    }
                                },
                                onConfigure = {
                                    editingCapability = cap
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    // Edit Capability Dialog wrapped in BasicAlertDialog + AppCard
    editingCapability?.let { cap ->
        var modelText by remember { mutableStateOf(cap.model) }
        var keyText by remember { mutableStateOf("") }
        var providerText by remember { mutableStateOf(cap.provider) }

        BasicAlertDialog(onDismissRequest = { editingCapability = null }) {
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
                        text = "Configure ${SpecializedCapabilitiesPresentationRules.titleFor(cap.id)}",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = colors.textPrimary,
                    )
                    Text(
                        text = "Set the model provider, model ID, and optional API key override for this capability.",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                    AppTextField(
                        value = providerText,
                        onValueChange = { providerText = it },
                        label = "Provider",
                        modifier = Modifier.fillMaxWidth(),
                    )
                    AppTextField(
                        value = modelText,
                        onValueChange = { modelText = it },
                        label = "Model ID",
                        modifier = Modifier.fillMaxWidth(),
                    )
                    AppTextField(
                        value = keyText,
                        onValueChange = { keyText = it },
                        label = if (cap.hasApiKey == true) "API Key (leave blank to keep current)" else "API Key",
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = { editingCapability = null }) {
                            Text("Cancel", color = colors.textSecondary)
                        }
                        Spacer(modifier = Modifier.width(AppSpacing.sm))
                        AppPill(
                            text = "Save",
                            tone = PillTone.Accent,
                            onClick = {
                                scope.launch {
                                    session.updateCapability(
                                        id = cap.id,
                                        enabled = cap.enabled,
                                        provider = providerText.trim(),
                                        model = modelText.trim(),
                                        apiKey = keyText.trim().ifEmpty { null },
                                    )
                                    editingCapability = null
                                    reload()
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CapabilityCard(
    config: CapabilityConfig,
    onToggle: (Boolean) -> Unit,
    onConfigure: () -> Unit,
) {
    val colors = AppTheme.colors
    val (statusLabel, statusColor) = SpecializedCapabilitiesPresentationRules.statusBadge(config)

    AppCard(
        modifier = Modifier.fillMaxWidth(),
        shape = AppRadii.cardShape,
        bordered = true,
        contentPadding = PaddingValues(AppSpacing.md),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(AppSpacing.sm)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = SpecializedCapabilitiesPresentationRules.titleFor(config.id),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = colors.textPrimary,
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = "${config.provider} / ${config.model.ifEmpty { "default" }}",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(AppRadii.pill)
                                .background(statusColor.copy(alpha = 0.12f))
                                .padding(horizontal = 7.dp, vertical = 2.dp),
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            AppStatusDot(color = statusColor, size = 6.dp)
                            Text(
                                text = statusLabel,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                color = statusColor,
                            )
                        }
                    }
                }

                Switch(
                    checked = config.enabled,
                    onCheckedChange = onToggle,
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                AppPill(
                    text = "Configure",
                    tone = PillTone.Raised,
                    onClick = onConfigure,
                )
            }
        }
    }
}
