package com.openmausbot.companion.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.caverock.androidsvg.SVG
import com.openmausbot.companion.core.ConnectorCard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Thread-safe, non-blocking icon loader for Composio connected services.
 *
 * Implements a 2-tier caching hierarchy:
 * 1. Fast in-memory LRU cache (100 bitmaps)
 * 2. Persistent on-disk PNG cache in context.cacheDir/connector_icons
 *
 * Supports:
 * - Direct SVG rasterization via AndroidSVG
 * - Standard web images (PNG/JPEG/WEBP)
 * - Automatic favicon resolution fallback via Google Social Favicon Service
 * - Clean brand-colored monogram fallback
 */
object ConnectorIconLoader {
    private const val MEMORY_CACHE_SIZE = 100
    private const val ICON_TARGET_SIZE_PX = 96
    private const val TIMEOUT_MILLIS = 5000

    private val memoryCache = LruCache<String, ImageBitmap>(MEMORY_CACHE_SIZE)

    suspend fun loadIcon(context: Context, card: ConnectorCard): ImageBitmap? = withContext(Dispatchers.IO) {
        val slug = card.slug.lowercase().trim()
        if (slug.isEmpty()) return@withContext null

        // 1. Check memory cache
        memoryCache.get(slug)?.let { return@withContext it }

        // 2. Check disk cache
        val diskCacheDir = File(context.cacheDir, "connector_icons").apply { if (!exists()) mkdirs() }
        val diskFile = File(diskCacheDir, "$slug.png")
        if (diskFile.exists() && diskFile.length() > 0) {
            try {
                val bitmap = BitmapFactory.decodeFile(diskFile.absolutePath)
                if (bitmap != null) {
                    val imageBitmap = bitmap.asImageBitmap()
                    memoryCache.put(slug, imageBitmap)
                    return@withContext imageBitmap
                }
            } catch (_: Throwable) {}
        }

        // 3. Attempt download: official Composio logo first
        val downloadedBitmap = downloadLogo(card.logo) ?: downloadFavicon(card.domain ?: "$slug.com")

        if (downloadedBitmap != null) {
            // Save to disk cache
            try {
                FileOutputStream(diskFile).use { out ->
                    downloadedBitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                }
            } catch (_: Throwable) {}

            val imageBitmap = downloadedBitmap.asImageBitmap()
            memoryCache.put(slug, imageBitmap)
            return@withContext imageBitmap
        }

        null
    }

    private fun downloadLogo(logoUrl: String?): Bitmap? {
        if (logoUrl.isNullOrBlank()) return null
        return try {
            val url = URL(logoUrl)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MILLIS
                readTimeout = TIMEOUT_MILLIS
                setRequestProperty("User-Agent", "MOBOT/1.0 (Android)")
            }
            conn.inputStream.use { input ->
                val bytes = input.readBytes()
                val contentType = conn.contentType.orEmpty().lowercase()
                val isSvg = contentType.contains("svg") || logoUrl.endsWith(".svg", ignoreCase = true) ||
                    String(bytes.take(100).toByteArray()).contains("<svg", ignoreCase = true)

                if (isSvg) {
                    renderSvgToBitmap(bytes)
                } else {
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                }
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun downloadFavicon(domain: String): Bitmap? {
        return try {
            val faviconUrl = "https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://$domain&size=128"
            val conn = (URL(faviconUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MILLIS
                readTimeout = TIMEOUT_MILLIS
                setRequestProperty("User-Agent", "Mozilla/5.0")
            }
            conn.inputStream.use { input ->
                val bytes = input.readBytes()
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun renderSvgToBitmap(svgBytes: ByteArray): Bitmap? {
        return try {
            val svg = SVG.getFromInputStream(svgBytes.inputStream())
            val targetSize = ICON_TARGET_SIZE_PX
            val bitmap = Bitmap.createBitmap(targetSize, targetSize, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)

            val docWidth = svg.documentWidth
            val docHeight = svg.documentHeight
            if (docWidth > 0 && docHeight > 0) {
                val scale = (targetSize.toFloat() / maxOf(docWidth, docHeight)) * 0.85f
                val dx = (targetSize - docWidth * scale) / 2f
                val dy = (targetSize - docHeight * scale) / 2f
                canvas.translate(dx, dy)
                canvas.scale(scale, scale)
            }
            svg.renderToCanvas(canvas)
            bitmap
        } catch (_: Throwable) {
            null
        }
    }

    fun brandColor(slug: String): Color {
        return when (slug.lowercase()) {
            "google", "gmail", "googlecalendar", "googledocs", "googlesheets", "googledrive" -> Color(0xFF4285F4)
            "github" -> Color(0xFF24292F)
            "slack" -> Color(0xFF4A154B)
            "notion" -> Color(0xFF000000)
            "linear" -> Color(0xFF5E6AD2)
            "sentry" -> Color(0xFF362D59)
            "discord" -> Color(0xFF5865F2)
            "twitter", "x" -> Color(0xFF14171A)
            "vercel" -> Color(0xFF000000)
            "render" -> Color(0xFF46E3B7)
            "stripe" -> Color(0xFF635BFF)
            "supabase" -> Color(0xFF3ECF8E)
            "hubspot" -> Color(0xFFFF7A59)
            "figma" -> Color(0xFFF24E1E)
            "dropbox" -> Color(0xFF0061FF)
            "jira", "atlassian" -> Color(0xFF0052CC)
            "asana" -> Color(0xFFF06A6A)
            "trello" -> Color(0xFF0079BF)
            "reddit" -> Color(0xFFFF4500)
            else -> Color(0xFF607D8B)
        }
    }
}

/**
 * Connected app icon component.
 *
 * Renders the official logo if available, or a clean brand-colored initial badge.
 */
@Composable
fun ConnectedAppIcon(
    card: ConnectorCard,
    modifier: Modifier = Modifier,
    size: Dp = 38.dp,
) {
    val context = LocalContext.current
    var bitmap by remember(card.slug) { mutableStateOf<ImageBitmap?>(null) }

    LaunchedEffect(card.slug) {
        bitmap = ConnectorIconLoader.loadIcon(context, card)
    }

    val currentBitmap = bitmap
    if (currentBitmap != null) {
        Box(
            modifier = modifier
                .size(size)
                .clip(RoundedCornerShape(11.dp))
                .background(Color.White),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                bitmap = currentBitmap,
                contentDescription = card.label,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .size(size * 0.82f)
                    .clip(RoundedCornerShape(8.dp)),
            )
        }
    } else {
        val brandColor = remember(card.slug) { ConnectorIconLoader.brandColor(card.slug) }
        val initial = card.label.trim().take(1).uppercase().ifEmpty { "?" }
        Box(
            modifier = modifier
                .size(size)
                .clip(RoundedCornerShape(11.dp))
                .background(brandColor),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = initial,
                fontSize = (size.value * 0.42f).sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
        }
    }
}
