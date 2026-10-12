package com.openmausbot.companion.ui

import androidx.compose.ui.graphics.Color
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Phase D (Localhost App Preview): Presentation rules test.
 *
 * Verifies that status badges, labels, and action capabilities accurately reflect
 * development server lifecycle states without misleading the user or locking up.
 */
class AppPreviewPresentationTest {

    @Test
    fun `badge colors distinguish live, starting, crashed, and stopped states`() {
        assertEquals(Color(0xFF10B981), AppPreviewRules.badgeColor("running"))
        assertEquals(Color(0xFF10B981), AppPreviewRules.badgeColor("live"))
        assertEquals(Color(0xFFF59E0B), AppPreviewRules.badgeColor("starting"))
        assertEquals(Color(0xFFF59E0B), AppPreviewRules.badgeColor("building"))
        assertEquals(Color(0xFFEF4444), AppPreviewRules.badgeColor("crashed"))
        assertEquals(Color(0xFFEF4444), AppPreviewRules.badgeColor("failed"))
        assertEquals(Color(0xFFEF4444), AppPreviewRules.badgeColor("error"))
        assertEquals(Color(0xFF6B7280), AppPreviewRules.badgeColor("stopped"))
        assertEquals(Color(0xFF6B7280), AppPreviewRules.badgeColor("unknown"))
    }

    @Test
    fun `status labels format canonical names cleanly`() {
        assertEquals("Live", AppPreviewRules.statusLabel("running"))
        assertEquals("Live", AppPreviewRules.statusLabel("live"))
        assertEquals("Starting", AppPreviewRules.statusLabel("starting"))
        assertEquals("Crashed", AppPreviewRules.statusLabel("crashed"))
        assertEquals("Stopped", AppPreviewRules.statusLabel("stopped"))
        assertEquals("Building", AppPreviewRules.statusLabel("building"))
        assertEquals("Custom", AppPreviewRules.statusLabel("custom"))
    }

    @Test
    fun `reload is allowed only when server is actively running`() {
        assertTrue(AppPreviewRules.canReload("running"))
        assertTrue(AppPreviewRules.canReload("live"))
        assertFalse(AppPreviewRules.canReload("starting"))
        assertFalse(AppPreviewRules.canReload("crashed"))
        assertFalse(AppPreviewRules.canReload("stopped"))
    }

    @Test
    fun `restart is available in all states to allow rapid recovery`() {
        assertTrue(AppPreviewRules.canRestart("running"))
        assertTrue(AppPreviewRules.canRestart("starting"))
        assertTrue(AppPreviewRules.canRestart("crashed"))
        assertTrue(AppPreviewRules.canRestart("stopped"))
    }

    @Test
    fun `stop is allowed when server is running or starting but not when already stopped or crashed`() {
        assertTrue(AppPreviewRules.canStop("running"))
        assertTrue(AppPreviewRules.canStop("live"))
        assertTrue(AppPreviewRules.canStop("starting"))
        assertFalse(AppPreviewRules.canStop("stopped"))
        assertFalse(AppPreviewRules.canStop("crashed"))
    }

    @Test
    fun `presentation state holds project identifiers and honest runtime details`() {
        val state = AppPreviewPresentationState(
            projectId = "proj-123",
            projectName = "Dashboard",
            status = "crashed",
            port = 3001,
            url = "http://127.0.0.1:3001",
            errorMessage = "Port 3001 terminated with code 1",
            logs = "Error: Cannot find module './routes'\n",
        )
        assertEquals("proj-123", state.projectId)
        assertEquals("Dashboard", state.projectName)
        assertEquals("crashed", state.status)
        assertEquals(3001, state.port)
        assertEquals("http://127.0.0.1:3001", state.url)
        assertEquals("Port 3001 terminated with code 1", state.errorMessage)
    }
}
