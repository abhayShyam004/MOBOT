package com.openmausbot.companion.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Checkbox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.openmausbot.companion.R
import com.openmausbot.companion.avatar.AvatarImagePicker
import com.openmausbot.companion.avatar.AvatarImageRules
import com.openmausbot.companion.avatar.PreparedAvatar
import com.openmausbot.companion.core.AvatarCrop
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.BotMcpSelection
import com.openmausbot.companion.core.forTask
import com.openmausbot.companion.core.BotProfilePatch
import com.openmausbot.companion.core.ConfigStatus
import com.openmausbot.companion.core.Instance
import com.openmausbot.companion.core.McpServerListing
import com.openmausbot.companion.core.ModelSelection
import com.openmausbot.companion.core.Voice
import com.openmausbot.companion.core.VoiceProvider
import com.openmausbot.companion.core.isConnectedAppsAllowed
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The paired-safe subset of bot settings — the port of
 * `ios/App/AgentProfileView.swift`.
 *
 * The model, identity, avatar, notifications and the renderer-neutral voice
 * choice. Shared provider keys stay on the computer: this sheet sees the model
 * catalog and configured / not configured, and offers no field that could
 * carry a key.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AgentProfileSheet(
    bot: Bot,
    onDismiss: () -> Unit,
    onOpenOverview: (String) -> Unit,
    onOpenMemory: (String) -> Unit = {},
    /**
     * Open straight onto the model list. A failed turn's "Change model" lands
     * here, where the same Apply button and the same busy/loaded gates already
     * live — a second, thinner picker inside the chat would be a second place
     * for a model change to happen, and the two would drift.
     */
    openModelPicker: Boolean = false,
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val state by session.state.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val player = environment.voicePreview

    // The record the sheet was opened on, so the form has an origin even after
    // the fleet drops the agent; `current` is what every action is applied to.
    val opened = remember { bot }
    val current = state.bot(opened.id) ?: opened
    val currentTask = current.forTask(opened.threadId)

    var form by rememberSaveable(stateSaver = ProfileFormSaver) {
        mutableStateOf(ProfileForm.of(opened))
    }
    var baseline by rememberSaveable(stateSaver = ProfileFormSaver) {
        mutableStateOf(ProfileForm.of(opened))
    }
    var prompt by rememberSaveable { mutableStateOf("") }
    var voices by remember { mutableStateOf<List<Voice>>(emptyList()) }
    var config by remember { mutableStateOf<ConfigStatus?>(null) }
    var busy by remember { mutableStateOf(false) }
    var switchingEngine by remember { mutableStateOf(false) }

    // The Model section. The draft survives rotation; the catalog is reloaded.
    var instances by remember { mutableStateOf<List<Instance>>(emptyList()) }
    var modelsLoaded by remember { mutableStateOf(false) }
    var savedModel by remember { mutableStateOf(opened.modelSelection) }
    var selectedInstanceId by rememberSaveable { mutableStateOf(opened.modelSelection.instanceId) }
    var selectedModelId by rememberSaveable { mutableStateOf(opened.modelSelection.model) }
    // "" is the engine default; the picker has no null row.
    var selectedEffort by rememberSaveable { mutableStateOf(opened.modelSelection.effort.orEmpty()) }
    // The selector is a page of this sheet rather than a sheet of its own.
    var selectingModel by rememberSaveable { mutableStateOf(openModelPicker) }
    // …and so is the provider picker: the two halves of one decision.
    var selectingProvider by rememberSaveable { mutableStateOf(false) }
    val selectedInstance = instances.firstOrNull { it.instanceId == selectedInstanceId }
    val modelDraft = ModelSelection(selectedInstanceId, selectedModelId, selectedEffort.ifEmpty { null })

    fun liveBot(): Bot = session.state.value.bot(opened.id) ?: opened

    fun showModel(selection: ModelSelection) {
        selectedInstanceId = selection.instanceId
        selectedModelId = selection.model
        selectedEffort = selection.effort.orEmpty()
    }

    LaunchedEffect(Unit) {
        val loaded = coroutineScope {
            val status = async { session.configStatus() }
            val options = async { session.voiceOptions() }
            val catalog = async { session.modelInstances() }
            Triple(status.await(), options.await(), catalog.await())
        }
        config = loaded.first
        voices = loaded.second
        instances = loaded.third
        modelsLoaded = true
        // A stored "speak replies" that nothing can speak is turned off before
        // the toggle is ever drawn.
        form = ProfileRules.applyLoadedConfig(form, loaded.first)
    }

    // One preview at a time, and none that outlives this sheet.
    DisposableEffect(lifecycleOwner) {
        player.bind(lifecycleOwner)
        onDispose { player.unbind(lifecycleOwner) }
    }
    LaunchedEffect(Unit) {
        player.playbackErrors.collect { session.actionError = it }
    }

    val pickImage = rememberLauncherForActivityResult(
        remember { AvatarImagePicker.contract() },
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            busy = true
            try {
                when (val prepared = AvatarImagePicker.read(context.contentResolver, uri)) {
                    is PreparedAvatar.Rejected -> session.actionError = prepared.message
                    is PreparedAvatar.Ready -> {
                        val intended = AvatarImageRules.intendedUploadCrop(form.crop)
                        val updated = session.uploadAvatar(
                            data = prepared.data,
                            mime = prepared.mime,
                            forBot = liveBot(),
                            crop = intended,
                        )
                        if (updated != null) {
                            val crop = updated.avatarCrop ?: intended
                            form = form.copy(crop = crop)
                            baseline = baseline.copy(crop = crop)
                        }
                    }
                }
            } finally {
                busy = false
            }
        }
    }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        if (selectingProvider) {
            ProviderSelectorPage(
                botName = current.name,
                instances = instances,
                selectedInstanceId = selectedInstanceId,
                onPick = { id ->
                    instances.firstOrNull { it.instanceId == id }
                        ?.let { ModelRules.defaultsFor(it, savedModel) }
                        ?.let { showModel(it) }
                    selectingProvider = false
                },
                onBack = { selectingProvider = false },
                modifier = Modifier.padding(bottom = 24.dp),
            )
            return@ModalBottomSheet
        }
        if (selectingModel) {
            // The choosing page replaces the settings body, and its own back
            // returns to it: one step out, not two sheets to unwind.
            ModelSelectorPage(
                botName = current.name,
                instances = instances,
                selection = modelDraft,
                // Picking returns to the settings page rather than closing the
                // sheet: the model is applied there, in one visible place, and a
                // choice that silently took effect would leave the row above it
                // saying something else.
                onPick = {
                    showModel(it)
                    selectingModel = false
                },
                onBack = { selectingModel = false },
                modifier = Modifier.padding(bottom = 24.dp),
            )
            return@ModalBottomSheet
        }
        Box {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier.align(Alignment.CenterStart),
                    ) {
                        Text("Done")
                    }
                    Text(
                        text = "Bot settings",
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.align(Alignment.Center),
                    )
                }

                FormSection(header = null) {
                    ActionRow(
                        text = "Bot overview",
                        icon = Icons.Filled.Info,
                        onClick = { onOpenOverview(bot.id) },
                    )
                    ActionRow(
                        text = "Memory",
                        icon = Icons.Filled.Info,
                        onClick = { onOpenMemory(bot.id) },
                    )
                }

                FormSection(header = "Model", footer = ModelRules.FOOTER) {
                    val instanceChoices = ModelRules.instanceChoices(instances, savedModel)
                    // Which engine runs the model, and which model it runs, are
                    // two facts rather than two fields: each row states what the
                    // bot is on and carries the small caption that opens its own
                    // page. A closed dropdown listed every engine on the host
                    // before anyone had asked to see any of them.
                    ProviderSummaryRow(
                        instance = selectedInstance,
                        loaded = modelsLoaded,
                        onClick = { selectingProvider = true },
                    )
                    ModelSummaryRow(
                        instance = selectedInstance,
                        selection = modelDraft,
                        loaded = modelsLoaded,
                        onClick = { selectingModel = true },
                    )
                    if (modelsLoaded && instanceChoices.isEmpty()) {
                        IconNote(text = ModelRules.NONE_AVAILABLE, icon = Icons.Filled.Warning)
                    } else if (modelsLoaded) {
                        val effortLevels = ModelRules.effortLevels(selectedInstance)
                        if (effortLevels.isNotEmpty()) {
                            ChoicePicker(
                                label = "Reasoning effort",
                                choices = buildList {
                                    add(VoiceChoice(id = "", label = ModelRules.DEFAULT_EFFORT_LABEL, detail = null, enabled = true))
                                    effortLevels.forEach {
                                        add(VoiceChoice(id = it, label = ModelRules.effortLabel(it), detail = null, enabled = true))
                                    }
                                },
                                selected = selectedEffort,
                                onSelect = { selectedEffort = it },
                            )
                        }
                        ModelRules.note(currentTask?.busy, selectedInstance)?.let { note ->
                            IconNote(text = note, icon = Icons.Filled.Info)
                        }
                        ActionRow(
                            text = "Apply model",
                            icon = Icons.Filled.Check,
                            enabled = !busy && currentTask != null && ModelRules.canApply(
                                loaded = modelsLoaded,
                                botBusy = currentTask?.busy,
                                instance = selectedInstance,
                                draft = modelDraft,
                                saved = savedModel,
                            ),
                            onClick = {
                                scope.launch {
                                    busy = true
                                    try {
                                        val target = liveBot().forTask(opened.threadId) ?: return@launch
                                        val updated = session.updateModel(modelDraft, target)
                                        if (updated != null) {
                                            savedModel = updated.modelSelection
                                            showModel(updated.modelSelection)
                                        }
                                    } finally {
                                        busy = false
                                    }
                                }
                            },
                        )
                    }
                }

                FormSection(header = "Avatar", footer = ProfileRules.AVATAR_FOOTER) {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        BotAvatar(
                            // The chosen colour previews live, before saving.
                            bot = current.copy(color = form.color),
                            size = 112.dp,
                            state = MausState.HAPPY,
                            contentDescription = "${current.name} avatar",
                        )
                    }

                    SingleChoiceSegmentedButtonRow(
                        modifier = Modifier.fillMaxWidth().height(MIN_TOUCH_TARGET),
                    ) {
                        AvatarCrop.entries.forEachIndexed { index, option ->
                            SegmentedButton(
                                selected = form.crop == option,
                                onClick = { form = form.copy(crop = option) },
                                shape = SegmentedButtonDefaults.itemShape(
                                    index = index,
                                    count = AvatarCrop.entries.size,
                                ),
                            ) {
                                Text(ProfileRules.cropLabel(option))
                            }
                        }
                    }

                    Text(
                        text = "Colour",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        MausPalette.names.sorted().forEach { name ->
                            val selected = form.color == name
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(Color(MausPalette.argb(name)))
                                    .border(
                                        width = if (selected) 3.dp else 1.dp,
                                        color = if (selected) {
                                            MaterialTheme.colorScheme.onSurface
                                        } else {
                                            MaterialTheme.colorScheme.outlineVariant
                                        },
                                        shape = CircleShape,
                                    )
                                    .selectable(
                                        selected = selected,
                                        role = Role.RadioButton,
                                        onClick = { form = form.copy(color = name) },
                                    )
                                    .semantics { contentDescription = "Colour $name" },
                            )
                        }
                    }

                    ActionRow(
                        text = "Upload image",
                        icon = Icons.Filled.AddCircle,
                        enabled = !busy,
                        onClick = { pickImage.launch(AvatarImagePicker.request()) },
                    )

                    if (current.avatarUrl != null) {
                        ActionRow(
                            text = "Use mascot",
                            icon = Icons.Filled.Delete,
                            enabled = !busy,
                            destructive = true,
                            onClick = {
                                scope.launch {
                                    busy = true
                                    try {
                                        val updated = session.updateProfile(
                                            BotProfilePatch(
                                                avatarUrl = BotProfilePatch.AvatarURL.Clear,
                                                avatarCrop = AvatarCrop.MASCOT,
                                            ),
                                            liveBot(),
                                        )
                                        if (updated != null) {
                                            val crop = updated.avatarCrop ?: AvatarCrop.MASCOT
                                            form = form.copy(crop = crop)
                                            baseline = baseline.copy(crop = crop)
                                        }
                                    } finally {
                                        busy = false
                                    }
                                }
                            },
                        )
                    }
                }

                FormSection(
                    header = "Generate an avatar",
                    footer = ProfileRules.generateFooter(config),
                ) {
                    AppTextField(
                        value = prompt,
                        onValueChange = { prompt = it },
                        label = "Art direction",
                        singleLine = false,
                        minLines = 2,
                        maxLines = 5,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    ActionRow(
                        text = "Generate on computer",
                        painter = R.drawable.ic_sparkles,
                        enabled = ProfileRules.canGenerate(busy, config, prompt),
                        onClick = {
                            scope.launch {
                                busy = true
                                try {
                                    val intended = AvatarImageRules.intendedUploadCrop(form.crop)
                                    val generated = session.generateAvatar(
                                        ProfileRules.generatePrompt(prompt),
                                        liveBot(),
                                    ) ?: return@launch
                                    // Generation picks a safe crop server-side;
                                    // the selector is the user's explicit choice,
                                    // so persist it against the returned
                                    // attachment rather than leaving the two out
                                    // of sync.
                                    val updated = session.updateProfile(
                                        BotProfilePatch(avatarCrop = intended),
                                        generated,
                                    )
                                    val crop = if (updated != null) {
                                        updated.avatarCrop ?: intended
                                    } else {
                                        // Generation itself succeeded: reflect its
                                        // authoritative fallback rather than
                                        // claiming the requested crop was saved.
                                        generated.avatarCrop ?: AvatarCrop.MASCOT
                                    }
                                    form = form.copy(crop = crop)
                                    baseline = baseline.copy(crop = crop)
                                } finally {
                                    busy = false
                                }
                            }
                        },
                    )
                }

                // Which of the host's custom MCP servers this bot sees. The
                // same three states the server defines: every enabled server,
                // none, or an explicit list. Disabled catalog entries stay
                // unmounted either way. The catalog comes from Session's
                // StateFlow, so a change made in Settings re-renders here.
                FormSection(header = "Tools", footer = MCP_TOOLS_FOOTER) {
                    val mcpCatalog by session.mcp.servers.collectAsState()
                    val enabledServers = mcpCatalog.orEmpty().filter { it.enabled }
                    when {
                        mcpCatalog == null -> {
                            IconNote("MCP servers could not be loaded.", Icons.Filled.Warning)
                            ActionRow(
                                text = "Retry",
                                icon = Icons.Filled.Check,
                                enabled = !busy,
                                onClick = { scope.launch { session.mcp.refresh() } },
                            )
                        }
                        enabledServers.isEmpty() -> IconNote(
                            "No MCP servers are enabled. Add and enable them in Settings → MCP servers.",
                            Icons.Filled.Info,
                        )
                        else -> {
                            val selection = current.mcpServers
                            val all = selection == null
                            enabledServers.forEach { server ->
                                val checked = if (all) true else selection.contains(server.name)
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .heightIn(min = MIN_TOUCH_TARGET)
                                        .toggleable(
                                            value = checked,
                                            role = Role.Checkbox,
                                            onValueChange = { on ->
                                                scope.launch {
                                                    busy = true
                                                    try {
                                                        val target = liveBot().forTask(opened.threadId) ?: return@launch
                                                        // A checkbox on an "all" bot starts the explicit
                                                        // list from the currently enabled servers.
                                                        val names = current.mcpServers ?: enabledServers.map { it.name }
                                                        val next = if (on) names + server.name else names - server.name
                                                        session.updateProfile(
                                                            if (next.size == enabledServers.size && enabledServers.all { next.contains(it.name) }) {
                                                                BotMcpSelection.all()
                                                            } else {
                                                                BotMcpSelection.only(next.distinct())
                                                            },
                                                            target,
                                                        )
                                                    } finally {
                                                        busy = false
                                                    }
                                                }
                                            },
                                        ),
                                ) {
                                    Checkbox(checked = checked, onCheckedChange = null)
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(server.name, fontSize = 15.sp)
                                        val detail = if (server.isRemote) {
                                            "${server.type ?: "http"} server"
                                        } else {
                                            (listOfNotNull(server.command) + server.args.orEmpty())
                                                .joinToString(" ")
                                        }
                                        Text(
                                            text = detail,
                                            fontSize = 12.sp,
                                            color = secondaryTint,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                }
                            }
                            // The only unambiguous bulk action: collapse an explicit
                            // list back to "follow all". Unchecking every box one by
                            // one reaches the none state honestly; no misleading
                            // "limit to selected" button on an all-checked list.
                            if (!all) {
                                ActionRow(
                                    text = "Use all enabled servers",
                                    icon = Icons.Filled.Check,
                                    enabled = !busy,
                                    onClick = {
                                        scope.launch {
                                            busy = true
                                            try {
                                                val target = liveBot().forTask(opened.threadId) ?: return@launch
                                                session.updateProfile(BotMcpSelection.all(), target)
                                            } finally {
                                                busy = false
                                            }
                                        }
                                    },
                                )
                            }
                        }
                    }
                }

                // The workspace's connected apps, granted or withheld per bot.
                // The server's gate is `bot.composio !== false`, so absent and
                // true mean the same thing; only an explicit false closes the
                // door. Turning the grant ON needs the host to be configured —
                // turning it OFF never does.
                FormSection(
                    header = "Connected apps",
                    footer = "Connected apps are set up once, for the whole host, in Settings → Connected apps.",
                ) {
                    val configured = config?.composio?.configured == true
                    val allowed = current.isConnectedAppsAllowed()
                    SwitchRow(
                        label = "Allow this bot to use connected apps",
                        checked = allowed,
                        enabled = !busy && (allowed || configured),
                        onCheckedChange = { next ->
                            scope.launch {
                                busy = true
                                try {
                                    session.setBotConnectedApps(current.id, next)
                                } finally {
                                    busy = false
                                }
                            }
                        },
                    )
                    Text(
                        text = when {
                            !configured -> "Connect apps in Settings before giving this bot access."
                            allowed -> "Let this bot use your connected Gmail, Calendar, Slack, and other apps."
                            else -> "Keep your connected apps unavailable to this bot."
                        },
                        fontSize = 12.sp,
                        color = secondaryTint,
                    )
                }

                FormSection(header = "Identity") {
                    AppTextField(
                        value = form.name,
                        onValueChange = { form = form.copy(name = it) },
                        label = "Name",
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Words,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    AppTextField(
                        value = form.title,
                        onValueChange = { form = form.copy(title = it) },
                        label = "Title",
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    AppTextField(
                        value = form.description,
                        onValueChange = { form = form.copy(description = it) },
                        label = "What this agent does",
                        singleLine = false,
                        minLines = 3,
                        maxLines = 8,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    SwitchRow(
                        label = "Agent notifications",
                        checked = form.notifications,
                        onCheckedChange = { form = form.copy(notifications = it) },
                    )
                }

                VoiceSection(
                    config = config,
                    switching = switchingEngine,
                    onSwitchEngine = { next ->
                        // The desktop's Voice engine group: one field of the
                        // ordinary config write, then a fresh voice list,
                        // because every engine names its own voices.
                        if (switchingEngine || config?.voiceProvider == next) return@VoiceSection
                        scope.launch {
                            switchingEngine = true
                            try {
                                val updated = session.switchVoiceProvider(next)
                                if (updated != null) {
                                    val (resetForm, resetBaseline) = ProfileRules.afterVoiceProviderSwitch(
                                        form = form,
                                        baseline = baseline,
                                        config = updated,
                                    )
                                    form = resetForm
                                    baseline = resetBaseline
                                    config = updated
                                    // Never render or preview the previous
                                    // provider's identifiers while reloading.
                                    voices = emptyList()
                                    voices = session.voiceOptions()
                                }
                            } finally {
                                switchingEngine = false
                            }
                        }
                    },
                ) {
                    ChoicePicker(
                        label = "Voice",
                        choices = ProfileRules.voiceChoices(config, voices, form.voice),
                        selected = form.voice,
                        onSelect = { form = form.copy(voice = it) },
                    )
                    SwitchRow(
                        label = "Speak replies",
                        checked = form.speakReplies,
                        enabled = ProfileRules.selectedVoiceCanSpeak(config, form.voice),
                        onCheckedChange = { form = form.copy(speakReplies = it) },
                    )
                    ActionRow(
                        text = "Preview voice",
                        painter = R.drawable.ic_volume_up,
                        enabled = ProfileRules.canPreview(busy, config, form.voice),
                        onClick = {
                            scope.launch {
                                if (!ProfileRules.selectedVoiceCanSpeak(config, form.voice)) {
                                    session.actionError = ProfileRules.PREVIEW_REFUSED
                                    return@launch
                                }
                                busy = true
                                try {
                                    val data = session.previewVoice(form.voice, liveBot())
                                        ?: return@launch
                                    // `rememberCoroutineScope` dispatches on
                                    // main, and starting a preview reaches
                                    // MediaPlayer.prepare(), which blocks
                                    // until the source is decodable. The
                                    // controller serialises every transition
                                    // on its own lock and its callbacks are
                                    // delivered on the main Looper, so it is
                                    // safe to start from a worker; the result
                                    // lands back on main to be reported.
                                    val failure = withContext(Dispatchers.IO) {
                                        player.play(data)
                                    }
                                    failure?.let { session.actionError = it }
                                } finally {
                                    busy = false
                                }
                            }
                        },
                    )
                    ProfileRules.pickAVoiceHint(config, form.voice)?.let { hint ->
                        IconNote(text = hint, icon = Icons.Filled.Info)
                    }
                }

                FormSection(header = null) {
                    ActionRow(
                        text = "Save profile changes",
                        enabled = ProfileRules.canSave(form, busy),
                        onClick = {
                            scope.launch {
                                busy = true
                                val updated = session.updateProfile(
                                    ProfileRules.patch(form, baseline, config),
                                    liveBot(),
                                )
                                if (updated != null) {
                                    form = ProfileForm.of(updated)
                                    baseline = ProfileForm.of(updated)
                                }
                                busy = false
                            }
                        },
                    )
                }
            }

            if (busy) {
                Box(
                    modifier = Modifier.matchParentSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(44.dp))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
/** A SwiftUI `Picker` as Material draws one: a read-only field that opens a menu. */
@Composable
internal fun ChoicePicker(
    label: String,
    choices: List<VoiceChoice>,
    selected: String,
    onSelect: (String) -> Unit,
    enabled: Boolean = true,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = choices.firstOrNull { it.id == selected }?.label.orEmpty()
    ExposedDropdownMenuBox(
        expanded = expanded && enabled,
        onExpandedChange = { if (enabled) expanded = it },
        modifier = Modifier.fillMaxWidth(),
    ) {
        AppTextField(
            value = selectedLabel,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = label,
            trailing = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable)
                .fillMaxWidth(),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            // The app's own curve and surface rather than Material's menu default:
            // a menu that is a rectangle with a stock elevation reads as a widget
            // borrowed from another product, and this one is the same shape as every
            // other raised surface in the app.
            shape = AppRadii.smallShape,
            containerColor = AppTheme.colors.surface,
        ) {
            choices.forEach { choice ->
                DropdownMenuItem(
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(choice.label)
                            choice.detail?.let {
                                Text(it, fontSize = 13.sp, color = secondaryTint)
                            }
                        }
                    },
                    // Which one you are on, said in the menu as well as in the field
                    // above it: an open menu covers the field it came from.
                    trailingIcon = if (choice.id == selected) {
                        {
                            Icon(
                                imageVector = Icons.Filled.Check,
                                contentDescription = null,
                                tint = AppTheme.colors.accent,
                                modifier = Modifier.size(AppSizes.glyph),
                            )
                        }
                    } else {
                        null
                    },
                    enabled = choice.enabled,
                    onClick = {
                        expanded = false
                        onSelect(choice.id)
                    },
                )
            }
        }
    }
}

/**
 * The Voice section: its words, and which of them stand in for the picker.
 *
 * Both come from one [ProfileRules.voiceCopy] call, so the branch and the
 * sentence explaining it cannot disagree. This exists as its own composable
 * because the defect it guards lives in the composition rather than in any
 * value a rule returns — the screen once drew a correct sentence in the wrong
 * slot with the whole suite green — and, like `DataTableCard`, the assertion
 * has to be over what is mounted. `VoiceSectionWiringTest` mounts exactly this.
 *
 * The engine picker rides above the branch: like the desktop's Voice engine
 * group it is drawn in every state, because switching away is how you repair
 * an engine whose credential is missing.
 */
@Composable
internal fun VoiceSection(
    config: ConfigStatus?,
    switching: Boolean = false,
    onSwitchEngine: (VoiceProvider) -> Unit = {},
    canSpeak: @Composable () -> Unit,
) {
    val copy = ProfileRules.voiceCopy(config)
    FormSection(header = "Voice", footer = copy.footer) {
        ChoicePicker(
            label = "Voice engine",
            choices = ProfileRules.providerChoices(),
            selected = (config?.voiceProvider ?: VoiceProvider.ELEVENLABS).wire,
            onSelect = { next -> onSwitchEngine(VoiceProvider.fromWire(next)) },
            enabled = !switching,
        )
        if (copy.unconfiguredNotice != null) {
            IconNote(text = copy.unconfiguredNotice, painter = R.drawable.ic_volume_off)
        } else {
            canSpeak()
        }
    }
}

/**
 * A SwiftUI `Form` section, as Material draws one: a quiet heading, a rule, the
 * rows, and the explanatory line underneath.
 */
@Composable
internal fun FormSection(
    header: String?,
    footer: String? = null,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        header?.let {
            Text(
                text = it,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = secondaryTint,
            )
        }
        HorizontalDivider()
        content()
        footer?.let { Text(text = it, fontSize = 13.sp, color = secondaryTint) }
    }
}

/** A `Button` row of a Form: full width, left aligned, hit at 48 dp. */
@Composable
internal fun ActionRow(
    text: String,
    enabled: Boolean = true,
    destructive: Boolean = false,
    icon: ImageVector? = null,
    painter: Int? = null,
    onClick: () -> Unit,
) {
    val tint = when {
        !enabled -> secondaryTint.copy(alpha = 0.5f)
        destructive -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.primary
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = MIN_TOUCH_TARGET)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when {
            icon != null -> Icon(
                imageVector = icon,
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(20.dp),
            )
            painter != null -> Icon(
                painter = painterResource(painter),
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(20.dp),
            )
        }
        Text(text = text, fontSize = 15.sp, color = tint)
    }
}

/** A `Toggle` row: the whole line switches, and it is 48 dp tall. */
@Composable
internal fun SwitchRow(
    label: String,
    checked: Boolean,
    enabled: Boolean = true,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = MIN_TOUCH_TARGET)
            .toggleable(
                value = checked,
                enabled = enabled,
                role = Role.Switch,
                onValueChange = onCheckedChange,
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            fontSize = 15.sp,
            color = if (enabled) Color.Unspecified else secondaryTint.copy(alpha = 0.5f),
            modifier = Modifier.weight(1f),
        )
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}

/** SwiftUI's `Label(_, systemImage:)` in its quiet, informational form. */
@Composable
internal fun IconNote(
    text: String,
    icon: ImageVector? = null,
    painter: Int? = null,
    tint: Color = Color.Unspecified,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val resolved = if (tint == Color.Unspecified) secondaryTint else tint
        when {
            icon != null -> Icon(
                imageVector = icon,
                contentDescription = null,
                tint = resolved,
                modifier = Modifier.size(18.dp),
            )
            painter != null -> Icon(
                painter = painterResource(painter),
                contentDescription = null,
                tint = resolved,
                modifier = Modifier.size(18.dp),
            )
        }
        Text(text = text, fontSize = 13.sp, color = resolved)
    }
}

/** Rotation must not throw away a half-typed profile. */
private val ProfileFormSaver = listSaver<ProfileForm, Any>(
    save = {
        listOf(
            it.name,
            it.title,
            it.description,
            it.notifications,
            it.crop.name,
            it.color,
            it.voice,
            it.speakReplies,
        )
    },
    restore = {
        ProfileForm(
            name = it[0] as String,
            title = it[1] as String,
            description = it[2] as String,
            notifications = it[3] as Boolean,
            crop = AvatarCrop.valueOf(it[4] as String),
            color = it[5] as String,
            voice = it[6] as String,
            speakReplies = it[7] as Boolean,
        )
    },
)
