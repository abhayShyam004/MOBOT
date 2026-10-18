package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Instance
import com.openmausbot.companion.core.InstanceAuthentication
import com.openmausbot.companion.core.ModelCatalog
import com.openmausbot.companion.core.ModelOption
import com.openmausbot.companion.core.ProviderAccount
import com.openmausbot.companion.core.ProviderSnapshot
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The Model providers screen keeps two kinds of thing apart: API providers
 * (paid with a key this phone can hold) and account sign-in engines (CLIs on
 * the host). A sign-in engine the host cannot run offers no sign-in button —
 * the honest move, not a tap that always answers "not installed on this
 * server".
 */
class ModelProvidersRulesTest {

    private fun instance(
        id: String,
        access: String?,
        authentication: InstanceAuthentication? = null,
        runtimeAvailable: Boolean = true,
        authenticated: Boolean? = null,
        account: ProviderAccount? = null,
        driverKind: String = "acp-codex",
    ) = Instance(
        instanceId = id,
        driverKind = driverKind,
        displayName = id,
        snapshot = ProviderSnapshot(
            state = if (runtimeAvailable) "available" else "unavailable",
            reason = if (runtimeAvailable) null else "`$id` CLI not found",
            authenticated = authenticated,
            account = account,
        ),
        models = ModelCatalog("m-1", listOf(ModelOption("m-1", "Model 1"))),
        access = access,
        authentication = authentication,
    )

    private fun catalog(vararg entries: Instance) = entries.toList()

    @Test
    fun `api-key providers and sign-in engines split into the two sections`() {
        val instances = catalog(
            // The wire fact: the server marks the OpenAI-compatible driver
            // access "custom" (EngineAccess is only subscription|custom), so
            // the driver kind decides — not a literal "apikey" that never
            // arrives.
            instance("openaiCompat", access = "custom", driverKind = "openai-compat"),
            instance("codex", access = "subscription", authentication = InstanceAuthentication(method = "device-code")),
            instance("cursor", access = "subscription"),
            // A custom-install CLI agent is still an engine, not an API provider.
            instance("qwen", access = "custom"),
        )
        assertEquals(listOf("openaiCompat"), ModelProvidersRules.apiProviders(instances).map { it.instanceId })
        assertEquals(
            listOf("codex", "cursor", "qwen"),
            ModelProvidersRules.signInEngines(instances).map { it.instanceId },
            "built-in and custom-install engines are sign-in-section engines: they exist by being installed",
        )
    }

    @Test
    fun `an engine with an authentication method is not an api provider, whatever its access says`() {
        // The account sign-in is the more specific signal: a key alone does
        // not configure an engine that also offers a sign-in flow.
        val mixed = instance("claude", access = "apikey", authentication = InstanceAuthentication(method = "paste-code"))
        assertTrue(ModelProvidersRules.signInEngines(listOf(mixed)).contains(mixed))
        assertFalse(ModelProvidersRules.apiProviders(listOf(mixed)).contains(mixed))
    }

    @Test
    fun `CLI missing plus native auth available keeps Sign in`() {
        // The pinned property of this phase: a missing runtime executable is
        // a runtime fact and must never hide a native authentication flow.
        val codex = instance(
            "codex",
            access = "subscription",
            authentication = InstanceAuthentication(method = "device-code", available = true),
            runtimeAvailable = false,
        )
        assertTrue(
            ModelProvidersRules.offersSignIn(codex),
            "Codex signs in through OpenAI's device flow natively; the missing CLI must not remove the button",
        )
        assertEquals("Unavailable", ModelProvidersRules.runtimeLine(codex))
        assertEquals("Not signed in", ModelProvidersRules.accountLine(codex))
    }

    @Test
    fun `CLI missing plus CLI-driven sign-in means no button and the server's reason`() {
        // Claude's paste-code sign-in IS the unmodified CLI's login; with no
        // runtime there is genuinely nothing to run, and the card says so.
        val claude = instance(
            "claude",
            access = "subscription",
            authentication = InstanceAuthentication(
                method = "paste-code",
                available = false,
                reason = "Account sign-in runs the Claude Code runtime's own login, and this host does not have it.",
            ),
            runtimeAvailable = false,
        )
        assertFalse(ModelProvidersRules.offersSignIn(claude))
        assertTrue(ModelProvidersRules.signInBlockedReason(claude)?.contains("Claude Code runtime") == true)
    }

    @Test
    fun `an engine with no authentication block offers no sign-in at all`() {
        assertFalse(ModelProvidersRules.offersSignIn(instance("qwen", access = "custom")))
        assertNull(ModelProvidersRules.signInBlockedReason(instance("qwen", access = "custom")))
    }

    @Test
    fun `api-key providers never offer sign-in, available or not`() {
        val keyed = instance("openaiCompat", access = "apikey", runtimeAvailable = true)
        val broken = instance("openaiCompat", access = "apikey", runtimeAvailable = false)
        assertFalse(ModelProvidersRules.offersSignIn(keyed))
        assertFalse(ModelProvidersRules.offersSignIn(broken))
    }

    @Test
    fun `a signed-out engine offers Sign in, not Switch account`() {
        // The server can remove a stored sign-in (signOut true) even when the
        // person is signed out; switching needs an account to switch from.
        val signedOut = instance(
            "codex",
            access = "subscription",
            authentication = InstanceAuthentication(method = "device-code", signOut = true, available = true),
            runtimeAvailable = false,
            authenticated = false,
        )
        assertFalse(ModelProvidersRules.showsSwitchAccount(signedOut))
        val signedIn = signedOut.copy(snapshot = signedOut.snapshot.copy(authenticated = true))
        assertTrue(ModelProvidersRules.showsSwitchAccount(signedIn), "a signed-in account can be switched")
    }

    @Test
    fun `a signed-in engine reports account and runtime separately`() {
        // The desired middle state: signed in, runtime unavailable.
        val signedIn = instance(
            "codex",
            access = "subscription",
            authentication = InstanceAuthentication(method = "device-code", signOut = true, available = true),
            runtimeAvailable = false,
            authenticated = true,
            account = ProviderAccount(email = "person@example.com", method = "login"),
        )
        assertEquals("Signed in", ModelProvidersRules.accountLine(signedIn))
        assertEquals("person@example.com", signedIn.snapshot.account?.email)
        assertEquals("Unavailable", ModelProvidersRules.runtimeLine(signedIn))
        assertTrue(ModelProvidersRules.offersSignIn(signedIn))
    }

    @Test
    fun `opencodeGo is recognized as supporting API key access`() {
        val opencode = instance("opencodeGo", access = "custom", driverKind = "opencodeGo")
        assertTrue(ModelProvidersRules.usesApiKey(opencode), "OpenCode exposes legitimate API key configuration")
        assertTrue(ModelProvidersRules.apiProviders(listOf(opencode)).contains(opencode))
    }

    @Test
    fun `docsUrl resolves truthful documentation links`() {
        val openai = instance("openaiCompat", access = "custom", driverKind = "openai-compat")
        val claude = instance("claude", access = "subscription", driverKind = "claudeAgent")
        val custom = instance("my-gateway", access = "custom", driverKind = "openai-compat").copy(
            docsUrl = "https://custom.example.com/docs",
        )
        assertEquals("https://platform.openai.com/docs", ModelProvidersRules.docsUrl(openai))
        assertEquals("https://docs.anthropic.com", ModelProvidersRules.docsUrl(claude))
        assertEquals("https://custom.example.com/docs", ModelProvidersRules.docsUrl(custom))
    }

    @Test
    fun `stateLine and statusTone never produce contradictory states`() {
        val notSignedIn = instance(
            "codex",
            access = "subscription",
            authentication = InstanceAuthentication(method = "device-code", available = true),
            runtimeAvailable = true,
            authenticated = false,
        )
        assertEquals("Sign in required", ModelProvidersRules.stateLine(notSignedIn))
        assertEquals(StatusTone.WARN, ModelProvidersRules.statusTone(notSignedIn))

        val signedIn = notSignedIn.copy(snapshot = notSignedIn.snapshot.copy(authenticated = true))
        assertEquals("Configured", ModelProvidersRules.stateLine(signedIn))
        assertEquals(StatusTone.GOOD, ModelProvidersRules.statusTone(signedIn))

        val unconfiguredKey = instance("openaiCompat", access = "custom", driverKind = "openai-compat", runtimeAvailable = false)
        assertEquals("API key required", ModelProvidersRules.stateLine(unconfiguredKey))
        assertEquals(StatusTone.WARN, ModelProvidersRules.statusTone(unconfiguredKey))

        val configuredKey = unconfiguredKey.copy(snapshot = unconfiguredKey.snapshot.copy(state = "available"))
        assertEquals("Configured", ModelProvidersRules.stateLine(configuredKey))
        assertEquals(StatusTone.GOOD, ModelProvidersRules.statusTone(configuredKey))
    }

    @Test
    fun `isSupportedBuiltInProvider keeps only supported providers with real Android auth`() {
        val codex = instance(
            "codex",
            access = "subscription",
            authentication = InstanceAuthentication(method = "device-code", available = true),
        )
        assertTrue(ModelProvidersRules.isSupportedBuiltInProvider(codex), "Codex has native Android device-code auth")

        val claude = instance(
            "claude",
            access = "subscription",
            authentication = InstanceAuthentication(method = "paste-code", available = false),
            runtimeAvailable = false,
        )
        assertFalse(ModelProvidersRules.isSupportedBuiltInProvider(claude), "Claude Code runtime missing on Android must be excluded")

        val antigravity = instance("antigravity", access = "subscription", runtimeAvailable = false)
        assertFalse(ModelProvidersRules.isSupportedBuiltInProvider(antigravity), "Antigravity CLI missing on Android must be excluded")

        val grok = instance("grok", access = "subscription", runtimeAvailable = false)
        assertFalse(ModelProvidersRules.isSupportedBuiltInProvider(grok), "Grok CLI missing on Android must be excluded")

        // Local execution engine runtimes must never populate consumer model catalog
        val runtimes = listOf("cursor", "droid", "hermes", "pi", "opencodeGo", "qwen", "kimi", "computer")
        for (runtimeId in runtimes) {
            val runtimeInstance = instance(runtimeId, access = "custom")
            assertFalse(
                ModelProvidersRules.isSupportedBuiltInProvider(runtimeInstance),
                "$runtimeId is a local execution engine runtime, not a consumer model provider",
            )
        }

        // Built-in API gateway
        val openaiCompat = instance("openaiCompat", access = "custom", driverKind = "openai-compat")
        assertTrue(ModelProvidersRules.isSupportedBuiltInProvider(openaiCompat), "openaiCompat is the built-in API gateway")

        // Custom endpoints are excluded from built-in standard providers section
        val custom = instance("custom-provider", access = "custom", driverKind = "openai-compat")
        assertFalse(ModelProvidersRules.isSupportedBuiltInProvider(custom), "Custom endpoints belong in Custom Endpoints section")
    }

    @Test
    fun `displayName presents clean OpenAI-compatible name`() {
        val openaiCompat = instance("openaiCompat", access = "custom", driverKind = "openai-compat").copy(
            displayName = "OpenAI-compatible (OpenRouter / Groq)",
        )
        assertEquals("OpenAI Compatible", ModelProvidersRules.displayName(openaiCompat))
    }
}
