package com.openmausbot.companion.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.core.WatchWorkspaceTelemetryEvent
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Official Phase 22 contract: Active operational workspace surface states.
 */
sealed class ComputerSurfaceState {
    object Idle : ComputerSurfaceState()
    data class BrowserLive(val currentUrl: String, val frame: Bitmap, val isNavigating: Boolean) : ComputerSurfaceState()
    data class TerminalLive(val activeCommand: String, val ptyBuffer: String) : ComputerSurfaceState()
    data class PhoneVision(val screenBitmap: Bitmap, val targetNodeBounds: Rect?) : ComputerSurfaceState()
    data class FileStreaming(val filePath: String, val lineCount: Int) : ComputerSurfaceState()
}

/**
 * Watch Computer workspace — Phase 22 authentic operational surface.
 *
 * Renders authentic, real-time telemetry from operating system, browser driver,
 * terminal PTY, and file editor. When no execution is active, displays an
 * authentic idle standby state without simulated progress or false spinners.
 */
@Composable
fun ComputerScreen(botId: String, onBack: () -> Unit) {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    val state by session.state.collectAsState()
    val connectionStatus by session.status.collectAsState()

    val bot = remember(state, botId) { state.bot(botId) }
    if (bot == null) {
        LaunchedEffect(botId) { onBack() }
        return
    }

    DisposableEffect(botId) {
        val watch = ScreenWatch(
            start = session::watchScreen,
            stop = session::stopWatchingScreen,
        )
        watch.watch(botId)
        onDispose { watch.release() }
    }

    var confirming by remember { mutableStateOf(false) }
    var opening by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }

    val frame = state.screens[botId]
    val telemetry: WatchWorkspaceTelemetryEvent? = state.telemetry[botId]

    // Memoize bitmap decoding by frame content/hash to prevent UI thread thrashing
    val decodedBitmap: Bitmap? = remember(frame?.png, telemetry?.frameHash) {
        val bytes = telemetry?.frameData ?: frame?.data
        bytes?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size) }.getOrNull() }
    }

    // Map canonical telemetry and frame state to ComputerSurfaceState
    val surfaceState: ComputerSurfaceState = remember(telemetry, decodedBitmap, bot.busy) {
        deriveSurfaceState(telemetry, decodedBitmap, bot.busy == true)
    }

    var gaveUp by remember(botId) { mutableStateOf(false) }
    var waitStart by remember(botId) { mutableStateOf(0L) }
    LaunchedEffect(botId, bot.busy, decodedBitmap, telemetry) {
        if (decodedBitmap != null || telemetry != null || bot.busy != true) {
            gaveUp = false
            return@LaunchedEffect
        }
        if (waitStart == 0L) {
            waitStart = System.currentTimeMillis()
            delay(ComputerPolicy.WAIT_GIVE_UP_MS)
            if (state.screens[botId] == null && state.telemetry[botId] == null) gaveUp = true
        } else {
            gaveUp = true
        }
    }

    // Scroll states preserved across recompositions and stream reconnects
    val terminalScrollState = rememberScrollState()
    val fileScrollState = rememberScrollState()

    Box(modifier = Modifier.fillMaxSize().background(Color(0xFF0F0F12))) {
        // Workspace surface content
        when (surfaceState) {
            is ComputerSurfaceState.BrowserLive -> {
                BrowserSurfaceView(
                    browserState = surfaceState,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            is ComputerSurfaceState.TerminalLive -> {
                TerminalSurfaceView(
                    terminalState = surfaceState,
                    scrollState = terminalScrollState,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            is ComputerSurfaceState.PhoneVision -> {
                PhoneVisionSurfaceView(
                    phoneState = surfaceState,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            is ComputerSurfaceState.FileStreaming -> {
                FileStreamingSurfaceView(
                    fileState = surfaceState,
                    scrollState = fileScrollState,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            is ComputerSurfaceState.Idle -> {
                IdleStandbyView(
                    botName = bot.name,
                    gaveUp = gaveUp,
                    onRetry = if (gaveUp) {
                        {
                            gaveUp = false
                            waitStart = 0L
                        }
                    } else null,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }

        // Floating reconnection recovery pill: ERR_WATCH_STREAM_DISCONNECTED
        val isDisconnected = connectionStatus is Session.Status.Connecting || connectionStatus is Session.Status.Offline
        if (isDisconnected) {
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = Color(0xFF1E1E24).copy(alpha = 0.92f),
                shadowElevation = 6.dp,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 60.dp),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(12.dp),
                        strokeWidth = 2.dp,
                        color = Color(0xFFFFB74D),
                    )
                    Text(
                        text = "ERR_WATCH_STREAM_DISCONNECTED · Reconnecting…",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = Color(0xFFFFE0B2),
                    )
                }
            }
        }

        // Top Header bar with Back button, bot title and status capsule
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.75f))
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = Color.White,
                modifier = Modifier
                    .size(32.dp)
                    .background(Color.White.copy(alpha = 0.18f), CircleShape)
                    .clickable(onClick = onBack)
                    .padding(6.dp),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = bot.name,
                    color = Color.White,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = resolveSurfaceBadge(surfaceState, telemetry),
                    fontSize = 11.sp,
                    color = Color.White.copy(alpha = 0.6f),
                )
            }
            StatusCapsulePill(
                surfaceState = surfaceState,
                telemetry = telemetry,
                botBusy = bot.busy == true,
            )
        }

        if (ComputerPolicy.showsCloudDesktop(bot)) {
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.65f))
                    .padding(horizontal = 18.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                failure?.let {
                    Text(
                        text = it,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                    )
                }
                Button(
                    onClick = { confirming = true },
                    enabled = !opening,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (opening) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text(ComputerPolicy.OPEN_DESKTOP)
                    }
                }
                Text(
                    text = ComputerPolicy.VNC_NOTE,
                    fontSize = 12.sp,
                    color = Color.White.copy(alpha = 0.6f),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(ComputerPolicy.CONFIRM_TITLE) },
            text = { Text(ComputerPolicy.CONFIRM_MESSAGE) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = false
                        opening = true
                        failure = null
                        scope.launch {
                            try {
                                failure = environment.openCloudDesktop(session.cloudDesktop(bot))
                            } catch (error: Throwable) {
                                if (error is kotlinx.coroutines.CancellationException) throw error
                                failure = error.message ?: "Could not open the cloud desktop."
                            } finally {
                                opening = false
                            }
                        }
                    },
                ) { Text("Open desktop") }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }) { Text("Cancel") }
            },
        )
    }
}

private fun deriveSurfaceState(
    telemetry: WatchWorkspaceTelemetryEvent?,
    decodedBitmap: Bitmap?,
    isBusy: Boolean,
): ComputerSurfaceState {
    if (telemetry == null) {
        return if (decodedBitmap != null) {
            ComputerSurfaceState.BrowserLive(
                currentUrl = "",
                frame = decodedBitmap,
                isNavigating = isBusy,
            )
        } else {
            ComputerSurfaceState.Idle
        }
    }

    if (telemetry.surface == "idle" ||
        (!telemetry.isLiveExecution && decodedBitmap == null &&
            telemetry.terminalChunk.isNullOrBlank() && telemetry.activeFileOperation == null)
    ) {
        return ComputerSurfaceState.Idle
    }

    return when (telemetry.surface) {
        "browser" -> {
            if (decodedBitmap != null) {
                val url = telemetry.statusCapsuleText
                    .removePrefix("Navigating to ")
                    .removePrefix("Browsing: ")
                ComputerSurfaceState.BrowserLive(
                    currentUrl = url,
                    frame = decodedBitmap,
                    isNavigating = telemetry.isLiveExecution,
                )
            } else {
                ComputerSurfaceState.Idle
            }
        }
        "terminal" -> {
            val cmd = telemetry.statusCapsuleText.removePrefix("Running: ")
            ComputerSurfaceState.TerminalLive(
                activeCommand = cmd,
                ptyBuffer = telemetry.terminalChunk ?: "",
            )
        }
        "phone_screen" -> {
            if (decodedBitmap != null) {
                ComputerSurfaceState.PhoneVision(
                    screenBitmap = decodedBitmap,
                    targetNodeBounds = null,
                )
            } else {
                ComputerSurfaceState.Idle
            }
        }
        "file_editor" -> {
            val path = telemetry.activeFileOperation?.path
                ?: telemetry.statusCapsuleText.removePrefix("Editing: ")
            val lineCount = telemetry.terminalChunk?.lines()?.size ?: 1
            ComputerSurfaceState.FileStreaming(
                filePath = path,
                lineCount = lineCount,
            )
        }
        else -> {
            if (decodedBitmap != null) {
                ComputerSurfaceState.BrowserLive(
                    currentUrl = telemetry.statusCapsuleText,
                    frame = decodedBitmap,
                    isNavigating = telemetry.isLiveExecution,
                )
            } else {
                ComputerSurfaceState.Idle
            }
        }
    }
}

private fun resolveSurfaceBadge(
    surfaceState: ComputerSurfaceState,
    telemetry: WatchWorkspaceTelemetryEvent?,
): String = when (surfaceState) {
    is ComputerSurfaceState.BrowserLive -> "Browser Execution"
    is ComputerSurfaceState.TerminalLive -> "Terminal PTY Session"
    is ComputerSurfaceState.PhoneVision -> "Phone Vision (Android UI)"
    is ComputerSurfaceState.FileStreaming -> "File & Workspace Activity"
    is ComputerSurfaceState.Idle -> telemetry?.statusCapsuleText.takeIf { !it.isNullOrBlank() } ?: "Agent Workspace · Standby"
}

@Composable
private fun StatusCapsulePill(
    surfaceState: ComputerSurfaceState,
    telemetry: WatchWorkspaceTelemetryEvent?,
    botBusy: Boolean,
) {
    val isLive = when (surfaceState) {
        is ComputerSurfaceState.Idle -> false
        is ComputerSurfaceState.BrowserLive -> surfaceState.isNavigating || botBusy
        else -> true
    }
    val text = when {
        telemetry?.statusCapsuleText?.isNotBlank() == true -> telemetry.statusCapsuleText
        isLive -> "Executing"
        else -> "Ready"
    }

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = if (isLive) Color(0xFF1B5E20).copy(alpha = 0.85f) else Color.White.copy(alpha = 0.12f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .background(
                        if (isLive) Color(0xFF69F0AE) else Color.White.copy(alpha = 0.4f),
                        CircleShape,
                    ),
            )
            Text(
                text = text,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = if (isLive) Color(0xFFE8F5E9) else Color.White.copy(alpha = 0.7f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun BrowserSurfaceView(
    browserState: ComputerSurfaceState.BrowserLive,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.padding(top = 56.dp)) {
        // Browser URL Address bar
        Surface(
            color = Color(0xFF18181D),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = Color(0xFF26262D),
                    modifier = Modifier.weight(1f),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = browserState.currentUrl.ifEmpty { "https://browser" },
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.White.copy(alpha = 0.85f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                if (browserState.isNavigating) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        strokeWidth = 2.dp,
                        color = Color(0xFF69F0AE),
                    )
                }
            }
        }
        // Live Screen Bitmap
        Image(
            bitmap = browserState.frame.asImageBitmap(),
            contentDescription = "Live Browser Viewport",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun TerminalSurfaceView(
    terminalState: ComputerSurfaceState.TerminalLive,
    scrollState: androidx.compose.foundation.ScrollState,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .padding(top = 56.dp)
            .background(Color(0xFF0D1117))
            .padding(14.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = Color(0xFF161B22),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "$ ${terminalState.activeCommand.ifEmpty { "shell" }}",
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Medium,
                    color = Color(0xFF7EE787),
                )
            }
        }
        Spacer(modifier = Modifier.height(10.dp))
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(8.dp))
                .background(Color(0xFF090D13))
                .padding(12.dp)
                .verticalScroll(scrollState),
        ) {
            Text(
                text = terminalState.ptyBuffer.ifEmpty { "[Running process... output will stream here]" },
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                color = Color(0xFFC9D1D9),
                lineHeight = 18.sp,
            )
        }
    }
}

@Composable
private fun PhoneVisionSurfaceView(
    phoneState: ComputerSurfaceState.PhoneVision,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .padding(top = 56.dp)
            .background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            bitmap = phoneState.screenBitmap.asImageBitmap(),
            contentDescription = "Phone Screen Observation",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun FileStreamingSurfaceView(
    fileState: ComputerSurfaceState.FileStreaming,
    scrollState: androidx.compose.foundation.ScrollState,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .padding(top = 56.dp)
            .background(Color(0xFF12141A))
            .padding(14.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = Color(0xFF1E222D),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = fileState.filePath,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    color = Color.White.copy(alpha = 0.9f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "${fileState.lineCount} lines",
                    fontSize = 11.sp,
                    color = Color.White.copy(alpha = 0.5f),
                )
            }
        }
        Spacer(modifier = Modifier.height(10.dp))
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(8.dp))
                .background(Color(0xFF0E1015))
                .padding(12.dp)
                .verticalScroll(scrollState),
        ) {
            Text(
                text = "Streaming file activity: ${fileState.filePath}",
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                color = Color(0xFF8B949E),
            )
        }
    }
}

@Composable
private fun IdleStandbyView(
    botName: String,
    gaveUp: Boolean,
    onRetry: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.padding(top = 56.dp, start = 24.dp, end = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(
            shape = CircleShape,
            color = Color.White.copy(alpha = 0.08f),
            modifier = Modifier.size(54.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    text = "STANDBY",
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White.copy(alpha = 0.6f),
                )
            }
        }
        Text(
            text = if (gaveUp) ComputerPolicy.GAVE_UP_HEADLINE else "$botName Standby",
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            color = Color.White.copy(alpha = 0.85f),
        )
        Text(
            text = if (gaveUp) {
                ComputerPolicy.GAVE_UP_EXPLANATION
            } else {
                "Authentic operational workspace. Active browser navigation, terminal execution, and phone control will stream here."
            },
            fontSize = 13.sp,
            color = Color.White.copy(alpha = 0.5f),
            textAlign = TextAlign.Center,
            lineHeight = 18.sp,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        onRetry?.let {
            Button(onClick = it) {
                Icon(imageVector = Icons.Default.Refresh, contentDescription = "Retry", modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text("Retry Connection")
            }
        }
    }
}
