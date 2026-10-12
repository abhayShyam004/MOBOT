package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
        load("MEMORY.md")
        loading = false
    }

    fun reload() {
        scope.launch {
            overview = session.memoryOverview(botId)
            doc?.let { load(it.path) }
        }
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
            Column {
                Text("Memory", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                bot?.let { Text(it.name, fontSize = 13.sp, color = secondaryTint) }
            }
        }

        if (loading) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(24.dp),
                horizontalArrangement = Arrangement.Center,
            ) { CircularProgressIndicator() }
            return@Column
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            val current = overview
            if (current == null) {
                Text(
                    "This bot's memory isn't available from the computer right now.",
                    fontSize = 14.sp,
                    color = secondaryTint,
                )
            } else {
                MemoryCapacityBar(current)
            }

            val editing = doc
            if (editing != null) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = if (editing.path == "MEMORY.md") "Always remembered" else editing.path,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = secondaryTint,
                    )
                    Text(
                        text = if (editing.path == "MEMORY.md") {
                            "Read back at the start of every session — alone and in any room. Keep it to facts that hold every time."
                        } else {
                            "A topic the bot reads on demand when it is relevant."
                        },
                        fontSize = 13.sp,
                        color = secondaryTint,
                    )
                    AppTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        // A memory is prose, and prose is more than one line:
                        // this field used to inherit the component's single-line
                        // default, which drew the whole file inside one line's
                        // worth of height where nothing past the first line could
                        // be read or even seen while editing.
                        singleLine = false,
                        minLines = 8,
                        enabled = !saving,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 180.dp),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            enabled = !saving && draft != editing.text,
                            onClick = {
                                saving = true
                                error = null
                                scope.launch {
                                    val ok = session.saveMemoryFile(botId, editing.path, draft, editing.hash)
                                    saving = false
                                    if (ok) reload() else {
                                        error = session.actionError ?: "Couldn't save this memory."
                                        session.actionError = null
                                        // A hash conflict means the bot wrote in between: show its version.
                                        reload()
                                    }
                                }
                            },
                        ) { Text(if (saving) "Saving…" else "Save") }
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
                            ) { Text("Delete file", color = MaterialTheme.colorScheme.error) }
                        }
                    }
                }
            }

            error?.let {
                Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
            }

            val others = buildList {
                overview?.topics?.let { addAll(it) }
                overview?.logs?.let { addAll(it) }
            }
            if (others.isNotEmpty()) {
                Text(
                    "Also remembered",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = secondaryTint,
                )
                LazyColumn(modifier = Modifier.heightIn(max = 260.dp)) {
                    items(others, key = { it.path }) { file ->
                        MemoryFileRow(
                            file = file,
                            selected = file.path == doc?.path,
                            onOpen = { scope.launch { load(file.path) } },
                        )
                    }
                }
            }

            overview?.workspacePath?.takeIf { it.isNotBlank() }?.let {
                Text(
                    "These are plain markdown files on the computer: $it",
                    fontSize = 12.sp,
                    color = secondaryTint,
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
