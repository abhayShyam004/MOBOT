package com.openmausbot.companion.ui

import androidx.compose.ui.graphics.Color
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Phase H (Project Management): Presentation rules test.
 *
 * Verifies that project states, capabilities, git badges, and action permissions
 * accurately represent physical on-device application state without fake values.
 */
class ProjectsPresentationRulesTest {

    @Test
    fun `state badge colors distinguish live, previewing, building, failed, and draft`() {
        assertEquals(Color(0xFF10B981), ProjectsPresentationRules.stateBadgeColor("live"))
        assertEquals(Color(0xFF06B6D4), ProjectsPresentationRules.stateBadgeColor("previewing"))
        assertEquals(Color(0xFF06B6D4), ProjectsPresentationRules.stateBadgeColor("ready"))
        assertEquals(Color(0xFFF59E0B), ProjectsPresentationRules.stateBadgeColor("building"))
        assertEquals(Color(0xFFF59E0B), ProjectsPresentationRules.stateBadgeColor("deploying"))
        assertEquals(Color(0xFFEF4444), ProjectsPresentationRules.stateBadgeColor("failed"))
        assertEquals(Color(0xFFEF4444), ProjectsPresentationRules.stateBadgeColor("crashed"))
        assertEquals(Color(0xFF6B7280), ProjectsPresentationRules.stateBadgeColor("draft"))
    }

    @Test
    fun `state labels format titles cleanly`() {
        assertEquals("Live", ProjectsPresentationRules.stateLabel("live"))
        assertEquals("Previewing", ProjectsPresentationRules.stateLabel("previewing"))
        assertEquals("Ready", ProjectsPresentationRules.stateLabel("ready"))
        assertEquals("Building", ProjectsPresentationRules.stateLabel("building"))
        assertEquals("Deploying", ProjectsPresentationRules.stateLabel("deploying"))
        assertEquals("Failed", ProjectsPresentationRules.stateLabel("failed"))
        assertEquals("Draft", ProjectsPresentationRules.stateLabel("draft"))
    }

    @Test
    fun `preview capability is allowed unless process is in-flight starting`() {
        assertTrue(ProjectsPresentationRules.canPreview("ready", "stopped"))
        assertTrue(ProjectsPresentationRules.canPreview("live", "running"))
        assertFalse(ProjectsPresentationRules.canPreview("building", "building"))
        assertFalse(ProjectsPresentationRules.canPreview("deploying", "deploying"))
    }

    @Test
    fun `deploy is allowed from ready, previewing, live, and draft states`() {
        assertTrue(ProjectsPresentationRules.canDeploy("ready"))
        assertTrue(ProjectsPresentationRules.canDeploy("previewing"))
        assertTrue(ProjectsPresentationRules.canDeploy("live"))
        assertTrue(ProjectsPresentationRules.canDeploy("draft"))
        assertFalse(ProjectsPresentationRules.canDeploy("building"))
        assertFalse(ProjectsPresentationRules.canDeploy("failed"))
    }

    @Test
    fun `git formatting displays branch and short commit SHA`() {
        assertEquals("main (abcdef1)", ProjectsPresentationRules.formatGitInfo("main", "abcdef1234567890"))
        assertEquals("feat/login", ProjectsPresentationRules.formatGitInfo("feat/login", null))
        assertEquals("Git initialized", ProjectsPresentationRules.formatGitInfo(null, null))
    }

    @Test
    fun `cancel deployment is allowed only during active in-flight stages`() {
        assertTrue(ProjectsPresentationRules.canCancelDeployment("building"))
        assertTrue(ProjectsPresentationRules.canCancelDeployment("queued"))
        assertTrue(ProjectsPresentationRules.canCancelDeployment("pending"))
        assertFalse(ProjectsPresentationRules.canCancelDeployment("ready"))
        assertFalse(ProjectsPresentationRules.canCancelDeployment("error"))
        assertFalse(ProjectsPresentationRules.canCancelDeployment("none"))
    }

    @Test
    fun `redeploy is allowed for finished or failed deployments`() {
        assertTrue(ProjectsPresentationRules.canRedeploy("ready"))
        assertTrue(ProjectsPresentationRules.canRedeploy("error"))
        assertTrue(ProjectsPresentationRules.canRedeploy("failed"))
        assertTrue(ProjectsPresentationRules.canRedeploy("cancelled"))
        assertFalse(ProjectsPresentationRules.canRedeploy("building"))
        assertFalse(ProjectsPresentationRules.canRedeploy("queued"))
    }
}
