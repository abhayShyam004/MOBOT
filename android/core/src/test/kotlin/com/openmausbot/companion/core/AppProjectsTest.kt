package com.openmausbot.companion.core

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AppProjectsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `deserializes project list response correctly`() {
        val payload = """
            {
              "projects": [
                {
                  "id": "job-tracker-demo",
                  "name": "Job Application Tracker",
                  "description": "Autonomous job tracker built via MOBOT Phase C",
                  "framework": "html",
                  "language": "javascript",
                  "runtime": "node",
                  "state": "previewing",
                  "preview": {
                    "status": "running",
                    "port": 3001,
                    "url": "http://127.0.0.1:3001",
                    "pid": 4821
                  },
                  "deployment": {
                    "status": "live",
                    "provider": "vercel",
                    "url": "https://job-tracker-demo.vercel.app"
                  },
                  "git": {
                    "initialized": true,
                    "branch": "main",
                    "commitHash": "a1b2c3d4e5",
                    "clean": true
                  },
                  "env": [
                    { "key": "APP_TITLE", "isSecret": false },
                    { "key": "DATABASE_URL", "isSecret": true }
                  ],
                  "updatedAt": "2026-10-10T14:00:00Z"
                }
              ]
            }
        """.trimIndent()

        val parsed = json.decodeFromString<AppProjectListResponse>(payload)
        assertEquals(1, parsed.projects.size)

        val project = parsed.projects.first()
        assertEquals("job-tracker-demo", project.id)
        assertEquals("Job Application Tracker", project.name)
        assertEquals("html", project.framework)
        assertEquals("previewing", project.state)
        assertEquals("running", project.preview.status)
        assertEquals(3001, project.preview.port)
        assertEquals("http://127.0.0.1:3001", project.preview.url)
        assertEquals("live", project.deployment.status)
        assertEquals("https://job-tracker-demo.vercel.app", project.deployment.url)
        assertTrue(project.git.initialized)
        assertEquals("main", project.git.branch)
        assertEquals(2, project.env.size)
        assertFalse(project.env[0].isSecret)
        assertTrue(project.env[1].isSecret)
    }

    @Test
    fun `default values handle empty preview and deployment`() {
        val payload = """
            {
              "projects": [
                {
                  "id": "minimal-app",
                  "name": "Minimal App"
                }
              ]
            }
        """.trimIndent()

        val parsed = json.decodeFromString<AppProjectListResponse>(payload)
        val project = parsed.projects.first()
        assertEquals("minimal-app", project.id)
        assertEquals("stopped", project.preview.status)
        assertEquals("none", project.deployment.status)
        assertFalse(project.git.initialized)
        assertTrue(project.env.isEmpty())
    }

    @Test
    fun `deserializes deployment accounts and response correctly`() {
        val payload = """
            {
              "accounts": [
                {
                  "provider": "vercel",
                  "connected": true,
                  "username": "maususer",
                  "maskedToken": "ver_...3456",
                  "lastTestedAt": "2026-10-10T14:00:00Z"
                },
                {
                  "provider": "render",
                  "connected": false
                }
              ]
            }
        """.trimIndent()

        val parsed = json.decodeFromString<DeploymentAccountsResponse>(payload)
        assertEquals(2, parsed.accounts.size)
        assertTrue(parsed.accounts[0].connected)
        assertEquals("vercel", parsed.accounts[0].provider)
        assertEquals("ver_...3456", parsed.accounts[0].maskedToken)
        assertFalse(parsed.accounts[1].connected)

        val deployResPayload = """
            {
              "ok": true,
              "projectId": "job-tracker-demo",
              "deployment": {
                "status": "ready",
                "provider": "vercel",
                "url": "https://job-tracker-demo.vercel.app",
                "deploymentId": "dpl_123"
              }
            }
        """.trimIndent()
        val deployRes = json.decodeFromString<DeployProjectResponse>(deployResPayload)
        assertTrue(deployRes.ok)
        assertEquals("ready", deployRes.deployment?.status)
        assertEquals("https://job-tracker-demo.vercel.app", deployRes.deployment?.url)
    }
}
