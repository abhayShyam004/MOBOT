package com.openmausbot.companion.core

import kotlinx.serialization.Serializable

@Serializable
data class CapabilityConfig(
    val id: String,
    val enabled: Boolean = false,
    val provider: String = "openai",
    val model: String = "",
    val apiKey: String? = null,
    val hasApiKey: Boolean? = null,
    val baseUrl: String? = null,
)

@Serializable
data class CapabilitiesResponse(
    val capabilities: List<CapabilityConfig> = emptyList(),
)
