package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.MemoryDoc
import com.openmausbot.companion.core.MemoryFileInfo
import com.openmausbot.companion.core.MemoryOverview
import kotlinx.coroutines.launch

/**
 * A bot's memory — its own page, not a row in bot settings.
 *
 * Every bot keeps its memory in its own workspace: MEMORY.md is read back at
 * the start of every session, alone and in a room, and the topic files hold
 * the longer notes it reads on demand. Nothing here is shared with another
 * bot unless someone copies the text themselves, which is the whole point of
 * it being a separate page: what one agent knows stays with that agent.
 *
 * The files are plain markdown on the computer, so this page edits exactly
 * what a person would open in an editor — and a save carries the hash it
 * read, so a note the bot wrote in between is never silently clobbered.
 */
@Composable
fun MemoryScreen(botId: String, onBack: () -> Unit) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    val state by session.state.collectAsState()
    val bot = remember(state, botId) { state.bot(botId) }

    var overview by remember { mutableStateOf<MemoryOverview?>(null) }
    var shared by remember { mutableStateOf<MemoryOverview?>(null) }
    var sharedDraft by remember { mutableStateOf("") }
    var sharedSaving by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var doc by remember { mutableStateOf<MemoryDoc?>(null) }
    var draft by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load(path: String) {
        val read = session.memoryFile(botId, path)
        if (read != null) {
            doc = read
            draft = read.text
        } else {
            error = session.actionError ?: "Couldn't read that memory file."
            session.actionError = null
        }
    }

    LaunchedEffect(botId) {
        loading = true
        overview = session.memoryOverview(botId)
        // The shared partition is the same for every bot on this page: it is
        // read from the team's workspace, not from this bot's, which is what
        // makes it survive a bot switch instead of being copied per bot.
        shared = session.sharedMemory()
        sharedDraft = shared?.text ?: ""
        load("MEMORY.md")
        loading = false
    }

    fun reload() {
        scope.launch {
            overview = session.memoryOverview(botId)
            val refreshed = session.sharedMemory()
            if (refreshed != null) {
                shared = refreshed
                sharedDraft = refreshed.text
            }
            doc?.let { load(it.path) }
        }
    }

    SettingsSubPage(
        title = "Agent Memory",
        subtitle = bot?.let { "${it.name} • Workspace Memory" } ?: "Persistent Knowledge & Notes",
        onBack = onBack,
    ) {
        if (loading) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(28.dp),
                    strokeWidth = 3.dp,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            return@SettingsSubPage
        }

        val current = overview
        if (current == null) {
            SettingsCard(
                title = "Memory Unavailable",
                subtitle = "This agent's memory files are not reachable from the host computer right now.",
            )
        } else {
            SettingsSection(title = "Memory Capacity & Index") {
                Box(modifier = Modifier.padding(16.dp)) {
                    MemoryCapacityBar(current)
                }
            }
        }

        // The other half of the partition: facts that are true for the whole
        // team. Read here, beside this bot's private index, so a bot switch
        // can be seen to change one and leave the other in place.
        val sharedPartition = shared
        if (sharedPartition != null) {
            val facts = sharedPartition.text
                .lineSequence()
                .map { it.trim() }
                .filter { it.startsWith("- ") || it.startsWith("* ") }                .map { it.removePrefix("- ").removePrefix("* ").trim() }
                .filter { it.isNotEmpty() }
                .toList()
            SettingsSection(title = "Shared Memory (every bot)") {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        "Team-wide facts: user preferences, cross-cutting projects, stable identity. Every bot reads them; none of them belongs to one bot, and switching bots leaves them in place.",
                        fontSize = 13.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                    if (facts.isEmpty() && sharedDraft == sharedPartition.text) {
                        Text("Nothing shared yet.", fontSize = 14.sp, color = AppTheme.colors.textTertiary)
                    }
                    AppTextField(
                        value = sharedDraft,
                        onValueChange = { sharedDraft = it },
                        singleLine = false,
                        minLines = 5,
                        enabled = !sharedSaving,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 120.dp),
                    )
                    Button(
                        enabled = !sharedSaving && sharedDraft != sharedPartition.text,
                        shape = RoundedCornerShape(12.dp),
                        onClick = {
                            sharedSaving = true
                            error = null
                            scope.launch {
                                val ok = session.saveSharedMemory(sharedDraft, sharedPartition.index.hash)
                                sharedSaving = false
                                if (ok) reload() else {
                                    error = session.actionError ?: "Couldn't save shared memory."
                                    session.actionError = null
                                    reload()
                                }
                            }
                        },
                    ) {
                        Text(if (sharedSaving) "Saving…" else "Save Shared Memory")
                    }
                }
            }
        }

        val editing = doc
        if (editing != null) {
            SettingsSection(
                title = if (editing.path == "MEMORY.md") "Core Memory (MEMORY.md)" else editing.path,
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        text = if (editing.path == "MEMORY.md") {
                            "Read back at the start of every session — alone and in any room. Keep it to facts that hold every time."
                        } else {
                            "A topic note the agent reads on demand when it is relevant."
                        },
                        fontSize = 13.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                    AppTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        singleLine = false,
                        minLines = 8,
                        enabled = !saving,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 180.dp),
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            enabled = !saving && draft != editing.text,
                            shape = RoundedCornerShape(12.dp),
                            onClick = {
                                saving = true
                                error = null
                                scope.launch {
                                    val ok = session.saveMemoryFile(botId, editing.path, draft, editing.hash)
                                    saving = false
                                    if (ok) reload() else {
                                        error = session.actionError ?: "Couldn't save this memory."
                                        session.actionError = null
                                        reload()
                                    }
                                }
                            },
                        ) {
                            Text(if (saving) "Saving…" else "Save Memory")
                        }
                        if (editing.path != "MEMORY.md") {
                            TextButton(
                                enabled = !saving,
                                onClick = {
                                    saving = true
                                    scope.launch {
                                        val ok = session.deleteMemoryFile(botId, editing.path)
                                        saving = false
                                        if (ok) {
                                            load("MEMORY.md")
                                            reload()
                                        } else {
                                            error = session.actionError ?: "Couldn't delete that file."
                                            session.actionError = null
                                        }
                                    }
                                },
                            ) {
                                Text("Delete File", color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }

        val currentError = error
        if (currentError != null) {
            Box(modifier = Modifier.padding(horizontal = 20.dp)) {
                Text(
                    currentError,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.Medium,
                )
            }
        }

        val others = buildList {
            overview?.topics?.let { addAll(it) }
            overview?.logs?.let { addAll(it) }
        }
        if (others.isNotEmpty()) {
            SettingsSection(title = "Topic & Log Notes (${others.size})") {
                others.forEachIndexed { index, file ->
                    SettingsRow(
                        title = file.name,
                        subtitle = "${file.bytes} bytes",
                        selected = file.path == doc?.path,
                        onClick = { scope.launch { load(file.path) } },
                    )
                    if (index < others.lastIndex) {
                        SettingsDivider()
                    }
                }
            }
        }

        val wsPath = overview?.workspacePath
        if (!wsPath.isNullOrBlank()) {
            Box(modifier = Modifier.padding(horizontal = 20.dp)) {
                Text(
                    text = "Stored as plain Markdown in workspace:\n$wsPath",
                    fontSize = 12.sp,
                    color = AppTheme.colors.textTertiary,
                )
            }
        }
    }
}

@Composable
private fun MemoryCapacityBar(overview: MemoryOverview) {
    val index = overview.index
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            "${index.loadedLines}/${index.maxLines} lines loaded",
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
        )
        val fraction = if (index.maxLines <= 0) 0f else (index.loadedLines.toFloat() / index.maxLines).coerceIn(0f, 1f)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 6.dp)
                .background(secondaryTint.copy(alpha = 0.2f), RoundedCornerShape(3.dp)),
        ) {
            if (fraction > 0f) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth(fraction)
                        .heightIn(min = 6.dp)
                        .background(
                            if (index.truncated) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                            RoundedCornerShape(3.dp),
                        ),
                ) {}
            }
        }
        if (index.truncated) {
            Text(
                "Over budget — the newest entries stop loading first. Trim it so the whole file is read.",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun MemoryFileRow(file: MemoryFileInfo, selected: Boolean, onOpen: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(file.name, fontSize = 15.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
            Text("${file.bytes} bytes", fontSize = 12.sp, color = secondaryTint)
        }
    }
}
