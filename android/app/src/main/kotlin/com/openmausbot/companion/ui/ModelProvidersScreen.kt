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
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.ui.graphics.asImageBitmap
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
 * Every model provider this host runs, as one honest list — the phone-side
 * counterpart of the desktop's provider settings.
 *
 * The rows are the server's own catalog (`/api/instances`): an engine is
 * "Configured" exactly when the server reports it available, and unavailable
 * rows keep the server's reason instead of disappearing. Two kinds of thing
 * live under "provider", and the screen keeps them apart: **API providers**
 * configure with a key this phone can hold; **account sign-in engines** are
 * CLIs on the host that authenticate with the provider's own flow, so their
 * sign-in and switch-account actions are only offered while the engine is
 * actually runnable — an unavailable engine would turn either tap into a
 * guaranteed "not installed on this server" error. API-key engines get a
 * write-only key form. The workspace default selection is patched through
 * `/api/config`, the same write the desktop sends. Nothing here invents a
 * provider the registry does not have.
 */
@Composable
fun ModelProvidersScreen(onBack: () -> Unit) {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()

    var instances by remember { mutableStateOf<List<Instance>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    // The compat engine's base URL is a setting, not a secret; the status read
    // carries it so the edit form can show what is already there.
    var compatUrl by remember { mutableStateOf("") }
    var editingKey by remember { mutableStateOf<Instance?>(null) }
    var signingIn by remember { mutableStateOf<Instance?>(null) }
    var confirmingDefault by remember { mutableStateOf<Instance?>(null) }
    var addingProvider by remember { mutableStateOf(false) }
    var removingProvider by remember { mutableStateOf<Instance?>(null) }
    var setupError by remember { mutableStateOf<String?>(null) }

    var loadError by remember { mutableStateOf<String?>(null) }

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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .backdrop(motif = BackdropMotif.SETTINGS, band = 180.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = AppSpacing.xs, end = AppSpacing.gutter, top = AppSpacing.xs, bottom = AppSpacing.md),
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HeaderBackButton(onBack)
            Text(
                text = "Model providers",
                style = MaterialTheme.typography.headlineSmall,
                color = AppTheme.colors.textPrimary,
            )
        }

        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = AppSpacing.gutter)
                .padding(bottom = 48.dp),
            verticalArrangement = Arrangement.spacedBy(AppSpacing.lg),
        ) {
            if (loading) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text("Loading providers", fontSize = 14.sp, color = secondaryTint)
                }
            } else if (instances.isEmpty()) {
                Text(
                    loadError ?: "No model providers are configured on this phone's host.",
                    fontSize = 14.sp,
                    color = secondaryTint,
                )
            } else {
                // Two different kinds of thing live under "provider": an API
                // provider is paid with a key this phone can hold; a sign-in
                // engine is a CLI on the host that authenticates by account.
                // Mixing them into one list is how a tap that can only fail
                // ends up sitting next to one that works.
                //
                // Each one is a card: an identity tile, the name, its state, and
                // the one or two things a person can do about it. The state is a
                // word on the card rather than a row of uppercase labels over a
                // column of values — a provider is an object with a face and a
                // status, not a form that has been filled in.
                val apiProviders = ModelProvidersRules.apiProviders(instances)
                val signInEngines = ModelProvidersRules.signInEngines(instances)
                // Where "Configure API access" sends a person whose engine
                // cannot sign in on this host: the key-based provider's own
                // form, which is the legitimate alternative that exists here.
                val apiProvider = apiProviders.firstOrNull()
                val providerCard: @Composable (Instance) -> Unit = { instance ->
                    ProviderCard(
                        instance = instance,
                        onEditKey = { editingKey = instance },
                        onRemove = if (ModelProvidersRules.isCustomApiProvider(instance)) {
                            { removingProvider = instance }
                        } else {
                            null
                        },
                        onSignIn = { signingIn = instance },
                        onSignOut = {
                            scope.launch {
                                session.signOutInstance(instance.instanceId)?.let { instances = it }
                            }
                        },
                        onTest = {
                            scope.launch {
                                val refreshed = session.testProviderModels(instance.instanceId)
                                refreshed?.let { instances = it }
                            }
                        },
                        onSetDefault = { confirmingDefault = instance },
                        onConfigureApiAccess = apiProvider?.let { provider -> { editingKey = provider } },
                    )
                }
                if (apiProviders.isNotEmpty()) {
                    ProvidersSectionLabel("API providers")
                    apiProviders.forEach { providerCard(it) }
                    Footnote("Keys are stored by this phone's host and never leave it.")
                }
                ProvidersSectionLabel("Your own endpoints")
                Row(horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm)) {
                    AppPill(
                        text = "Add a provider",
                        onClick = { setupError = null; addingProvider = true },
                        tone = PillTone.Raised,
                    )
                }
                Footnote(
                    "Add as many OpenAI- or Anthropic-compatible endpoints as you like, " +
                        "each with its own name; the name shows everywhere the provider does.",
                )
                if (signInEngines.isNotEmpty()) {
                    ProvidersSectionLabel("Account sign-in engines")
                    signInEngines.forEach { providerCard(it) }
                    Footnote(
                        "These engines run on the host computer and sign in with the " +
                            "provider's own account flow. When the engine is not installed " +
                            "on the host, its reason line says what is missing and sign-in " +
                            "is not offered.",
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
            onDismiss = { signingIn = null },
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
private fun ProviderCard(
    instance: Instance,
    onEditKey: () -> Unit,
    onRemove: (() -> Unit)?,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
    onTest: () -> Unit,
    onSetDefault: () -> Unit,
    onConfigureApiAccess: (() -> Unit)?,
) {
    val name = ModelProvidersRules.displayName(instance)
    val auth = instance.authentication
    val available = instance.snapshot.isAvailable
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(AppRadii.cardShape)
            .background(AppTheme.colors.surface)
            .padding(AppSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ProviderMark(instance)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = name,
                    style = MaterialTheme.typography.titleMedium,
                    color = AppTheme.colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = ModelProvidersRules.accessLine(instance),
                    style = MaterialTheme.typography.bodySmall,
                    color = AppTheme.colors.textTertiary,
                )
            }
            ProviderState(
                text = if (available) "Configured" else "Unavailable",
                tone = if (available) StatusTone.GOOD else StatusTone.WARN,
            )
        }
        if (auth != null) {
            // Account and runtime are different facts, and the card keeps
            // them apart: an engine can be signed in while its runtime is
            // absent (Codex on this host), or need a runtime to sign in at
            // all (Claude's own login). Neither is "just unavailable".
            ProviderCardLabel("Account")
            Text(
                text = ModelProvidersRules.accountLine(instance),
                fontSize = 14.sp,
                color = if (instance.snapshot.authenticated == true) {
                    MaterialTheme.colorScheme.primary
                } else {
                    secondaryTint
                },
            )
            instance.snapshot.account?.email?.let { email ->
                Text(text = email, fontSize = 13.sp, color = secondaryTint)
            }
            if (ModelProvidersRules.offersSignIn(instance)) {
                Row(horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm)) {
                    // "Switch account" only when an account exists to switch;
                    // a signed-out engine says "Sign in" even though the
                    // server can remove a stored sign-in. Signing in is the one
                    // action on the card that is worth the accent: it is what the
                    // card is for when the account is the thing that is missing.
                    if (ModelProvidersRules.showsSwitchAccount(instance)) {
                        AppPill(text = "Switch account", onClick = onSignOut, tone = PillTone.Raised)
                    } else {
                        AppPill(text = "Sign in", onClick = onSignIn, tone = PillTone.Accent)
                    }
                }
            } else {
                ModelProvidersRules.signInBlockedReason(instance)?.let { reason ->
                    Text(text = reason, fontSize = 13.sp, color = secondaryTint)
                }
                if (onConfigureApiAccess != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm)) {
                        AppPill(
                            text = "Configure API access",
                            onClick = onConfigureApiAccess,
                            tone = PillTone.Raised,
                        )
                    }
                }
            }
            ProviderCardLabel("Runtime")
            Text(
                text = ModelProvidersRules.runtimeLine(instance),
                fontSize = 14.sp,
                color = if (instance.snapshot.isAvailable) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.error
                },
            )
            instance.snapshot.reason?.takeIf { !instance.snapshot.isAvailable }?.let { reason ->
                Text(text = reason, fontSize = 13.sp, color = secondaryTint)
            }
        } else {
            Text(
                text = ModelProvidersRules.stateLine(instance),
                fontSize = 14.sp,
                color = if (instance.snapshot.isAvailable) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.error
                },
            )
            instance.snapshot.reason?.takeIf { !instance.snapshot.isAvailable }?.let { reason ->
                Text(text = reason, fontSize = 13.sp, color = secondaryTint)
            }
            // An engine with no sign-in catalogue entry: its account login
            // lives in a CLI runtime this build does not carry. Say that
            // plainly and point at the legitimate alternative — never a dead
            // Sign in button, never an invented flow.
            if (!ModelProvidersRules.usesApiKey(instance)) {
                Text(
                    text = "Account sign-in isn't available in this build for this engine.",
                    fontSize = 13.sp,
                    color = secondaryTint,
                )
                if (onConfigureApiAccess != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm)) {
                        AppPill(
                            text = "Configure API access",
                            onClick = onConfigureApiAccess,
                            tone = PillTone.Raised,
                        )
                    }
                }
            }
        }
        if (instance.snapshot.isAvailable) {
            val modelCount = instance.models.options.size
            Text(
                text = if (modelCount > 0) "$modelCount models available" else "Available",
                fontSize = 13.sp,
                color = secondaryTint,
            )
        }
        val context = LocalContext.current
        val docs = ModelProvidersRules.docsUrl(instance)
        Row(horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm)) {
            if (instance.snapshot.isAvailable) {
                AppPill(text = "Test", onClick = onTest, tone = PillTone.Raised)
                AppPill(text = "Set as default", onClick = onSetDefault, tone = PillTone.Raised)
            }
            if (ModelProvidersRules.usesApiKey(instance)) {
                AppPill(text = "Edit key", onClick = onEditKey, tone = PillTone.Raised)
            }
            if (docs != null) {
                AppPill(text = "Docs", onClick = { openBrowser(context, docs) }, tone = PillTone.Raised)
            }
            if (onRemove != null) {
                AppPill(text = "Remove", onClick = onRemove, tone = PillTone.Destructive)
            }
        }
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

    // Start once; poll while waiting. The flow id is the server's, and every
    // answer is the server's own safe copy — never CLI output.
    LaunchedEffect(instance.instanceId) {
        val started = session.startInstanceAuth(instance.instanceId)
        if (started == null) {
            error = session.actionError ?: "The sign-in could not be started."
            return@LaunchedEffect
        }
        val method = instance.authentication?.method ?: "browser"
        phase = InstanceAuthUi(started.phase, started.flowId, started.authorizationUrl, started.userCode, null, method)
        // A browser redirect sign-in opens its page by itself: the person
        // never types a code. A start that answers with a user code is the
        // headless fallback — no browser to open; the code is shown below.
        val url = started.authorizationUrl
        if (method == "browser" && started.userCode == null && !browserOpened && url != null) {
            browserOpened = true
            runCatching { openBrowser(context, url) }
                .onFailure { error = "The browser could not be opened. Use the link below to finish signing in." }
        }
        val flowId = started.flowId
        if (flowId == null) return@LaunchedEffect
        while (true) {
            delay(2_000)
            val status = session.instanceAuthStatus(instance.instanceId, flowId) ?: continue
            phase = InstanceAuthUi(status.phase, flowId, status.authorizationUrl, status.userCode, status.message, method)
            if (status.succeeded || status.dead) break
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
            when {                    current?.phase == "succeeded" -> TextButton(onClick = onDone) { Text("Done") }
                current?.method == "paste-code" && current.waiting -> TextButton(
                    enabled = !completing && code.isNotBlank(),
                    onClick = {
                        completing = true
                        scope.launch {
                            val flowId = current.flowId
                            if (flowId != null) {
                                session.completeInstanceAuth(instance.instanceId, flowId, code.trim())
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
private data class InstanceAuthUi(
    val phase: String,
    val flowId: String?,
    val authorizationUrl: String?,
    val userCode: String?,
    val message: String?,
    /** The engine's declared sign-in method: "browser" | "device-code" | "paste-code". */
    val method: String,
) {
    val waiting: Boolean get() = phase == "waiting"
}

/** Provider card decisions, kept out of the composables. */
object ModelProvidersRules {
    fun displayName(instance: Instance): String =
        instance.displayName?.trim()?.takeIf { it.isNotEmpty() } ?: instance.instanceId

    /**
     * A provider this phone added itself (POST /api/instances) — the two
     * custom-API drivers, never the built-in `openaiCompat` entry whose
     * settings are workspace-wide. Only these can be renamed or removed from
     * here.
     */
    fun isCustomApiProvider(instance: Instance): Boolean =
        instance.instanceId != "openaiCompat" &&
            (instance.driverKind == "openai-compat" || instance.driverKind == "anthropic-compat")

    /**
     * The key-and-URL engine: configured entirely from settings, nothing to
     * install. On the wire the server marks engines "subscription" (account
     * sign-in CLIs) or "custom" (custom configuration — see EngineAccess in
     * the server's contracts; "apikey" is an older spelling this host never
     * sends). Within "custom" the OpenAI-compatible driver is the one whose
     * whole configuration is a base URL and a key — it is the API provider;
     * every other engine on the host installs and signs in through a CLI.
     * Getting this wrong hides the Edit-key form behind an Unavailable card,
     * which is exactly how adding a provider became impossible.
     */
    fun usesApiKey(instance: Instance): Boolean =
        instance.instanceId == "opencodeGo" ||
            (instance.authentication == null &&
                (instance.access == "apikey" ||
                    (instance.access == "custom" &&
                        (instance.driverKind == "openai-compat" || instance.driverKind == "anthropic-compat"))))

    /** Documentation link for the provider when available. */
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

    /** API-key providers configure with a key alone — nothing to install. */
    fun apiProviders(instances: List<Instance>): List<Instance> = instances.filter { usesApiKey(it) }

    /** Account sign-in engines: CLIs on the host, authenticated by account.
     * The built-in engine lands here too — it exists by being installed. */
    fun signInEngines(instances: List<Instance>): List<Instance> = instances.filter { !usesApiKey(it) }

    /**
     * Sign-in is offered whenever the server says the flow can run on this
     * host — which is a fact about authentication, not about the runtime.
     * The Codex ChatGPT device flow is native (available even with no Codex
     * runtime installed: sign in first, runtime later), while Claude's
     * sign-in IS its CLI's login and the server reports it unavailable when
     * the runtime is absent. An older host that sends no flag reads as
     * available, preserving its previous behavior.
     */
    fun offersSignIn(instance: Instance): Boolean {
        val auth = instance.authentication ?: return false
        return auth.available != false
    }

    /** The server's own words for why sign-in is not offered, when it says so. */
    fun signInBlockedReason(instance: Instance): String? =
        instance.authentication?.takeIf { it.available == false }?.reason

    /** "Signed in" / "Not signed in" — the account section's state line. */
    fun accountLine(instance: Instance): String =
        if (instance.snapshot.authenticated == true) "Signed in" else "Not signed in"

    /** True when the account action switches accounts rather than starting
     * one: switching needs an account to switch from. */
    fun showsSwitchAccount(instance: Instance): Boolean =
        instance.authentication?.signOut == true && instance.snapshot.authenticated == true

    /** The runtime section's state line: can turns run on this host now? */
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
        instance.snapshot.isAvailable -> "Configured"
        else -> "Unavailable"
    }
}

/** The browser sign-in happens on this device; open the provider's own page
 * with the system browser. Every browser shows its own account picker here. */
internal fun openBrowser(context: Context, url: String) {
    context.startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}

/** The heading over one kind of provider — see [AppSectionHeader]. */
@Composable
private fun ProvidersSectionLabel(text: String) {
    AppSectionHeader(text)
}

/** The quieter heading inside one engine card (Account, Runtime). */
@Composable
private fun ProviderCardLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = AppTheme.colors.textTertiary,
    )
}

/**
 * A provider's identity tile: its own logo, on a white square.
 *
 * A mark this app recognises is the fastest thing on the row — OpenAI, Claude,
 * Gemini, Groq are pictures before they are words — so a list of six engines
 * reads as six engines rather than six rows of the same letter. The white
 * square is not decoration: brand marks are drawn for a light ground, and a
 * white chip keeps them correct in either theme instead of needing a second,
 * recoloured copy of every logo.
 *
 * A provider with no bundled mark — a private gateway someone named "home
 * box" — keeps the letter it always had, on a colour picked from its instance
 * id, because inventing a logo for it would say something untrue.
 */
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

/** How much of the tile the mark fills; the rest is the white ground it sits on. */
private const val LOGO_FRACTION: Float = 0.66f

/**
 * The fallback identity tile: one letter of the provider's name on a pastel
 * square, kept for providers no bundled mark covers.
 */
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

/**
 * One provider, as a card.
 *
 * The state is a pill beside the name — "Configured", "Unavailable" — and the
 * card's body carries only what is true and useful: which account is signed in,
 * whether the runtime will take a turn right now, and why not when it will not.
 * The actions are soft pills at the foot of the card, quiet by default, with
 * exactly one of them (setting the workspace default) wearing the accent.
 */
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

/**
 * The name, protocol, endpoint, key and (optional) model a custom provider
 * needs. The name is not decoration: every list, picker and bot settings
 * screen shows it in place of the driver's own label, so two gateways on the
 * same protocol stay tellable apart.
 */
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
                    text = "Add a provider",
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
                        "deepseek" to "DeepSeek",
                        "mistral" to "Mistral",
                        "groq" to "Groq",
                        "openrouter" to "OpenRouter",
                        "perplexity" to "Perplexity",
                        "ollama" to "Ollama",
                        "openai" to "OpenAI",
                        "anthropic" to "Anthropic",
                        "gemini" to "Gemini",
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
                                onClick = { selectedPreset = preset },
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
