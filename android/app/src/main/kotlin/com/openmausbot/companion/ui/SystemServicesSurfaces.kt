package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.QuickCaptureResponse
import com.openmausbot.companion.core.SmartLinkAction
import com.openmausbot.companion.core.SmartLinkResponse
import com.openmausbot.companion.core.UniversalSearchResultItem
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * System Services & Integrations UI Surfaces (Phase VI / Master Prompt Lines 2620–2715)
 *
 * Implements:
 * 1. UniversalSearchSheet (Cross-system indexing: chats, bots, projects, files, routines)
 * 2. QuickCaptureSheet (Multi-source context capture + target bot delegation)
 * 3. SmartLinkActionCard (Contextual URL preview + actions with SSRF safety indicator)
 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UniversalSearchSheet(
    onDismiss: () -> Unit,
    onSelectResult: (UniversalSearchResultItem) -> Unit = {},
) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf("all") }
    var results by remember { mutableStateOf<List<UniversalSearchResultItem>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }

    fun doSearch(q: String, cat: String) {
        if (q.isBlank()) {
            results = emptyList()
            return
        }
        scope.launch {
            loading = true
            val catFilter = if (cat == "all") null else cat
            val resp = session.performUniversalSearch(q, catFilter)
            results = resp?.results ?: emptyList()
            loading = false
        }
    }

    LaunchedEffect(query, selectedCategory) {
        doSearch(query, selectedCategory)
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Universal Search",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = AppTheme.colors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = "Close",
                        tint = AppTheme.colors.textSecondary,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // Search input field
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Search chats, bots, projects, files, routines...") },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Filled.Search,
                        contentDescription = null,
                        tint = AppTheme.colors.textSecondary,
                    )
                },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
            )

            Spacer(Modifier.height(12.dp))

            // Category filter chips
            val categories = listOf("all" to "All", "chats" to "Chats", "bots" to "Bots", "projects" to "Projects", "files" to "Files", "routines" to "Routines")
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for ((key, label) in categories) {
                    val isSelected = selectedCategory == key
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .background(
                                if (isSelected) AppTheme.colors.accent else AppTheme.colors.surfaceRaised,
                            )
                            .clickable { selectedCategory = key }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    ) {
                        Text(
                            text = label,
                            fontSize = 12.sp,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            color = if (isSelected) Color.White else AppTheme.colors.textSecondary,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            if (loading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(140.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(28.dp))
                }
            } else if (query.isNotBlank() && results.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "No results matching \"$query\"",
                        fontSize = 14.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(bottom = 24.dp),
                ) {
                    items(results) { item ->
                        SearchResultRow(
                            item = item,
                            onClick = {
                                onSelectResult(item)
                                onDismiss()
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchResultRow(
    item: UniversalSearchResultItem,
    onClick: () -> Unit,
) {
    val categoryColor = when (item.category) {
        "bots" -> Color(0xFF14B8A6) // Teal
        "chats" -> Color(0xFF3B82F6) // Blue
        "projects" -> Color(0xFF8B5CF6) // Purple
        "files" -> Color(0xFFF59E0B) // Amber
        "routines" -> Color(0xFF10B981) // Green
        else -> AppTheme.colors.textSecondary
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(AppTheme.colors.surfaceRaised)
            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(12.dp),
    ) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Category Tag
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(categoryColor.copy(alpha = 0.15f))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text(
                        text = item.category.uppercase(),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = categoryColor,
                    )
                }

                Spacer(Modifier.width(8.dp))

                Text(
                    text = item.title,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AppTheme.colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )

                val badge = item.badge
                if (badge != null) {
                    Text(
                        text = badge,
                        fontSize = 11.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                }
            }

            val subtitle = item.subtitle
            if (subtitle != null) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = subtitle,
                    fontSize = 12.sp,
                    color = AppTheme.colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            val preview = item.preview
            if (preview != null) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = preview,
                    fontSize = 13.sp,
                    color = AppTheme.colors.textPrimary.copy(alpha = 0.85f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuickCaptureSheet(
    onDismiss: () -> Unit,
) {
    val session = LocalCompanion.current.session
    val state by session.state.collectAsState()
    val bots = state.bots
    val scope = rememberCoroutineScope()

    var captureType by remember { mutableStateOf("text") }
    var textInput by remember { mutableStateOf("") }
    var promptInput by remember { mutableStateOf("") }
    var selectedBotId by remember { mutableStateOf(bots.firstOrNull()?.id ?: "") }
    var loading by remember { mutableStateOf(false) }
    var lastPacket by remember { mutableStateOf<QuickCaptureResponse?>(null) }

    val suggestedActions = listOf("Summarize", "Extract Tasks", "Analyze & Report", "Review Code")

    fun submitCapture() {
        scope.launch {
            loading = true
            val payload = buildJsonObject {
                put("type", captureType)
                put("content", textInput)
                put("targetBotId", selectedBotId)
                put("userPrompt", promptInput)
            }
            val res = session.sendQuickCapture(payload)
            lastPacket = res
            loading = false
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Quick Capture",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = AppTheme.colors.textPrimary,
                    )
                    Text(
                        text = "Capture context & delegate to a bot",
                        fontSize = 12.sp,
                        color = AppTheme.colors.textSecondary,
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(imageVector = Icons.Filled.Close, contentDescription = "Close", tint = AppTheme.colors.textSecondary)
                }
            }

            Spacer(Modifier.height(14.dp))

            if (lastPacket != null) {
                // Success packet
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF10B981).copy(alpha = 0.12f))
                        .border(1.dp, Color(0xFF10B981).copy(alpha = 0.4f), RoundedCornerShape(12.dp))
                        .padding(16.dp),
                ) {
                    Column {
                        Text(
                            text = "✓ Context Captured Successfully",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF10B981),
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = lastPacket?.summary ?: "",
                            fontSize = 13.sp,
                            color = AppTheme.colors.textPrimary,
                        )
                        Spacer(Modifier.height(8.dp))
                        val packet = lastPacket
                        val recId = packet?.recommendedBotId
                        val recBot = bots.find { it.id == recId }
                        Text(
                            text = "ID: ${packet?.captureId} · Recommended: ${recBot?.name ?: "Rio"}",
                            fontSize = 11.sp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                }

                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Done")
                }
                Spacer(Modifier.height(12.dp))
                return@Column
            }

            // Context Type Selector
            val types = listOf("text" to "Text", "link" to "Web Link", "screenshot" to "Screenshot", "file" to "Document", "camera" to "Camera")
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for ((key, label) in types) {
                    val isSelected = captureType == key
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (isSelected) AppTheme.colors.accent else AppTheme.colors.surfaceRaised)
                            .clickable { captureType = key }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    ) {
                        Text(
                            text = label,
                            fontSize = 12.sp,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            color = if (isSelected) Color.White else AppTheme.colors.textSecondary,
                        )
                    }
                }
            }

            Spacer(Modifier.height(14.dp))

            // Input according to capture type
            when (captureType) {
                "text" -> {
                    OutlinedTextField(
                        value = textInput,
                        onValueChange = { textInput = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(110.dp),
                        placeholder = { Text("Paste or type text context...") },
                        shape = RoundedCornerShape(10.dp),
                    )
                }
                "link" -> {
                    OutlinedTextField(
                        value = textInput,
                        onValueChange = { textInput = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("https://example.com/...") },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                    )
                }
                else -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(AppTheme.colors.surfaceRaised)
                            .padding(14.dp),
                    ) {
                        Text(
                            text = "Live $captureType context will be packaged from the device.",
                            fontSize = 13.sp,
                            color = AppTheme.colors.textSecondary,
                        )
                    }
                }
            }

            Spacer(Modifier.height(14.dp))

            // Target Bot Selector
            Text(text = "Target Agent", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.textPrimary)
            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (b in bots) {
                    val isSelected = selectedBotId == b.id
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (isSelected) AppTheme.colors.accent.copy(alpha = 0.2f) else AppTheme.colors.surfaceRaised)
                            .border(1.dp, if (isSelected) AppTheme.colors.accent else AppTheme.colors.hairline, RoundedCornerShape(12.dp))
                            .clickable { selectedBotId = b.id }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(AppTheme.colors.accent),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                text = b.name,
                                fontSize = 12.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                color = AppTheme.colors.textPrimary,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(14.dp))

            // Action Prompt
            Text(text = "What should the agent do?", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.textPrimary)
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = promptInput,
                onValueChange = { promptInput = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("e.g. Extract action items and summarize...") },
                singleLine = true,
                shape = RoundedCornerShape(10.dp),
            )

            Spacer(Modifier.height(8.dp))

            // Suggested prompt pills
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                for (action in suggestedActions) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(AppTheme.colors.surfaceRaised)
                            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(12.dp))
                            .clickable { promptInput = action }
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Text(text = action, fontSize = 11.sp, color = AppTheme.colors.textSecondary)
                    }
                }
            }

            Spacer(Modifier.height(20.dp))

            // Submit Button
            Button(
                onClick = { submitCapture() },
                modifier = Modifier.fillMaxWidth(),
                enabled = !loading,
            ) {
                if (loading) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White)
                } else {
                    Text("Dispatch to Bot")
                }
            }

            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
fun SmartLinkActionCard(
    analysis: SmartLinkResponse,
    onActionClick: (SmartLinkAction) -> Unit = {},
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(AppTheme.colors.surfaceRaised)
            .border(1.dp, AppTheme.colors.hairline, RoundedCornerShape(12.dp))
            .padding(14.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (analysis.isSafe) Color(0xFF10B981).copy(alpha = 0.15f) else Color(0xFFEF4444).copy(alpha = 0.15f))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text(
                        text = if (analysis.isSafe) "SAFE" else "BLOCKED",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (analysis.isSafe) Color(0xFF10B981) else Color(0xFFEF4444),
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = analysis.domain,
                    fontSize = 12.sp,
                    color = AppTheme.colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }

            Spacer(Modifier.height(6.dp))

            Text(
                text = analysis.title ?: analysis.url,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.textPrimary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )

            val desc = analysis.description
            if (desc != null) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = desc,
                    fontSize = 12.sp,
                    color = AppTheme.colors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            if (analysis.suggestedActions.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                HorizontalDivider(color = AppTheme.colors.hairline)
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    for (act in analysis.suggestedActions) {
                        TextButton(
                            onClick = { onActionClick(act) },
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                        ) {
                            Text(text = act.label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}
