package com.openmausbot.companion.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CapabilityGuidanceTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `common capabilities catalog is correctly structured and typed`() {
        val maps = CommonCapabilities.GOOGLE_MAPS
        assertEquals("google_maps", maps.id)
        assertEquals(CapabilityKind.CONNECTED_SERVICE, maps.kind)
        assertEquals("Google Maps", maps.title)
        assertEquals("Connect Google Maps", maps.actionLabel)
        assertEquals(CapabilityState.DISCONNECTED, maps.state)
        assertFalse(maps.isConfigured)

        val gmail = CommonCapabilities.GMAIL
        assertEquals("gmail", gmail.id)
        assertEquals(CapabilityKind.CONNECTED_SERVICE, gmail.kind)

        val terminal = CommonCapabilities.TERMINAL
        assertEquals("terminal", terminal.id)
        assertEquals(CapabilityKind.AGENT_PERMISSION, terminal.kind)

        val notifications = CommonCapabilities.NOTIFICATIONS
        assertEquals("notifications", notifications.id)
        assertEquals(CapabilityKind.SYSTEM_PERMISSION, notifications.kind)
    }

    @Test
    fun `capability guidance card renders unconfigured state with action button`() {
        var actionFired = false
        val item = CommonCapabilities.GOOGLE_MAPS.copy(
            isConfigured = false,
            state = CapabilityState.DISCONNECTED,
        )

        compose.setContent {
            CompanionTheme {
                CapabilityGuidanceCard(
                    prerequisite = item,
                    onAction = { actionFired = true },
                )
            }
        }

        // Title and status pill
        compose.onNodeWithText("Google Maps", substring = false).assertIsDisplayed()
        compose.onNodeWithText("Not connected").assertIsDisplayed()
        compose.onNodeWithText("Connect Google Maps").assertIsDisplayed()

        compose.onNodeWithText("Connect Google Maps").performClick()
        assertTrue(actionFired, "Clicking action button must invoke onAction callback")
    }

    @Test
    fun `capability guidance card renders connected state with badge`() {
        val item = CommonCapabilities.GOOGLE_MAPS.copy(
            isConfigured = true,
            state = CapabilityState.CONNECTED,
        )

        compose.setContent {
            CompanionTheme {
                CapabilityGuidanceCard(
                    prerequisite = item,
                    onAction = {},
                )
            }
        }

        compose.onNodeWithText("Google Maps", substring = false).assertIsDisplayed()
        compose.onNodeWithText("Connected").assertIsDisplayed()
    }

    @Test
    fun `capability guidance card renders granted badge for permissions`() {
        val item = CommonCapabilities.TERMINAL.copy(
            isConfigured = true,
            state = CapabilityState.CONNECTED,
        )

        compose.setContent {
            CompanionTheme {
                CapabilityGuidanceCard(
                    prerequisite = item,
                    onAction = {},
                )
            }
        }

        compose.onNodeWithText("Terminal Execution", substring = false).assertIsDisplayed()
        compose.onNodeWithText("Connected").assertIsDisplayed()
    }
}
