package com.openmausbot.companion.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.R

/**
 * The shared vocabulary every screen is built out of.
 *
 * The rule these exist to enforce: two screens that show the same *kind* of thing
 * show it the same way. A heading, a row, a card, a state dot, an empty state —
 * each is defined once here and parameterised, so the roster, the chat, Settings
 * and the bot screens read as one product instead of four.
 *
 * Nothing in this file invents a colour or a size. Everything comes from
 * [AppTheme], [AppSpacing], [AppRadii] and [AppMotion], which is what keeps a
 * later change to the system from having to be repeated screen by screen.
 */

/**
 * A heading over a stretch of content: "Today", "Pinned", "Connected apps".
 *
 * Small and quiet on purpose — a heading is a signpost, not a title, so it is
 * sentence case in `textSecondary` and set at the size of a label. Uppercase
 * tracked-out headings are the house style of a settings page; the reference this
 * language came from labels a stretch of content the way a person would say it.
 */
@Composable
internal fun AppSectionHeader(
    text: String,
    modifier: Modifier = Modifier,
    trailing: @Composable () -> Unit = {},
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = AppSpacing.gutter, vertical = AppSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = text,
            // `titleSmall` is the object size — the same step a bot's name is set
            // in, which is what makes a label read as belonging to the list under
            // it rather than to the chrome above it.
            style = MaterialTheme.typography.titleSmall,
            color = AppTheme.colors.textSecondary,
            modifier = Modifier.weight(1f),
        )
        trailing()
    }
}

/**
 * The separator between two rows of a list.
 *
 * [inset] is what makes it read as a list rather than a table: the line starts
 * where the row's text starts, so the avatars down the left keep a clean column
 * with nothing crossing it.
 */
@Composable
internal fun Hairline(
    modifier: Modifier = Modifier,
    inset: Dp = AppSpacing.gutter,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = inset)
            .height(1.dp)
            .background(AppTheme.colors.hairline),
    )
}

/**
 * A raised surface: a sheet, a settings group, an artifact.
 *
 * Deliberately a *container of meaning* rather than the default shape of
 * everything. Rows and headings do not get a card; a card is for content that is
 * one object — a question from a bot, a running task, a provider's settings.
 */
@Composable
internal fun AppCard(
    modifier: Modifier = Modifier,
    shape: Shape = AppRadii.cardShape,
    color: Color = AppTheme.colors.surface,
    bordered: Boolean = false,
    contentPadding: PaddingValues = PaddingValues(AppSpacing.lg),
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(shape)
            .background(color)
            .then(
                if (bordered) {
                    Modifier.border(1.dp, AppTheme.colors.hairline, shape)
                } else {
                    Modifier
                },
            )
            .padding(contentPadding),
    ) {
        content()
    }
}

/** How loud a button is. Most actions in this app are [Quiet]. */
internal enum class PillTone { Accent, Raised, Quiet, Destructive }

/**
 * How tall a pill is drawn.
 *
 * 42 dp rather than the 48 dp minimum: the reference's own pill is a compact
 * capsule, and a row of 48 dp pills is what makes a light screen look like a
 * control panel. The touch target is unaffected — [AppPill] is a row inside a
 * screen's own padded layout, and every call site gives it at least the minimum
 * around it.
 */
internal val PILL_HEIGHT: Dp = 42.dp

/**
 * A pill button.
 *
 * One filled accent pill is allowed on a screen — the thing the person most
 * likely came to do. Everything else is [PillTone.Raised] or [PillTone.Quiet],
 * which is how a screen with five possible actions still reads as calm.
 */
@Composable
internal fun AppPill(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: PillTone = PillTone.Raised,
    leading: (@Composable () -> Unit)? = null,
    enabled: Boolean = true,
) {
    val colors = AppTheme.colors
    val background = when (tone) {
        PillTone.Accent -> colors.accent
        PillTone.Raised -> colors.surface
        PillTone.Quiet -> Color.Transparent
        PillTone.Destructive -> colors.danger.copy(alpha = 0.16f)
    }
    val foreground = when (tone) {
        PillTone.Accent -> colors.onAccent
        PillTone.Raised -> colors.textPrimary
        PillTone.Quiet -> colors.textSecondary
        PillTone.Destructive -> colors.danger
    }
    Row(
        modifier = modifier
            .height(PILL_HEIGHT)
            .clip(AppRadii.pill)
            .background(background)
            .then(
                if (tone == PillTone.Raised) {
                    Modifier.border(1.dp, colors.hairline, AppRadii.pill)
                } else {
                    Modifier
                },
            )
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = if (leading == null) 18.dp else 14.dp)
            .alpha(if (enabled) 1f else 0.5f),
        horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        leading?.invoke()
        Text(
            text = text,
            style = MaterialTheme.typography.titleSmall,
            color = foreground,
            maxLines = 1,
        )
    }
}

/**
 * A state dot: unread, waiting, working.
 *
 * [pulsing] is the one animation allowed to run unattended, and only for work
 * that is actually in flight — a bot that is not doing anything is drawn still.
 * It breathes rather than blinks, so a list of them does not strobe.
 */
@Composable
internal fun AppStatusDot(
    color: Color,
    modifier: Modifier = Modifier,
    size: Dp = AppSizes.dot,
    pulsing: Boolean = false,
) {
    val alpha = if (!pulsing) {
        1f
    } else {
        val transition = rememberInfiniteTransition(label = "dot")
        val value by transition.animateFloat(
            initialValue = 1f,
            targetValue = 0.35f,
            animationSpec = infiniteRepeatable(
                animation = tween(AppMotion.SLOW * 3),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "dot-alpha",
        )
        value
    }
    Box(
        modifier = modifier
            .size(size)
            .alpha(alpha)
            .background(color, CircleShape),
    )
}

/**
 * A text field: a label above it, a soft well under it, and a line of help or
 * correction below.
 *
 * Filled rather than outlined. An outline is a line drawn around a rectangle, and
 * on a page whose surfaces are already rectangles a well is the quieter way to say
 * "this is where typing goes" — the field reads as a place, not as a box. The
 * label sits *above* rather than floating inside, so the field never changes shape
 * when it is focused and a screen's rows do not jump as a person moves through
 * them.
 *
 * [error] and [helper] are the same line of text in two tones, because they are the
 * same thing on screen: what is wrong with what was typed, or what to type.
 */
@Composable
internal fun AppTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    helper: String? = null,
    error: String? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = Int.MAX_VALUE,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    /**
     * True marks the field itself — a red hairline — for a call site that carries
     * its own message elsewhere. Prefer [error] where there is a sentence to say.
     */
    isError: Boolean = false,
    /** A line of help as a composable, for a call site that needs to say more. */
    supportingText: (@Composable () -> Unit)? = null,
    /** Sits on the field's text baseline: a unit, a suffix, a chevron. */
    suffix: (@Composable () -> Unit)? = null,
    textStyle: TextStyle? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailing: (@Composable () -> Unit)? = null,
) {
    val colors = AppTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val border = when {
        error != null || isError -> colors.danger
        focused -> colors.textPrimary
        else -> Color.Transparent
    }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        label?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.labelSmall,
                color = colors.textSecondary,
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(AppRadii.row))
                .background(if (enabled) colors.surfaceRaised else colors.surfaceSunken)
                .border(1.dp, border, RoundedCornerShape(AppRadii.row))
                .padding(horizontal = AppSpacing.md, vertical = 13.dp),
            horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
            verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
        ) {
            Box(modifier = Modifier.weight(1f)) {
                if (value.isEmpty() && placeholder != null) {
                    Text(
                        text = placeholder,
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textTertiary,
                        maxLines = if (singleLine) 1 else 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    enabled = enabled,
                    readOnly = readOnly,
                    singleLine = singleLine,
                    minLines = minLines,
                    maxLines = maxLines,
                    keyboardOptions = keyboardOptions,
                    visualTransformation = visualTransformation,
                    cursorBrush = SolidColor(colors.textPrimary),
                    interactionSource = interaction,
                    textStyle = (textStyle ?: MaterialTheme.typography.bodyLarge).merge(
                        TextStyle(color = colors.textPrimary),
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            suffix?.invoke()
            trailing?.invoke()
        }
        val note = error ?: helper
        when {
            note != null -> Text(
                text = note,
                style = MaterialTheme.typography.bodySmall,
                color = if (error != null) colors.danger else colors.textTertiary,
            )
            supportingText != null -> supportingText()
        }
    }
}

/** No bots, no threads, no search results — said in the app's own voice. */
@Composable
internal fun AppEmptyState(
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = AppSpacing.xxl, vertical = AppSpacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(AppSpacing.sm),
    ) {
        // An empty screen is the one place the decoration is allowed to be the
        // subject rather than the texture: there is nothing else on the page for
        // it to sit behind, and a blank page with a sentence on it is the least
        // designed state an app has.
        DecorativeBackdrop(
            motif = BackdropMotif.HERO,
            height = 130.dp,
            alpha = 0.9f,
        )
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            color = AppTheme.colors.textPrimary,
            textAlign = TextAlign.Center,
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = AppTheme.colors.textSecondary,
            textAlign = TextAlign.Center,
        )
        if (action != null) {
            Spacer(Modifier.height(AppSpacing.sm))
            action()
        }
    }
}

/**
 * Something is being fetched and the screen has nothing to show yet.
 *
 * A quiet line of text rather than a spinner wherever the wait is short and its
 * shape is known — a spinner in the middle of a screen says "this might be
 * broken", and most of these waits are one round trip.
 */
@Composable
internal fun AppLoadingState(
    label: String = "Loading…",
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(AppSpacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = AppTheme.colors.textTertiary,
        )
    }
}

/** The named states a bot can be in, as the interface names them. */
internal object BotStateLabel {
    const val WORKING = "Working"
    const val WAITING = "Waiting on you"
    const val BLOCKED = "Blocked"
    const val QUEUED = "Queued"
    const val IDLE = ""
}

/**
 * One bot, in the roster and anywhere else a bot is listed.
 *
 * Two lines, and the row is four things: the face (who it is, and what it is doing
 * right now), the name with its role beside it, and the newest line worth reading.
 * The stamp sits where a chat app puts a chat's time — hard right of the name —
 * and the unread dot sits at the end of the line it refers to. Everything else —
 * model, provider, task ids, thread counts — is one level deeper, because a roster
 * that shows them all is a roster nobody can scan.
 *
 * The role is a chip *beside* the name rather than a line under it. A separate
 * line cost a row of height for one word and made the role read like a fourth
 * kind of message; a chip labels the bot and leaves the second line to the only
 * thing that changes.
 *
 * Two lines and no rule between rows: whitespace separates bots. A hairline under
 * every row is what turns a list of faces into a table, and it cost the vertical
 * space that the rows themselves needed.
 *
 * The face is its own target when there is somewhere for it to go ([onOpen]):
 * tapping a bot's picture opens the bot, tapping the row opens the conversation.
 * That is what the trailing chevron used to do, at the price of a second glyph on
 * every row of a list that is meant to read as faces and names.
 *
 * @param activity the newest line worth showing: what it is doing now, or what it
 *   last said. Empty when there is nothing true to say, in which case the row is
 *   one line rather than two with a blank one.
 */
@Composable
internal fun BotRow(
    name: String,
    role: String,
    activity: String,
    stamp: String,
    accent: Color,
    unread: Boolean,
    working: Boolean,
    waiting: Boolean,
    avatar: @Composable () -> Unit,
    onClick: () -> Unit,
    onLongClick: () -> Unit = {},
    onOpen: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val colors = AppTheme.colors
    // One signal per row, drawn on the face rather than written on the row: a bot
    // that is working is a colour that breathes, and one that is waiting on you is
    // the colour of the thing it is waiting for (§4.1). Idle draws nothing — a dot
    // on every row is a dashboard, not a list.
    val signal = when {
        working -> colors.accent to true
        waiting -> colors.caution to false
        else -> null
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .semantics {
                // The dot is the only thing that says "unread" in the layout, so
                // it is said again in words rather than left to colour alone.
                if (unread) stateDescription = "Unread"
            }
            // 19 dp above and below the face, against the reference's own pitch:
            // its rows measure about 0.24 of the screen width apart, of which the
            // face is 0.12. Rows this airy are what let the eye land on one bot
            // without a rule under it to say where the last one ended.
            .padding(start = AppSpacing.gutter, end = AppSpacing.gutter, top = 19.dp, bottom = 19.dp),
        // 20 + 40 + 16 = the 76 dp the design puts the name at, measured off its
        // own rows: text starts at 0.198 of the screen width there.
        horizontalArrangement = Arrangement.spacedBy(AppSpacing.lg),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AvatarBadge(
            signal = signal?.first,
            pulsing = signal?.second == true,
            onOpen = onOpen,
            contentDescription = if (onOpen != null) "Open $name" else null,
        ) {
            avatar()
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // The name may use what is left over once the chip and the stamp
                // have their intrinsic widths; a long one ellipsizes instead of
                // pushing the time off the row.
                Row(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = name,
                        style = MaterialTheme.typography.titleMedium,
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (role.isNotEmpty()) {
                        RoleChip(role)
                    }
                }
                if (stamp.isNotEmpty()) {
                    Text(
                        text = stamp,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textTertiary,
                        maxLines = 1,
                    )
                }
            }

            if (activity.isNotEmpty() || unread) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(AppSpacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = activity,
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (unread) {
                        // In the bot's own colour, the same one its face is drawn
                        // in: the dot is the row saying "this one", not the app
                        // saying "a notification".
                        AppStatusDot(color = accent, size = 10.dp)
                    }
                }
            }
        }
    }
}

/**
 * A bot's face, with what it is doing drawn on it.
 *
 * The state rides the avatar instead of the row: the row's two lines are already
 * spent on the name and the last thing it said, and a row of coloured words is a
 * dashboard rather than a list. A dot at the lower-left is the same thing a chat
 * app puts on a person's picture, so it reads with no legend.
 *
 * [signal] is null for a bot that is idle, which is the common case; only work in
 * flight and work waiting on a person are worth drawing.
 */
@Composable
private fun AvatarBadge(
    signal: Color?,
    pulsing: Boolean,
    onOpen: (() -> Unit)?,
    contentDescription: String?,
    content: @Composable () -> Unit,
) {
    Box {
        // The face alone is clipped and clickable; the dot sits outside that box,
        // because a dot drawn inside a circle gets its corner cut off.
        Box(
            modifier = if (onOpen == null) {
                Modifier
            } else {
                Modifier
                    .clip(CircleShape)
                    .clickable(role = Role.Button, onClick = onOpen)
                    .then(
                        if (contentDescription == null) {
                            Modifier
                        } else {
                            Modifier.semantics { this.contentDescription = contentDescription }
                        },
                    )
            },
        ) {
            content()
        }
        if (signal != null) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .offset(x = (-2).dp, y = 2.dp)
                    .size(AppSizes.dot + 6.dp)
                    .background(AppTheme.colors.background, CircleShape)
                    .padding(3.dp),
            ) {
                AppStatusDot(color = signal, size = AppSizes.dot, pulsing = pulsing)
            }
        }
    }
}

/**
 * The app's own mark, in a soft circle: the identity tile the roster's header
 * carries.
 *
 * It replaced a green disc holding the paired computer's first letter, which read
 * as "you" on one phone and as a stray initial on the next — and which said the
 * computer's name was the app. The mark is the one thing on a screen of bots that
 * is the same everywhere, which is what a header is for.
 */
@Composable
internal fun AppMark(
    modifier: Modifier = Modifier,
    size: Dp = 34.dp,
    glyph: Dp = 22.dp,
) {
    Box(
        modifier = modifier.size(size),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_maus_mark),
            contentDescription = null,
            tint = AppTheme.colors.brand,
            modifier = Modifier.size(glyph),
        )
    }
}

/** A small label that says what kind of thing something is: a provider, a connector. */
@Composable
internal fun QuietTag(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = AppTheme.colors.textTertiary,
        modifier = modifier
            .clip(CircleShape)
            .background(AppTheme.colors.surfaceRaised)
            .padding(horizontal = AppSpacing.sm, vertical = 3.dp),
    )
}

/** A bot's role, in the small rounded form the roster and profile both use. */
@Composable
internal fun RoleChip(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Medium,
        color = AppTheme.colors.textSecondary,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(AppTheme.colors.surfaceRaised)
            .padding(horizontal = 7.dp, vertical = 2.dp),
    )
}
