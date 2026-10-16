package com.openmausbot.companion.mascot

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.ui.AppRadii
import com.openmausbot.companion.ui.AppSpacing
import com.openmausbot.companion.ui.AppTheme
import com.openmausbot.companion.ui.AppType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Dedicated interactive showcase for the MOBOT Mascot System.
 * Demonstrates shapes, colors, facial expressions, animation states,
 * and responsive sizing in real-time.
 */
@Composable
fun MascotShowcaseScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AppTheme.colors
    val scope = rememberCoroutineScope()

    var selectedShape by remember { mutableStateOf(MascotShape.CLOUD) }
    var selectedPalette by remember { mutableStateOf(MascotPalette.BLUE) }
    var selectedEyeStyle by remember { mutableStateOf(MascotEyeStyle.TWIN_DOTS) }
    var selectedMouthStyle by remember { mutableStateOf(MascotMouthStyle.SMILE_ARC) }
    var selectedPersonality by remember { mutableStateOf(MascotPersonality.PLAYFUL) }
    var activityState by remember { mutableStateOf(MascotActivityState.IDLE) }
    var hasCheeks by remember { mutableStateOf(true) }
    var isSimulating by remember { mutableStateOf(false) }

    val currentMascot = remember(
        selectedShape,
        selectedPalette,
        selectedEyeStyle,
        selectedMouthStyle,
        selectedPersonality,
        hasCheeks,
    ) {
        MascotDefinition(
            id = "preview",
            shape = selectedShape,
            palette = selectedPalette,
            eyeStyle = selectedEyeStyle,
            mouthStyle = selectedMouthStyle,
            personality = selectedPersonality,
            hasCheeks = hasCheeks,
        )
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(colors.background),
    ) {
        // Top App Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = colors.textPrimary,
                )
            }
            Text(
                text = "Mascot Studio",
                style = AppType.screenTitle,
                color = colors.textPrimary,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = {
                selectedShape = MascotShape.entries.random()
                selectedPalette = MascotPalette.entries.random()
                selectedEyeStyle = MascotEyeStyle.entries.random()
                selectedPersonality = MascotPersonality.entries.random()
            }) {
                Icon(
                    imageVector = Icons.Filled.Refresh,
                    contentDescription = "Shuffle",
                    tint = colors.textSecondary,
                )
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = AppSpacing.gutter, vertical = AppSpacing.sm),
            verticalArrangement = Arrangement.spacedBy(AppSpacing.lg),
        ) {
            // 1. Hero Mascot Stage
            item(key = "hero_stage") {
                Surface(
                    shape = AppRadii.cardShape,
                    color = colors.elevatedSurface,
                    border = BorderStroke(1.dp, colors.subtleBorder),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(130.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            MascotView(
                                mascot = currentMascot,
                                activityState = activityState,
                                size = 110.dp,
                            )
                        }

                        // State Badges
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Surface(
                                shape = CircleShape,
                                color = colors.surfaceVariant,
                            ) {
                                Text(
                                    text = currentMascot.shape.label,
                                    style = AppType.caption,
                                    fontWeight = FontWeight.SemiBold,
                                    color = colors.textSecondary,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                                )
                            }
                            Surface(
                                shape = CircleShape,
                                color = colors.surfaceVariant,
                            ) {
                                Text(
                                    text = currentMascot.personality.label,
                                    style = AppType.caption,
                                    fontWeight = FontWeight.SemiBold,
                                    color = colors.accent,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                                )
                            }
                        }

                        // Activity State Selector
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            val states = listOf(
                                MascotActivityState.IDLE to "Idle",
                                MascotActivityState.THINKING to "Thinking",
                                MascotActivityState.WORKING to "Working",
                                MascotActivityState.WAITING to "Waiting",
                                MascotActivityState.SUCCESS to "Success",
                                MascotActivityState.ERROR to "Error",
                            )
                            states.forEach { (state, label) ->
                                val active = activityState == state
                                Surface(
                                    shape = CircleShape,
                                    color = if (active) colors.accent else colors.surfaceVariant,
                                    modifier = Modifier.clickable { activityState = state },
                                ) {
                                    Text(
                                        text = label,
                                        style = AppType.caption,
                                        fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                                        color = if (active) Color.White else colors.textSecondary,
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                    )
                                }
                            }
                        }

                        // Task Lifecycle Simulator Button
                        Button(
                            onClick = {
                                if (isSimulating) return@Button
                                isSimulating = true
                                scope.launch {
                                    activityState = MascotActivityState.IDLE
                                    delay(600)
                                    activityState = MascotActivityState.THINKING
                                    delay(1600)
                                    activityState = MascotActivityState.WORKING
                                    delay(2000)
                                    activityState = MascotActivityState.SUCCESS
                                    delay(1800)
                                    activityState = MascotActivityState.IDLE
                                    isSimulating = false
                                }
                            },
                            enabled = !isSimulating,
                            shape = AppRadii.pill,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = colors.accent,
                                contentColor = Color.White,
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(if (isSimulating) "Running Simulation…" else "Simulate Agent Task Cycle")
                        }
                    }
                }
            }

            // 2. Shape Selector
            item(key = "shapes_section") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Body Shape (${MascotShape.entries.size} Silhouettes)",
                        style = AppType.bodyEmphasized,
                        color = colors.textPrimary,
                    )
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(MascotShape.entries) { shape ->
                            val selected = shape == selectedShape
                            Surface(
                                shape = AppRadii.compactCardShape,
                                color = if (selected) colors.accent.copy(alpha = 0.15f) else colors.elevatedSurface,
                                border = BorderStroke(
                                    1.dp,
                                    if (selected) colors.accent else colors.subtleBorder,
                                ),
                                modifier = Modifier
                                    .clickable { selectedShape = shape }
                                    .padding(vertical = 2.dp),
                            ) {
                                Column(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    MascotView(
                                        mascot = currentMascot.copy(shape = shape),
                                        size = 36.dp,
                                        animated = false,
                                    )
                                    Text(
                                        text = shape.label,
                                        style = AppType.caption,
                                        color = if (selected) colors.accent else colors.textSecondary,
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // 3. Color Palette Selector
            item(key = "palettes_section") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Color Palette (${MascotPalette.entries.size} Tuned Colors)",
                        style = AppType.bodyEmphasized,
                        color = colors.textPrimary,
                    )
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(MascotPalette.entries) { palette ->
                            val spec = MascotColorSystem.specFor(palette)
                            val selected = palette == selectedPalette
                            Box(
                                modifier = Modifier
                                    .size(38.dp)
                                    .clip(CircleShape)
                                    .background(spec.primary)
                                    .clickable { selectedPalette = palette },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (selected) {
                                    Box(
                                        modifier = Modifier
                                            .size(14.dp)
                                            .clip(CircleShape)
                                            .background(Color.White),
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // 4. Eye Styles
            item(key = "eyes_section") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Eye Style",
                        style = AppType.bodyEmphasized,
                        color = colors.textPrimary,
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        MascotEyeStyle.entries.forEach { eye ->
                            val selected = eye == selectedEyeStyle
                            Surface(
                                shape = CircleShape,
                                color = if (selected) colors.accent else colors.surfaceVariant,
                                modifier = Modifier.clickable { selectedEyeStyle = eye },
                            ) {
                                Text(
                                    text = eye.label,
                                    style = AppType.caption,
                                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                    color = if (selected) Color.White else colors.textSecondary,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                )
                            }
                        }
                    }
                }
            }

            // 5. Personality Profiles
            item(key = "personality_section") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Personality Profile",
                        style = AppType.bodyEmphasized,
                        color = colors.textPrimary,
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        MascotPersonality.entries.forEach { pers ->
                            val selected = pers == selectedPersonality
                            Surface(
                                shape = CircleShape,
                                color = if (selected) colors.accent else colors.surfaceVariant,
                                modifier = Modifier.clickable { selectedPersonality = pers },
                            ) {
                                Text(
                                    text = pers.label,
                                    style = AppType.caption,
                                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                    color = if (selected) Color.White else colors.textSecondary,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                )
                            }
                        }
                    }
                }
            }

            // 6. Responsive Sizes Comparison
            item(key = "sizes_section") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Responsive Size Scale",
                        style = AppType.bodyEmphasized,
                        color = colors.textPrimary,
                    )
                    Surface(
                        shape = AppRadii.cardShape,
                        color = colors.elevatedSurface,
                        border = BorderStroke(1.dp, colors.subtleBorder),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            horizontalArrangement = Arrangement.SpaceEvenly,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                MascotView(mascot = currentMascot, size = MascotSize.SMALL.dp)
                                Spacer(Modifier.height(4.dp))
                                Text("Small (28dp)", style = AppType.caption, color = colors.textTertiary)
                            }
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                MascotView(mascot = currentMascot, size = MascotSize.MEDIUM.dp)
                                Spacer(Modifier.height(4.dp))
                                Text("Medium (40dp)", style = AppType.caption, color = colors.textTertiary)
                            }
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                MascotView(mascot = currentMascot, size = MascotSize.LARGE.dp)
                                Spacer(Modifier.height(4.dp))
                                Text("Large (56dp)", style = AppType.caption, color = colors.textTertiary)
                            }
                        }
                    }
                }
            }

            // 7. MOBOT Fleet Roster Lineup
            item(key = "fleet_lineup") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "MOBOT Fleet Characters",
                        style = AppType.bodyEmphasized,
                        color = colors.textPrimary,
                    )
                    val fleetExamples = listOf(
                        Triple("Vega", MascotShape.SQUIRCLE, MascotPalette.BLUE),
                        Triple("Panko", MascotShape.DROPLET, MascotPalette.YELLOW),
                        Triple("Skye", MascotShape.CLOUD, MascotPalette.PINK),
                        Triple("Olive", MascotShape.PEBBLE, MascotPalette.GREEN),
                        Triple("Ziggy", MascotShape.TRIANGLE, MascotPalette.PURPLE),
                        Triple("Rio", MascotShape.CAPSULE, MascotPalette.ORANGE),
                        Triple("Poppy", MascotShape.BLOB, MascotPalette.PURPLE),
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        fleetExamples.forEach { (name, shape, palette) ->
                            val fleetDef = remember(name, shape, palette) {
                                MascotDefinition(
                                    id = name.lowercase(),
                                    shape = shape,
                                    palette = palette,
                                    eyeStyle = if (name == "Ziggy") MascotEyeStyle.CYCLOPS else MascotEyeStyle.TWIN_DOTS,
                                    personality = MascotPersonality.PLAYFUL,
                                )
                            }
                            Surface(
                                shape = AppRadii.compactCardShape,
                                color = colors.elevatedSurface,
                                border = BorderStroke(1.dp, colors.subtleBorder),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    MascotView(mascot = fleetDef, size = 42.dp)
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(name, style = AppType.bodyEmphasized, color = colors.textPrimary)
                                        Text(
                                            "${shape.label} · ${palette.label}",
                                            style = AppType.caption,
                                            color = colors.textSecondary,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            item(key = "footer_space") {
                Spacer(Modifier.height(30.dp))
            }
        }
    }
}
