package com.openmausbot.companion.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Phase D (Localhost App Preview): Native Android preview surface for generated apps.
 *
 * Runs entirely on the phone:
 * - Live preview surface backed by Android's WebView.
 * - Controls: reload, restart, stop, external browser launch.
 * - Honest state reporting (Live, Starting, Stopped, Crashed).
 * - Prevents infinite spinners when preview process exits or crashes.
 */

data class AppPreviewPresentationState(
    val projectId: String,
    val projectName: String,
    val status: String,
    val port: Int? = null,
    val url: String? = null,
    val errorMessage: String? = null,
    val logs: String? = null,
)

object AppPreviewRules {
    fun badgeColor(status: String): Color = when (status.lowercase()) {
        "running", "live" -> Color(0xFF10B981) // Emerald Green
        "starting", "building" -> Color(0xFFF59E0B) // Amber
        "crashed", "failed", "error" -> Color(0xFFEF4444) // Red
        else -> Color(0xFF6B7280) // Grey (stopped/draft)
    }

    fun statusLabel(status: String): String = when (status.lowercase()) {
        "running", "live" -> "Live"
        "starting" -> "Starting"
        "crashed" -> "Crashed"
        "stopped" -> "Stopped"
        "building" -> "Building"
        else -> status.replaceFirstChar { it.uppercase() }
    }

    fun canReload(status: String): Boolean = status.lowercase() in listOf("running", "live")
    fun canRestart(status: String): Boolean = true
    fun canStop(status: String): Boolean = status.lowercase() in listOf("running", "live", "starting")
}

@Composable
fun AppPreviewSurface(
    state: AppPreviewPresentationState,
    onReload: () -> Unit = {},
    onRestart: () -> Unit = {},
    onStop: () -> Unit = {},
    onClose: () -> Unit = {},
    onStartServer: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val colors = AppTheme.colors
    var webViewInstance by remember { mutableStateOf<WebView?>(null) }
    var pageLoadingProgress by remember { mutableFloatStateOf(0f) }
    var isPageLoading by remember { mutableStateOf(false) }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = colors.background,
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // ── Preview Control Header ─────────────────────────────────────────
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.surface)
                    .padding(horizontal = AppSpacing.gutter, vertical = AppSpacing.sm),
                verticalArrangement = Arrangement.spacedBy(AppSpacing.xs),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    // Left: Project title & Status Badge
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "${state.projectName} — MOBOT Local Preview",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = colors.textPrimary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(top = 2.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            val badgeColor = AppPreviewRules.badgeColor(state.status)
                            AppStatusDot(
                                color = badgeColor,
                                size = 6.dp,
                                pulsing = state.status.lowercase() in listOf("running", "live", "starting", "building"),
                            )
                            Text(
                                text = AppPreviewRules.statusLabel(state.status),
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.textSecondary,
                                fontWeight = FontWeight.SemiBold,
                            )
                            if (state.url != null) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .clip(AppRadii.pill)
                                        .background(colors.surfaceSunken)
                                        .clickable { launchExternalBrowser(context, state.url) }
                                        .padding(horizontal = 8.dp, vertical = 2.dp),
                                ) {
                                    Text(
                                        text = state.url,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = colors.accent,
                                        fontFamily = FontFamily.Monospace,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                    }

                    // Right: Action pills
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(AppSpacing.xs),
                    ) {
                        if (AppPreviewRules.canReload(state.status)) {
                            AppPill(
                                text = "Reload",
                                tone = PillTone.Raised,
                                onClick = {
                                    webViewInstance?.reload()
                                    onReload()
                                },
                            )
                        }
                        AppPill(
                            text = "Restart",
                            tone = PillTone.Quiet,
                            onClick = onRestart,
                        )
                        if (AppPreviewRules.canStop(state.status)) {
                            AppPill(
                                text = "Stop",
                                tone = PillTone.Destructive,
                                onClick = onStop,
                            )
                        }
                        if (state.url != null) {
                            AppPill(
                                text = "Browser",
                                tone = PillTone.Accent,
                                onClick = { launchExternalBrowser(context, state.url) },
                            )
                        }
                    }
                }
            }

            // Progress bar during page load
            if (isPageLoading && state.status.lowercase() in listOf("running", "live")) {
                LinearProgressIndicator(
                    progress = { pageLoadingProgress },
                    color = colors.accent,
                    trackColor = colors.hairline,
                    modifier = Modifier.fillMaxWidth().height(2.dp),
                )
            } else {
                Spacer(modifier = Modifier.height(1.dp).background(colors.hairline))
            }

            // ── Live Preview Surface ───────────────────────────────────────────
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .background(Color.White),
            ) {
                when (state.status.lowercase()) {
                    "running", "live" -> {
                        if (state.url != null) {
                            AndroidView(
                                factory = { ctx ->
                                    WebView(ctx).apply {
                                        layoutParams = ViewGroup.LayoutParams(
                                            ViewGroup.LayoutParams.MATCH_PARENT,
                                            ViewGroup.LayoutParams.MATCH_PARENT,
                                        )
                                        settings.javaScriptEnabled = true
                                        settings.domStorageEnabled = true
                                        settings.useWideViewPort = true
                                        settings.loadWithOverviewMode = true
                                        settings.setSupportZoom(true)
                                        settings.builtInZoomControls = true
                                        settings.displayZoomControls = false

                                        webViewClient = object : WebViewClient() {
                                            override fun onPageFinished(view: WebView?, url: String?) {
                                                isPageLoading = false
                                                super.onPageFinished(view, url)
                                            }

                                            override fun onReceivedError(
                                                view: WebView?,
                                                request: WebResourceRequest?,
                                                error: WebResourceError?,
                                            ) {
                                                isPageLoading = false
                                                super.onReceivedError(view, request, error)
                                            }
                                        }

                                        webChromeClient = object : WebChromeClient() {
                                            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                                                pageLoadingProgress = newProgress / 100f
                                                isPageLoading = newProgress < 100
                                                super.onProgressChanged(view, newProgress)
                                            }
                                        }

                                        webViewInstance = this
                                        loadUrl(state.url)
                                    }
                                },
                                update = { webView ->
                                    if (webView.url != state.url) {
                                        state.url?.let { webView.loadUrl(it) }
                                    }
                                },
                                modifier = Modifier.fillMaxSize(),
                            )
                        } else {
                            PreviewEmptyView(
                                title = "Server Listening",
                                message = "Waiting for preview URL...",
                            )
                        }
                    }

                    "crashed", "failed", "error" -> {
                        PreviewErrorView(
                            errorMessage = state.errorMessage ?: "Development server process exited unexpectedly.",
                            onRestart = onRestart,
                        )
                    }

                    "starting", "building" -> {
                        PreviewLoadingView(
                            status = AppPreviewRules.statusLabel(state.status),
                            message = "Allocating port on 127.0.0.1 and starting server...",
                        )
                    }

                    else -> {
                        PreviewStoppedView(
                            projectName = state.projectName,
                            onStart = onStartServer,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PreviewErrorView(
    errorMessage: String,
    onRestart: () -> Unit,
) {
    val colors = AppTheme.colors
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(AppSpacing.gutter),
        contentAlignment = Alignment.Center,
    ) {
        AppCard(
            modifier = Modifier.fillMaxWidth(),
            shape = AppRadii.cardShape,
            bordered = true,
            contentPadding = PaddingValues(AppSpacing.xl),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(AppSpacing.md),
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .background(colors.danger.copy(alpha = 0.14f), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.material3.Icon(
                        imageVector = androidx.compose.material.icons.Icons.Filled.Warning,
                        contentDescription = null,
                        tint = colors.danger,
                        modifier = Modifier.size(24.dp),
                    )
                }
                Text(
                    text = "MOBOT Local Preview Error",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = colors.textPrimary,
                )
                Text(
                    text = errorMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(AppRadii.row))
                        .background(colors.surfaceSunken)
                        .padding(AppSpacing.md),
                )
                AppPill(
                    text = "Restart Preview Server",
                    tone = PillTone.Accent,
                    onClick = onRestart,
                )
            }
        }
    }
}

@Composable
private fun PreviewLoadingView(
    status: String,
    message: String,
) {
    val colors = AppTheme.colors
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(
            color = colors.accent,
            strokeWidth = 3.dp,
            modifier = Modifier.size(40.dp),
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = status,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = colors.textPrimary,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = colors.textSecondary,
        )
    }
}

@Composable
private fun PreviewStoppedView(
    projectName: String,
    onStart: () -> Unit,
) {
    val colors = AppTheme.colors
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(AppSpacing.gutter),
        contentAlignment = Alignment.Center,
    ) {
        AppCard(
            modifier = Modifier.fillMaxWidth(),
            shape = AppRadii.cardShape,
            bordered = true,
            contentPadding = PaddingValues(AppSpacing.xl),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(AppSpacing.md),
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .background(colors.surfaceSunken, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.material3.Icon(
                        imageVector = androidx.compose.material.icons.Icons.Filled.PlayArrow,
                        contentDescription = null,
                        tint = colors.textSecondary,
                        modifier = Modifier.size(26.dp),
                    )
                }
                Text(
                    text = "$projectName — MOBOT Local Preview",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = colors.textPrimary,
                )
                Text(
                    text = "Localhost development server is stopped.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
                AppPill(
                    text = "Start Preview Server",
                    tone = PillTone.Accent,
                    onClick = onStart,
                )
            }
        }
    }
}

@Composable
private fun PreviewEmptyView(
    title: String,
    message: String,
) {
    val colors = AppTheme.colors
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = colors.textPrimary,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = colors.textSecondary,
        )
    }
}

internal fun launchExternalBrowser(context: Context, url: String) {
    try {
        val parsedUri = Uri.parse(url)
        CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
            .launchUrl(context, parsedUri)
    } catch (_: Exception) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (_: Exception) {}
    }
}
