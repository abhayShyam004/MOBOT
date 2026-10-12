package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.terminal.TerminalSession
import com.openmausbot.companion.terminal.TerminalSessions
import kotlin.math.floor

/**
 * Which terminal is on screen, and whether the screen is up at all.
 *
 * Separated from the Composable so the rules can be tested: a bot starting a
 * terminal must put it in front of the person, a session the person closed must
 * not leave the surface pointing at a session that no longer exists, and
 * leaving the surface must never close anything.
 */
class TerminalPresentation internal constructor(private val sessions: TerminalSessions) {
    var visible by mutableStateOf(false)
        private set
    var selectedId by mutableStateOf<String?>(null)
        private set

    val selected: TerminalSession? get() = selectedId?.let { sessions.get(it) }

    /** Show [id] — the session stays running either way. */
    fun show(id: String) {
        if (sessions.get(id) == null) return
        selectedId = id
        visible = true
    }

    /** Leave the screen. The program keeps running; this is not a close. */
    fun leave() {
        visible = false
    }

    /**
     * React to the registry. An id that no longer exists (closed by the bot, by
     * a person, or because the app closed everything) must never be shown, and
     * when the last one goes the surface goes with it.
     */
    fun reconcile() {
        val live = sessions.list()
        if (live.isEmpty()) {
            visible = false
            selectedId = null
            return
        }
        if (selectedId == null || live.none { it.id == selectedId }) {
            selectedId = live.first().id
        }
    }

    /** The registry's "someone wants to see this" signal, consumed once. */
    fun consumeOpenRequest(id: String?) {
        if (id != null) show(id)
        sessions.consumeOpenRequest()
    }

    companion object {
        @Volatile private var current: TerminalPresentation? = null

        /**
         * The app's one presentation, for this registry.
         *
         * It has to outlive a composition, because "which terminal is on
         * screen" is not a screen's business: rotating the phone or any other
         * Activity recreation would otherwise drop the person back to the
         * roster with a running program they did not close. The session
         * survives either way (it belongs to the registry) — this is what makes
         * the surface survive with it.
         */
        fun of(sessions: TerminalSessions): TerminalPresentation = synchronized(this) {
            val existing = current
            if (existing != null && existing.sessions === sessions) existing
            else TerminalPresentation(sessions).also { current = it }
        }
    }
}

/**
 * A real terminal on a phone screen: live output, a keyboard, the keys a
 * terminal has, its true dimensions, and an honest state line.
 *
 * It does not paint a terminal (no cell grid, no cursor addressing — see
 * TerminalText for what that means for a full-screen program), and it does not
 * need to: what a person does with a terminal is read the stream and answer it,
 * and both of those are exact here. The output is the program's own bytes with
 * escape sequences consumed; the input is what a terminal sends, including the
 * named keys in [KeyboardRow]; the size is measured from the monospace metrics
 * of the surface and pushed to the program with TIOCSWINSZ, so a program that
 * asks how big it is gets the truth.
 */
@Composable
fun TerminalSurface(
    session: TerminalSession,
    onLeave: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val screen by session.screen.collectAsState()
    val state by session.state.collectAsState()
    val size by session.size.collectAsState()
    val revision by session.revision.collectAsState()

    val scroll = rememberScrollState()
    val focus = remember { FocusRequester() }
    val measurer = rememberTextMeasurer()
    val textStyle = remember { TextStyle(fontFamily = FontFamily.Monospace, fontSize = TERMINAL_FONT_SIZE) }
    // One cell, measured from the same style the output is drawn with: ten Ms
    // divided by ten is a truer column width than any assumed ratio, and the
    // line box is the row height.
    val cell = remember(measurer, textStyle) { measurer.measure("MMMMMMMMMM", textStyle) }
    val charWidth = (cell.size.width / 10f).coerceAtLeast(1f)
    val lineHeight = cell.size.height.coerceAtLeast(1)

    var stage by remember { mutableStateOf(IntSize.Zero) }
    // Keyed on the session: a half-typed line belongs to the program it was
    // being typed to, and must not follow the person into the next terminal.
    var field by remember(session.id) { mutableStateOf("") }
    var rawKeys by remember { mutableStateOf(false) }
    // "Opening terminal…" is true for the first moments of a session, not for
    // every session that has not printed yet: a program may legitimately wait
    // for input before saying anything, and a state line that keeps saying
    // "opening" would be a lie about a program that is running fine.
    var starting by remember(session.id) { mutableStateOf(true) }
    // Ending a terminal is the one thing on this screen that cannot be undone,
    // so the small close affordance asks first: a thumb on the header, or a
    // stray tap, must not be able to kill a program mid-download.
    var confirmEnd by remember(session.id) { mutableStateOf(false) }
    LaunchedEffect(session.id) {
        kotlinx.coroutines.delay(4_000)
        starting = false
    }

    // The size the program believes it has, from the space the output actually
    // occupies — recomputed on rotation, on the keyboard sliding up, and on any
    // other relayout, and only sent when it changed.
    LaunchedEffect(stage, charWidth, lineHeight, session.id) {
        if (stage.width <= 0 || stage.height <= 0) return@LaunchedEffect
        val cols = floor(stage.width / charWidth).toInt()
        val rows = floor(stage.height / lineHeight.toFloat()).toInt()
        if (cols < TerminalSession.MIN_COLS || rows < TerminalSession.MIN_ROWS) return@LaunchedEffect
        if (cols != session.size.value.cols || rows != session.size.value.rows) {
            runCatching { session.resize(rows, cols) }
        }
    }

    // A terminal you just opened is one you want to type into.
    LaunchedEffect(session.id) {
        runCatching { focus.requestFocus() }
    }

    // Follow the stream while the reader is at the bottom; stop following the
    // moment they scroll back, so output never yanks the view out from under
    // someone reading earlier lines.
    val atBottom = scroll.value >= scroll.maxValue - 4
    LaunchedEffect(revision, atBottom) {
        if (atBottom && scroll.maxValue > 0) scroll.scrollTo(scroll.maxValue)
    }

    fun send(text: String, enter: Boolean = false) {
        runCatching { session.writeText(text, enter) }
            .onFailure { field = "" }
    }

    fun press(key: String) {
        runCatching { session.sendKeys(listOf(key)) }
    }

    /** What both Enter paths do: send what was typed, then press Enter. */
    fun submit(text: String) {
        field = ""
        if (text.isNotEmpty()) send(text.trimEnd('\n'))
        press("enter")
    }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = TERMINAL_BACKGROUND,
        contentColor = TERMINAL_TEXT,
    ) {
        Column(modifier = Modifier.fillMaxSize().imePadding()) {

            // ── header: what this is, what it is doing, how big it is ───────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = session.label,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Text(
                    text = stateLine(
                        running = state.running,
                        exitCode = state.exitCode,
                        signal = state.signal,
                        closed = state.closed,
                        starting = starting && screen.isEmpty(),
                    ),
                    fontSize = 11.sp,
                    color = if (state.running) TERMINAL_OK else TERMINAL_DIM,
                    maxLines = 1,
                )
                Text(
                    text = "${size.cols}×${size.rows}",
                    fontSize = 11.sp,
                    color = TERMINAL_DIM,
                )
                Box(modifier = Modifier.weight(1f))
                TerminalIconButton(onClick = onLeave) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back to the app",
                        modifier = Modifier.size(18.dp),
                    )
                }
                TerminalIconButton(onClick = { confirmEnd = true }) {
                    Icon(Icons.Filled.Close, contentDescription = "End this terminal", modifier = Modifier.size(18.dp))
                }
            }

            // ── output ──────────────────────────────────────────────────────
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(TERMINAL_BACKGROUND)
                    .onSizeChanged { stage = it }
                    .verticalScroll(scroll)
                    .padding(horizontal = 10.dp),
            ) {
                Text(
                    text = if (screen.isEmpty() && state.running) "" else screen.ifEmpty { "" },
                    style = textStyle,
                    color = TERMINAL_TEXT,
                )
            }

            if (!state.running) {
                Text(
                    text = exitLine(state.exitCode, state.signal),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    color = TERMINAL_DIM,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 2.dp),
                )
            }

            // ── keys a terminal has, and that a phone keyboard does not ─────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                KeyChip("esc") { press("escape") }
                KeyChip("tab") { press("tab") }
                KeyChip("^C") { press("ctrl-c") }
                KeyChip("^D") { press("ctrl-d") }
                KeyChip("↑") { press("up") }
                KeyChip("↓") { press("down") }
                KeyChip("←") { press("left") }
                KeyChip("→") { press("right") }
                KeyChip("⌫") { press("backspace") }
                KeyChip(if (rawKeys) "raw:on" else "raw:off", active = rawKeys) {
                    rawKeys = !rawKeys
                    field = ""
                }
            }

            // ── input ───────────────────────────────────────────────────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(TERMINAL_INPUT_BACKGROUND)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                BasicTextField(
                    value = field,
                    onValueChange = { next ->
                        if (!rawKeys) {
                            field = next
                            return@BasicTextField
                        }
                        // Raw mode: every keystroke is the program's, exactly as
                        // a terminal delivers it. Insertions are the text that
                        // appeared; deletions are Backspace. The field itself
                        // stays empty — the program echoes what it received, so
                        // a local echo here would double every character.
                        val common = field.commonPrefixWith(next)
                        val added = next.substring(common.length)
                        if (added.isNotEmpty()) send(added)
                        repeat(field.length - common.length) { press("backspace") }
                        field = ""
                    },
                    textStyle = TextStyle(
                        fontFamily = FontFamily.Monospace,
                        fontSize = TERMINAL_FONT_SIZE,
                        color = TERMINAL_TEXT,
                    ),
                    cursorBrush = SolidColor(TERMINAL_OK),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    // A soft keyboard's Done key arrives as an IME action…
                    keyboardActions = KeyboardActions(onDone = { submit(field) }),
                    // …and a hardware Enter key arrives as a key event, which is
                    // what a terminal's Enter is. Consuming it here is what
                    // stops it from being inserted into the field, and is why
                    // the field cannot accumulate a newline.
                    modifier = Modifier
                        .weight(1f)
                        .focusRequester(focus)
                        .onPreviewKeyEvent { event ->
                            if (rawKeys) return@onPreviewKeyEvent false
                            val enter = event.key == Key.Enter || event.key == Key.NumPadEnter
                            if (!enter) return@onPreviewKeyEvent false
                            if (event.type == KeyEventType.KeyUp) submit(field)
                            true
                        }
                        .padding(vertical = 4.dp),
                    decorationBox = { inner ->
                        if (field.isEmpty()) {
                            Text(
                                text = if (rawKeys) "type — every key goes straight to the program" else "type here, then Enter",
                                style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = TERMINAL_FONT_SIZE),
                                color = TERMINAL_DIM,
                            )
                        }
                        inner()
                    },
                )
                if (!rawKeys) {
                    KeyChip("enter") { submit(field) }
                }
            }
        }

        if (confirmEnd) {
            AlertDialog(
                onDismissRequest = { confirmEnd = false },
                title = { Text("End this terminal?") },
                text = {
                    Text(
                        if (state.running) {
                            "This stops ${session.label} and anything it started. " +
                                "Use the back arrow to leave it running instead."
                        } else {
                            "${session.label} has already stopped. Ending it clears the screen away."
                        },
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        confirmEnd = false
                        onClose()
                    }) { Text("End it") }
                },
                dismissButton = {
                    TextButton(onClick = { confirmEnd = false }) {
                        Text(if (state.running) "Keep running" else "Cancel")
                    }
                },
            )
        }
    }
}

/**
 * A terminal worth returning to, when its screen is not up.
 *
 * One chip per running terminal, each naming its own program, because the point
 * of the chip is to get back to a *particular* running thing: a single chip
 * that said "2 terminals" would be a door that only opens one of them.
 */
@Composable
fun TerminalChip(
    label: String,
    active: Boolean = false,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(18.dp))
            .background(TERMINAL_BACKGROUND)
            .clickable(role = Role.Button, onClick = onOpen)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = ">_",
            color = if (active) TERMINAL_TEXT else TERMINAL_OK,
            fontFamily = FontFamily.Monospace,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = label,
            color = TERMINAL_TEXT,
            fontSize = 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.width(160.dp),
        )
    }
}

@Composable
private fun KeyChip(text: String, active: Boolean = false, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (active) TERMINAL_OK else TERMINAL_KEY_BACKGROUND)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = if (active) TERMINAL_BACKGROUND else TERMINAL_TEXT,
            fontFamily = FontFamily.Monospace,
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun TerminalIconButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .size(34.dp)
            .clip(RoundedCornerShape(8.dp))
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        androidx.compose.runtime.CompositionLocalProvider(
            androidx.compose.material3.LocalContentColor provides TERMINAL_TEXT,
        ) { content() }
    }
}

/** The state of a session, in a word. "Opening terminal…" is honest: the
 *  session exists and is starting, and there is nothing to show yet. */
internal fun stateLine(
    running: Boolean,
    exitCode: Int?,
    signal: Int?,
    closed: Boolean,
    starting: Boolean,
): String = when {
    closed -> "closed"
    running && starting -> "Opening terminal…"
    running -> "running"
    signal != null -> "stopped"
    exitCode != null -> "exited ($exitCode)"
    else -> "ended"
}

internal fun exitLine(exitCode: Int?, signal: Int?): String = when {
    signal != null -> "the program was stopped by the system (signal $signal)"
    exitCode != null && exitCode == 0 -> "the program finished"
    exitCode != null -> "the program exited with status $exitCode"
    else -> "the program is no longer running"
}

private fun String.commonPrefixWith(other: String): String {
    val limit = minOf(length, other.length)
    var i = 0
    while (i < limit && this[i] == other[i]) i++
    return substring(0, i)
}

// A terminal is a dark surface with light monospace text on every platform; the
// theme's colors would make it look like a chat bubble, which is precisely the
// thing it must not look like.
private val TERMINAL_BACKGROUND = Color(0xFF0B1020)
private val TERMINAL_INPUT_BACKGROUND = Color(0xFF141B33)
private val TERMINAL_KEY_BACKGROUND = Color(0xFF232C4A)
private val TERMINAL_TEXT = Color(0xFFE6EAF5)
private val TERMINAL_DIM = Color(0xFF8C97B8)
private val TERMINAL_OK = Color(0xFF4ADE80)
private val TERMINAL_FONT_SIZE = 12.sp
