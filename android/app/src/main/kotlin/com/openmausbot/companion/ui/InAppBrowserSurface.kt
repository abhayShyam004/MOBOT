package com.openmausbot.companion.ui

import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.openmausbot.companion.browser.BrowserSecurity
import com.openmausbot.companion.host.BrowserDriverServer
import java.net.URI

/**
 * Native in-app browser surface with comprehensive navigation, layered Back behavior,
 * secure WebView settings, honest error reporting, and explicit exit controls.
 */
@Composable
fun InAppBrowserSurface(
    destination: Destination.Browser,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val colors = AppTheme.colors

    var webViewInstance by remember { mutableStateOf<WebView?>(null) }
    val isUrlSafe = remember(destination.url) { BrowserSecurity.isSafeWebUrl(destination.url) }
    var currentUrl by remember(destination.url) { mutableStateOf(destination.url) }
    var pageTitle by remember(destination.title) { mutableStateOf(destination.title.orEmpty()) }
    var canGoBack by remember { mutableStateOf(false) }
    var canGoForward by remember { mutableStateOf(false) }
    var isLoading by remember(destination.url) { mutableStateOf(isUrlSafe) }
    var loadingProgress by remember { mutableFloatStateOf(0f) }
    var errorMessage by remember(destination.url) {
        mutableStateOf(
            if (!isUrlSafe) "Invalid or restricted URL: ${destination.url}" else null
        )
    }

    val sessionName = remember(destination.botId) {
        destination.botId?.let { BrowserDriverServer.sessionNameForBot(it) }
    }

    // Layered Back logic:
    // If WebView history has a previous page, navigate back.
    // If no previous history remains, exit browser surface.
    val handleBack: () -> Unit = {
        val view = webViewInstance
        if (view != null && view.canGoBack()) {
            view.goBack()
        } else {
            onClose()
        }
    }

    // Intercept system Back button with the exact same layered logic
    BackHandler(enabled = true) {
        handleBack()
    }

    val displayHost = remember(currentUrl) {
        runCatching {
            val uri = URI(currentUrl)
            uri.host ?: currentUrl
        }.getOrDefault(currentUrl)
    }

    val isHttps = remember(currentUrl) {
        currentUrl.startsWith("https://", ignoreCase = true)
    }

    // Clean teardown on disposal
    DisposableEffect(destination) {
        onDispose {
            val view = webViewInstance
            if (view != null) {
                view.stopLoading()
                (view.parent as? ViewGroup)?.removeView(view)
                if (sessionName != null) {
                    BrowserDriverServer.releaseSessionWebView(sessionName, view)
                } else {
                    view.destroy()
                }
            }
            webViewInstance = null
        }
    }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = colors.background,
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // ── Top Navigation Bar ───────────────────────────────────────────
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = colors.surface,
                shadowElevation = 2.dp,
            ) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 4.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // Back Button
                        IconButton(
                            onClick = handleBack,
                            modifier = Modifier.size(48.dp),
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Back",
                                tint = colors.textPrimary,
                            )
                        }

                        // Forward Button
                        IconButton(
                            onClick = { webViewInstance?.goForward() },
                            enabled = canGoForward,
                            modifier = Modifier.size(48.dp),
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                                contentDescription = "Forward",
                                tint = if (canGoForward) colors.textPrimary else colors.textTertiary.copy(alpha = 0.38f),
                            )
                        }

                        // Reload Button
                        IconButton(
                            onClick = {
                                errorMessage = null
                                webViewInstance?.reload()
                            },
                            modifier = Modifier.size(48.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = "Reload",
                                tint = colors.textPrimary,
                            )
                        }

                        // Title & Host indicator
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .padding(horizontal = 8.dp),
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text(
                                text = pageTitle.ifBlank { displayHost },
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = colors.textPrimary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                if (isHttps) {
                                    Icon(
                                        imageVector = Icons.Default.Lock,
                                        contentDescription = "Secure HTTPS connection",
                                        tint = Color(0xFF10B981),
                                        modifier = Modifier.size(12.dp),
                                    )
                                } else {
                                    Icon(
                                        imageVector = Icons.Default.Info,
                                        contentDescription = "Insecure HTTP connection",
                                        tint = Color(0xFFF59E0B),
                                        modifier = Modifier.size(12.dp),
                                    )
                                }
                                Text(
                                    text = displayHost,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    fontFamily = FontFamily.Monospace,
                                )
                            }
                        }

                        // Open Externally Button
                        IconButton(
                            onClick = {
                                if (currentUrl.isNotBlank()) {
                                    launchExternalBrowser(context, currentUrl)
                                }
                            },
                            modifier = Modifier.size(48.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Default.Share,
                                contentDescription = "Open in external browser",
                                tint = colors.textPrimary,
                            )
                        }

                        // Close / Exit Button
                        IconButton(
                            onClick = onClose,
                            modifier = Modifier.size(48.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Close browser",
                                tint = colors.textPrimary,
                            )
                        }
                    }

                    // Progress Bar
                    if (isLoading) {
                        LinearProgressIndicator(
                            progress = { loadingProgress },
                            color = colors.accent,
                            trackColor = colors.hairline,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(2.dp),
                        )
                    } else {
                        Spacer(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(1.dp)
                                .background(colors.hairline),
                        )
                    }
                }
            }

            // ── Browser Surface / Error State ────────────────────────────────
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .background(colors.background),
            ) {
                AndroidView(
                    factory = { ctx ->
                        val borrowed = sessionName?.let { BrowserDriverServer.adoptSessionWebView(it) }
                        val view = borrowed ?: WebView(ctx).apply {
                            layoutParams = ViewGroup.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT,
                            )
                            settings.apply {
                                javaScriptEnabled = true
                                domStorageEnabled = true
                                allowFileAccess = false
                                allowContentAccess = false
                                safeBrowsingEnabled = true
                                mediaPlaybackRequiresUserGesture = false
                                builtInZoomControls = true
                                displayZoomControls = false
                                useWideViewPort = true
                                loadWithOverviewMode = true
                            }
                        }

                        view.webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(v: WebView?, progress: Int) {
                                loadingProgress = progress / 100f
                                isLoading = progress in 1..99
                                canGoBack = v?.canGoBack() == true
                                canGoForward = v?.canGoForward() == true
                            }

                            override fun onReceivedTitle(v: WebView?, title: String?) {
                                if (!title.isNullOrBlank()) {
                                    pageTitle = title
                                }
                            }
                        }

                        view.webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(v: WebView?, request: WebResourceRequest?): Boolean {
                                val nextUrl = request?.url?.toString() ?: return false
                                if (!BrowserSecurity.isSafeWebUrl(nextUrl)) {
                                    errorMessage = "Access to private or restricted network addresses is not allowed."
                                    return true
                                }
                                return false
                            }

                            override fun onPageStarted(v: WebView?, url: String?, favicon: Bitmap?) {
                                isLoading = true
                                errorMessage = null
                                url?.let { currentUrl = it }
                                canGoBack = v?.canGoBack() == true
                                canGoForward = v?.canGoForward() == true
                            }

                            override fun onPageFinished(v: WebView?, url: String?) {
                                isLoading = false
                                url?.let { currentUrl = it }
                                canGoBack = v?.canGoBack() == true
                                canGoForward = v?.canGoForward() == true
                                if (v?.title?.isNotBlank() == true) {
                                    pageTitle = v.title.orEmpty()
                                }
                            }

                            override fun onReceivedError(v: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                                if (request?.isForMainFrame == true) {
                                    isLoading = false
                                    errorMessage = error?.description?.toString() ?: "Failed to load page"
                                }
                            }

                            override fun onReceivedHttpError(
                                v: WebView?,
                                request: WebResourceRequest?,
                                errorResponse: WebResourceResponse?,
                            ) {
                                if (request?.isForMainFrame == true && (errorResponse?.statusCode ?: 200) >= 400) {
                                    isLoading = false
                                    errorMessage = "HTTP Error ${errorResponse?.statusCode}: ${errorResponse?.reasonPhrase.orEmpty()}"
                                }
                            }
                        }

                        if (!BrowserSecurity.isSafeWebUrl(destination.url)) {
                            errorMessage = "Invalid or restricted URL: ${destination.url}"
                        } else if (borrowed == null || view.url.isNullOrBlank() || view.url != destination.url) {
                            view.loadUrl(destination.url)
                        } else {
                            canGoBack = view.canGoBack()
                            canGoForward = view.canGoForward()
                            view.url?.let { currentUrl = it }
                            if (view.title?.isNotBlank() == true) pageTitle = view.title.orEmpty()
                            isLoading = false
                        }

                        webViewInstance = view
                        view
                    },
                    update = { view ->
                        view.visibility = if (errorMessage != null) View.GONE else View.VISIBLE
                    },
                    modifier = Modifier.fillMaxSize(),
                )

                if (errorMessage != null) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(colors.background)
                            .padding(24.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(16.dp))
                                .background(colors.surface)
                                .border(1.dp, colors.hairline, RoundedCornerShape(16.dp))
                                .padding(24.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Default.Warning,
                                contentDescription = null,
                                tint = Color(0xFFEF4444),
                                modifier = Modifier.size(48.dp),
                            )
                            Text(
                                text = "Page failed to load",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = colors.textPrimary,
                            )
                            Text(
                                text = errorMessage ?: "Unknown network error",
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.textSecondary,
                                textAlign = TextAlign.Center,
                            )
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(top = 8.dp),
                            ) {
                                Button(
                                    onClick = {
                                        errorMessage = null
                                        webViewInstance?.reload()
                                    },
                                ) {
                                    Text("Retry")
                                }
                                OutlinedButton(
                                    onClick = {
                                        if (currentUrl.isNotBlank()) {
                                            launchExternalBrowser(context, currentUrl)
                                        }
                                    },
                                ) {
                                    Text("Open externally")
                                }
                                TextButton(onClick = onClose) {
                                    Text("Close")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
