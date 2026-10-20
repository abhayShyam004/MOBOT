package com.openmausbot.companion.storage

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Authoritative persistent state machine for MOBOT's first-run onboarding.
 *
 * Guarantees that interrupted onboarding resumes exactly where the user left off,
 * preserving draft inputs (name, email, bot preferences) and preventing duplicate
 * authentication, duplicate bot creation, or premature completion claims.
 */
enum class OnboardingStep(val rank: Int) {
    NOT_STARTED(0),
    IDENTITY_IN_PROGRESS(1),
    IDENTITY_COMPLETE(2),
    AI_SETUP_IN_PROGRESS(3),
    AI_SETUP_COMPLETE(4),
    PERMISSIONS_IN_PROGRESS(5),
    PERMISSIONS_COMPLETE(6),
    SERVICES_IN_PROGRESS(7),
    SERVICES_COMPLETE(8),
    BOT_CREATION_IN_PROGRESS(9),
    BOT_CREATION_COMPLETE(10),
    COMPLETED(11);

    companion object {
        fun fromString(value: String?): OnboardingStep {
            if (value.isNullOrBlank()) return NOT_STARTED
            return try {
                valueOf(value)
            } catch (_: IllegalArgumentException) {
                NOT_STARTED
            }
        }
    }
}

data class OnboardingDraft(
    val step: OnboardingStep,
    val name: String,
    val email: String,
    val providerId: String,
    val modelId: String,
    val botName: String,
    val botRole: String,
    val botColor: String,
    val botMascot: String = "cursor",
    val completedAt: Long?,
)

class OnboardingStateStore(
    private val prefs: SharedPreferences,
) {
    companion object {
        const val PREFS_NAME = "mobot_onboarding_state"
        private const val KEY_STEP = "onboarding_step"
        private const val KEY_NAME = "draft_name"
        private const val KEY_EMAIL = "draft_email"
        private const val KEY_PROVIDER_ID = "selected_provider_id"
        private const val KEY_MODEL_ID = "selected_model_id"
        private const val KEY_BOT_NAME = "draft_bot_name"
        private const val KEY_BOT_ROLE = "draft_bot_role"
        private const val KEY_BOT_COLOR = "draft_bot_color"
        private const val KEY_BOT_MASCOT = "draft_bot_mascot"
        private const val KEY_COMPLETED_AT = "completed_at"
    }

    constructor(context: Context) : this(
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE),
    )

    private val _draft = MutableStateFlow(readCurrentDraft())
    val draft: StateFlow<OnboardingDraft> = _draft.asStateFlow()

    val currentStep: OnboardingStep
        get() = _draft.value.step

    val isCompleted: Boolean
        get() = currentStep == OnboardingStep.COMPLETED

    private fun readCurrentDraft(): OnboardingDraft {
        val rawStep = prefs.getString(KEY_STEP, null)
        val step = OnboardingStep.fromString(rawStep)
        return OnboardingDraft(
            step = step,
            name = prefs.getString(KEY_NAME, "") ?: "",
            email = prefs.getString(KEY_EMAIL, "") ?: "",
            providerId = prefs.getString(KEY_PROVIDER_ID, "") ?: "",
            modelId = prefs.getString(KEY_MODEL_ID, "") ?: "",
            botName = prefs.getString(KEY_BOT_NAME, "Togepi") ?: "Togepi",
            botRole = prefs.getString(KEY_BOT_ROLE, "") ?: "",
            botColor = prefs.getString(KEY_BOT_COLOR, "blue") ?: "blue",
            botMascot = prefs.getString(KEY_BOT_MASCOT, "cursor") ?: "cursor",
            completedAt = if (prefs.contains(KEY_COMPLETED_AT)) prefs.getLong(KEY_COMPLETED_AT, 0L) else null,
        )
    }

    fun updateStep(step: OnboardingStep) {
        prefs.edit().putString(KEY_STEP, step.name).commit()
        _draft.value = _draft.value.copy(step = step)
    }

    fun saveIdentity(name: String, email: String, complete: Boolean = (name.isNotBlank() && email.isNotBlank())) {
        val step = if (complete) OnboardingStep.IDENTITY_COMPLETE else OnboardingStep.IDENTITY_IN_PROGRESS
        prefs.edit()
            .putString(KEY_NAME, name)
            .putString(KEY_EMAIL, email)
            .putString(KEY_STEP, step.name)
            .commit()
        _draft.value = _draft.value.copy(
            name = name,
            email = email,
            step = step,
        )
    }

    fun saveAiProvider(providerId: String, modelId: String, complete: Boolean = providerId.isNotBlank()) {
        val step = if (complete) OnboardingStep.AI_SETUP_COMPLETE else OnboardingStep.AI_SETUP_IN_PROGRESS
        prefs.edit()
            .putString(KEY_PROVIDER_ID, providerId)
            .putString(KEY_MODEL_ID, modelId)
            .putString(KEY_STEP, step.name)
            .commit()
        _draft.value = _draft.value.copy(
            providerId = providerId,
            modelId = modelId,
            step = step,
        )
    }

    fun saveBotDraft(botName: String, botRole: String, botColor: String, botMascot: String = "cursor") {
        prefs.edit()
            .putString(KEY_BOT_NAME, botName)
            .putString(KEY_BOT_ROLE, botRole)
            .putString(KEY_BOT_COLOR, botColor)
            .putString(KEY_BOT_MASCOT, botMascot)
            .commit()
        _draft.value = _draft.value.copy(
            botName = botName,
            botRole = botRole,
            botColor = botColor,
            botMascot = botMascot,
        )
    }

    fun markCompleted() {
        val now = System.currentTimeMillis()
        prefs.edit()
            .putString(KEY_STEP, OnboardingStep.COMPLETED.name)
            .putLong(KEY_COMPLETED_AT, now)
            .commit()
        _draft.value = _draft.value.copy(
            step = OnboardingStep.COMPLETED,
            completedAt = now,
        )
    }

    fun reset() {
        prefs.edit().clear().commit()
        _draft.value = readCurrentDraft()
    }
}
