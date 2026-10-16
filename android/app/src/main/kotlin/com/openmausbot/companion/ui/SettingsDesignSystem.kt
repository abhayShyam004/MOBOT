package com.openmausbot.companion.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Reusable Settings Sub-Page Scaffold.
 *
 * Provides the unified visual foundation for all Settings sub-screens:
 * - Pinned back navigation bar
 * - Bold editorial headline & optional subtitle
 * - Standardized margins (20.dp), background color, and vertical rhythm (22.dp)
 * - Supports scrollable content or unconstrained content (for LazyColumn)
 */
@Composable
fun SettingsSubPage(
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    scrollable: Boolean = true,
    topAction: @Composable (() -> Unit)? = null,
    headerExtra: @Composable (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(AppTheme.colors.background),
    ) {
        // Pinned Top Navigation Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            IconButton(
                onClick = onBack,
                modifier = Modifier.size(42.dp),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = AppTheme.colors.textPrimary,
                    modifier = Modifier.size(22.dp),
                )
            }
            if (topAction != null) {
                topAction()
            }
        }

        if (scrollable) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 56.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                SettingsSubPageHeader(
                    title = title,
                    subtitle = subtitle,
                    extra = headerExtra,
                )
                content()
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                SettingsSubPageHeader(
                    title = title,
                    subtitle = subtitle,
                    extra = headerExtra,
                )
                content()
            }
        }
    }
}

@Composable
private fun SettingsSubPageHeader(
    title: String,
    subtitle: String?,
    extra: @Composable (() -> Unit)?,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 22.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(end = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = title,
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
                color = AppTheme.colors.textPrimary,
                letterSpacing = (-0.5).sp,
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Normal,
                    color = AppTheme.colors.textSecondary,
                )
            }
        }
        if (extra != null) {
            extra()
        }
    }
}

/**
 * Grouped rounded container matching the Settings landing page.
 *
 * - 22.dp corner radius
 * - Subtle border with 0.5f alpha
 * - Surface background
 * - Consistent title header
 */
@Composable
fun SettingsSection(
    title: String? = null,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (title != null) {
            Text(
                text = title,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textSecondary,
                modifier = Modifier.padding(horizontal = 24.dp),
            )
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(AppTheme.colors.surface)
                .border(
                    width = 1.dp,
                    color = AppTheme.colors.border.copy(alpha = 0.5f),
                    shape = RoundedCornerShape(22.dp),
                ),
        ) {
            content()
        }
    }
}

/**
 * Standard settings row supporting:
 * - Leading icon or avatar badge
 * - Title and subtitle
 * - Trailing value text
 * - Navigation chevron
 * - Switch toggle
 * - Checkmark selection indicator
 * - Destructive or disabled state
 * - Busy spinner
 */
@Composable
fun SettingsRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    leadingIcon: @Composable (() -> Unit)? = null,
    trailingValue: String? = null,
    showChevron: Boolean = false,
    checked: Boolean? = null,
    onCheckedChange: ((Boolean) -> Unit)? = null,
    selected: Boolean? = null,
    destructive: Boolean = false,
    enabled: Boolean = true,
    busy: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val clickableModifier = if (onClick != null && enabled && checked == null) {
        Modifier.clickable(role = Role.Button, onClick = onClick)
    } else {
        Modifier
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .then(clickableModifier)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leadingIcon != null) {
            leadingIcon()
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = title,
                fontSize = 15.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = when {
                    destructive -> MaterialTheme.colorScheme.error
                    !enabled -> AppTheme.colors.textTertiary
                    else -> AppTheme.colors.textPrimary
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    fontSize = 13.sp,
                    color = AppTheme.colors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        if (trailingValue != null) {
            Text(
                text = trailingValue,
                fontSize = 14.sp,
                fontWeight = FontWeight.Normal,
                color = AppTheme.colors.textTertiary,
            )
        }

        when {
            busy -> {
                CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp,
                    color = AppTheme.colors.textTertiary,
                )
            }
            checked != null -> {
                Switch(
                    checked = checked,
                    onCheckedChange = onCheckedChange,
                    enabled = enabled,
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Color.White,
                        checkedTrackColor = Color(0xFF1E88E5),
                        uncheckedThumbColor = AppTheme.colors.textSecondary,
                        uncheckedTrackColor = AppTheme.colors.surfaceRaised,
                    ),
                )
            }
            selected == true -> {
                Icon(
                    imageVector = Icons.Default.Check,
                    contentDescription = "Selected",
                    tint = Color(0xFF1E88E5),
                    modifier = Modifier.size(20.dp),
                )
            }
            showChevron -> {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = AppTheme.colors.textTertiary.copy(alpha = 0.7f),
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}

/**
 * Clean indented row divider matching Settings specifications.
 */
@Composable
fun SettingsDivider(indent: Dp = 68.dp) {
    HorizontalDivider(
        modifier = Modifier.padding(start = indent, end = 16.dp),
        thickness = 0.5.dp,
        color = AppTheme.colors.divider.copy(alpha = 0.6f),
    )
}

/**
 * Segmented selection row (e.g., Light / System / Dark, permission modes, etc.)
 */
@Composable
fun SettingsChoiceRow(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (label != null) {
            Text(
                text = label,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textSecondary,
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(AppTheme.colors.surfaceRaised)
                .padding(3.dp),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            options.forEachIndexed { index, option ->
                val selected = index == selectedIndex
                Text(
                    text = option,
                    fontSize = 14.sp,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (selected) AppTheme.colors.textPrimary else AppTheme.colors.textSecondary,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(11.dp))
                        .background(if (selected) AppTheme.colors.surface else Color.Transparent)
                        .selectable(
                            selected = selected,
                            role = Role.RadioButton,
                            onClick = { onSelect(index) },
                        )
                        .padding(vertical = 10.dp),
                )
            }
        }
    }
}

/**
 * Card surface for standalone settings content, statistics, or custom forms.
 */
@Composable
fun SettingsCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    subtitle: String? = null,
    content: @Composable (ColumnScope.() -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(AppTheme.colors.surface)
            .border(
                width = 1.dp,
                color = AppTheme.colors.border.copy(alpha = 0.5f),
                shape = RoundedCornerShape(22.dp),
            )
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (title != null) {
            Text(
                text = title,
                fontSize = 15.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textPrimary,
            )
        }
        if (subtitle != null) {
            Text(
                text = subtitle,
                fontSize = 13.sp,
                color = AppTheme.colors.textSecondary,
            )
        }
        content?.invoke(this)
    }
}

/**
 * Clean search field styled to fit seamlessly within Settings sub-pages.
 */
@Composable
fun SettingsSearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Search...",
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(AppTheme.colors.surface)
            .border(
                width = 1.dp,
                color = AppTheme.colors.border.copy(alpha = 0.5f),
                shape = RoundedCornerShape(16.dp),
            )
            .padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            imageVector = Icons.Default.Search,
            contentDescription = "Search",
            tint = AppTheme.colors.textTertiary,
            modifier = Modifier.size(20.dp),
        )
        Box(modifier = Modifier.weight(1f)) {
            if (query.isEmpty()) {
                Text(
                    text = placeholder,
                    color = AppTheme.colors.textTertiary,
                    fontSize = 14.5.sp,
                )
            }
            BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                singleLine = true,
                textStyle = TextStyle(
                    color = AppTheme.colors.textPrimary,
                    fontSize = 14.5.sp,
                ),
                cursorBrush = SolidColor(AppTheme.colors.textPrimary),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (query.isNotEmpty()) {
            IconButton(
                onClick = { onQueryChange("") },
                modifier = Modifier.size(20.dp),
            ) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "Clear",
                    tint = AppTheme.colors.textTertiary,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}

/**
 * Stylized circular initial/monogram icon badge for services or models.
 */
@Composable
fun SettingsServiceBadge(
    label: String,
    modifier: Modifier = Modifier,
    size: Dp = 38.dp,
    backgroundColor: Color = AppTheme.colors.surfaceRaised,
    textColor: Color = AppTheme.colors.textPrimary,
) {
    val initial = label.trim().take(1).uppercase().ifEmpty { "?" }
    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(12.dp))
            .background(backgroundColor),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = initial,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = textColor,
        )
    }
}
