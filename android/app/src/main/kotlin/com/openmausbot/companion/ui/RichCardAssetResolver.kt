package com.openmausbot.companion.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.util.Log
import android.util.LruCache
import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.caverock.androidsvg.SVG
import com.openmausbot.companion.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * High-performance, non-blocking asset resolver for rich sports and competition cards.
 *
 * Implements a 2-tier caching hierarchy (memory LRU + disk cache) and provides
 * authentic bundled vector/raster assets for player portraits, country flags,
 * and competition team crests.
 *
 * Strictly adheres to the zero-emoji invariant.
 */
object RichCardAssetResolver {
    private const val TAG = "RichCardAssetResolver"
    private const val MEMORY_CACHE_SIZE = 120
    private const val TIMEOUT_MILLIS = 5000

    private val memoryCache = LruCache<String, ImageBitmap>(MEMORY_CACHE_SIZE)

    sealed class ResolvedAsset {
        data class Resource(@DrawableRes val resId: Int) : ResolvedAsset()
        data class BitmapAsset(val bitmap: ImageBitmap) : ResolvedAsset()
        object None : ResolvedAsset()
    }

    /**
     * Resolves a bundled portrait resource ID for a player, or null if unbundled.
     */
    @DrawableRes
    fun getBundledPlayerPortrait(playerName: String): Int? {
        val norm = normalizeKey(playerName)
        return when {
            norm.contains("virat") || norm.contains("kohli") -> R.drawable.player_virat_kohli
            norm.contains("sanju") || norm.contains("samson") -> R.drawable.player_sanju_samson
            norm.contains("rohit") || norm.contains("sharma") -> R.drawable.player_rohit_sharma
            norm.contains("alcaraz") || norm.contains("carlos") -> R.drawable.player_carlos_alcaraz
            norm.contains("djokovic") || norm.contains("novak") -> R.drawable.player_novak_djokovic
            else -> null
        }
    }

    /**
     * Resolves a country flag resource ID given a country name, ISO code, or IOC code.
     * Covers the minimum coverage set and common sporting nations.
     */
    @DrawableRes
    fun getBundledCountryFlag(countryNameOrCode: String?): Int? {
        if (countryNameOrCode.isNullOrBlank()) return null
        val norm = normalizeKey(countryNameOrCode)
        return when {
            norm in listOf("in", "ind", "india") -> R.drawable.flag_in
            norm in listOf("nz", "nzl", "new zealand") -> R.drawable.flag_nz
            norm in listOf("za", "rsa", "sa", "south africa") -> R.drawable.flag_za
            norm in listOf("cn", "chn", "china", "pr china", "people's republic of china") -> R.drawable.flag_cn
            norm in listOf("jp", "jpn", "japan") -> R.drawable.flag_jp
            norm in listOf("kr", "kor", "korea", "south korea", "republic of korea", "korea republic") -> R.drawable.flag_kr
            norm in listOf("uz", "uzb", "uzbekistan") -> R.drawable.flag_uz
            norm in listOf("ir", "iri", "iran", "islamic republic of iran") -> R.drawable.flag_ir
            norm in listOf("th", "tha", "thailand") -> R.drawable.flag_th
            norm in listOf("kz", "kaz", "kazakhstan") -> R.drawable.flag_kz
            norm in listOf("hk", "hkg", "hong kong", "hong kong, china", "hong kong china") -> R.drawable.flag_hk
            norm in listOf("bh", "brn", "bahrain") -> R.drawable.flag_bh
            norm in listOf("us", "usa", "united states", "united states of america", "usa team") -> R.drawable.flag_us
            norm in listOf("gb", "gbr", "uk", "great britain", "england", "united kingdom", "team gb") -> R.drawable.flag_gb
            norm in listOf("au", "aus", "australia") -> R.drawable.flag_au
            norm in listOf("es", "esp", "spain") -> R.drawable.flag_es
            norm in listOf("it", "ita", "italy") -> R.drawable.flag_it
            norm in listOf("de", "ger", "germany") -> R.drawable.flag_de
            norm in listOf("fr", "fra", "france") -> R.drawable.flag_fr
            norm in listOf("ar", "arg", "argentina") -> R.drawable.flag_ar
            norm in listOf("br", "bra", "brazil") -> R.drawable.flag_br
            norm in listOf("pk", "pak", "pakistan") -> R.drawable.flag_pk
            norm in listOf("lk", "sri", "sl", "sri lanka") -> R.drawable.flag_lk
            norm in listOf("bd", "ban", "bangladesh") -> R.drawable.flag_bd
            norm in listOf("af", "afg", "afghanistan") -> R.drawable.flag_af
            norm in listOf("nl", "ned", "netherlands") -> R.drawable.flag_nl
            norm in listOf("ca", "can", "canada") -> R.drawable.flag_ca
            norm in listOf("jm", "jam", "jamaica") -> R.drawable.flag_jm
            norm in listOf("ke", "ken", "kenya") -> R.drawable.flag_ke
            norm in listOf("et", "eth", "ethiopia") -> R.drawable.flag_et
            norm in listOf("no", "nor", "norway") -> R.drawable.flag_no
            norm in listOf("se", "swe", "sweden") -> R.drawable.flag_se
            norm in listOf("ch", "sui", "switzerland") -> R.drawable.flag_ch
            norm in listOf("pt", "por", "portugal") -> R.drawable.flag_pt
            norm in listOf("be", "bel", "belgium") -> R.drawable.flag_be
            norm in listOf("at", "aut", "austria") -> R.drawable.flag_at
            else -> null
        }
    }

    /**
     * Resolves a club/team logo resource ID given a team name or abbreviation.
     */
    @DrawableRes
    fun getBundledTeamLogo(teamName: String?, sport: String? = null): Int? {
        if (teamName.isNullOrBlank()) return null
        val norm = normalizeKey(teamName)

        // 1. Club logos
        when {
            norm.contains("arsenal") -> return R.drawable.logo_arsenal
            norm.contains("manchester city") || norm in listOf("man city", "mancity", "mcfc") -> return R.drawable.logo_man_city
            norm.contains("chelsea") -> return R.drawable.logo_chelsea
            norm.contains("liverpool") || norm == "lfc" -> return R.drawable.logo_liverpool
            norm.contains("manchester united") || norm in listOf("man united", "man utd", "mufc") -> return R.drawable.logo_man_utd
            norm.contains("tottenham") || norm.contains("spurs") -> return R.drawable.logo_tottenham
            norm.contains("newcastle") -> return R.drawable.logo_newcastle
            norm.contains("aston villa") || norm == "avfc" -> return R.drawable.logo_aston_villa
            norm.contains("real madrid") -> return R.drawable.logo_real_madrid
            norm.contains("barcelona") || norm == "barca" -> return R.drawable.logo_barcelona
            norm.contains("chennai super kings") || norm == "csk" -> return R.drawable.logo_csk
            norm.contains("mumbai indians") || norm == "mi" -> return R.drawable.logo_mi
            norm == "bcci" -> return R.drawable.logo_bcci
        }

        // 2. If national team or sport flag match
        val flagMatch = getBundledCountryFlag(teamName)
        if (flagMatch != null) return flagMatch

        return null
    }

    /**
     * Asynchronously loads an image from a remote URL, with 2-tier disk and memory caching.
     */
    suspend fun loadRemoteImage(context: Context, imageUrl: String?): ImageBitmap? = withContext(Dispatchers.IO) {
        if (imageUrl.isNullOrBlank()) return@withContext null
        val cacheKey = hashUrl(imageUrl)

        // 1. Memory cache check
        memoryCache.get(cacheKey)?.let { return@withContext it }

        // 2. Disk cache check
        val diskCacheDir = File(context.cacheDir, "rich_card_assets").apply { if (!exists()) mkdirs() }
        val diskFile = File(diskCacheDir, "$cacheKey.png")
        if (diskFile.exists() && diskFile.length() > 0) {
            try {
                val bitmap = BitmapFactory.decodeFile(diskFile.absolutePath)
                if (bitmap != null) {
                    val imageBitmap = bitmap.asImageBitmap()
                    memoryCache.put(cacheKey, imageBitmap)
                    return@withContext imageBitmap
                }
            } catch (_: Throwable) {}
        }

        // 3. Network fetch
        try {
            val url = URL(imageUrl)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MILLIS
                readTimeout = TIMEOUT_MILLIS
                setRequestProperty("User-Agent", "MOBOT/1.0 (Android Rich Cards)")
            }

            conn.inputStream.use { input ->
                val bytes = input.readBytes()
                val contentType = conn.contentType.orEmpty().lowercase()
                val isSvg = contentType.contains("svg") || imageUrl.endsWith(".svg", ignoreCase = true) ||
                    String(bytes.take(100).toByteArray()).contains("<svg", ignoreCase = true)

                val bitmap = if (isSvg) {
                    renderSvgToBitmap(bytes)
                } else {
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                }

                if (bitmap != null) {
                    try {
                        FileOutputStream(diskFile).use { out ->
                            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                        }
                    } catch (_: Throwable) {}

                    val imageBitmap = bitmap.asImageBitmap()
                    memoryCache.put(cacheKey, imageBitmap)
                    return@withContext imageBitmap
                }
            }
        } catch (e: Throwable) {
            Log.d(TAG, "Failed downloading remote asset: $imageUrl (${e.message})")
        }

        null
    }

    private fun renderSvgToBitmap(svgBytes: ByteArray): Bitmap? {
        return try {
            val svg = SVG.getFromInputStream(svgBytes.inputStream())
            val targetSize = 96
            val bitmap = Bitmap.createBitmap(targetSize, targetSize, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            svg.renderToCanvas(canvas)
            bitmap
        } catch (_: Throwable) {
            null
        }
    }

    private fun normalizeKey(raw: String): String {
        return raw.lowercase()
            .trim()
            .replace(Regex("[^a-z0-9\\s]"), "")
            .replace(Regex("\\s+"), " ")
    }

    private fun hashUrl(url: String): String {
        return try {
            val md = MessageDigest.getInstance("MD5")
            val digest = md.digest(url.toByteArray())
            digest.joinToString("") { "%02x".format(it) }
        } catch (_: Throwable) {
            url.hashCode().toString()
        }
    }
}

// ── Jetpack Compose Rich Card Image & Badge Helpers ──

/**
 * Renders an authentic player portrait where available, falling back gracefully to initials.
 */
@Composable
fun RichPlayerAvatar(
    playerName: String,
    avatarUrl: String? = null,
    modifier: Modifier = Modifier,
    size: Dp = 44.dp,
) {
    val context = LocalContext.current
    val bundledRes = remember(playerName) { RichCardAssetResolver.getBundledPlayerPortrait(playerName) }
    var remoteBitmap by remember(avatarUrl) { mutableStateOf<ImageBitmap?>(null) }

    LaunchedEffect(avatarUrl) {
        if (!avatarUrl.isNullOrBlank()) {
            remoteBitmap = RichCardAssetResolver.loadRemoteImage(context, avatarUrl)
        }
    }

    val initials = remember(playerName) {
        playerName.split(" ").filter { it.isNotBlank() }.map { it.first() }.take(2).joinToString("").uppercase()
    }

    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .border(1.5.dp, AppTheme.colors.accent.copy(alpha = 0.6f), CircleShape)
            .background(AppTheme.colors.surfaceRaised),
        contentAlignment = Alignment.Center,
    ) {
        when {
            remoteBitmap != null -> {
                Image(
                    bitmap = remoteBitmap!!,
                    contentDescription = playerName,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(size).clip(CircleShape),
                )
            }
            bundledRes != null -> {
                Image(
                    painter = painterResource(id = bundledRes),
                    contentDescription = playerName,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(size).clip(CircleShape),
                )
            }
            else -> {
                Text(
                    text = initials.ifBlank { "?" },
                    fontSize = if (size >= 40.dp) 16.sp else 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = AppTheme.colors.accent,
                )
            }
        }
    }
}

/**
 * Renders an authentic country flag asset with crisp aspect ratio and fallback badge.
 */
@Composable
fun RichCountryFlag(
    name: String,
    code: String? = null,
    flagUrl: String? = null,
    modifier: Modifier = Modifier,
    width: Dp = 20.dp,
    height: Dp = 14.dp,
) {
    val context = LocalContext.current
    val bundledRes = remember(name, code) {
        RichCardAssetResolver.getBundledCountryFlag(code) ?: RichCardAssetResolver.getBundledCountryFlag(name)
    }
    var remoteBitmap by remember(flagUrl) { mutableStateOf<ImageBitmap?>(null) }

    LaunchedEffect(flagUrl) {
        if (!flagUrl.isNullOrBlank()) {
            remoteBitmap = RichCardAssetResolver.loadRemoteImage(context, flagUrl)
        }
    }

    if (bundledRes == null && remoteBitmap == null && flagUrl.isNullOrBlank()) {
        Log.d("RichCardAssetResolver", "Country flag unmapped: name='$name', code='$code'")
    }

    when {
        remoteBitmap != null -> {
            Image(
                bitmap = remoteBitmap!!,
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = modifier
                    .size(width = width, height = height)
                    .clip(RoundedCornerShape(2.dp))
                    .border(0.5.dp, AppTheme.colors.hairline, RoundedCornerShape(2.dp)),
            )
        }
        bundledRes != null -> {
            Image(
                painter = painterResource(id = bundledRes),
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = modifier
                    .size(width = width, height = height)
                    .clip(RoundedCornerShape(2.dp))
                    .border(0.5.dp, AppTheme.colors.hairline, RoundedCornerShape(2.dp)),
            )
        }
        else -> {
            // Diagnostic fallback badge with nation abbreviation
            val badgeText = remember(name, code) {
                (code?.trim()?.take(3) ?: name.take(3)).uppercase()
            }
            Box(
                modifier = modifier
                    .size(width = width, height = height)
                    .clip(RoundedCornerShape(2.dp))
                    .background(AppTheme.colors.surfaceRaised)
                    .border(0.5.dp, AppTheme.colors.hairline, RoundedCornerShape(2.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = badgeText,
                    fontSize = 7.sp,
                    fontWeight = FontWeight.Bold,
                    color = AppTheme.colors.textSecondary,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * Renders an authentic team logo or country flag, falling back gracefully to a stylized monogram badge.
 */
@Composable
fun RichTeamLogo(
    name: String,
    sport: String? = null,
    shortName: String? = null,
    logoUrl: String? = null,
    flag: String? = null,
    color: String? = null,
    modifier: Modifier = Modifier,
    size: Dp = 20.dp,
) {
    val context = LocalContext.current

    // 0. If individual sport player (tennis, etc.), try player portrait first!
    val bundledPlayerRes = remember(name, sport) {
        if (sport?.lowercase() in listOf("tennis", "golf", "boxing", "athletics", "generic")) {
            RichCardAssetResolver.getBundledPlayerPortrait(name)
        } else null
    }

    // 1. Try bundled team logo
    val bundledTeamRes = remember(name, shortName, sport) {
        if (bundledPlayerRes == null) {
            RichCardAssetResolver.getBundledTeamLogo(name, sport)
                ?: shortName?.let { RichCardAssetResolver.getBundledTeamLogo(it, sport) }
        } else null
    }

    // 2. Try bundled flag
    val bundledFlagRes = remember(name, shortName, flag) {
        if (bundledTeamRes == null && bundledPlayerRes == null) {
            RichCardAssetResolver.getBundledCountryFlag(flag)
                ?: RichCardAssetResolver.getBundledCountryFlag(name)
                ?: shortName?.let { RichCardAssetResolver.getBundledCountryFlag(it) }
        } else null
    }

    var remoteBitmap by remember(logoUrl) { mutableStateOf<ImageBitmap?>(null) }

    LaunchedEffect(logoUrl) {
        if (!logoUrl.isNullOrBlank()) {
            remoteBitmap = RichCardAssetResolver.loadRemoteImage(context, logoUrl)
        }
    }

    val teamColor = remember(color) {
        if (!color.isNullOrBlank()) {
            try { Color(android.graphics.Color.parseColor(color)) } catch (_: Exception) { Color(0xFF3B82F6) }
        } else {
            Color(0xFF3B82F6)
        }
    }

    when {
        remoteBitmap != null -> {
            Image(
                bitmap = remoteBitmap!!,
                contentDescription = name,
                contentScale = ContentScale.Fit,
                modifier = modifier.size(size).clip(CircleShape),
            )
        }
        bundledPlayerRes != null -> {
            Image(
                painter = painterResource(id = bundledPlayerRes),
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = modifier
                    .size(size)
                    .clip(CircleShape)
                    .border(1.dp, AppTheme.colors.accent.copy(alpha = 0.5f), CircleShape),
            )
        }
        bundledTeamRes != null -> {
            Image(
                painter = painterResource(id = bundledTeamRes),
                contentDescription = name,
                contentScale = ContentScale.Fit,
                modifier = modifier.size(size).clip(CircleShape),
            )
        }
        bundledFlagRes != null -> {
            Image(
                painter = painterResource(id = bundledFlagRes),
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = modifier
                    .size(width = size, height = (size.value * 0.7f).dp)
                    .clip(RoundedCornerShape(2.dp))
                    .border(0.5.dp, AppTheme.colors.hairline, RoundedCornerShape(2.dp)),
            )
        }
        else -> {
            // Diagnostic fallback badge with team initials
            val initials = remember(name, shortName) {
                shortName ?: name.split(" ").filter { it.isNotBlank() }.map { it.first() }.take(2).joinToString("").uppercase()
            }
            Box(
                modifier = modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(teamColor.copy(alpha = 0.2f))
                    .border(1.dp, teamColor.copy(alpha = 0.6f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = initials.take(3),
                    fontSize = (size.value * 0.45f).sp,
                    fontWeight = FontWeight.Bold,
                    color = teamColor,
                )
            }
        }
    }
}
