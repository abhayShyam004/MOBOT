package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.McpProbeResult
import com.openmausbot.companion.core.McpSecret
import com.openmausbot.companion.core.McpServerConfig
import com.openmausbot.companion.core.McpServerListing
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.launch

/** Copy shared by the two MCP surfaces (Settings section + bot sheet Tools). */
internal const val MCP_TOOLS_FOOTER =
    "Tools from the enabled MCP servers this bot can see. Every tool call asks " +
        "for approval before it runs, unless you allow it for the thread."

/** The outcome of the last per-server Test press, shown under the row. */
data class McpProbeState(
    val name: String? = null,
    val running: Boolean = false,
    val result: McpProbeResult? = null,
)

/**
 * The Settings → MCP servers section: the host's custom-tool catalog with
 * enable switches, per-server Test/Edit/Remove, add (command or URL) and
 * paste-import. State ownership is [Session.mcpServers] — this composable
 * renders it and routes intents back through Session, so a change here is
 * immediately visible to every other MCP surface (e.g. an open bot sheet).
 */
@Composable
internal fun McpSection(session: Session) {
    val catalog by session.mcp.servers.collectAsState()
    val scope = rememberCoroutineScope()
    var mcpLoadFailed by remember { mutableStateOf(false) }
    var mcpEditor by remember { mutableStateOf<McpEditorDraft?>(null) }
    var mcpProbe by remember { mutableStateOf(McpProbeState()) }
    var confirmingMcpDelete by remember { mutableStateOf<McpServerListing?>(null) }
    var showingMcpImport by remember { mutableStateOf(false) }

    SettingsGroup("MCP servers") {
        val servers = catalog
        when {
            servers == null -> {
                SettingsRow("Status", if (mcpLoadFailed) "Could not load — try again" else "Loading…")
                SettingsLink(
                    text = if (mcpLoadFailed) "Retry" else "Add MCP server",
                    enabled = mcpLoadFailed,
                ) {
                    if (mcpLoadFailed) {
                        scope.launch { mcpLoadFailed = !session.mcp.refresh() }
                    } else {
                        mcpEditor = McpEditorDraft.new()
                    }
                }
            }
            servers.isEmpty() -> {
                SettingsRow("Status", "None configured")
                SettingsLink("Add MCP server") { mcpEditor = McpEditorDraft.new() }
            }
            else -> {
                servers.forEach { server ->
                    McpServerRow(
                        server = server,
                        onToggle = { scope.launch { session.mcp.setEnabled(server.name, !server.enabled) } },
                        onEdit = { mcpEditor = McpEditorDraft.edit(server) },
                        onTest = {
                            scope.launch {
                                mcpProbe = McpProbeState(name = server.name, running = true)
                                mcpProbe = McpProbeState(
                                    name = server.name,
                                    running = false,
                                    result = session.mcp.probe(server.name),
                                )
                            }
                        },
                        onDelete = { confirmingMcpDelete = server },
                    )
                }
                SettingsLink("Add MCP server") { mcpEditor = McpEditorDraft.new() }
                SettingsLink("Paste config block") { showingMcpImport = true }
                if (mcpProbe.running || mcpProbe.result != null) {
                    Footnote(
                        when {
                            mcpProbe.running -> "Testing ${mcpProbe.name}…"
                            mcpProbe.result?.ok == true ->
                                "${mcpProbe.name}: reachable, " +
                                    (mcpProbe.result?.tools?.size ?: 0) + " tool(s)"
                            else -> mcpProbe.result?.error ?: "Test failed."
                        },
                    )
                }
                Footnote(
                    "Tools from enabled servers are offered to bots here, with an " +
                        "approval before anything runs. Each bot picks which servers it " +
                        "sees in its settings.",
                )
            }
        }
    }

    confirmingMcpDelete?.let { server ->
        AlertDialog(
            onDismissRequest = { confirmingMcpDelete = null },
            title = { Text("Remove ${server.name}?") },
            text = { Text("Bots using its tools will no longer be offered them. The server itself is not touched.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmingMcpDelete = null
                        scope.launch { session.mcp.delete(server.name) }
                    },
                ) { Text("Remove", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmingMcpDelete = null }) { Text("Cancel") }
            },
        )
    }

    if (showingMcpImport) {
        var importText by remember { mutableStateOf("") }
        var importing by remember { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { if (!importing) showingMcpImport = false },
            title = { Text("Paste config block") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Paste a {\"mcpServers\": {…}} block from Claude Desktop, Claude Code, " +
                            "Cursor or any other agent tool. Entries land disabled.",
                        fontSize = 14.sp,
                    )
                    AppTextField(
                        value = importText,
                        singleLine = false,
                        onValueChange = { importText = it },
                        placeholder = "{\"mcpServers\": { … }}",
                        minLines = 4,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = importText.isNotBlank() && !importing,
                    onClick = {
                        scope.launch {
                            importing = true
                            val ok = session.mcp.import(importText)
                            importing = false
                            if (ok) {
                                showingMcpImport = false
                            }
                        }
                    },
                ) { Text("Import") }
            },
            dismissButton = {
                TextButton(onClick = { showingMcpImport = false }, enabled = !importing) { Text("Cancel") }
            },
        )
    }

    mcpEditor?.let { draft ->
        McpServerEditorDialog(
            draft = draft,
            onDismiss = { mcpEditor = null },
            onSave = { name, config ->
                scope.launch {
                    val ok = if (draft.isNew) session.mcp.add(name, config) else session.mcp.replace(name, config)
                    if (ok) mcpEditor = null
                }
            },
        )
    }
}

/** One row of the catalog: enable switch, then Test / Edit / Remove. */
@Composable
private fun McpServerRow(
    server: McpServerListing,
    onToggle: () -> Unit,
    onEdit: () -> Unit,
    onTest: () -> Unit,
    onDelete: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = MIN_TOUCH_TARGET),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(server.name, fontSize = 15.sp)
                Text(
                    text = when {
                        server.isRemote -> "${server.type ?: "http"} · ${shortenedAddress(server.url.orEmpty())}"
                        else -> (listOfNotNull(server.command) + server.args.orEmpty()).joinToString(" ")
                    },
                    fontSize = 13.sp,
                    fontFamily = FontFamily.Monospace,
                    color = secondaryTint,
                    maxLines = 1,
                    overflow = TextOverflow.MiddleEllipsis,
                )
            }
            Switch(checked = server.enabled, onCheckedChange = { onToggle() })
        }
        Row {
            TextButton(onClick = onTest) { Text("Test") }
            TextButton(onClick = onEdit) { Text("Edit") }
            TextButton(onClick = onDelete) {
                Text("Remove", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

/** What the editor dialog holds: an empty form, or one seeded from a listing.
 * Secrets never arrive in a listing, so an edit starts them empty — the
 * server keeps whatever was stored unless new values are typed. */
data class McpEditorDraft(
    val isNew: Boolean,
    val name: String,
    val remote: Boolean,
    val type: String,
    val url: String,
    val command: String,
    val args: String,
    val envPairs: List<Pair<String, String>>,
    val headerPairs: List<Pair<String, String>>,
) {
    companion object {
        private val oneBlank = listOf("" to "")

        fun new(): McpEditorDraft = McpEditorDraft(
            isNew = true,
            name = "",
            remote = false,
            type = "http",
            url = "",
            command = "",
            args = "",
            envPairs = oneBlank,
            headerPairs = oneBlank,
        )

        fun edit(server: McpServerListing): McpEditorDraft = McpEditorDraft(
            isNew = false,
            name = server.name,
            remote = server.isRemote,
            type = server.type ?: "http",
            url = server.url.orEmpty(),
            command = server.command.orEmpty(),
            args = server.args.orEmpty().joinToString(" "),
            envPairs = server.envKeys.orEmpty().map { it to "" }.ifEmpty { oneBlank },
            headerPairs = server.headerKeys.orEmpty().map { it to "" }.ifEmpty { oneBlank },
        )
    }
}

/** The add/edit form. Mirrors the desktop panel: name + command/args/env for
 * a local server, name + transport + URL/headers for a remote one; blank
 * secret values keep whatever the server has stored. */
@Composable
private fun McpServerEditorDialog(
    draft: McpEditorDraft,
    onDismiss: () -> Unit,
    onSave: (name: String, config: McpServerConfig) -> Unit,
) {
    var name by remember { mutableStateOf(draft.name) }
    var remote by remember { mutableStateOf(draft.remote) }
    var type by remember { mutableStateOf(draft.type) }
    var url by remember { mutableStateOf(draft.url) }
    var command by remember { mutableStateOf(draft.command) }
    var args by remember { mutableStateOf(draft.args) }
    var envPairs by remember { mutableStateOf(draft.envPairs) }
    var headerPairs by remember { mutableStateOf(draft.headerPairs) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (draft.isNew) "Add MCP server" else "Edit ${draft.name}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (draft.isNew) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !remote, onClick = { remote = false }, label = { Text("Command") })
                        FilterChip(selected = remote, onClick = { remote = true }, label = { Text("URL") })
                    }
                    AppTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = "Name (lowercase letters, digits, -)",
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (remote) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = type == "http", onClick = { type = "http" }, label = { Text("HTTP (streamable)") })
                        FilterChip(selected = type == "sse", onClick = { type = "sse" }, label = { Text("SSE (legacy)") })
                    }
                    AppTextField(
                        value = url,
                        onValueChange = { url = it },
                        label = "Server URL",
                        placeholder = "https://mcp.example.com/mcp",
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    AppTextField(
                        value = command,
                        onValueChange = { command = it },
                        label = "Command",
                        placeholder = "node",
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    AppTextField(
                        value = args,
                        onValueChange = { args = it },
                        label = "Arguments (space separated)",
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                SecretPairsEditor(
                    label = if (remote) "Headers (name, value — blank keeps stored)" else "Environment (name, value — blank keeps stored)",
                    pairs = if (remote) headerPairs else envPairs,
                    onChange = { if (remote) headerPairs = it else envPairs = it },
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = if (draft.isNew) name.isNotBlank() && (if (remote) url.isNotBlank() else command.isNotBlank()) else true,
                onClick = {
                    val secrets = (if (remote) headerPairs else envPairs)
                        .filter { (key, _) -> key.isNotBlank() }
                        .associate { (key, value) ->
                            key.trim() to (value.takeIf { it.isNotBlank() }?.let(McpSecret::Value) ?: McpSecret.KeepStored)
                        }
                    val config = if (remote) {
                        McpServerConfig.Url(type = type, url = url.trim(), headers = secrets)
                    } else {
                        McpServerConfig.Command(
                            command = command.trim(),
                            args = args.trim().split(' ').filter { it.isNotEmpty() },
                            env = secrets,
                        )
                    }
                    onSave(name.trim(), config)
                },
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

/** Name/value rows for env vars or headers. A typed name with an empty value
 * means "keep the stored secret" — the server's write-only placeholder. */
@Composable
private fun SecretPairsEditor(
    label: String,
    pairs: List<Pair<String, String>>,
    onChange: (List<Pair<String, String>>) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, fontSize = 13.sp, color = secondaryTint)
        pairs.forEachIndexed { index, (key, value) ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                AppTextField(
                    value = key,
                    onValueChange = { newKey ->
                        onChange(pairs.toMutableList().also { it[index] = newKey to value })
                    },
                    label = "Name",
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                AppTextField(
                    value = value,
                    onValueChange = { newValue ->
                        onChange(pairs.toMutableList().also { it[index] = key to newValue })
                    },
                    label = "Value",
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.weight(1f),
                )
            }
        }
        TextButton(onClick = { onChange(pairs + ("" to "")) }) { Text("Add another") }
    }
}
