package com.openmausbot.companion.core

/**
 * Which theme the app draws in.
 *
 * `LIGHT` is the default, and it is a design decision rather than an accident:
 * this app's interface is a light one — a warm off-white page, dark type, white
 * surfaces, and a pastel backdrop behind the content — and that is the version of
 * it the design was drawn for. A phone set to dark used to get the dark
 * interpretation from its first launch; now it gets the light one, and the person
 * can move to `DARK` or hand the decision back to the phone with `SYSTEM`.
 *
 * The old default was `SYSTEM`, on the argument that it "is never wrong". That
 * argument holds for an app whose dark theme is the design; it does not hold for
 * one whose light theme is, because then the first launch is a coin toss between
 * the intended look and a second interpretation of it.
 *
 * Lives in `:core` rather than the UI because the choice is stored: the app's
 * preference store reads it back long before any Compose tree exists.
 */
enum class ThemeMode(
    val wireValue: String,
    val label: String,
    val caption: String,
) {
    LIGHT("light", "Light", "The app's own light theme."),
    SYSTEM("system", "System", "Follow the phone's own setting."),
    DARK("dark", "Dark", "Always draw the dark theme."),
    ;

    companion object {
        /**
         * An unknown or missing value is not an error; it is the default.
         *
         * A stored `"system"` or `"dark"` still wins: this is the fallback for a
         * phone that has never opened Appearance, not a migration that overrides
         * a choice someone already made.
         */
        fun fromWire(value: String?): ThemeMode =
            entries.firstOrNull { it.wireValue == value } ?: LIGHT
    }
}
