package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Instance
import com.openmausbot.companion.core.ModelSelection
import kotlinx.coroutines.launch

/**
 * Creating a bot as one deliberate configuration — the counterpart of
 * [NewGroupSheet] for a single agent.
 *
 * The sheet collects the whole opening configuration up front: name, role,
 * persona, provider and model. Create sends all of it in one atomic request,
 * so there is never a half-configured bot to repair afterwards. A blank name
 * is left to the host, which picks from its own curated list; provider and
 * model rows come from the live catalog, and the workspace default is the
 * row that is pre-selected.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NewBotSheet(
    onCreated: (com.openmausbot.companion.core.Bot) -> Unit,
    onDismiss: () -> Unit,
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()

    var name by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("") }
    var persona by rememberSaveable { mutableStateOf("") }
    var instances by remember { mutableStateOf<List<Instance>>(emptyList()) }
    var modelsLoaded by remember { mutableStateOf(false) }
    var modelsFailed by remember { mutableStateOf<String?>(null) }
    var selectedInstanceId by rememberSaveable { mutableStateOf("") }
    var selectedModelId by rememberSaveable { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }

    // The workspace default, resolved once the catalog lands: the first
    // available provider, at its own default model. The sheet opens with it
    // selected so Create works with zero extra taps.
    val defaultSelection = remember(instances) { NewBotRules.defaultChoice(instances) }

    LaunchedEffect(Unit) {
        try {
            instances = session.modelInstances()
            modelsFailed = if (instances.isEmpty()) "No model providers are configured yet." else null
        } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            modelsFailed = error.message ?: "Models could not be loaded."
        }
        modelsLoaded = true
        if (selectedInstanceId.isEmpty()) {
            defaultSelection?.let { (instance, model) ->
                selectedInstanceId = instance.instanceId
                selectedModelId = model
            }
        }
    }

    val selection = NewBotRules.selection(selectedInstanceId, selectedModelId, instances)
    val canCreate = NewBotRules.canCreate(creating, modelsLoaded, selection)

    ModalBottomSheet(onDismissRequest = { if (!creating) onDismiss() }) {
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
                TextButton(
                    onClick = onDismiss,
                    enabled = !creating,
                    modifier = Modifier.align(Alignment.CenterStart),
                ) { Text("Cancel") }
                Text(
                    text = "New chat",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.align(Alignment.Center),
                )
                TextButton(
                    onClick = {
                        creating = true
                        scope.launch {
                            val bot = session.createBot(
                                name = name.trim().ifEmpty { null },
                                model = selection,
                                title = role.trim().ifEmpty { null },
                                description = persona.trim().ifEmpty { null },
                            )
                            // A failure leaves the sheet open with the fields
                            // intact; `Session` raises the error dialog itself.
                            if (bot != null) {
                                haptics.play(TactileAction.CREATE_BOT_SUCCESS)
                                onCreated(bot)
                            }
                            creating = false
                        }
                    },
                    enabled = canCreate,
                    modifier = Modifier.align(Alignment.CenterEnd),
                ) { Text("Create") }
            }

            AppTextField(
                value = name,
                onValueChange = { name = it },
                label = "Name",
                placeholder = "Scout, Atlas, Mochi…",
                helper = "Optional. The computer picks a name when this is blank.",
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            )
            AppTextField(
                value = role,
                onValueChange = { role = it },
                label = "Role",
                placeholder = "Researcher, coder, travel planner…",
                helper = "Optional. Shows beside the name in the roster.",
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            )
            AppTextField(
                value = persona,
                onValueChange = { persona = it },
                label = "Context",
                placeholder = "What this agent should know or do",
                singleLine = false,
                minLines = 2,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            )

            AppSectionHeader("Provider & model")

            when {
                !modelsLoaded -> {
                    Text(
                        text = "Loading models",
                        fontSize = 13.sp,
                        color = secondaryTint,
                        modifier = Modifier.padding(horizontal = 20.dp),
                    )
                }
                instances.isEmpty() -> {
                    Text(
                        text = modelsFailed ?: "No model providers are configured yet.",
                        fontSize = 13.sp,
                        color = secondaryTint,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                    )
                    Text(
                        text = "Add one under Settings → Model providers, then come back.",
                        fontSize = 13.sp,
                        color = secondaryTint,
                        modifier = Modifier.padding(horizontal = 20.dp),
                    )
                }
                else -> {
                    val usable = NewBotRules.usableInstances(instances)
                    if (usable.isEmpty()) {
                        Text(
                            text = "No model providers are usable yet.",
                            fontSize = 13.sp,
                            color = secondaryTint,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                        )
                        Text(
                            text = "Configure one under Settings → Model providers, then come back.",
                            fontSize = 13.sp,
                            color = secondaryTint,
                            modifier = Modifier.padding(horizontal = 20.dp),
                        )
                    } else {
                        LazyColumn(modifier = Modifier.heightIn(max = 320.dp)) {
                            items(usable, key = { it.instanceId }) { instance ->
                                ProviderModelRow(
                                    instance = instance,
                                    selected = instance.instanceId == selectedInstanceId,
                                    selectedModelId = selectedModelId,
                                    onPick = { modelId ->
                                        selectedInstanceId = instance.instanceId
                                        selectedModelId = modelId
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProviderModelRow(
    instance: Instance,
    selected: Boolean,
    selectedModelId: String,
    onPick: (String) -> Unit,
) {
    val choices = ModelRules.modelChoices(instance, selectedModelId)
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // The engine is named here to pick a model from it, so it carries
            // the mark every other screen names a provider with: a provider
            // someone recognises as a picture before they read the words.
            ProviderMark(instance = instance, size = 26.dp)
            Text(
                text = ModelRules.instanceLabel(instance),
                style = MaterialTheme.typography.titleSmall,
                color = AppTheme.colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (choices.isEmpty()) {
            Text(
                text = "No models listed",
                style = MaterialTheme.typography.bodySmall,
                color = AppTheme.colors.textTertiary,
            )
        } else {
            // A chip per model, the chosen one filled: a column of radio buttons
            // is a form, and picking a model is the one choice this sheet is for.
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
            ) {
                choices.forEach { choice ->
                    val chosen = selected && choice.id == selectedModelId
                    AppPill(
                        text = choice.label,
                        onClick = { onPick(choice.id) },
                        tone = if (chosen) PillTone.Accent else PillTone.Raised,
                    )
                }
            }
        }
    }
}

/**
 * The creation rules, so the sheet stays a drawing and the decisions stay
 * testable: what counts as a valid opening selection and when Create may fire.
 */
object NewBotRules {
    data class Choice(val instance: Instance, val model: String)

    /**
     * The providers and models that are genuinely usable in the current configuration.
     * Unavailable engines or engines with empty catalogs are excluded from New Chat.
     */
    fun usableInstances(instances: List<Instance>): List<Instance> =
        instances.filter { it.snapshot.isAvailable && (it.models.defaultModel.isNotEmpty() || it.models.options.isNotEmpty()) }

    /**
     * The row the sheet opens with: the first usable provider at its own
     * default model, or null when no provider is usable — in which case the
     * sheet says so instead of offering a dead Create.
     */
    fun defaultChoice(instances: List<Instance>): Choice? =
        usableInstances(instances).firstOrNull()
            ?.let { Choice(it, it.models.defaultModel) }

    /**
     * The selection Create sends, or null to follow the workspace default:
     * a provider that is not available can never be sent, and a model the
     * chosen provider does not offer cannot either.
     */
    fun selection(instanceId: String, modelId: String, instances: List<Instance>): ModelSelection? {
        if (instanceId.isEmpty()) return null
        val instance = instances.firstOrNull { it.instanceId == instanceId } ?: return null
        if (!instance.snapshot.isAvailable) return null
        val offered = instance.models.defaultModel == modelId ||
            instance.models.options.any { it.id == modelId }
        if (!offered) return null
        return ModelSelection(instanceId = instanceId, model = modelId)
    }

    /** Create lights when the sheet has loaded; a null selection follows the
     * workspace default, and a failed provider choice is answered honestly by
     * the server rather than guessed at here. */
    fun canCreate(creating: Boolean, modelsLoaded: Boolean, selection: ModelSelection?): Boolean =
        !creating && modelsLoaded
}
