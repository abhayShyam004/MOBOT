package com.openmausbot.companion.ui

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ApplicationProvider
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.Instance
import com.openmausbot.companion.core.ModelCatalog
import com.openmausbot.companion.core.ModelOption
import com.openmausbot.companion.core.ProviderSnapshot
import com.openmausbot.companion.onboarding.OnboardingScene
import com.openmausbot.companion.storage.OnboardingStateStore
import com.openmausbot.companion.storage.OnboardingStep
import org.junit.Rule
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FirstRunOnboardingTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `onboarding beats are ordered sequentially from welcome to ready`() {
        val beats = OnboardingBeat.entries.toTypedArray()
        assertEquals(OnboardingBeat.WELCOME, beats[0])
        assertEquals(OnboardingBeat.NAME, beats[1])
        assertEquals(OnboardingBeat.EMAIL, beats[2])
        assertEquals(OnboardingBeat.AI_PROVIDER, beats[3])
        assertEquals(OnboardingBeat.PERMISSIONS, beats[4])
        assertEquals(OnboardingBeat.SERVICES, beats[5])
        assertEquals(OnboardingBeat.FIRST_BOT, beats[6])
        assertEquals(OnboardingBeat.READY, beats[7])
        assertEquals(8, beats.size)
    }

    @Test
    fun `first run onboarding guides user through the complete beat journey to first chat`() {
        val scene = OnboardingScene()
        var finishedBot: Bot? = null

        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme {
                    FirstRunOnboardingScreen(
                        onFinish = { bot -> finishedBot = bot },
                    )
                }
            }
        }
        compose.waitForIdle()

        // 1. WELCOME BEAT
        compose.onNodeWithText(OnboardingCopy.WELCOME_TITLE).assertIsDisplayed()
        compose.onNodeWithText("Get Started").performClick()
        compose.waitForIdle()

        // 2. NAME BEAT
        compose.onNodeWithText("What should MOBOT call you?").assertIsDisplayed()
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).performTextInput("Antigravity")
        compose.waitForIdle()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()

        // 3. EMAIL BEAT
        compose.onNodeWithText("Your email address").assertIsDisplayed()
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).performTextInput("agent@mobot.ai")
        compose.waitForIdle()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()

        // 4. AI PROVIDER BEAT
        compose.onNodeWithText("Connect AI Provider").assertIsDisplayed()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()

        // 5. PERMISSIONS BEAT
        compose.onNodeWithText("Agent Capabilities").assertIsDisplayed()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()

        // 6. SERVICES BEAT
        compose.onNodeWithText("Useful Services").assertIsDisplayed()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()

        // 7. FIRST BOT BEAT
        compose.onNodeWithText("Your First Agent").assertIsDisplayed()
        compose.onNodeWithText("Create Agent & Continue").performClick()
        compose.waitForIdle()

        // 8. READY BEAT
        compose.onNodeWithText("You're all set!").assertIsDisplayed()
        compose.onNodeWithText("Start First Chat").performClick()
        compose.waitForIdle()

        // Confirms onFinish was called with a created bot
        assertNotNull(finishedBot)
        assertEquals("Togepi", finishedBot?.name)
    }

    @Test
    fun `welcome beat contains only get started and does not present computer pairing or skip`() {
        val scene = OnboardingScene()

        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme {
                    FirstRunOnboardingScreen(onFinish = {})
                }
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText("Get Started").assertIsDisplayed()
        compose.onNodeWithText("Pair with a computer").assertDoesNotExist()
        compose.onNodeWithText(OnboardingCopy.NOT_NOW).assertDoesNotExist()
    }

    @Test
    fun `name and email fields require non-empty valid input before continue is enabled`() {
        val scene = OnboardingScene()

        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme {
                    FirstRunOnboardingScreen(onFinish = {})
                }
            }
        }
        compose.waitForIdle()

        // Welcome -> Name
        compose.onNodeWithText("Get Started").performClick()
        compose.waitForIdle()

        // Name input initially empty -> continue disabled
        compose.onNodeWithText("Continue").assertIsNotEnabled()

        // Fill valid name
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).performTextInput("Ada")
        compose.waitForIdle()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()

        // Email input initially empty -> continue disabled
        compose.onNodeWithText("Your email address").assertIsDisplayed()
        compose.onNodeWithText("Continue").assertIsNotEnabled()

        // Invalid email format without @ -> continue disabled
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).performTextInput("not-an-email")
        compose.waitForIdle()
        compose.onNodeWithText("Continue").assertIsNotEnabled()

        // Valid email -> continue enabled and clickable
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).performTextReplacement("ada@lovelace.org")
        compose.waitForIdle()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()

        compose.onNodeWithText("Connect AI Provider").assertIsDisplayed()
    }

    @Test
    fun `ai provider beat disables continue if selected provider is not available`() {
        val unavailableInstances = listOf(
            Instance(
                instanceId = "openai",
                driverKind = "openai",
                snapshot = ProviderSnapshot(state = "unconfigured"),
                models = ModelCatalog(
                    defaultModel = "gpt-4o",
                    options = listOf(ModelOption(id = "gpt-4o", label = "GPT-4o")),
                ),
            )
        )
        val scene = OnboardingScene(instances = unavailableInstances)

        val context = ApplicationProvider.getApplicationContext<Context>()
        val stateStore = OnboardingStateStore(context)
        stateStore.reset()
        stateStore.saveIdentity(name = "Test", email = "test@example.com", complete = true)

        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme {
                    FirstRunOnboardingScreen(
                        onFinish = {},
                        stateStore = stateStore,
                    )
                }
            }
        }
        compose.waitForIdle()

        // AI Provider beat displayed with unconfigured provider
        compose.onNodeWithText("Connect AI Provider").assertIsDisplayed()
        compose.onNodeWithText("Continue").assertIsNotEnabled()
    }

    @Test
    fun `failed bot creation displays inline error and does not fabricate fallback bot`() {
        val scene = OnboardingScene(createBotOverride = null)

        val context = ApplicationProvider.getApplicationContext<Context>()
        val stateStore = OnboardingStateStore(context)
        stateStore.reset()
        stateStore.updateStep(OnboardingStep.SERVICES_COMPLETE)

        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme {
                    FirstRunOnboardingScreen(
                        onFinish = {},
                        stateStore = stateStore,
                    )
                }
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText("Your First Agent").assertIsDisplayed()
        compose.onNodeWithText("Create Agent & Continue").performClick()
        compose.waitForIdle()

        // Displays error message and retry button instead of proceeding
        compose.onNodeWithText("Could not initialize agent on this device. Please tap retry.").assertIsDisplayed()
        compose.onNodeWithText("Retry Agent Creation").assertIsDisplayed()
        // Must stay on first bot beat, never navigating to Ready
        compose.onNodeWithText("You're all set!").assertDoesNotExist()
    }

    @Test
    fun `back navigation returns to the previous onboarding beat`() {
        val scene = OnboardingScene()

        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme {
                    FirstRunOnboardingScreen(onFinish = {})
                }
            }
        }
        compose.waitForIdle()

        // Step 1 -> Step 2
        compose.onNodeWithText("Get Started").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("What should MOBOT call you?").assertIsDisplayed()

        // Tap top back button
        compose.onNodeWithContentDescription("Back").performClick()
        compose.waitForIdle()

        // Returns to Welcome
        compose.onNodeWithText(OnboardingCopy.WELCOME_TITLE).assertIsDisplayed()
    }

    @Test
    fun `interrupted onboarding resumes at email with draft name restored`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val stateStore = OnboardingStateStore(context)
        stateStore.reset()
        stateStore.saveIdentity(name = "Ada Lovelace", email = "", complete = false)

        val scene = OnboardingScene()

        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme {
                    FirstRunOnboardingScreen(
                        onFinish = {},
                        stateStore = stateStore,
                    )
                }
            }
        }
        compose.waitForIdle()

        // Resumes directly at email step!
        compose.onNodeWithText("Your email address").assertIsDisplayed()
        assertEquals("Ada Lovelace", stateStore.draft.value.name)
    }

    @Test
    fun `interrupted onboarding resumes at permissions when ai setup complete`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val stateStore = OnboardingStateStore(context)
        stateStore.reset()
        stateStore.saveIdentity(name = "Grace Hopper", email = "grace@navy.mil", complete = true)
        stateStore.saveAiProvider(providerId = "openai", modelId = "gpt-4o", complete = true)

        val scene = OnboardingScene()

        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme {
                    FirstRunOnboardingScreen(
                        onFinish = {},
                        stateStore = stateStore,
                    )
                }
            }
        }
        compose.waitForIdle()

        // Resumes directly at permissions step!
        compose.onNodeWithText("Agent Capabilities").assertIsDisplayed()
    }

    @Test
    fun `interrupted onboarding resumes at first bot when services complete`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val stateStore = OnboardingStateStore(context)
        stateStore.reset()
        stateStore.updateStep(OnboardingStep.SERVICES_COMPLETE)

        val scene = OnboardingScene()

        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme {
                    FirstRunOnboardingScreen(
                        onFinish = {},
                        stateStore = stateStore,
                    )
                }
            }
        }
        compose.waitForIdle()

        // Resumes directly at first bot step!
        compose.onNodeWithText("Your First Agent").assertIsDisplayed()
    }

    @Test
    fun `interrupted onboarding resumes at ready when bot creation complete`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val stateStore = OnboardingStateStore(context)
        stateStore.reset()
        stateStore.saveBotDraft(botName = "Navigator", botRole = "Research Partner", botColor = "purple")
        stateStore.updateStep(OnboardingStep.BOT_CREATION_COMPLETE)

        val testBot = Bot(
            id = "bot-nav",
            threadId = "thread-nav",
            name = "Navigator",
            title = "Research Partner",
            description = "Test bot",
            notifications = true,
            color = "purple",
            unread = false,
            modelSelection = com.openmausbot.companion.core.ModelSelection("anthropic", "claude-3-5-sonnet"),
            createdAt = System.currentTimeMillis().toDouble(),
        )
        val scene = OnboardingScene(initialBots = listOf(testBot))

        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme {
                    FirstRunOnboardingScreen(
                        onFinish = {},
                        stateStore = stateStore,
                    )
                }
            }
        }
        compose.waitForIdle()

        // Resumes directly at ready step with custom bot name!
        compose.onNodeWithText("You're all set!").assertIsDisplayed()
        compose.onNodeWithText("Navigator (Research Partner)").assertIsDisplayed()
    }

    @Test
    fun `full journey updates stateStore at each transition and marks completed at the end`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val stateStore = OnboardingStateStore(context)
        stateStore.reset()

        val scene = OnboardingScene()
        var completedBot: Bot? = null

        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme {
                    FirstRunOnboardingScreen(
                        onFinish = { bot -> completedBot = bot },
                        stateStore = stateStore,
                    )
                }
            }
        }
        compose.waitForIdle()

        // 1. Welcome -> Name
        compose.onNodeWithText("Get Started").performClick()
        compose.waitForIdle()
        assertEquals(OnboardingStep.IDENTITY_IN_PROGRESS, stateStore.currentStep)

        // 2. Name -> Email
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).performTextInput("Alan Turing")
        compose.waitForIdle()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()
        assertEquals("Alan Turing", stateStore.draft.value.name)

        // 3. Email -> AI Provider
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).performTextInput("alan@bletchley.uk")
        compose.waitForIdle()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()
        assertEquals(OnboardingStep.IDENTITY_COMPLETE, stateStore.currentStep)
        assertEquals("alan@bletchley.uk", stateStore.draft.value.email)

        // 4. AI Provider -> Permissions
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()
        assertEquals(OnboardingStep.AI_SETUP_COMPLETE, stateStore.currentStep)

        // 5. Permissions -> Services
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()
        assertEquals(OnboardingStep.PERMISSIONS_COMPLETE, stateStore.currentStep)

        // 6. Services -> First Bot
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()
        assertEquals(OnboardingStep.SERVICES_COMPLETE, stateStore.currentStep)

        // 7. First Bot -> Ready
        compose.onNodeWithText("Create Agent & Continue").performClick()
        compose.waitForIdle()
        assertEquals(OnboardingStep.BOT_CREATION_COMPLETE, stateStore.currentStep)

        // 8. Ready -> Finish
        compose.onNodeWithText("Start First Chat").performClick()
        compose.waitForIdle()
        assertTrue(stateStore.isCompleted)
        assertNotNull(stateStore.draft.value.completedAt)
        assertNotNull(completedBot)
    }
}
