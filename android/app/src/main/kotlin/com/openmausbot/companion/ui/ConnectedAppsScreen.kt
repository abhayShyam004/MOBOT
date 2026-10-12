package com.openmausbot.companion.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.openmausbot.companion.core.ConnectedAppsRules
import com.openmausbot.companion.core.ConnectorAccount
import com.openmausbot.companion.core.ConnectorCard
import com.openmausbot.companion.core.ConnectorCatalog
import com.openmausbot.companion.core.ConnectorStatus
import com.openmausbot.companion.core.ConnectorStatuses
import com.openmausbot.companion.core.DeploymentAccountInfo
import kotlinx.coroutines.launch

/**
 * The paired-phone inventory for apps connected on the computer.
 *
 * Authorization deliberately leaves the app for the system browser. The
 * desktop owns provider credentials and revocation, and the paired phone only
 * starts an authorization flow and reports the inventory it was given.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectedAppsScreen(onBack: () -> Unit) {
    val environment = LocalCompanion.current
    val session = environment.session
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var catalog by remember { mutableStateOf<ConnectorCatalog?>(null) }
    var inventory by remember { mutableStateOf(ConnectedAppsInventory()) }
    var deploymentAccounts by remember { mutableStateOf<List<DeploymentAccountInfo>>(emptyList()) }
    // Everything typed, and the dialog holding it, outlive a rotation: this
    // Activity is recreated on one, and the catalog behind them is re-fetched.
    var query by rememberSaveable { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var aliasTarget by rememberSaveable(stateSaver = AliasTargetSaver) {
        mutableStateOf<AliasTarget?>(null)
    }
    var alias by rememberSaveable { mutableStateOf("") }
    // The project key is typed once and never echoed back: the field starts
    // empty even on the setup step for an already-configured host.
    var setupOpen by rememberSaveable { mutableStateOf(false) }
    var setupKey by rememberSaveable { mutableStateOf("") }
    var setupSurface by rememberSaveable { mutableStateOf("connect") }
    var setupError by rememberSaveable { mutableStateOf<String?>(null) }
    var savingSetup by remember { mutableStateOf(false) }

    suspend fun refresh(showProgress: Boolean = false) {
        if (showProgress) refreshing = true
        try {
            session.loadAllConnectorStatuses()?.let { response ->
                inventory = ConnectedAppsPolicy.accept(inventory, response)
            }
            deploymentAccounts = session.deploymentAccounts()
        } finally {
            if (showProgress) refreshing = false
        }
    }

    fun authorize(slug: String, accountAlias: String?) {
        scope.launch {
            val url = session.authorizeConnector(slug, accountAlias) ?: return@launch
            // The core client accepts only a well-formed HTTPS URL.
            openConnectorAuthorization(context, session, url)
        }
    }

    LaunchedEffect(Unit) {
        loading = true
        try {
            catalog = session.loadConnectorCatalog()
            deploymentAccounts = session.deploymentAccounts()
            refresh()
        } finally {
            loading = false
        }
    }

    // Authorization finishes in the browser, so the answer arrives while this
    // screen is away — iOS re-reads on `scenePhase == .active`
    // (`ios/App/ConnectedAppsView.swift:90-92`), without the full-screen
    // spinner its `load` uses. The first resume is this screen's own entry,
    // which the effect above already loaded, so it is skipped rather than
    // asking twice.
    var entered by remember { mutableStateOf(false) }
    LifecycleResumeEffect(Unit) {
        if (entered) scope.launch { refresh() } else entered = true
        onPauseOrDispose {}
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HeaderBackButton(onBack)
            Text("Connected Apps", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            TextButton(
                onClick = { scope.launch { refresh(showProgress = true) } },
                enabled = !refreshing,
            ) { Text(if (refreshing) "Refreshing…" else "Refresh") }
        }
        HorizontalDivider()

        // The same gesture the roster uses for the same question (RosterScreen.kt:167),
        // and iOS's `.refreshable` (ConnectedAppsView.swift:89).
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refresh(showProgress = true) } },
            modifier = Modifier.fillMaxSize(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                AppTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = "Search apps",
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                // Cloud & Deployment section (Vercel & Render)
                val showVercel = query.isBlank() ||
                    "vercel".contains(query.trim(), ignoreCase = true) ||
                    "cloud".contains(query.trim(), ignoreCase = true) ||
                    "deploy".contains(query.trim(), ignoreCase = true)
                val showRender = query.isBlank() ||
                    "render".contains(query.trim(), ignoreCase = true) ||
                    "cloud".contains(query.trim(), ignoreCase = true) ||
                    "deploy".contains(query.trim(), ignoreCase = true)

                if (showVercel || showRender) {
                    AppSectionHeader(
                        text = "Cloud Deployment",
                        modifier = Modifier.padding(top = AppSpacing.xs, bottom = AppSpacing.xs),
                    )

                    val vercelAccount = deploymentAccounts.find { it.provider == "vercel" } ?: DeploymentAccountInfo(provider = "vercel")
                    val renderAccount = deploymentAccounts.find { it.provider == "render" } ?: DeploymentAccountInfo(provider = "render")

                    if (showVercel) {
                        ProviderAccountCard(
                            providerId = "vercel",
                            providerName = "Vercel",
                            providerTagline = "Next.js, React, Node.js & Static Sites",
                            tokenPlaceholder = "ver_xxxxxxxxxxxxxxxxxxxx",
                            tokenHelpUrl = "vercel.com/account/tokens",
                            accountInfo = vercelAccount,
                            onConnect = { token ->
                                val ok = session.connectDeploymentAccount("vercel", token)
                                if (ok) refresh()
                                ok
                            },
                            onTest = {
                                val ok = session.testDeploymentAccount("vercel")
                                refresh()
                                ok
                            },
                            onDisconnect = {
                                scope.launch {
                                    val ok = session.disconnectDeploymentAccount("vercel")
                                    if (ok) refresh()
                                }
                            },
                        )
                    }

                    if (showRender) {
                        ProviderAccountCard(
                            providerId = "render",
                            providerName = "Render",
                            providerTagline = "Web Services & Full-Stack Apps",
                            tokenPlaceholder = "rnd_xxxxxxxxxxxxxxxxxxxx",
                            tokenHelpUrl = "dashboard.render.com/u/settings#api-keys",
                            accountInfo = renderAccount,
                            onConnect = { token ->
                                val ok = session.connectDeploymentAccount("render", token)
                                if (ok) refresh()
                                ok
                            },
                            onTest = {
                                val ok = session.testDeploymentAccount("render")
                                refresh()
                                ok
                            },
                            onDisconnect = {
                                scope.launch {
                                    val ok = session.disconnectDeploymentAccount("render")
                                    if (ok) refresh()
                                }
                            },
                        )
                    }
                }

                val filteredCards = ConnectedAppsPolicy.filterCards(catalog?.cards.orEmpty(), query)
                if (filteredCards.isNotEmpty() || ConnectedAppsPolicy.showSetupNotice(catalog, inventory.credentialStoreUnreadable)) {
                    AppSectionHeader(
                        text = "Workspace Services",
                        modifier = Modifier.padding(top = AppSpacing.xs, bottom = AppSpacing.xs),
                    )
                }

                if (inventory.credentialStoreUnreadable) {
                    CredentialStoreWarning(hasLastKnownInventory = inventory.statuses != null)
                }

                if (ConnectedAppsPolicy.showSetupNotice(catalog, inventory.credentialStoreUnreadable)) {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text("Connected apps need setup", fontWeight = FontWeight.SemiBold)
                            Text(
                                "Add your Composio Connect consumer key (ck_...) or Platform Project API key (ak_...). The key is stored securely on the host and never reaches phones or bots.",
                                color = secondaryTint,
                                fontSize = 13.sp,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                TextButton(onClick = {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(COMPOSIO_DASHBOARD_URL)))
                                }) { Text("Get a key") }
                                TextButton(onClick = { setupOpen = true }) { Text("Set up") }
                            }
                        }
                    }
                }

                filteredCards.forEach { card ->
                    ConnectorCardView(
                        card = card,
                        status = inventory.statuses?.get(card.slug),
                        hasAuthoritativeInventory = inventory.statuses != null,
                        configured = catalog?.configured == true,
                        onConnect = { authorize(card.slug, ConnectedAppsRules.firstAccountAlias) },
                        onAddAccount = {
                            alias = ""
                            aliasTarget = AliasTarget(slug = card.slug, label = card.label)
                        },
                        onDisconnect = {
                            scope.launch {
                                if (session.disconnectConnector(card.slug)) refresh(showProgress = true)
                            }
                        },
                    )
                }

                if (catalog?.configured == true) {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "Connected through Composio",
                                color = secondaryTint,
                                fontSize = 13.sp,
                                modifier = Modifier.weight(1f),
                            )
                            TextButton(
                                enabled = !savingSetup,
                                onClick = {
                                    scope.launch {
                                        savingSetup = true
                                        if (session.saveComposioKey("") != null) {
                                            catalog = session.loadConnectorCatalog()
                                            refresh()
                                        }
                                        savingSetup = false
                                    }
                                },
                            ) { Text("Remove key") }
                        }
                    }
                }

                if (!loading && catalog?.cards.isNullOrEmpty()) {
                    Text("No connected apps are available from this computer.", color = secondaryTint)
                }

                if (loading) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
                    }
                }
            }
        }
    }

    aliasTarget?.let { target ->
        val normalized = ConnectedAppsRules.additionalAccountAlias(alias)
        AlertDialog(
            onDismissRequest = { aliasTarget = null },
            title = { Text("Account alias") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    AppTextField(
                        value = alias,
                        onValueChange = { alias = it },
                        label = "Work, Personal, Client…",
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        "An alias makes the account explicit when an agent uses more than one ${target.label} account.",
                        color = secondaryTint,
                        fontSize = 13.sp,
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = normalized != null,
                    onClick = {
                        aliasTarget = null
                        authorize(target.slug, normalized)
                    },
                ) { Text("Continue") }
            },
            dismissButton = { TextButton(onClick = { aliasTarget = null }) { Text("Cancel") } },
        )
    }

    if (setupOpen) {
        val trimmedKey = setupKey.trim()
        val hasPlatformPrefix = trimmedKey.startsWith("ak_")
        val hasConnectPrefix = trimmedKey.startsWith("ck_")
        val mismatchWarning = when {
            setupSurface == "connect" && hasPlatformPrefix ->
                "You provided a Platform key (ak_...). Select Composio Platform above."
            setupSurface == "platform" && hasConnectPrefix ->
                "You provided a Connect key (ck_...). Select Composio Connect above."
            trimmedKey.isNotBlank() && !hasPlatformPrefix && !hasConnectPrefix ->
                "Key format should start with ${if (setupSurface == "connect") "ck_" else "ak_"}."
            else -> null
        }

        AlertDialog(
            onDismissRequest = { if (!savingSetup) setupOpen = false },
            title = { Text("Connect Composio") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Select connection surface:", fontSize = 13.sp, fontWeight = FontWeight.Medium)

                    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                        SegmentedButton(
                            selected = setupSurface == "connect",
                            onClick = {
                                setupSurface = "connect"
                                setupError = null
                            },
                            shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                        ) {
                            Text("Connect (ck_)", fontSize = 12.sp)
                        }
                        SegmentedButton(
                            selected = setupSurface == "platform",
                            onClick = {
                                setupSurface = "platform"
                                setupError = null
                            },
                            shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                        ) {
                            Text("Platform (ak_)", fontSize = 12.sp)
                        }
                    }

                    if (setupSurface == "connect") {
                        Text(
                            "Composio Connect / For You\nAuthentication: Connect MCP (x-consumer-api-key)\nFor personal accounts connected at dashboard.composio.dev.",
                            color = secondaryTint,
                            fontSize = 12.sp,
                        )
                        AppTextField(
                            value = setupKey,
                            onValueChange = {
                                setupKey = it
                                setupError = null
                            },
                            label = "Consumer key (ck_...)",
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else {
                        Text(
                            "Composio Platform\nAuthentication: Platform API (x-api-key)\nFor project sessions with multi-account routing.",
                            color = secondaryTint,
                            fontSize = 12.sp,
                        )
                        AppTextField(
                            value = setupKey,
                            onValueChange = {
                                setupKey = it
                                setupError = null
                            },
                            label = "Project API key (ak_...)",
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    if (mismatchWarning != null) {
                        Text(
                            mismatchWarning,
                            color = MaterialTheme.colorScheme.tertiary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }

                    if (setupError != null) {
                        Text(
                            setupError ?: "",
                            color = MaterialTheme.colorScheme.error,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }

                    Text(
                        "The key is stored securely on the host and never logged or displayed again.",
                        color = secondaryTint,
                        fontSize = 11.sp,
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !savingSetup && setupKey.isNotBlank(),
                    onClick = {
                        scope.launch {
                            savingSetup = true
                            setupError = null
                            val status = session.saveComposioKey(setupKey.trim(), setupSurface)
                            if (status != null) {
                                setupKey = ""
                                setupOpen = false
                                setupError = null
                                catalog = session.loadConnectorCatalog()
                                refresh()
                            } else {
                                setupError = session.actionError ?: "Connection failed"
                            }
                            savingSetup = false
                        }
                    },
                ) { Text(if (savingSetup) "Saving…" else "Save") }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        setupOpen = false
                        setupError = null
                    },
                    enabled = !savingSetup,
                ) { Text("Cancel") }
            },
        )
    }
}

/** The one place the setup card sends someone to create a project key. */
private const val COMPOSIO_DASHBOARD_URL = "https://dashboard.composio.dev"

/**
 * What the alias dialog is about: the connector it will authorize and the name
 * it says out loud. Kept apart from [ConnectorCard] because it has to survive a
 * rotation on its own — the catalog it came from is being fetched again at that
 * moment, and a dialog holding typed text cannot wait for the network.
 */
private data class AliasTarget(val slug: String, val label: String)

private val AliasTargetSaver = listSaver<AliasTarget?, String>(
    save = { target -> target?.let { listOf(it.slug, it.label) }.orEmpty() },
    restore = { saved -> saved.takeIf { it.size == 2 }?.let { AliasTarget(it[0], it[1]) } },
)

@Composable
private fun CredentialStoreWarning(hasLastKnownInventory: Boolean) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Accounts could not be re-checked", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.tertiary)
            Text(
                if (hasLastKnownInventory) {
                    "Showing what was connected last time. Your computer could not open its credential store just now, so these accounts could not be re-checked. Nothing has been disconnected — restarting MOBOT on your computer usually clears this."
                } else {
                    "Your computer could not open its credential store, so it cannot say which accounts are connected. Nothing has been disconnected — restarting MOBOT on your computer usually clears this."
                },
                color = secondaryTint,
                fontSize = 13.sp,
            )
        }
    }
}

@Composable
private fun ConnectorCardView(
    card: ConnectorCard,
    status: ConnectorStatus?,
    hasAuthoritativeInventory: Boolean,
    configured: Boolean,
    onConnect: () -> Unit,
    onAddAccount: () -> Unit,
    onDisconnect: () -> Unit,
) {
    val accounts = status?.accounts.orEmpty()
    val connected = status?.connected == true
    val pending = status?.pending == true

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(card.label, fontWeight = FontWeight.SemiBold)
                    Text(card.blurb, color = secondaryTint, fontSize = 13.sp)
                }
                if (pending) Text("Connecting…", color = secondaryTint, fontSize = 13.sp)
            }

            when {
                !hasAuthoritativeInventory -> Text("Connection unknown", color = secondaryTint)
                accounts.isEmpty() && !connected && !pending -> Button(onClick = onConnect, enabled = configured) {
                    Text("Connect ${card.label}")
                }
                accounts.isEmpty() -> {
                    Text(if (pending) "Connecting…" else "Connected")
                    Text(
                        "Account details are unavailable from this provider. Refresh after authorization finishes.",
                        color = secondaryTint,
                        fontSize = 13.sp,
                    )
                }
                else -> {
                    accounts.forEach { account -> ConnectorAccountRow(account) }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        // Kept and disabled at the limit, so the limit is legible
                        // (`ios/App/ConnectedAppsView.swift:159-163`); hiding the
                        // button leaves the ceiling to be guessed at.
                        TextButton(
                            onClick = onAddAccount,
                            enabled = ConnectedAppsRules.canAddAnotherAccount(accounts),
                        ) { Text("Add another account") }
                        // Disconnecting happens provider-side: the harness asks
                        // Composio to revoke, this screen only shows the answer.
                        TextButton(onClick = onDisconnect) { Text("Disconnect") }
                    }
                }
            }
        }
    }
}

@Composable
private fun ConnectorAccountRow(account: ConnectorAccount) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(account.displayName)
            Text(ConnectedAppsPolicy.statusLabel(account.status), color = secondaryTint, fontSize = 12.sp)
            SelectionContainer { Text(account.id, color = secondaryTint, fontSize = 11.sp) }
        }
        Text(if (account.isActive) "Active" else "Pending", color = secondaryTint, fontSize = 12.sp)
    }
}

/** Pure state transition so an unavailable store can never erase a known inventory. */
data class ConnectedAppsInventory(
    val statuses: Map<String, ConnectorStatus>? = null,
    val credentialStoreUnreadable: Boolean = false,
)

object ConnectedAppsPolicy {
    fun accept(previous: ConnectedAppsInventory, response: ConnectorStatuses): ConnectedAppsInventory =
        if (response.isAuthoritative) {
            ConnectedAppsInventory(statuses = response.services)
        } else {
            previous.copy(credentialStoreUnreadable = true)
        }

    /**
     * The provider's own wire word, made readable —
     * `status.replacingOccurrences(of: "_", with: " ").capitalized` in
     * `ios/App/ConnectedAppsView.swift:144`. Case is fixed, not the phone's
     * locale: these are ASCII protocol words, not prose.
     */
    fun statusLabel(status: String): String =
        status.replace('_', ' ').split(' ').joinToString(" ") { word ->
            word.lowercase().replaceFirstChar(Char::uppercaseChar)
        }

    fun showSetupNotice(catalog: ConnectorCatalog?, credentialStoreUnreadable: Boolean): Boolean =
        catalog?.configured == false && !credentialStoreUnreadable

    fun filterCards(cards: List<ConnectorCard>, query: String): List<ConnectorCard> {
        val needle = query.trim()
        if (needle.isEmpty()) return cards
        return cards.filter { card ->
            card.label.contains(needle, ignoreCase = true) || card.slug.contains(needle, ignoreCase = true)
        }
    }
}
