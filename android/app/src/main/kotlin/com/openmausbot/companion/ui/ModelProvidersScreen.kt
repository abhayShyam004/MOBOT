package com.openmausbot.companion.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.browser.customtabs.CustomTabsIntent
import com.openmausbot.companion.MainActivity
import com.openmausbot.companion.core.Instance
import com.openmausbot.companion.core.ProviderIconDto
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal fun decodeCustomIcon(dataUrl: String): androidx.compose.ui.graphics.ImageBitmap? {
    return try {
        val base64 = dataUrl.substringAfter("base64,")
        val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
        val bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        bitmap?.asImageBitmap()
    } catch (_: Throwable) {
        null
    }
}

/**
 * Model Providers Screen redesigned to match MOBOT's minimal, premium Settings design system.
 *
 * Information Architecture:
 * - Active Default Model: Clean summary section showing current workspace model & provider.
 * - Providers: Grouped SettingsSection with standard rows showing authentic brand logos, status, and chevron.
 * - Custom Endpoints: Dedicated section for custom API gateways with an Add Endpoint action.
 * - Provider Detail SubPage: Tapping any provider navigates to its full detail view for credentials,
 *   sign-in actions, runtime readiness, model selection, and diagnostics.
 */
@Composable
fun ModelProvidersScreen(onBack: () -> Unit) {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var instances by remember { mutableStateOf<List<Instance>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var compatUrl by remember { mutableStateOf("") }
    var activeDetailInstanceId by remember { mutableStateOf<String?>(null) }

    var editingKey by remember { mutableStateOf<Instance?>(null) }
    var signingIn by remember { mutableStateOf<Instance?>(null) }
    var confirmingDefault by remember { mutableStateOf<Instance?>(null) }
    var addingProvider by remember { mutableStateOf(false) }
    var removingProvider by remember { mutableStateOf<Instance?>(null) }
    var setupError by remember { mutableStateOf<String?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var testingId by remember { mutableStateOf<String?>(null) }

    fun reload() {
        scope.launch {
            loadError = null
            instances = try {
                session.modelInstances()
            } catch (error: Throwable) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                loadError = error.message ?: "The provider list could not be loaded."
                emptyList()
            }
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        reload()
        compatUrl = session.readProviderStatus()?.openaiCompat?.url.orEmpty()
    }

    val detailInstance = activeDetailInstanceId?.let { id -> instances.firstOrNull { it.instanceId == id } }

    if (detailInstance != null) {
        // Dedicated Provider Detail SubPage
        SettingsSubPage(
            title = ModelProvidersRules.displayName(detailInstance),
            subtitle = "Provider details and model configuration",
            onBack = { activeDetailInstanceId = null },
        ) {
            // Identity Header Card
            Column(
                modifier = Modifier
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 8.dp),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(22.dp))
                        .background(AppTheme.colors.surface)
                        .border(
                            width = 1.dp,
                            color = AppTheme.colors.border.copy(alpha = 0.5f),
                            shape = RoundedCornerShape(22.dp),
                        )
                        .padding(20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    ProviderMark(detailInstance, size = 52.dp)
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            text = ModelProvidersRules.displayName(detailInstance),
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = AppTheme.colors.textPrimary,
                            maxLines = 2,
                        )
                        Text(
                            text = ModelProvidersRules.accessLine(detailInstance),
                            fontSize = 13.5.sp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                    ProviderState(
                        text = ModelProvidersRules.stateLine(detailInstance),
                        tone = ModelProvidersRules.statusTone(detailInstance),
                    )
                }
            }

            // Authentication & Access Section
            SettingsSection(title = "Access & Authentication") {
                if (ModelProvidersRules.usesApiKey(detailInstance)) {
                    if (detailInstance.instanceId == "openaiCompat") {
                        SettingsRow(
                            title = "Base URL",
                            subtitle = if (compatUrl.isNotBlank()) compatUrl else "https://api.openai.com/v1",
                            trailingValue = "Edit",
                            showChevron = true,
                            onClick = { editingKey = detailInstance },
                        )
                        SettingsDivider()
                    }
                    SettingsRow(
                        title = "API Key",
                        subtitle = if (detailInstance.snapshot.isAvailable) {
                            "Stored on host, never exposed"
                        } else {
                            "API key required to enable models"
                        },
                        trailingValue = if (detailInstance.snapshot.isAvailable) "Configured" else "Edit key",
                        showChevron = true,
                        onClick = { editingKey = detailInstance },
                    )
                } else if (detailInstance.authentication != null) {
                    val email = detailInstance.snapshot.account?.email
                    SettingsRow(
                        title = "Account",
                        subtitle = email ?: ModelProvidersRules.accountLine(detailInstance),
                        trailingValue = if (detailInstance.snapshot.authenticated == true) "Signed in" else "Not signed in",
                    )
                    SettingsDivider()
                    if (ModelProvidersRules.offersSignIn(detailInstance)) {
                        val isSwitch = ModelProvidersRules.showsSwitchAccount(detailInstance)
                        SettingsRow(
                            title = if (isSwitch) "Switch Account" else "Sign In",
                            subtitle = "Authenticate via provider flow",
                            trailingValue = "Continue",
                            showChevron = true,
                            onClick = {
                                if (isSwitch) {
                                    scope.launch {
                                        val updated = session.signOutInstance(detailInstance.instanceId)
                                        updated?.let { instances = it }
                                        val freshTarget = instances.firstOrNull { it.instanceId == detailInstance.instanceId } ?: detailInstance
                                        signingIn = freshTarget
                                    }
                                } else {
                                    signingIn = detailInstance
                                }
                            },
                        )
                    } else {
                        val blockedReason = ModelProvidersRules.signInBlockedReason(detailInstance)
                            ?: "Account sign-in not available in this build"
                        SettingsRow(
                            title = "Sign In",
                            subtitle = blockedReason,
                            enabled = false,
                        )
                    }
                    SettingsDivider()
                    SettingsRow(
                        title = "Host Runtime",
                        subtitle = if (detailInstance.snapshot.isAvailable) {
                            "Runtime ready for turns"
                        } else {
                            detailInstance.snapshot.reason ?: "CLI runtime not found on host"
                        },
                        trailingValue = ModelProvidersRules.runtimeLine(detailInstance),
                    )
                } else {
                    SettingsRow(
                        title = "Built-in Engine",
                        subtitle = if (detailInstance.snapshot.isAvailable) {
                            "Ready on host"
                        } else {
                            detailInstance.snapshot.reason ?: "Unavailable"
                        },
                        trailingValue = ModelProvidersRules.runtimeLine(detailInstance),
                    )
                }

                val docs = ModelProvidersRules.docsUrl(detailInstance)
                if (docs != null) {
                    SettingsDivider()
                    SettingsRow(
                        title = "Documentation",
                        subtitle = "Official setup and developer docs",
                        showChevron = true,
                        onClick = { openBrowser(context, docs) },
                    )
                }
            }

            // Available Models Section
            SettingsSection(title = "Available Models") {
                if (detailInstance.snapshot.isAvailable && detailInstance.models.options.isNotEmpty()) {
                    detailInstance.models.options.forEachIndexed { idx, opt ->
                        if (idx > 0) SettingsDivider()
                        val isDefault = detailInstance.models.defaultModel == opt.id
                        SettingsRow(
                            title = opt.label.ifBlank { opt.id },
                            subtitle = opt.id,
                            selected = isDefault,
                            onClick = {
                                scope.launch {
                                    instances = instances.map { inst ->
                                        if (inst.instanceId == detailInstance.instanceId) {
                                            inst.copy(models = inst.models.copy(defaultModel = opt.id), isDefault = true)
                                        } else {
                                            inst.copy(isDefault = false)
                                        }
                                    }
                                    session.setDefaultModelSelection(detailInstance.instanceId, opt.id)
                                    reload()
                                }
                            },
                        )
                    }
                } else if (detailInstance.snapshot.isAvailable) {
                    SettingsRow(
                        title = "Default Model",
                        subtitle = detailInstance.models.defaultModel.ifBlank { "No default specified" },
                        enabled = false,
                    )
                } else {
                    SettingsRow(
                        title = "No Models Available",
                        subtitle = "Authenticate or configure credentials to discover models",
                        enabled = false,
                    )
                }
            }

            // Actions Section
            SettingsSection(title = "Management") {
                if (detailInstance.snapshot.isAvailable) {
                    SettingsRow(
                        title = "Test Connection",
                        subtitle = "Verify credentials and refresh model list",
                        trailingValue = if (testingId == detailInstance.instanceId) "Testing…" else "Test",
                        busy = (testingId == detailInstance.instanceId),
                        onClick = {
                            testingId = detailInstance.instanceId
                            scope.launch {
                                val refreshed = session.testProviderModels(detailInstance.instanceId)
                                testingId = null
                                refreshed?.let { instances = it }
                            }
                        },
                    )
                    SettingsDivider()
                    SettingsRow(
                        title = "Set as Workspace Default",
                        subtitle = "Use ${ModelProvidersRules.displayName(detailInstance)} for new chats",
                        trailingValue = "Set",
                        onClick = { confirmingDefault = detailInstance },
                    )
                }
                if (ModelProvidersRules.isCustomApiProvider(detailInstance)) {
                    if (detailInstance.snapshot.isAvailable) SettingsDivider()
                    SettingsRow(
                        title = "Remove Provider",
                        subtitle = "Delete custom endpoint from host",
                        destructive = true,
                        onClick = { removingProvider = detailInstance },
                    )
                }
            }
        }
    } else {
        // Main Overview Screen
        SettingsSubPage(
            title = "Model Providers",
            subtitle = "Configure AI models, API keys, and CLI sign-in engines",
            onBack = onBack,
        ) {
            if (loading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = AppSpacing.xxl),
                    contentAlignment = Alignment.Center,
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        Text("Loading providers…", fontSize = 14.sp, color = AppTheme.colors.textSecondary)
                    }
                }
            } else if (instances.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 20.dp),
                ) {
                    Text(
                        loadError ?: "No model providers are configured on this host.",
                        fontSize = 14.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                }
            } else {
                // Section 1: Default Model
                val eligibleInstances = instances.filter {
                    ModelProvidersRules.isSupportedBuiltInProvider(it) || ModelProvidersRules.isCustomApiProvider(it)
                }
                val defaultInstance = eligibleInstances.firstOrNull { it.isDefault }
                    ?: eligibleInstances.firstOrNull { it.snapshot.isAvailable && it.models.defaultModel.isNotEmpty() }
                    ?: eligibleInstances.firstOrNull { it.snapshot.isAvailable }

                SettingsSection(title = "Default Model") {
                    if (defaultInstance != null) {
                        val modelName = defaultInstance.models.options
                            .firstOrNull { it.id == defaultInstance.models.defaultModel }?.label
                            ?: defaultInstance.models.defaultModel.ifEmpty { "Default Model" }

                        SettingsRow(
                            leadingIcon = { ProviderMark(defaultInstance, size = 36.dp) },
                            title = modelName,
                            subtitle = "Provider: ${ModelProvidersRules.displayName(defaultInstance)}",
                            trailingValue = "Active",
                            showChevron = true,
                            onClick = { activeDetailInstanceId = defaultInstance.instanceId },
                        )
                    } else {
                        SettingsRow(
                            title = "No Active Provider",
                            subtitle = "Sign in or configure credentials below to select a model",
                            trailingValue = "Not configured",
                            enabled = false,
                        )
                    }
                }

                // Section 2: Standard Providers
                val standardProviders = instances.filter { ModelProvidersRules.isSupportedBuiltInProvider(it) }
                if (standardProviders.isNotEmpty()) {
                    SettingsSection(title = "Providers") {
                        standardProviders.forEachIndexed { index, instance ->
                            if (index > 0) SettingsDivider()
                            SettingsRow(
                                leadingIcon = { ProviderMark(instance, size = 36.dp) },
                                title = ModelProvidersRules.displayName(instance),
                                subtitle = ModelProvidersRules.accessLine(instance),
                                trailingValue = ModelProvidersRules.stateLine(instance),
                                showChevron = true,
                                onClick = { activeDetailInstanceId = instance.instanceId },
                            )
                        }
                    }
                }

                // Section 3: Custom Endpoints
                val customProviders = instances.filter { ModelProvidersRules.isCustomApiProvider(it) }
                SettingsSection(title = "Custom Endpoints") {
                    customProviders.forEach { instance ->
                        SettingsRow(
                            leadingIcon = { ProviderMark(instance, size = 36.dp) },
                            title = ModelProvidersRules.displayName(instance),
                            subtitle = ModelProvidersRules.accessLine(instance),
                            trailingValue = ModelProvidersRules.stateLine(instance),
                            showChevron = true,
                            onClick = { activeDetailInstanceId = instance.instanceId },
                        )
                        SettingsDivider()
                    }
                    SettingsRow(
                        title = "Add Custom Endpoint",
                        subtitle = "OpenAI or Anthropic-compatible API gateway",
                        trailingValue = "+ Add",
                        showChevron = true,
                        onClick = {
                            setupError = null
                            addingProvider = true
                        },
                    )
                }
            }
        }
    }

    if (addingProvider) {
        AddProviderDialog(
            session = session,
            onAdded = { refreshed ->
                refreshed?.let { instances = it }
                addingProvider = false
            },
            onDismiss = { addingProvider = false },
        )
    }

    removingProvider?.let { instance ->
        AlertDialog(
            onDismissRequest = { removingProvider = null },
            title = { Text("Remove ${ModelProvidersRules.displayName(instance)}?") },
            text = { Text("Bots using it will need a new provider. Its key and endpoint are removed from this host.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        val refreshed = session.removeCustomProvider(instance.instanceId)
                        removingProvider = null
                        if (activeDetailInstanceId == instance.instanceId) {
                            activeDetailInstanceId = null
                        }
                        refreshed?.let { instances = it }
                    }
                }) { Text("Remove") }
            },
            dismissButton = {
                TextButton(onClick = { removingProvider = null }) { Text("Cancel") }
            },
        )
    }

    setupError?.let { message ->
        AlertDialog(
            onDismissRequest = { setupError = null },
            title = { Text("The provider was not added") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { setupError = null }) { Text("OK") } },
        )
    }

    editingKey?.let { instance ->
        ProviderKeyDialog(
            instance = instance,
            session = session,
            compatUrl = compatUrl,
            onSaved = { refreshed ->
                refreshed?.let { instances = it }
                editingKey = null
            },
            onDismiss = { editingKey = null },
        )
    }

    signingIn?.let { instance ->
        ProviderAuthDialog(
            instance = instance,
            session = session,
            onDone = {
                signingIn = null
                reload()
            },
            onDismiss = {
                signingIn = null
                reload()
            },
        )
    }

    confirmingDefault?.let { instance ->
        val model = instance.models.defaultModel
        AlertDialog(
            onDismissRequest = { confirmingDefault = null },
            title = { Text("Make ${ModelProvidersRules.displayName(instance)} the default?") },
            text = {
                Text(
                    "New chats will use ${ModelProvidersRules.displayName(instance)}" +
                        (if (model.isNotBlank()) " with $model" else "") +
                        ". Existing chats keep their own model.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        if (session.setDefaultModelSelection(instance.instanceId, model)) {
                            confirmingDefault = null
                            reload()
                        }
                    }
                }) { Text("Make default") }
            },
            dismissButton = {
                TextButton(onClick = { confirmingDefault = null }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun ProviderKeyDialog(
    instance: Instance,
    session: Session,
    compatUrl: String,
    onSaved: (List<Instance>?) -> Unit,
    onDismiss: () -> Unit,
) {
    var url by remember { mutableStateOf(if (instance.instanceId == "openaiCompat") compatUrl else "") }
    var key by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text("Edit ${ModelProvidersRules.displayName(instance)}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (instance.instanceId == "openaiCompat") {
                    AppTextField(
                        value = url,
                        onValueChange = { url = it },
                        label = "Base URL",
                        placeholder = "https://api.openai.com/v1",
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                AppTextField(
                    value = key,
                    onValueChange = { key = it },
                    label = "API key (saved — blank keeps it)",
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "The key is stored by this phone's host and never shown again.",
                    fontSize = 12.sp,
                    color = secondaryTint,
                )
            }
        },
        confirmButton = {
            val dialogScope = rememberCoroutineScope()
            TextButton(
                enabled = !saving && (instance.instanceId != "openaiCompat" || url.isNotBlank()),
                onClick = {
                    saving = true
                    dialogScope.launch {
                        val saved = session.saveProviderKey(
                            instance.instanceId,
                            url.trim().ifEmpty { null },
                            key.takeIf { it.isNotBlank() },
                        )
                        val refreshed = if (saved != null) session.testProviderModels(instance.instanceId) else null
                        saving = false
                        onSaved(refreshed)
                    }
                },
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !saving) { Text("Cancel") }
        },
    )
}

@Composable
private fun ProviderAuthDialog(
    instance: Instance,
    session: Session,
    onDone: () -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var phase by remember { mutableStateOf<InstanceAuthUi?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var completing by remember { mutableStateOf(false) }
    var browserOpened by remember { mutableStateOf(false) }
    val context = LocalContext.current

    LaunchedEffect(instance.instanceId) {
        val started = session.startInstanceAuth(instance.instanceId)
        if (started == null) {
            error = session.actionError ?: "The sign-in could not be started."
            return@LaunchedEffect
        }
        if (started.phase == "succeeded") {
            onDone()
            return@LaunchedEffect
        }
        val method = instance.authentication?.method ?: "browser"
        phase = InstanceAuthUi(started.phase, started.flowId, started.authorizationUrl, started.userCode, null, method)
        val url = started.authorizationUrl
        if (method == "browser" && started.userCode == null && !browserOpened && url != null) {
            browserOpened = true
            runCatching { openBrowser(context, url) }
                .onFailure { error = "The browser could not be opened. Use the link below to finish signing in." }
        }
        val flowId = started.flowId
        if (flowId == null) return@LaunchedEffect
        while (true) {
            delay(1_000)
            val status = session.instanceAuthStatus(instance.instanceId, flowId)
            if (status != null) {
                phase = InstanceAuthUi(status.phase, flowId, status.authorizationUrl, status.userCode, status.message, method)
                if (status.succeeded) {
                    try {
                        val returnIntent = Intent(context, MainActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        }
                        context.startActivity(returnIntent)
                    } catch (_: Exception) {}
                    delay(300)
                    onDone()
                    break
                }
                if (status.dead) break
            }
        }
    }

    LaunchedEffect(phase?.phase) {
        if (phase?.phase == "succeeded") {
            onDone()
        }
    }

    AlertDialog(
        onDismissRequest = { if (!completing) onDismiss() },
        title = { Text("Sign in to ${ModelProvidersRules.displayName(instance)}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val current = phase
                when {
                    error != null -> Text(error ?: "", color = MaterialTheme.colorScheme.error)
                    current == null -> {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                            Text("Starting sign-in…", fontSize = 14.sp)
                        }
                    }
                    current.phase == "succeeded" -> Text("Signed in. You can close this.")
                    current.userCode != null -> {
                        Text("Enter this code at the provider's sign-in page:")
                        Text(
                            text = current.userCode,
                            fontSize = 20.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.SemiBold,
                        )
                        current.authorizationUrl?.let { url ->
                            Text(url, fontSize = 12.sp, color = secondaryTint)
                        }
                    }
                    current.authorizationUrl != null && current.waiting -> {
                        if (current.method == "browser") {
                            Text("Finish the sign-in in the browser that just opened. It returns here on its own.")
                            TextButton(onClick = {
                                current.authorizationUrl?.let { url ->
                                    runCatching { openBrowser(context, url) }
                                }
                            }) { Text("Re-open sign-in page") }
                        } else {
                            Text("Open the sign-in page on this device and approve access:")
                            Text(current.authorizationUrl, fontSize = 13.sp, color = secondaryTint)
                            if (current.method == "paste-code") {
                                AppTextField(
                                    value = code,
                                    onValueChange = { code = it },
                                    label = "Paste the code from the page",
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        }
                    }
                    else -> Text(current.message ?: "Waiting for the provider…", fontSize = 14.sp)
                }
            }
        },
        confirmButton = {
            val current = phase
            when {
                current?.phase == "succeeded" -> TextButton(onClick = onDone) { Text("Done") }
                current?.method == "paste-code" && current.waiting -> TextButton(
                    enabled = !completing && code.isNotBlank(),
                    onClick = {
                        completing = true
                        scope.launch {
                            val flowId = current.flowId
                            if (flowId != null) {
                                val ok = session.completeInstanceAuth(instance.instanceId, flowId, code.trim())
                                if (ok) {
                                    onDone()
                                }
                            }
                            completing = false
                        }
                    },
                ) { Text("Submit code") }
                else -> {}
            }
        },
        dismissButton = {
            TextButton(onClick = { if (phase?.phase == "succeeded") onDone() else onDismiss() }) {
                Text(if (phase?.phase == "succeeded") "Done" else "Cancel")
            }
        },
    )
}

/** What the auth dialog renders, flattened for the `when` above. */
internal data class InstanceAuthUi(
    val phase: String,
    val flowId: String?,
    val authorizationUrl: String?,
    val userCode: String?,
    val message: String?,
    val method: String,
) {
    val waiting: Boolean get() = phase == "waiting"
}

/** Provider card and presentation decisions. */
object ModelProvidersRules {
    fun displayName(instance: Instance): String {
        if (instance.instanceId == "openaiCompat") return "OpenAI Compatible"
        return instance.displayName?.trim()?.takeIf { it.isNotEmpty() } ?: instance.instanceId
    }

    fun isCustomApiProvider(instance: Instance): Boolean =
        instance.instanceId != "openaiCompat" &&
            (instance.driverKind == "openai-compat" || instance.driverKind == "anthropic-compat")

    /**
     * Built-in supported model providers on Android.
     *
     * Invariants:
     * 1. Exclude internal CLI/agent runtimes (cursor, droid, hermes, pi, opencodeGo, qwen, kimi, computer).
     *    These are local execution engines, not consumer model providers.
     * 2. Exclude custom API providers (these belong under Custom Endpoints).
     * 3. Built-in providers requiring account sign-in (e.g. codex) must have a real, working native auth
     *    flow on this device (authentication.available != false).
     * 4. Providers lacking native auth or whose required runtime CLI is not present on Android (claude,
     *    grok, antigravity) are excluded so users are never shown misleading "Sign in required" or "Unavailable"
     *    dead ends. Users connect them via Custom Endpoints instead.
     */
    fun isSupportedBuiltInProvider(instance: Instance): Boolean {
        val runtimeEngines = setOf("cursor", "droid", "hermes", "pi", "opencodeGo", "qwen", "kimi", "computer")
        if (instance.instanceId in runtimeEngines) return false
        if (isCustomApiProvider(instance)) return false

        // Account sign-in engine: must have native auth available on this device
        val auth = instance.authentication
        if (auth != null) {
            return auth.available != false
        }

        // CLI-dependent engine without API key or native auth: must be actually available
        if (!usesApiKey(instance) && !instance.snapshot.isAvailable) {
            return false
        }

        return true
    }

    fun usesApiKey(instance: Instance): Boolean =
        instance.instanceId == "opencodeGo" ||
            (instance.authentication == null &&
                (instance.access == "apikey" ||
                    (instance.access == "custom" &&
                        (instance.driverKind == "openai-compat" || instance.driverKind == "anthropic-compat"))))

    fun docsUrl(instance: Instance): String? =
        instance.docsUrl ?: instance.instanceId.let { id ->
            when (id) {
                "openaiCompat", "codex" -> "https://platform.openai.com/docs"
                "claude" -> "https://docs.anthropic.com"
                "antigravity" -> "https://ai.google.dev/docs"
                "grok" -> "https://docs.x.ai"
                "qwen" -> "https://qwenlm.github.io/qwen-code-docs/"
                "opencodeGo" -> "https://opencode.ai/docs/"
                "hermes" -> "https://hermes-agent.nousresearch.com/docs/"
                "pi" -> "https://pi.dev"
                else -> null
            }
        }

    fun apiProviders(instances: List<Instance>): List<Instance> = instances.filter { usesApiKey(it) }

    fun signInEngines(instances: List<Instance>): List<Instance> = instances.filter { !usesApiKey(it) }

    fun offersSignIn(instance: Instance): Boolean {
        val auth = instance.authentication ?: return false
        return auth.available != false
    }

    fun signInBlockedReason(instance: Instance): String? =
        instance.authentication?.takeIf { it.available == false }?.reason

    fun accountLine(instance: Instance): String =
        if (instance.snapshot.authenticated == true) "Signed in" else "Not signed in"

    fun showsSwitchAccount(instance: Instance): Boolean =
        instance.authentication?.signOut == true && instance.snapshot.authenticated == true

    fun runtimeLine(instance: Instance): String =
        if (instance.snapshot.isAvailable) "Ready" else "Unavailable"

    fun accessLine(instance: Instance): String {
        val method = instance.authentication?.method
        return when {
            usesApiKey(instance) -> "API key"
            method == "browser" -> "Account sign-in (browser)"
            method == "device-code" -> "Account sign-in (device code)"
            method == "paste-code" -> "Account sign-in (code)"
            method != null -> "Account sign-in"
            else -> "Built-in engine"
        }
    }

    fun stateLine(instance: Instance): String = when {
        instance.authentication != null && instance.snapshot.authenticated != true -> "Sign in required"
        instance.snapshot.isAvailable -> "Configured"
        usesApiKey(instance) -> "API key required"
        else -> "Unavailable"
    }

    fun statusTone(instance: Instance): StatusTone = when {
        instance.authentication != null && instance.snapshot.authenticated != true -> StatusTone.WARN
        instance.snapshot.isAvailable -> StatusTone.GOOD
        else -> StatusTone.WARN
    }
}

internal fun openBrowser(context: Context, url: String) {
    val uri = Uri.parse(url)
    try {
        val customTabsIntent = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
        customTabsIntent.launchUrl(context, uri)
    } catch (_: Exception) {
        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (_: Exception) {}
    }
}

@Composable
internal fun ProviderMark(instance: Instance, size: Dp = 42.dp) {
    val customBitmap = remember(instance.icon) {
        val icon = instance.icon
        val dataUrl = icon?.dataUrl
        if (icon?.kind == "custom" && !dataUrl.isNullOrEmpty()) {
            decodeCustomIcon(dataUrl)
        } else {
            null
        }
    }
    if (customBitmap != null) {
        Box(
            modifier = Modifier
                .size(size)
                .clip(RoundedCornerShape(AppRadii.small))
                .background(Color.White)
                .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(AppRadii.small)),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                bitmap = customBitmap,
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(size * LOGO_FRACTION),
            )
        }
        return
    }
    val logo = remember(instance) { ProviderLogo.drawableFor(instance) }
    if (logo == null) {
        LetterMark(instance = instance, size = size)
        return
    }
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(AppRadii.small))
            .background(Color.White)
            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(AppRadii.small)),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painter = painterResource(id = logo),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.size(size * LOGO_FRACTION),
        )
    }
}

private const val LOGO_FRACTION: Float = 0.66f

@Composable
private fun LetterMark(instance: Instance, size: Dp) {
    val colors = AppTheme.colors
    val palette = listOf(colors.petalTeal, colors.petalSand, colors.petalBlush, colors.petalSky)
    val tint = palette[(instance.instanceId.hashCode().rem(palette.size) + palette.size) % palette.size]
    val letter = ModelProvidersRules.displayName(instance).trim().firstOrNull()
        ?.uppercaseChar()
        ?.toString()
        .orEmpty()
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(AppRadii.small))
            .background(tint),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = letter,
            style = MaterialTheme.typography.titleMedium,
            color = AppTheme.colors.textPrimary,
        )
    }
}

@Composable
private fun ProviderState(
    text: String,
    tone: StatusTone,
) {
    val colors = AppTheme.colors
    val color = when (tone) {
        StatusTone.PLAIN -> colors.textSecondary
        StatusTone.GOOD -> colors.positive
        StatusTone.WARN -> colors.caution
        StatusTone.BAD -> colors.danger
    }
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = color,
        maxLines = 1,
        modifier = Modifier
            .clip(AppRadii.pill)
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = AppSpacing.sm, vertical = 3.dp),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddProviderDialog(
    session: Session,
    onAdded: (List<Instance>?) -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var protocol by remember { mutableStateOf("openai-compat") }
    var url by remember { mutableStateOf("") }
    var key by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var selectedPreset by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val canAdd = !saving && name.isNotBlank() && url.trim().startsWith("http")
    val colors = AppTheme.colors

    BasicAlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
    ) {
        AppCard(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = AppSpacing.sm),
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
                Text(
                    text = "Add custom provider",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = colors.textPrimary,
                )

                AppTextField(
                    value = name,
                    onValueChange = { name = it.take(80) },
                    label = "Name",
                    placeholder = "My gateway",
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Protocol", style = MaterialTheme.typography.labelSmall, color = colors.textSecondary)
                    Row(horizontalArrangement = Arrangement.spacedBy(AppSpacing.xs)) {
                        AppPill(
                            text = "OpenAI-compatible",
                            tone = if (protocol == "openai-compat") PillTone.Accent else PillTone.Raised,
                            onClick = { protocol = "openai-compat" },
                        )
                        AppPill(
                            text = "Anthropic-compatible",
                            tone = if (protocol == "anthropic-compat") PillTone.Accent else PillTone.Raised,
                            onClick = { protocol = "anthropic-compat" },
                        )
                    }
                }

                AppTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = "Base URL",
                    placeholder = if (protocol == "anthropic-compat") {
                        "https://api.anthropic.com"
                    } else {
                        "https://api.openai.com/v1"
                    },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )

                AppTextField(
                    value = key,
                    onValueChange = { key = it },
                    label = "API key",
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )

                AppTextField(
                    value = model,
                    onValueChange = { model = it },
                    label = "Model ID (optional)",
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Icon branding (optional)", style = MaterialTheme.typography.labelSmall, color = colors.textSecondary)
                    val presetOptions = listOf(
                        null to "None",
                        "openai" to "OpenAI",
                        "anthropic" to "Anthropic",
                        "gemini" to "Gemini",
                        "grok" to "xAI / Grok",
                        "openrouter" to "OpenRouter",
                        "deepseek" to "DeepSeek",
                        "groq" to "Groq",
                        "perplexity" to "Perplexity",
                        "mistral" to "Mistral",
                        "ollama" to "Ollama",
                        "qwen" to "Qwen",
                    )
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(AppSpacing.xs),
                        verticalArrangement = Arrangement.spacedBy(AppSpacing.xs),
                    ) {
                        presetOptions.forEach { (preset, label) ->
                            val chosen = selectedPreset == preset
                            AppPill(
                                text = label,
                                onClick = {
                                    selectedPreset = preset
                                    when (preset) {
                                        "anthropic" -> {
                                            protocol = "anthropic-compat"
                                            if (url.isBlank() || url == "https://api.openai.com/v1") url = "https://api.anthropic.com"
                                            if (name.isBlank()) name = "Anthropic"
                                        }
                                        "openai" -> {
                                            protocol = "openai-compat"
                                            if (url.isBlank()) url = "https://api.openai.com/v1"
                                            if (name.isBlank()) name = "OpenAI"
                                        }
                                        "gemini" -> {
                                            protocol = "openai-compat"
                                            if (url.isBlank() || url == "https://api.openai.com/v1") url = "https://generativelanguage.googleapis.com/v1beta/openai/"
                                            if (name.isBlank()) name = "Google Gemini"
                                        }
                                        "grok" -> {
                                            protocol = "openai-compat"
                                            if (url.isBlank() || url == "https://api.openai.com/v1") url = "https://api.x.ai/v1"
                                            if (name.isBlank()) name = "xAI Grok"
                                        }
                                        "openrouter" -> {
                                            protocol = "openai-compat"
                                            if (url.isBlank() || url == "https://api.openai.com/v1") url = "https://openrouter.ai/api/v1"
                                            if (name.isBlank()) name = "OpenRouter"
                                        }
                                        "deepseek" -> {
                                            protocol = "openai-compat"
                                            if (url.isBlank() || url == "https://api.openai.com/v1") url = "https://api.deepseek.com/v1"
                                            if (name.isBlank()) name = "DeepSeek"
                                        }
                                        "groq" -> {
                                            protocol = "openai-compat"
                                            if (url.isBlank() || url == "https://api.openai.com/v1") url = "https://api.groq.com/openai/v1"
                                            if (name.isBlank()) name = "Groq"
                                        }
                                        "perplexity" -> {
                                            protocol = "openai-compat"
                                            if (url.isBlank() || url == "https://api.openai.com/v1") url = "https://api.perplexity.ai"
                                            if (name.isBlank()) name = "Perplexity"
                                        }
                                        "mistral" -> {
                                            protocol = "openai-compat"
                                            if (url.isBlank() || url == "https://api.openai.com/v1") url = "https://api.mistral.ai/v1"
                                            if (name.isBlank()) name = "Mistral"
                                        }
                                        "ollama" -> {
                                            protocol = "openai-compat"
                                            if (url.isBlank() || url == "https://api.openai.com/v1") url = "http://localhost:11434/v1"
                                            if (name.isBlank()) name = "Ollama"
                                        }
                                        "qwen" -> {
                                            protocol = "openai-compat"
                                            if (url.isBlank() || url == "https://api.openai.com/v1") url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
                                            if (name.isBlank()) name = "Qwen"
                                        }
                                        null -> {}
                                    }
                                },
                                tone = if (chosen) PillTone.Accent else PillTone.Raised,
                            )
                        }
                    }
                }

                error?.let { message ->
                    Text(text = message, style = MaterialTheme.typography.bodySmall, color = colors.danger)
                }

                Text(
                    "The key is stored on this phone's host, never shown again. " +
                        "Leave it blank to add the provider first and add the key later.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(enabled = !saving, onClick = onDismiss) {
                        Text("Cancel", color = colors.textSecondary)
                    }
                    Spacer(modifier = Modifier.width(AppSpacing.sm))
                    AppPill(
                        text = if (saving) "Adding…" else "Add",
                        tone = PillTone.Accent,
                        enabled = canAdd,
                        onClick = {
                            saving = true
                            error = null
                            scope.launch {
                                val iconDto = selectedPreset?.let { ProviderIconDto(kind = "preset", preset = it) }
                                val created = session.createCustomProvider(
                                    driver = protocol,
                                    name = name.trim(),
                                    url = url.trim(),
                                    key = key.trim(),
                                    model = model.trim().takeIf { it.isNotEmpty() },
                                    icon = iconDto,
                                )
                                saving = false
                                if (created == null) {
                                    error = session.actionError ?: "The provider could not be added."
                                    session.actionError = null
                                } else {
                                    onAdded(created)
                                }
                            }
                        },
                    )
                }
            }
        }
    }
}
