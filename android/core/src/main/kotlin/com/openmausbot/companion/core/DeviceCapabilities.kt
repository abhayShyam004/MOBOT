package com.openmausbot.companion.core

import kotlinx.serialization.Serializable

/**
 * Risk classification for device capabilities (Phase P & Q).
 */
@Serializable
enum class RiskTier {
    LOW,
    MEDIUM,
    HIGH;

    val label: String
        get() = when (this) {
            LOW -> "Low Risk"
            MEDIUM -> "Medium Risk"
            HIGH -> "High Risk"
        }
}

/**
 * Lifecycle behavior of device capability actions.
 */
@Serializable
enum class LifecycleBehavior {
    STATELESS,
    TRANSIENT,
    PERSISTENT;
}

@Serializable
data class OperationMetadata(
    val name: String,
    val description: String,
    val risk: String,
)

@Serializable
data class CapabilityAvailability(
    val supported: Boolean,
    val reason: String? = null,
)

@Serializable
data class DeviceCapabilityItem(
    val id: String,
    val name: String,
    val description: String,
    val availability: CapabilityAvailability,
    val requiredPermissions: List<String> = emptyList(),
    val riskClassification: String = "low",
    val lifecycleBehavior: String = "stateless",
    val supportedOperations: List<OperationMetadata> = emptyList(),
)

@Serializable
data class DeviceCapabilitiesListResponse(
    val capabilities: List<DeviceCapabilityItem> = emptyList(),
)

@Serializable
data class DeviceCapabilityError(
    val code: String,
    val message: String,
    val category: String,
)

@Serializable
data class DeviceCapabilityInvokeResult(
    val success: Boolean,
    val error: DeviceCapabilityError? = null,
)
