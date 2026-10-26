package com.openmausbot.companion.reach

import org.json.JSONObject
import java.util.UUID

enum class ReachEventType {
    CALL_REMINDER,
    ALARM;

    companion object {
        fun fromString(value: String): ReachEventType = when (value.trim().lowercase()) {
            "call_reminder", "call", "reminder" -> CALL_REMINDER
            "alarm", "wake_up" -> ALARM
            else -> CALL_REMINDER
        }
    }
}

enum class ReachEventState {
    SCHEDULED,
    RINGING,
    ANSWERED,
    SNOOZED,
    DISMISSED,
    COMPLETED,
    CANCELLED,
    MISSED;

    companion object {
        fun fromString(value: String): ReachEventState = try {
            valueOf(value.trim().uppercase())
        } catch (_: Exception) {
            SCHEDULED
        }
    }
}

data class ReachEvent(
    val id: String = UUID.randomUUID().toString(),
    val type: ReachEventType,
    val title: String,
    val message: String = "",
    val triggerTimeMs: Long,
    val timezone: String = java.util.TimeZone.getDefault().id,
    val recurrence: String? = null,
    val createdAtMs: Long = System.currentTimeMillis(),
    val updatedAtMs: Long = System.currentTimeMillis(),
    val state: ReachEventState = ReachEventState.SCHEDULED,
    val snoozeMinutes: Int = 10,
    val snoozeCount: Int = 0,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("type", type.name.lowercase())
        put("title", title)
        put("message", message)
        put("triggerTimeMs", triggerTimeMs)
        put("timezone", timezone)
        if (recurrence != null) put("recurrence", recurrence)
        put("createdAtMs", createdAtMs)
        put("updatedAtMs", updatedAtMs)
        put("state", state.name.lowercase())
        put("snoozeMinutes", snoozeMinutes)
        put("snoozeCount", snoozeCount)
    }

    companion object {
        fun fromJson(json: JSONObject): ReachEvent {
            return ReachEvent(
                id = json.optString("id", UUID.randomUUID().toString()),
                type = ReachEventType.fromString(json.optString("type", "call_reminder")),
                title = json.optString("title", "MOBOT Reminder"),
                message = json.optString("message", ""),
                triggerTimeMs = json.optLong("triggerTimeMs", System.currentTimeMillis()),
                timezone = json.optString("timezone", java.util.TimeZone.getDefault().id),
                recurrence = if (json.has("recurrence") && !json.isNull("recurrence")) json.getString("recurrence") else null,
                createdAtMs = json.optLong("createdAtMs", System.currentTimeMillis()),
                updatedAtMs = json.optLong("updatedAtMs", System.currentTimeMillis()),
                state = ReachEventState.fromString(json.optString("state", "scheduled")),
                snoozeMinutes = json.optInt("snoozeMinutes", 10),
                snoozeCount = json.optInt("snoozeCount", 0),
            )
        }
    }
}
