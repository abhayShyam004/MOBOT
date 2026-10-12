package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Instance
import com.openmausbot.companion.core.ModelOption
import com.openmausbot.companion.core.ModelSelection

/**
 * One model, as the chooser offers it: what to call it, who runs it, and what it
 * can do — never its internal id or the endpoint behind it.
 */
internal data class SelectableModel(
    val instanceId: String,
    val providerName: String,
    val modelId: String,
    val label: String,
    /** "Vision · Reasoning", or empty when the engine reports nothing about itself. */
    val capabilities: String,
    val current: Boolean,
    val contextWindow: Long? = null,
    val upstreamProvider: String? = null,
)

/**
 * What the page draws: the models of the one provider being browsed.
 *
 * It used to draw every provider's models too, split into "Other models" under
 * the ones you asked for — which answered a question nobody had asked. The
 * provider is chosen in the row above this page, so this page is that
 * provider's catalog and nothing else; a list of somebody else's models is a
 * decision offered twice, in two places.
 */

/**
 * The choosing half of the model page, as rules.
 *
 * The phone is shown the catalog and asked one question — which model — so what
 * this decides is which models are offered, what each one says about itself, and
 * which single provider is being browsed. Provider identity, key state and
 * runtime availability are stated where they belong (Model providers); here they
 * are only ever the reason a row exists or does not.
 */
internal object ModelSelectorSpec {
    /** The capability line: only facts the engine actually reported. */
    fun capabilities(instance: Instance?): String {
        val caps = instance?.capabilities ?: return ""
        val out = mutableListOf<String>()
        if (caps.images == true) out += "Vision"
        if (caps.effortLevels?.any { it.isNotEmpty() } == true) out += "Reasoning"
        if (caps.queueing == true) out += "Steering"
        return out.joinToString(" · ")
    }

    /**
     * Every model one provider offers: its default first, then the catalog, then
     * the selection when the catalog has stopped carrying it — the same order
     * [ModelRules.modelChoices] has always used, so the two lists cannot disagree.
     */
    fun modelsOf(instance: Instance, selection: ModelSelection): List<ModelOption> {
        val seen = mutableSetOf<String>()
        val out = mutableListOf<ModelOption>()
        val default = instance.models.defaultModel
        if (default.isNotEmpty() && seen.add(default)) {
            val label = instance.models.options.firstOrNull { it.id == default }?.label ?: default
            out += ModelOption(default, label)
        }
        for (option in instance.models.options) {
            if (seen.add(option.id)) out += option
        }
        if (instance.instanceId == selection.instanceId && selection.model.isNotEmpty() && seen.add(selection.model)) {
            out += ModelOption(selection.model, selection.model)
        }
        return out
    }

    /** Instant filtering: the model's name, or the provider's. */
    fun matches(query: String, model: SelectableModel): Boolean {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return true
        return model.label.contains(trimmed, ignoreCase = true) ||
            model.providerName.contains(trimmed, ignoreCase = true)
    }

    /**
     * The models this page offers: the catalog of the provider the bot is on,
     * filtered by the search — and only that provider's. An unavailable or
     * unknown provider offers nothing, which is what the empty state says.
     */
    fun listing(
        instances: List<Instance>,
        selection: ModelSelection,
        query: String = "",
    ): List<SelectableModel> {
        val provider = instances.firstOrNull { it.instanceId == selection.instanceId }
            ?.takeIf { it.snapshot.isAvailable }
            ?: return emptyList()
        return rowsOf(provider, selection).filter { matches(query, it) }
    }

    /** One provider's catalog, in the order [ModelRules.modelChoices] uses. */
    private fun rowsOf(instance: Instance, selection: ModelSelection): List<SelectableModel> {
        val capabilities = capabilities(instance)
        return modelsOf(instance, selection).map { option ->
            SelectableModel(
                instanceId = instance.instanceId,
                providerName = ModelProvidersRules.displayName(instance),
                modelId = option.id,
                label = option.label,
                capabilities = capabilities,
                current = instance.instanceId == selection.instanceId && option.id == selection.model,
                contextWindow = option.contextWindow,
                upstreamProvider = option.provider,
            )
        }
    }

    /** True when [provider] is the one this page is browsing. */
    fun providerName(instances: List<Instance>, selection: ModelSelection): String =
        instances.firstOrNull { it.instanceId == selection.instanceId }
            ?.let { ModelProvidersRules.displayName(it) }
            .orEmpty()

    /**
     * What choosing a row sets: the model, with the reasoning level kept when the
     * provider did not change — a level belongs to an engine, and switching engines
     * must not carry one the new one never offered.
     */
    fun pick(
        selection: ModelSelection,
        model: SelectableModel,
        instances: List<Instance>,
    ): ModelSelection {
        if (model.instanceId != selection.instanceId) {
            return ModelSelection(instanceId = model.instanceId, model = model.modelId, effort = null)
        }
        val offered = instances.firstOrNull { it.instanceId == model.instanceId }
            ?.let { ModelRules.effortLevels(it) }
            .orEmpty()
        return ModelSelection(
            instanceId = model.instanceId,
            model = model.modelId,
            effort = selection.effort?.takeIf { it in offered },
        )
    }

    /** The name to print for a model id, falling back to the id the catalog lost. */
    fun labelFor(instance: Instance?, modelId: String): String {
        if (instance == null) return modelId
        return instance.models.options.firstOrNull { it.id == modelId }?.label
            ?: instance.models.defaultModel.takeIf { it == modelId }
            ?: modelId
    }
}

/**
 * Choosing a model.
 *
 * One question, asked once: which model should answer. The provider was already
 * chosen — the dropdown that owns it sits in the settings this page opens from —
 * so the page is the models of that provider, in the same shape as everything
 * else that is choosable here: a card per model, a name, and what the engine says
 * it can do. Search crosses providers, because a model you can name is a model you
 * should not have to find by first remembering whose it is.
 *
 * A page inside the bot settings sheet and not a second sheet on top of it: this
 * is a step of that screen's work, and a sheet over a sheet is a stack a person
 * has to unwind twice.
 *
 * The provider is not chosen here — it is the row this page opens from — so
 * everything below the search is that one provider's own catalog.
 */
@Composable
internal fun ModelSelectorPage(
    botName: String,
    instances: List<Instance>,
    selection: ModelSelection,
    onPick: (ModelSelection) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val models = remember(instances, selection, query) {
        ModelSelectorSpec.listing(instances, selection, query)
    }
    val providerName = remember(instances, selection) {
        ModelSelectorSpec.providerName(instances, selection)
    }
    val searched = query.isNotBlank()

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = AppSpacing.gutter),
        verticalArrangement = Arrangement.spacedBy(AppSpacing.md),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
        ) {
            HeaderBackButton(onBack = onBack)
            Text(
                text = "Select model",
                style = MaterialTheme.typography.displaySmall,
                color = AppTheme.colors.textPrimary,
            )
        }
        val currentInstance = remember(instances, selection) {
            instances.firstOrNull { it.instanceId == selection.instanceId }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
        ) {
            currentInstance?.let { ProviderMark(it, size = 24.dp) }
            Text(
                text = if (providerName.isEmpty()) {
                    "The model that answers for $botName."
                } else {
                    "The model that answers for $botName on $providerName."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = AppTheme.colors.textSecondary,
            )
        }

        ModelSearchField(query = query, onQuery = { query = it })

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
            contentPadding = PaddingValues(bottom = AppSpacing.xl),
        ) {
            if (models.isEmpty()) {
                item(key = "empty") {
                    AppEmptyState(
                        title = if (searched) "No model matches" else "Nothing to choose from",
                        message = if (searched) {
                            "No model matches “$query”."
                        } else if (providerName.isNotEmpty()) {
                            "$providerName offers no model right now."
                        } else {
                            ModelRules.NONE_AVAILABLE
                        },
                    )
                }
            }

            items(models, key = { "${it.instanceId}-${it.modelId}" }) { model ->
                ModelCard(
                    model = model,
                    showProvider = false,
                    onClick = { onPick(ModelSelectorSpec.pick(selection, model, instances)) },
                )
            }
        }
    }
}

/**
 * One model, as a card.
 *
 * A card and not a bare line because every row here is a choice: the surface is
 * what says so, and the one already in use says it a second way, with a tinted
 * surface and a check. [showProvider] is off inside the browsed provider's own
 * list, where naming the provider on every row is the same word forty times.
 */
@Composable
private fun ModelCard(model: SelectableModel, showProvider: Boolean, onClick: () -> Unit) {
    val colors = AppTheme.colors
    AppCard(
        shape = AppRadii.rowShape,
        color = if (model.current) colors.selected else colors.surface,
        bordered = !model.current,
        contentPadding = PaddingValues(horizontal = AppSpacing.md, vertical = AppSpacing.md),
        modifier = Modifier
            .fillMaxWidth()
            .clip(AppRadii.rowShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = "Choose ${model.label}" },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = model.label,
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val contextStr = model.contextWindow?.let { tokens ->
                    when {
                        tokens >= 1_000_000 -> "${tokens / 1_000_000}M context"
                        tokens >= 1_000 -> "${tokens / 1_000}k context"
                        else -> "$tokens context"
                    }
                }
                val detail = listOfNotNull(
                    model.providerName.takeIf { showProvider },
                    model.upstreamProvider?.takeIf { it.isNotEmpty() },
                    contextStr,
                    model.capabilities.takeIf { it.isNotEmpty() },
                ).joinToString(" · ")
                if (detail.isNotEmpty()) {
                    Text(
                        text = detail,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (model.current) {
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = null,
                    tint = colors.accent,
                    modifier = Modifier.size(AppSizes.glyph),
                )
            }
        }
    }
}

/** The field that filters the catalog: one visible pill, no label above it. */
@Composable
private fun ModelSearchField(query: String, onQuery: (String) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(MIN_TOUCH_TARGET)
            .clip(AppRadii.pill)
            .background(AppTheme.colors.surface)
            .border(1.dp, AppTheme.colors.hairline, AppRadii.pill)
            .padding(horizontal = AppSpacing.lg),
        horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Filled.Search,
            contentDescription = null,
            tint = AppTheme.colors.textTertiary,
            modifier = Modifier.size(18.dp),
        )
        Box(modifier = Modifier.weight(1f)) {
            if (query.isEmpty()) {
                Text(
                    text = "Search models",
                    style = MaterialTheme.typography.bodyMedium,
                    color = AppTheme.colors.textTertiary,
                )
            }
            BasicTextField(
                value = query,
                onValueChange = onQuery,
                singleLine = true,
                textStyle = LocalTextStyle.current.copy(
                    fontSize = 16.sp,
                    color = AppTheme.colors.textPrimary,
                ),
                cursorBrush = SolidColor(AppTheme.colors.accent),
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = "Search models" },
            )
        }
    }
}

/**
 * One provider the picker offers: its name, whether it can run anything, and
 * whether it is the one the bot is on.
 */
internal data class SelectableProvider(
    val instanceId: String,
    val name: String,
    val available: Boolean,
    val selected: Boolean,
    /** The catalog entry itself, so the row can draw the provider's mark. */
    val instance: Instance,
)

/** The provider page's rows, as rules — pinned without a sheet. */
internal object ProviderSelectorSpec {
    /**
     * The providers offered: exactly what [ModelRules.instanceChoices] offers,
     * because the row above this page and the page itself must never disagree —
     * a provider the settings list would show as unavailable must not be
     * quietly tappable one step deeper.
     */
    fun rows(instances: List<Instance>, selectedInstanceId: String): List<SelectableProvider> =
        ModelRules.instanceChoices(instances, ModelSelection(selectedInstanceId, ""))
            .map { instance ->
                SelectableProvider(
                    instanceId = instance.instanceId,
                    name = ModelProvidersRules.displayName(instance),
                    available = instance.snapshot.isAvailable,
                    selected = instance.instanceId == selectedInstanceId,
                    instance = instance,
                )
            }
}

/**
 * The row a bot's settings shows for the provider in use: the mark, the name,
 * and the way to change it.
 *
 * It used to be a dropdown — a closed field listing engines nobody asked to
 * see, taking a third of the section before anyone had chosen anything. What a
 * person needs from it standing still is one fact (which provider is answering
 * for this bot) and one door (change it); a row states the fact and the door
 * keeps the words "Select provider", so the field is only ever a field when
 * someone is using it.
 */
@Composable
internal fun ProviderSummaryRow(
    instance: Instance?,
    loaded: Boolean,
    onClick: () -> Unit,
) {
    val colors = AppTheme.colors
    val name = when {
        !loaded -> ModelRules.LOADING
        instance == null -> ModelRules.NO_PROVIDER
        else -> ModelRules.instanceLabel(instance)
    }

    AppCard(
        shape = AppRadii.rowShape,
        contentPadding = PaddingValues(AppSpacing.md),
        modifier = Modifier
            .fillMaxWidth()
            .clip(AppRadii.rowShape)
            .clickable(enabled = loaded, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = "Select provider" },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (instance != null) {
                ProviderMark(instance = instance, size = 38.dp)
            }
            Text(
                text = name,
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            SelectAffordance("Select provider")
        }
    }
}

/**
 * The row a bot's settings shows for the model in use: what this bot runs, and
 * the way to change it — the provider having a row of its own directly above.
 */
@Composable
internal fun ModelSummaryRow(
    instance: Instance?,
    selection: ModelSelection,
    loaded: Boolean,
    onClick: () -> Unit,
) {
    val colors = AppTheme.colors
    val label = if (loaded) {
        ModelSelectorSpec.labelFor(instance, selection.model).ifEmpty { "No model chosen" }
    } else {
        ModelRules.LOADING
    }
    val detail = instance?.let { ModelSelectorSpec.capabilities(it) }.orEmpty()

    AppCard(
        shape = AppRadii.rowShape,
        contentPadding = PaddingValues(AppSpacing.md),
        modifier = Modifier
            .fillMaxWidth()
            .clip(AppRadii.rowShape)
            .clickable(enabled = loaded, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = "Select model" },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (detail.isNotEmpty()) {
                    Text(
                        text = detail,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            SelectAffordance("Select model")
        }
    }
}

/**
 * The small caption that says what a row will do — the words on the right of
 * both summary rows. Deliberately not a button: the whole row is the target,
 * and a second button inside it would say the same thing twice.
 */
@Composable
private fun SelectAffordance(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = AppTheme.colors.textTertiary,
        maxLines = 1,
    )
}

/**
 * Choosing the provider.
 *
 * The same shape as the model page it sits beside — one question, one list, one
 * back — because these are the two halves of one decision and a person moves
 * between them while making it. The unavailable provider the bot is already on
 * is listed (greyed, unselectable) rather than hidden: the bot's own setting
 * must be readable even when the thing it names is broken.
 */
@Composable
internal fun ProviderSelectorPage(
    botName: String,
    instances: List<Instance>,
    selectedInstanceId: String,
    onPick: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val rows = remember(instances, selectedInstanceId) {
        ProviderSelectorSpec.rows(instances, selectedInstanceId)
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = AppSpacing.gutter),
        verticalArrangement = Arrangement.spacedBy(AppSpacing.md),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
        ) {
            HeaderBackButton(onBack = onBack)
            Text(
                text = "Select provider",
                style = MaterialTheme.typography.displaySmall,
                color = AppTheme.colors.textPrimary,
            )
        }
        Text(
            text = "The engine that runs $botName's model.",
            style = MaterialTheme.typography.bodyMedium,
            color = AppTheme.colors.textSecondary,
        )

        if (rows.isEmpty()) {
            AppEmptyState(
                title = "No providers yet",
                message = ModelRules.NONE_AVAILABLE,
            )
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                contentPadding = PaddingValues(bottom = AppSpacing.xl),
            ) {
                items(rows, key = { it.instanceId }) { row ->
                    ProviderChoiceCard(
                        provider = row,
                        onClick = { if (row.available && !row.selected) onPick(row.instanceId) },
                    )
                }
            }
        }
    }
}

/** One provider, as a choice. */
@Composable
private fun ProviderChoiceCard(provider: SelectableProvider, onClick: () -> Unit) {
    val colors = AppTheme.colors
    AppCard(
        shape = AppRadii.rowShape,
        color = if (provider.selected) colors.selected else colors.surface,
        bordered = !provider.selected,
        contentPadding = PaddingValues(AppSpacing.md),
        modifier = Modifier
            .fillMaxWidth()
            .clip(AppRadii.rowShape)
            .clickable(enabled = provider.available, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = "Choose ${provider.name}" },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ProviderMark(instance = provider.instance, size = 38.dp)
            Text(
                text = provider.name,
                style = MaterialTheme.typography.titleMedium,
                color = if (provider.available) colors.textPrimary else colors.textTertiary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (!provider.available) {
                Text(
                    text = "Unavailable",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.textTertiary,
                    maxLines = 1,
                )
            }
            if (provider.selected) {
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = null,
                    tint = colors.accent,
                    modifier = Modifier.size(AppSizes.glyph),
                )
            }
        }
    }
}

/** A back chevron for a page that is a step inside a sheet. */
@Composable
private fun HeaderBackButton(onBack: () -> Unit) {
    Box(
        modifier = Modifier
            .size(MIN_TOUCH_TARGET)
            .clip(CircleShape)
            .clickable(role = Role.Button, onClick = onBack)
            .semantics { contentDescription = "Back to bot settings" },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = null,
            tint = AppTheme.colors.textSecondary,
            modifier = Modifier.size(22.dp),
        )
    }
}
