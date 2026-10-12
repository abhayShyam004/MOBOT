package com.openmausbot.companion.storage

import android.content.Context
import android.content.SharedPreferences
import com.openmausbot.companion.core.ThemeMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * How the app is drawn, as the person chose it.
 *
 * One value, committed to disk the moment it changes: a theme that resets on
 * next launch is a setting people conclude is broken, and the write is a single
 * small string. Placed in [com.openmausbot.companion.ui.CompanionEnvironment] so
 * the theme at the root of the composition and the row in Settings that changes
 * it are reading the same value rather than two copies that agree today.
 *
 * Deliberately *not* the same store as `ChatPreferences`: how a transcript is
 * folded is about conversations, and what the app looks like is about the app.
 */
class AppearancePreferences(
    private val prefs: SharedPreferences,
) {
    constructor(context: Context) : this(
        context.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE),
    )

    private val _theme = MutableStateFlow(ThemeMode.fromWire(prefs.getString(THEME, null)))
    val theme: StateFlow<ThemeMode> = _theme.asStateFlow()

    /**
     * The chosen background's id — empty for the plain page, and read as none
     * for anything this build does not know (see
     * [com.openmausbot.companion.ui.BackgroundArt.fromId]).
     *
     * Stored here rather than in its own file on purpose: theme and background
     * are one decision about how the app looks, and a person changing one
     * expects the other to still be there afterwards.
     */
    private val _background = MutableStateFlow(prefs.getString(BACKGROUND, null).orEmpty())
    val background: StateFlow<String> = _background.asStateFlow()

    fun setBackground(id: String) {
        if (_background.value == id && prefs.contains(BACKGROUND)) return
        // Commit, for the reason [setTheme] commits: the next frame is a
        // redraw of every screen, and a wallpaper that arrived one launch
        // late is a setting that looks broken.
        prefs.edit().putString(BACKGROUND, id).commit()
        _background.value = id
    }

    fun setTheme(mode: ThemeMode) {
        if (_theme.value == mode && prefs.contains(THEME)) return
        // Commit rather than apply: the next thing that happens is usually a
        // process-visible redraw, and a theme that arrives one launch late is
        // indistinguishable from a broken control.
        prefs.edit().putString(THEME, mode.wireValue).commit()
        _theme.value = mode
    }

    private companion object {
        const val NAME = "openmaus.appearance"
        const val THEME = "theme"
        const val BACKGROUND = "background"
    }
}
