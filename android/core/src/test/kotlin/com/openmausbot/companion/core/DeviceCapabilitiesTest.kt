package com.openmausbot.companion.core

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DeviceCapabilitiesTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `risk tier labels match safety categories`() {
        assertEquals("Low Risk", RiskTier.LOW.label)
        assertEquals("Medium Risk", RiskTier.MEDIUM.label)
        assertEquals("High Risk", RiskTier.HIGH.label)
    }

    @Test
    fun `deserializes device capabilities list response correctly`() {
        val payload = """
            {
              "capabilities": [
                {
                  "id": "device.files",
                  "name": "Files & Storage",
                  "description": "Access files",
                  "availability": { "supported": true },
                  "requiredPermissions": ["android.permission.READ_EXTERNAL_STORAGE"],
                  "riskClassification": "medium",
                  "lifecycleBehavior": "stateless",
                  "supportedOperations": [
                    { "name": "list", "description": "List files", "risk": "low" },
                    { "name": "delete", "description": "Delete file", "risk": "high" }
                  ]
                },
                {
                  "id": "device.camera",
                  "name": "Camera",
                  "description": "Capture photos",
                  "availability": { "supported": true },
                  "requiredPermissions": ["android.permission.CAMERA"],
                  "riskClassification": "medium",
                  "lifecycleBehavior": "transient",
                  "supportedOperations": [
                    { "name": "capture_photo", "description": "Take photo", "risk": "medium" }
                  ]
                }
              ]
            }
        """.trimIndent()

        val parsed = json.decodeFromString<DeviceCapabilitiesListResponse>(payload)
        assertEquals(2, parsed.capabilities.size)

        val files = parsed.capabilities.first { it.id == "device.files" }
        assertEquals("Files & Storage", files.name)
        assertTrue(files.availability.supported)
        assertEquals(1, files.requiredPermissions.size)
        assertEquals("android.permission.READ_EXTERNAL_STORAGE", files.requiredPermissions.first())
        assertEquals(2, files.supportedOperations.size)
        assertEquals("delete", files.supportedOperations[1].name)
        assertEquals("high", files.supportedOperations[1].risk)
    }
}
