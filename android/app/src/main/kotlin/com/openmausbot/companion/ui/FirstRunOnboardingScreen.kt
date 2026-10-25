package com.openmausbot.companion.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import com.openmausbot.companion.R
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.BorderStroke
import androidx.core.content.ContextCompat
import com.openmausbot.companion.MainActivity
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.BotProfilePatch
import com.openmausbot.companion.core.Instance
import com.openmausbot.companion.core.InstanceAuthentication
import com.openmausbot.companion.core.ModelCatalog
import com.openmausbot.companion.core.ModelOption
import com.openmausbot.companion.core.ModelSelection
import com.openmausbot.companion.core.ProviderSnapshot
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.core.ThemeMode
import com.openmausbot.companion.storage.OnboardingDraft
import com.openmausbot.companion.storage.OnboardingStateStore
import com.openmausbot.companion.storage.OnboardingStep
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Steps in the guided first-run onboarding experience.
 *
 * Designed to feel like preparing an intelligent AI teammate to work with the user:
 * FIRST INSTALL → WELCOME → NAME → EMAIL → AI AUTHENTICATION / API → PERMISSIONS → USEFUL SERVICES → FIRST BOT → READY → FIRST CHAT
 */
enum class OnboardingBeat(val stepNumber: Int, val totalSteps: Int = 7) {
    WELCOME(0),
    NAME(1),
    EMAIL(2),
    AI_PROVIDER(3),
    PERMISSIONS(4),
    SERVICES(5),
    FIRST_BOT(6),
    READY(7),
}

/**
 * Maps persistent onboarding state to the initial active beat on launch or resume.
 */
fun OnboardingDraft.toInitialBeat(): OnboardingBeat {
    return when (step) {
        OnboardingStep.NOT_STARTED -> OnboardingBeat.WELCOME
        OnboardingStep.IDENTITY_IN_PROGRESS -> {
            if (name.isNotBlank()) OnboardingBeat.EMAIL else OnboardingBeat.NAME
        }
        OnboardingStep.IDENTITY_COMPLETE,
        OnboardingStep.AI_SETUP_IN_PROGRESS -> OnboardingBeat.AI_PROVIDER
        OnboardingStep.AI_SETUP_COMPLETE,
        OnboardingStep.PERMISSIONS_IN_PROGRESS -> OnboardingBeat.PERMISSIONS
        OnboardingStep.PERMISSIONS_COMPLETE,
        OnboardingStep.SERVICES_IN_PROGRESS -> OnboardingBeat.SERVICES
        OnboardingStep.SERVICES_COMPLETE,
        OnboardingStep.BOT_CREATION_IN_PROGRESS -> OnboardingBeat.FIRST_BOT
        OnboardingStep.BOT_CREATION_COMPLETE,
        OnboardingStep.COMPLETED -> OnboardingBeat.READY
    }
}

@Composable
fun FirstRunOnboardingScreen(
    onFinish: (Bot) -> Unit,
    stateStore: OnboardingStateStore = run {
        val ctx = LocalContext.current
        remember(ctx) { OnboardingStateStore(ctx) }
    },
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val onboarding = environment.onboarding
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val haptics = rememberHaptics()

    val initialDraft = remember { stateStore.draft.value }
    var currentBeat by rememberSaveable { mutableStateOf(initialDraft.toInitialBeat()) }

    // State collected across steps
    var userName by rememberSaveable { mutableStateOf(initialDraft.name) }
    var userEmail by rememberSaveable { mutableStateOf(initialDraft.email) }

    // AI Provider state
    var instances by remember { mutableStateOf<List<Instance>>(emptyList()) }
    var selectedInstanceId by rememberSaveable { mutableStateOf(initialDraft.providerId) }
    var selectedModelId by rememberSaveable { mutableStateOf(initialDraft.modelId) }
    var verifyingProvider by remember { mutableStateOf(false) }
    var providerVerificationError by remember { mutableStateOf<String?>(null) }
    var editingKeyInstance by remember { mutableStateOf<Instance?>(null) }
    var signingInInstance by remember { mutableStateOf<Instance?>(null) }

    // Permissions state
    var terminalGranted by rememberSaveable { mutableStateOf(true) }
    var filesystemGranted by rememberSaveable { mutableStateOf(true) }
    var browserGranted by rememberSaveable { mutableStateOf(true) }
    var autonomousExecution by rememberSaveable { mutableStateOf(false) }
    var notificationsEnabling by remember { mutableStateOf(false) }

    val currentTheme by environment.appearance.theme.collectAsState()
    val funRoles = remember {
        listOf(
            "Joke Teller",
            "Study Buddy",
            "Idea Generator",
            "Personal Researcher",
            "Problem Solver",
        )
    }
    val initialRole = rememberSaveable { funRoles.random() }

    // First Bot state
    var botName by rememberSaveable { mutableStateOf(initialDraft.botName.ifBlank { "Togepi" }) }
    var botRole by rememberSaveable { mutableStateOf(initialDraft.botRole.ifBlank { initialRole }) }
    var botDescription by rememberSaveable { mutableStateOf("Autonomous AI teammate with device & tool capabilities.") }
    var botColor by rememberSaveable { mutableStateOf(initialDraft.botColor.ifBlank { "blue" }) }
    var botMascot by rememberSaveable { mutableStateOf(initialDraft.botMascot.ifBlank { MausBodies.DEFAULT_ID }) }
    var createdBot by remember { mutableStateOf<Bot?>(null) }
    var creatingBot by remember { mutableStateOf(false) }
    var botCreationError by remember { mutableStateOf<String?>(null) }

    // Load initial state from server
    LaunchedEffect(Unit) {
        val config = session.configStatus()
        config?.profile?.let { prof ->
            if (userName.isBlank() && prof.name.isNotBlank()) {
                userName = prof.name
                stateStore.saveIdentity(userName, userEmail, complete = false)
            }
            if (userEmail.isBlank() && prof.email.isNotBlank()) {
                userEmail = prof.email
                stateStore.saveIdentity(userName, userEmail, complete = false)
            }
        }
        try {
            instances = session.modelInstances()
            val available = instances.filter { it.snapshot.isAvailable }
            if (available.isNotEmpty() && selectedInstanceId.isEmpty()) {
                val def = available.first()
                selectedInstanceId = def.instanceId
                selectedModelId = def.models.defaultModel
                stateStore.saveAiProvider(selectedInstanceId, selectedModelId, complete = true)
            }
        } catch (_: Throwable) {
            // Server might still be initialising
        }
    }

    LaunchedEffect(currentBeat) {
        if (currentBeat == OnboardingBeat.AI_PROVIDER && instances.isEmpty()) {
            try {
                instances = session.modelInstances()
                val available = instances.filter { it.snapshot.isAvailable }
                if (available.isNotEmpty() && selectedInstanceId.isEmpty()) {
                    val def = available.first()
                    selectedInstanceId = def.instanceId
                    selectedModelId = def.models.defaultModel
                    stateStore.saveAiProvider(selectedInstanceId, selectedModelId, complete = true)
                }
            } catch (_: Throwable) {
                // Server might still be initialising
            }
        }
        if (currentBeat == OnboardingBeat.READY && createdBot == null) {
            val existing = session.state.value.bots.lastOrNull()
            if (existing != null) {
                createdBot = existing
            } else {
                currentBeat = OnboardingBeat.FIRST_BOT
            }
        }
    }

    fun navigateBack() {
        val targetBeat = when (currentBeat) {
            OnboardingBeat.NAME -> OnboardingBeat.WELCOME
            OnboardingBeat.EMAIL -> OnboardingBeat.NAME
            OnboardingBeat.AI_PROVIDER -> OnboardingBeat.EMAIL
            OnboardingBeat.PERMISSIONS -> OnboardingBeat.AI_PROVIDER
            OnboardingBeat.SERVICES -> OnboardingBeat.PERMISSIONS
            OnboardingBeat.FIRST_BOT -> OnboardingBeat.SERVICES
            else -> OnboardingBeat.WELCOME
        }
        val targetStep = when (targetBeat) {
            OnboardingBeat.WELCOME -> OnboardingStep.NOT_STARTED
            OnboardingBeat.NAME -> OnboardingStep.IDENTITY_IN_PROGRESS
            OnboardingBeat.EMAIL -> OnboardingStep.IDENTITY_IN_PROGRESS
            OnboardingBeat.AI_PROVIDER -> OnboardingStep.IDENTITY_COMPLETE
            OnboardingBeat.PERMISSIONS -> OnboardingStep.AI_SETUP_COMPLETE
            OnboardingBeat.SERVICES -> OnboardingStep.PERMISSIONS_COMPLETE
            OnboardingBeat.FIRST_BOT -> OnboardingStep.SERVICES_COMPLETE
            OnboardingBeat.READY -> OnboardingStep.BOT_CREATION_COMPLETE
        }
        stateStore.updateStep(targetStep)
        currentBeat = targetBeat
    }

    BackHandler(enabled = currentBeat != OnboardingBeat.WELCOME && currentBeat != OnboardingBeat.READY) {
        navigateBack()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AppTheme.colors.background),
    ) {
        // Top Navigation & Step Indicator (hidden on welcome and ready)
        if (currentBeat != OnboardingBeat.WELCOME && currentBeat != OnboardingBeat.READY) {
            OnboardingTopBar(
                step = currentBeat.stepNumber,
                totalSteps = currentBeat.totalSteps,
                onBack = ::navigateBack,
                onSkip = if (currentBeat == OnboardingBeat.SERVICES) {
                    {
                        stateStore.updateStep(OnboardingStep.SERVICES_COMPLETE)
                        currentBeat = OnboardingBeat.FIRST_BOT
                    }
                } else null,
            )
        }

        // Animated Step Transitions
        AnimatedContent(
            targetState = currentBeat,
            transitionSpec = {
                if (targetState.ordinal > initialState.ordinal) {
                    (slideInHorizontally { width -> width / 3 } + fadeIn()) togetherWith
                        (slideOutHorizontally { width -> -width / 3 } + fadeOut())
                } else {
                    (slideInHorizontally { width -> -width / 3 } + fadeIn()) togetherWith
                        (slideOutHorizontally { width -> width / 3 } + fadeOut())
                }
            },
            modifier = Modifier.weight(1f),
            label = "OnboardingSteps",
        ) { beat ->
            when (beat) {
                OnboardingBeat.WELCOME -> {
                    WelcomeBeat(
                        onGetStarted = {
                            haptics.play(TactileAction.OPEN_SEARCH)
                            stateStore.updateStep(OnboardingStep.IDENTITY_IN_PROGRESS)
                            currentBeat = OnboardingBeat.NAME
                        },
                    )
                }
                OnboardingBeat.NAME -> {
                    NameBeat(
                        name = userName,
                        onNameChange = { userName = it },
                        onContinue = {
                            if (userName.trim().isNotEmpty()) {
                                haptics.play(TactileAction.OPEN_SEARCH)
                                val cleanName = userName.trim()
                                userName = cleanName
                                stateStore.saveIdentity(cleanName, userEmail, complete = false)
                                scope.launch {
                                    session.updateUserProfile(name = cleanName, email = null)
                                }
                                currentBeat = OnboardingBeat.EMAIL
                            }
                        },
                    )
                }
                OnboardingBeat.EMAIL -> {
                    EmailBeat(
                        email = userEmail,
                        currentTheme = currentTheme,
                        onEmailChange = { userEmail = it },
                        onThemeChange = { mode ->
                            scope.launch {
                                environment.appearance.setTheme(mode)
                            }
                        },
                        onContinue = {
                            val cleanEmail = userEmail.trim()
                            if (cleanEmail.isNotEmpty() && cleanEmail.contains("@") && cleanEmail.contains(".")) {
                                haptics.play(TactileAction.OPEN_SEARCH)
                                userEmail = cleanEmail
                                stateStore.saveIdentity(userName, cleanEmail, complete = true)
                                scope.launch {
                                    session.updateUserProfile(
                                        name = userName.trim().ifEmpty { "User" },
                                        email = cleanEmail,
                                    )
                                }
                                currentBeat = OnboardingBeat.AI_PROVIDER
                            }
                        },
                    )
                }
                OnboardingBeat.AI_PROVIDER -> {
                    AiProviderBeat(
                        instances = instances,
                        selectedInstanceId = selectedInstanceId,
                        onSelectInstance = { instanceId, modelId ->
                            selectedInstanceId = instanceId
                            selectedModelId = modelId
                            stateStore.saveAiProvider(instanceId, modelId, complete = true)
                        },
                        onConfigureKey = { instance -> editingKeyInstance = instance },
                        onSignIn = { instance -> signingInInstance = instance },
                        onReloadInstances = {
                            scope.launch {
                                instances = session.modelInstances()
                            }
                        },
                        onContinue = {
                            haptics.play(TactileAction.OPEN_SEARCH)
                            if (selectedInstanceId.isNotEmpty()) {
                                stateStore.saveAiProvider(selectedInstanceId, selectedModelId, complete = true)
                                scope.launch {
                                    session.setDefaultModelSelection(selectedInstanceId, selectedModelId)
                                }
                            }
                            currentBeat = OnboardingBeat.PERMISSIONS
                        },
                    )
                }
                OnboardingBeat.PERMISSIONS -> {
                    PermissionsBeat(
                        terminal = terminalGranted,
                        filesystem = filesystemGranted,
                        browser = browserGranted,
                        autonomous = autonomousExecution,
                        onTerminalChange = { terminalGranted = it },
                        onFilesystemChange = { filesystemGranted = it },
                        onBrowserChange = { browserGranted = it },
                        onAutonomousChange = { autonomousExecution = it },
                        onEnableNotifications = {
                            notificationsEnabling = true
                            scope.launch {
                                onboarding.setNotificationPromptSeen(true)
                                environment.notifications.act()
                                notificationsEnabling = false
                            }
                        },
                        notificationsBusy = notificationsEnabling,
                        onContinue = {
                            haptics.play(TactileAction.OPEN_SEARCH)
                            stateStore.updateStep(OnboardingStep.PERMISSIONS_COMPLETE)
                            scope.launch {
                                session.setAgentPermission("terminal", if (terminalGranted) "granted" else "denied")
                                session.setAgentPermission("filesystem", if (filesystemGranted) "granted" else "denied")
                                session.setAgentPermission("browser", if (browserGranted) "granted" else "denied")
                                session.setNeverAskPermissions(autonomousExecution)
                            }
                            currentBeat = OnboardingBeat.SERVICES
                        },
                    )
                }
                OnboardingBeat.SERVICES -> {
                    ServicesBeat(
                        session = session,
                        onContinue = {
                            haptics.play(TactileAction.OPEN_SEARCH)
                            stateStore.updateStep(OnboardingStep.SERVICES_COMPLETE)
                            currentBeat = OnboardingBeat.FIRST_BOT
                        },
                    )
                }
                OnboardingBeat.FIRST_BOT -> {
                    FirstBotBeat(
                        botName = botName,
                        botRole = botRole,
                        botColor = botColor,
                        botMascot = botMascot,
                        selectedInstanceId = selectedInstanceId,
                        selectedModelId = selectedModelId,
                        instances = instances,
                        creating = creatingBot,
                        errorMessage = botCreationError,
                        onNameChange = {
                            botName = it
                            botCreationError = null
                        },
                        onRoleChange = {
                            botRole = it
                            botCreationError = null
                        },
                        onColorChange = { botColor = it },
                        onMascotChange = { botMascot = it },
                        suggestedRoles = funRoles,
                        onCreate = {
                            creatingBot = true
                            botCreationError = null
                            stateStore.saveBotDraft(
                                botName = botName.trim().ifEmpty { "Togepi" },
                                botRole = botRole.trim().ifEmpty { initialRole },
                                botColor = botColor,
                                botMascot = botMascot,
                            )
                            stateStore.updateStep(OnboardingStep.BOT_CREATION_IN_PROGRESS)
                            scope.launch {
                                val modelSelection = if (selectedInstanceId.isNotEmpty()) {
                                    ModelSelection(instanceId = selectedInstanceId, model = selectedModelId)
                                } else null
                                val bot = session.createBot(
                                    name = botName.trim().ifEmpty { "Togepi" },
                                    model = modelSelection,
                                    title = botRole.trim().ifEmpty { initialRole },
                                    description = botDescription.trim().ifEmpty { null },
                                )
                                creatingBot = false
                                if (bot != null) {
                                    val patched = runCatching {
                                        session.updateProfile(BotProfilePatch(color = botColor, mascotBody = botMascot), bot)
                                    }.getOrNull()
                                    createdBot = patched ?: bot.copy(color = botColor, mascotBody = botMascot)
                                    stateStore.updateStep(OnboardingStep.BOT_CREATION_COMPLETE)
                                    haptics.play(TactileAction.CREATE_BOT_SUCCESS)
                                    currentBeat = OnboardingBeat.READY
                                } else {
                                    botCreationError = "Could not initialize agent on this device. Please tap retry."
                                }
                            }
                        },
                    )
                }
                OnboardingBeat.READY -> {
                    val activeBot = createdBot
                    ReadyBeat(
                        userName = userName.ifBlank { "User" },
                        botName = activeBot?.name ?: botName.ifBlank { "MOBOT" },
                        botRole = activeBot?.title ?: botRole,
                        botColor = activeBot?.color ?: botColor,
                        botMascot = activeBot?.mascotBody ?: botMascot,
                        onStartChat = {
                            val botToLaunch = createdBot
                            if (botToLaunch != null) {
                                haptics.play(TactileAction.CREATE_BOT_SUCCESS)
                                stateStore.markCompleted()
                                scope.launch {
                                    session.completeOnboarding()
                                    onboarding.setWelcomeSeen(true)
                                }
                                onFinish(botToLaunch)
                            }
                        },
                    )
                }
            }
        }
    }

    // Modal dialog for editing provider keys inline
    editingKeyInstance?.let { instance ->
        OnboardingKeyDialog(
            instance = instance,
            session = session,
            onSaved = {
                scope.launch {
                    instances = session.modelInstances()
                    selectedInstanceId = instance.instanceId
                    selectedModelId = instance.models.defaultModel
                    stateStore.saveAiProvider(instance.instanceId, instance.models.defaultModel, complete = true)
                }
                editingKeyInstance = null
            },
            onDismiss = { editingKeyInstance = null },
        )
    }

    // Modal dialog for account sign-in inline
    signingInInstance?.let { instance ->
        OnboardingAuthDialog(
            instance = instance,
            session = session,
            onDone = {
                scope.launch {
                    instances = session.modelInstances()
                    selectedInstanceId = instance.instanceId
                    selectedModelId = instance.models.defaultModel
                    stateStore.saveAiProvider(instance.instanceId, instance.models.defaultModel, complete = true)
                }
                signingInInstance = null
            },
            onDismiss = { signingInInstance = null },
        )
    }
}

/** Top bar showing back chevron, minimal segmented indicator, and optional skip. */
@Composable
private fun OnboardingTopBar(
    step: Int,
    totalSteps: Int,
    onBack: () -> Unit,
    onSkip: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        IconButton(onClick = onBack, modifier = Modifier.size(40.dp)) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = AppTheme.colors.textPrimary,
                modifier = Modifier.size(20.dp),
            )
        }

        // Minimalist step indicator bar
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            for (i in 1..totalSteps) {
                Box(
                    modifier = Modifier
                        .height(3.5.dp)
                        .width(if (i == step) 24.dp else 12.dp)
                        .clip(CircleShape)
                        .background(
                            if (i <= step) AppTheme.colors.accent
                            else AppTheme.colors.surfaceRaised
                        ),
                )
            }
        }

        if (onSkip != null) {
            TextButton(onClick = onSkip) {
                Text(
                    text = "Skip",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = AppTheme.colors.textSecondary,
                )
            }
        } else {
            Spacer(modifier = Modifier.width(48.dp))
        }
    }
}

/**
 * Step 1: WELCOME
 * Confident, editorial presentation of MOBOT as an intelligent AI teammate.
 * Preserves exact OnboardingCopy strings for test contract satisfaction.
 */
@Composable
private fun WelcomeBeat(
    onGetStarted: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 16.dp),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(Modifier.height(16.dp))

            // MOBOT Brand Icon
            Box(
                modifier = Modifier
                    .size(96.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(AppTheme.colors.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    painter = painterResource(R.drawable.mobot_logo),
                    contentDescription = "MOBOT Logo",
                    modifier = Modifier
                        .size(96.dp)
                        .clip(RoundedCornerShape(24.dp)),
                )
            }

            Spacer(Modifier.height(4.dp))

            Text(
                text = OnboardingCopy.WELCOME_TITLE,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = AppTheme.colors.textPrimary,
                textAlign = TextAlign.Center,
            )

            Text(
                text = OnboardingCopy.WELCOME_SUBTITLE,
                fontSize = 15.sp,
                lineHeight = 22.sp,
                color = AppTheme.colors.textSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 12.dp),
            )

            Spacer(Modifier.height(8.dp))

            // Value proposition highlights
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                OnboardingValueCard(
                    icon = Icons.AutoMirrored.Filled.Send,
                    title = "Autonomous Reasoning & Tools",
                    subtitle = "Executes commands, inspects files, and interacts with the web directly on Android.",
                )
                OnboardingValueCard(
                    icon = Icons.Filled.CheckCircle,
                    title = "Connected Services",
                    subtitle = "Integrates with Google Maps, Gmail, GitHub, Slack, and cloud SaaS.",
                )
                OnboardingValueCard(
                    icon = Icons.Filled.Lock,
                    title = "Strict Security Boundaries",
                    subtitle = "Runs standalone on your device with complete permission control.",
                )
            }
        }

        Spacer(Modifier.height(24.dp))

        // Pinned single action
        Button(
            onClick = onGetStarted,
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = AppTheme.colors.accent,
                contentColor = AppTheme.colors.onAccent,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            Text(
                text = "Get Started",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun OnboardingValueCard(icon: ImageVector, title: String, subtitle: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(AppTheme.colors.surface)
            .border(1.dp, AppTheme.colors.border.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(AppTheme.colors.surfaceRaised),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = AppTheme.colors.accent,
                modifier = Modifier.size(20.dp),
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                fontSize = 14.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textPrimary,
            )
            Text(
                text = subtitle,
                fontSize = 13.sp,
                lineHeight = 17.sp,
                color = AppTheme.colors.textSecondary,
            )
        }
    }
}

/**
 * Step 2: NAME
 * High-focus input asking for user's preferred name.
 */
@Composable
private fun NameBeat(
    name: String,
    onNameChange: (String) -> Unit,
    onContinue: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 20.dp),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "What should MOBOT call you?",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = AppTheme.colors.textPrimary,
            )
            Text(
                text = "Your name personalizes conversations, workspace context, and agent briefings.",
                fontSize = 15.sp,
                lineHeight = 22.sp,
                color = AppTheme.colors.textSecondary,
            )

            Spacer(Modifier.height(16.dp))

            AppTextField(
                value = name,
                onValueChange = onNameChange,
                label = "Your Name",
                placeholder = "Alex",
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Words,
                    imeAction = ImeAction.Done,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Spacer(Modifier.height(12.dp))

        Button(
            onClick = onContinue,
            enabled = name.trim().isNotBlank(),
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = AppTheme.colors.accent,
                contentColor = AppTheme.colors.onAccent,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            Text(
                text = "Continue",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/**
 * Step 3: EMAIL
 * Clean input asking for user's email address.
 */
@Composable
private fun EmailBeat(
    email: String,
    currentTheme: ThemeMode,
    onEmailChange: (String) -> Unit,
    onThemeChange: (ThemeMode) -> Unit,
    onContinue: () -> Unit,
) {
    val cleanEmail = email.trim()
    val isEmailValid = cleanEmail.isNotBlank() && cleanEmail.contains("@") && cleanEmail.contains(".") && cleanEmail.length >= 5

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 20.dp),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "Your email address",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = AppTheme.colors.textPrimary,
            )
            Text(
                text = "Used for workspace identification, notifications, and connecting third-party services.",
                fontSize = 15.sp,
                lineHeight = 22.sp,
                color = AppTheme.colors.textSecondary,
            )

            Spacer(Modifier.height(8.dp))

            AppTextField(
                value = email,
                onValueChange = onEmailChange,
                label = "Email Address",
                placeholder = "alex@example.com",
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Done,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            Text(
                text = "Stored locally on your device. Never shared without your explicit consent.",
                fontSize = 12.5.sp,
                color = AppTheme.colors.textTertiary,
            )

            Spacer(Modifier.height(8.dp))

            Text(
                text = "Theme Preference",
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textPrimary,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(
                    ThemeMode.SYSTEM to "System",
                    ThemeMode.LIGHT to "Light",
                    ThemeMode.DARK to "Dark",
                ).forEach { (mode, label) ->
                    val isSelected = currentTheme == mode
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = if (isSelected) AppTheme.colors.surfaceRaised else AppTheme.colors.surface,
                        border = BorderStroke(
                            width = if (isSelected) 2.dp else 1.dp,
                            color = if (isSelected) AppTheme.colors.accent else AppTheme.colors.border.copy(alpha = 0.5f),
                        ),
                        modifier = Modifier
                            .weight(1f)
                            .height(44.dp)
                            .clickable { onThemeChange(mode) },
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text(
                                text = label,
                                fontSize = 13.5.sp,
                                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (isSelected) AppTheme.colors.textPrimary else AppTheme.colors.textSecondary,
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        Button(
            onClick = onContinue,
            enabled = isEmailValid,
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = AppTheme.colors.accent,
                contentColor = AppTheme.colors.onAccent,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            Text(
                text = "Continue",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/**
 * Step 4: AI AUTHENTICATION / API
 * Restricts selection strictly to OpenAI Codex (Browser OAuth sign-in)
 * and OpenAI Compatible (API Key provider).
 */
private val FALLBACK_CODEX = Instance(
    instanceId = "codex",
    driverKind = "codex",
    displayName = "OpenAI Codex",
    snapshot = ProviderSnapshot(state = "unconfigured"),
    models = ModelCatalog(defaultModel = "gpt-4o", options = listOf(ModelOption("gpt-4o", "GPT-4o"))),
    access = "subscription",
    authentication = InstanceAuthentication(method = "browser", available = true),
)

private val FALLBACK_OPENAI = Instance(
    instanceId = "openaiCompat",
    driverKind = "openai-compat",
    displayName = "OpenAI Compatible",
    snapshot = ProviderSnapshot(state = "unconfigured"),
    models = ModelCatalog(defaultModel = "gpt-4o", options = listOf(ModelOption("gpt-4o", "GPT-4o"))),
    access = "apikey",
)

@Composable
private fun AiProviderBeat(
    instances: List<Instance>,
    selectedInstanceId: String,
    onSelectInstance: (String, String) -> Unit,
    onConfigureKey: (Instance) -> Unit,
    onSignIn: (Instance) -> Unit,
    onReloadInstances: () -> Unit,
    onContinue: () -> Unit,
) {
    val codexInst = instances.firstOrNull { it.instanceId == "codex" } ?: FALLBACK_CODEX
    val openaiInst = instances.firstOrNull { it.instanceId == "openaiCompat" } ?: FALLBACK_OPENAI
    val visibleInstances = listOf(codexInst, openaiInst)
    val configuredInstances = visibleInstances.filter { it.snapshot.isAvailable }
    val isAnyConfigured = configuredInstances.isNotEmpty()

    LaunchedEffect(instances.isEmpty()) {
        if (instances.isEmpty()) {
            onReloadInstances()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 20.dp),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "Connect AI Provider",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = AppTheme.colors.textPrimary,
            )
            Text(
                text = "Sign in with OpenAI Codex or configure an OpenAI-compatible API key to power MOBOT's intelligence.",
                fontSize = 15.sp,
                lineHeight = 22.sp,
                color = AppTheme.colors.textSecondary,
            )

            Spacer(Modifier.height(8.dp))

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                visibleInstances.forEach { instance ->
                    val isSelected = instance.instanceId == selectedInstanceId
                    val isAvailable = instance.snapshot.isAvailable
                    val isCodex = instance.instanceId == "codex"

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(AppTheme.colors.surface)
                            .border(
                                width = if (isSelected) 2.dp else 1.dp,
                                color = if (isSelected) AppTheme.colors.accent else AppTheme.colors.border.copy(alpha = 0.5f),
                                shape = RoundedCornerShape(16.dp),
                            )
                            .clickable {
                                if (isAvailable) {
                                    onSelectInstance(instance.instanceId, instance.models.defaultModel)
                                } else {
                                    if (isCodex) {
                                        onSignIn(instance)
                                    } else {
                                        onConfigureKey(instance)
                                    }
                                }
                            }
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.weight(1f),
                        ) {
                            ProviderMark(instance = instance, size = 40.dp)
                            Column {
                                Text(
                                    text = if (isCodex) "OpenAI Codex" else "OpenAI Compatible",
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = AppTheme.colors.textPrimary,
                                )
                                Text(
                                    text = if (isAvailable) {
                                        if (isCodex) "Connected via OAuth • Ready" else "API Key Configured • Ready"
                                    } else {
                                        if (isCodex) "OAuth Sign In Required" else "API Key Required"
                                    },
                                    fontSize = 13.sp,
                                    color = if (isAvailable) AppTheme.colors.positive else AppTheme.colors.textTertiary,
                                )
                            }
                        }

                        if (isAvailable) {
                            Box(
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .background(AppTheme.colors.positive.copy(alpha = 0.12f))
                                    .padding(horizontal = 10.dp, vertical = 4.dp),
                            ) {
                                Text(
                                    text = if (isSelected) "Active" else "Ready",
                                    fontSize = 11.5.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = AppTheme.colors.positive,
                                )
                            }
                        } else {
                            OutlinedButton(
                                onClick = {
                                    if (isCodex) {
                                        onSignIn(instance)
                                    } else {
                                        onConfigureKey(instance)
                                    }
                                },
                                shape = CircleShape,
                                modifier = Modifier.height(34.dp),
                            ) {
                                Text(
                                    text = if (isCodex) "Sign In" else "Configure",
                                    fontSize = 12.5.sp,
                                    color = AppTheme.colors.textPrimary,
                                )
                            }
                        }
                    }
                }
            }
        }

        val isSelectedAvailable = visibleInstances.any { it.instanceId == selectedInstanceId && it.snapshot.isAvailable }

        Button(
            onClick = onContinue,
            enabled = isSelectedAvailable || isAnyConfigured,
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = AppTheme.colors.accent,
                contentColor = AppTheme.colors.onAccent,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            Text(
                text = "Continue",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }

        if (!isSelectedAvailable && !isAnyConfigured) {
            Spacer(Modifier.height(8.dp))
            TextButton(
                onClick = onContinue,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = "Configure later in Settings",
                    fontSize = 14.sp,
                    color = AppTheme.colors.textSecondary,
                )
            }
        }
    }
}

/**
 * Step 5: PERMISSIONS & CAPABILITIES
 * Requests all foundational Android device permissions (Location, Microphone, Camera, Media, Notifications)
 * and allows configuration of agent execution policies (Terminal, Filesystem, Browser, Autonomy).
 */
@Composable
private fun PermissionsBeat(
    terminal: Boolean,
    filesystem: Boolean,
    browser: Boolean,
    autonomous: Boolean,
    onTerminalChange: (Boolean) -> Unit,
    onFilesystemChange: (Boolean) -> Unit,
    onBrowserChange: (Boolean) -> Unit,
    onAutonomousChange: (Boolean) -> Unit,
    onEnableNotifications: () -> Unit,
    notificationsBusy: Boolean,
    onContinue: () -> Unit,
) {
    val context = LocalContext.current
    var hasCamera by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var hasMic by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
    }
    var hasLocation by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        )
    }
    var hasMedia by remember {
        mutableStateOf(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
            } else {
                ContextCompat.checkSelfPermission(context, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
            }
        )
    }
    var hasNotifications by remember {
        mutableStateOf(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            } else true
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        hasCamera = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        hasMic = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        hasLocation = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        hasMedia = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
        hasNotifications = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else true
    }

    fun requestDevicePermissions() {
        val perms = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
            perms.add(Manifest.permission.READ_MEDIA_IMAGES)
            perms.add(Manifest.permission.READ_MEDIA_VIDEO)
            perms.add(Manifest.permission.READ_MEDIA_AUDIO)
        } else {
            perms.add(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        permissionLauncher.launch(perms.toTypedArray())
    }

    val allDevicePermissionsGranted = hasCamera && hasMic && hasLocation && hasMedia && hasNotifications

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 20.dp),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "Agent Capabilities",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = AppTheme.colors.textPrimary,
            )
            Text(
                text = "Empower MOBOT to see, listen, locate, and act on your device with complete security.",
                fontSize = 15.sp,
                lineHeight = 22.sp,
                color = AppTheme.colors.textSecondary,
            )

            Spacer(Modifier.height(4.dp))

            // Device Permissions Section
            Text(
                text = "Device Permissions",
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textPrimary,
            )

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(AppTheme.colors.surface)
                    .border(1.dp, AppTheme.colors.border.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                DevicePermissionRow("Camera", "Photo capture, visual inspection & OCR", hasCamera)
                HorizontalDivider(color = AppTheme.colors.border.copy(alpha = 0.3f))
                DevicePermissionRow("Microphone", "Voice input, dictation & audio recording", hasMic)
                HorizontalDivider(color = AppTheme.colors.border.copy(alpha = 0.3f))
                DevicePermissionRow("Location", "Navigation, place search & contextual tools", hasLocation)
                HorizontalDivider(color = AppTheme.colors.border.copy(alpha = 0.3f))
                DevicePermissionRow("Media & Files", "File access, attachments & photo analysis", hasMedia)
                HorizontalDivider(color = AppTheme.colors.border.copy(alpha = 0.3f))
                DevicePermissionRow("Notifications", "Background completion & approval alerts", hasNotifications)

                Spacer(Modifier.height(4.dp))

                Button(
                    onClick = { requestDevicePermissions() },
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (allDevicePermissionsGranted) AppTheme.colors.surfaceRaised else AppTheme.colors.accent,
                        contentColor = if (allDevicePermissionsGranted) AppTheme.colors.textPrimary else AppTheme.colors.onAccent,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp),
                ) {
                    Text(
                        text = if (allDevicePermissionsGranted) "All Device Permissions Granted" else "Grant Device Permissions",
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            Spacer(Modifier.height(4.dp))

            // Agent Execution Policy Section
            Text(
                text = "Agent Execution Policy",
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textPrimary,
            )

            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PermissionToggleCard(
                    title = "Terminal Execution",
                    subtitle = "Allows MOBOT to run shell commands, scripts, and build tasks.",
                    checked = terminal,
                    onCheckedChange = onTerminalChange,
                )
                PermissionToggleCard(
                    title = "Workspace Filesystem",
                    subtitle = "Allows MOBOT to read, create, and modify code files in your workspace.",
                    checked = filesystem,
                    onCheckedChange = onFilesystemChange,
                )
                PermissionToggleCard(
                    title = "Web Browser & Search",
                    subtitle = "Allows MOBOT to browse websites, search Google, and inspect live URLs.",
                    checked = browser,
                    onCheckedChange = onBrowserChange,
                )
                PermissionToggleCard(
                    title = "Autonomous Execution",
                    subtitle = "Execute safe tools automatically without stopping for approval prompts.",
                    checked = autonomous,
                    onCheckedChange = onAutonomousChange,
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = onContinue,
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = AppTheme.colors.accent,
                contentColor = AppTheme.colors.onAccent,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            Text(
                text = "Continue",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun DevicePermissionRow(title: String, subtitle: String, granted: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(
                text = title,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textPrimary,
            )
            Text(
                text = subtitle,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                color = AppTheme.colors.textSecondary,
            )
        }
        Box(
            modifier = Modifier
                .clip(CircleShape)
                .background(if (granted) AppTheme.colors.positive.copy(alpha = 0.12f) else AppTheme.colors.surfaceRaised)
                .padding(horizontal = 9.dp, vertical = 4.dp),
        ) {
            Text(
                text = if (granted) "Granted" else "Needed",
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                color = if (granted) AppTheme.colors.positive else AppTheme.colors.textTertiary,
            )
        }
    }
}

@Composable
private fun PermissionToggleCard(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(AppTheme.colors.surface)
            .border(1.dp, AppTheme.colors.border.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
            .clickable { onCheckedChange(!checked) }
            .padding(14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(
                text = title,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textPrimary,
            )
            Text(
                text = subtitle,
                fontSize = 12.5.sp,
                lineHeight = 17.sp,
                color = AppTheme.colors.textSecondary,
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = AppTheme.colors.onAccent,
                checkedTrackColor = AppTheme.colors.accent,
            ),
        )
    }
}

/**
 * Step 6: USEFUL SERVICES
 * Directly prompts user to configure their Composio API key, enabling 100+ connected apps and tools.
 */
@Composable
private fun ServicesBeat(
    session: Session,
    onContinue: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var composioKey by rememberSaveable { mutableStateOf("") }
    var keySurface by rememberSaveable { mutableStateOf("connect") } // "connect" or "platform"
    var savingKey by remember { mutableStateOf(false) }
    var saveSuccess by remember { mutableStateOf(false) }
    var saveError by remember { mutableStateOf<String?>(null) }
    var isConfigured by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val config = session.configStatus()
        if (config?.composio?.configured == true) {
            isConfigured = true
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 20.dp),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "Useful Services",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = AppTheme.colors.textPrimary,
            )
            Text(
                text = "Connect Composio so MOBOT can seamlessly interact with your tools, accounts, and external APIs.",
                fontSize = 15.sp,
                lineHeight = 22.sp,
                color = AppTheme.colors.textSecondary,
            )

            // Educational card explaining the proactive enablement philosophy
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(AppTheme.colors.surfaceVariant)
                    .padding(14.dp),
            ) {
                Text(
                    text = "When a task needs an app that isn't connected yet (such as Google Maps, GitHub, or Gmail), MOBOT will automatically guide you toward connecting it instead of giving up.",
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    color = AppTheme.colors.textSecondary,
                )
            }

            Spacer(Modifier.height(4.dp))

            // Composio Key Configuration Card
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(AppTheme.colors.surface)
                    .border(1.dp, AppTheme.colors.border.copy(alpha = 0.5f), RoundedCornerShape(18.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Composio Integration",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = AppTheme.colors.textPrimary,
                    )
                    if (isConfigured || saveSuccess) {
                        Box(
                            modifier = Modifier
                                .clip(CircleShape)
                                .background(AppTheme.colors.positive.copy(alpha = 0.12f))
                                .padding(horizontal = 10.dp, vertical = 4.dp),
                        ) {
                            Text(
                                text = "Configured",
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.Medium,
                                color = AppTheme.colors.positive,
                            )
                        }
                    }
                }

                Text(
                    text = "Select your key type and enter your Composio key to connect Google Maps, Gmail, GitHub, Slack, and 100+ services.",
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    color = AppTheme.colors.textSecondary,
                )

                // Surface selector
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    listOf(
                        "connect" to "Connect (ck_...)",
                        "platform" to "Platform (ak_...)",
                    ).forEach { (surf, label) ->
                        val isSelected = keySurface == surf
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = if (isSelected) AppTheme.colors.surfaceRaised else AppTheme.colors.surface,
                            border = BorderStroke(
                                width = if (isSelected) 2.dp else 1.dp,
                                color = if (isSelected) AppTheme.colors.accent else AppTheme.colors.border.copy(alpha = 0.5f),
                            ),
                            modifier = Modifier
                                .weight(1f)
                                .height(40.dp)
                                .clickable {
                                    keySurface = surf
                                    saveError = null
                                },
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    text = label,
                                    fontSize = 12.5.sp,
                                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                    color = if (isSelected) AppTheme.colors.textPrimary else AppTheme.colors.textSecondary,
                                )
                            }
                        }
                    }
                }

                AppTextField(
                    value = composioKey,
                    onValueChange = {
                        composioKey = it
                        saveError = null
                    },
                    label = if (keySurface == "connect") "Consumer Key (ck_...)" else "Project API Key (ak_...)",
                    placeholder = if (keySurface == "connect") "ck_live_..." else "ak_live_...",
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )

                if (saveError != null) {
                    Text(
                        text = saveError ?: "",
                        fontSize = 12.sp,
                        color = AppTheme.colors.danger,
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(
                        onClick = {
                            runCatching {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://dashboard.composio.dev")))
                            }
                        },
                    ) {
                        Text(
                            text = "Get key at composio.dev",
                            fontSize = 12.sp,
                            color = AppTheme.colors.accent,
                        )
                    }

                    Button(
                        onClick = {
                            scope.launch {
                                savingKey = true
                                saveError = null
                                val result = session.saveComposioKey(composioKey.trim(), keySurface)
                                savingKey = false
                                if (result != null && result.composio?.configured == true) {
                                    saveSuccess = true
                                    isConfigured = true
                                } else if (result != null) {
                                    saveSuccess = true
                                    isConfigured = false
                                } else {
                                    saveError = session.actionError ?: "Failed to save Composio key"
                                }
                            }
                        },
                        enabled = !savingKey && composioKey.trim().isNotBlank(),
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = AppTheme.colors.accent,
                            contentColor = AppTheme.colors.onAccent,
                        ),
                        modifier = Modifier.height(38.dp),
                    ) {
                        if (savingKey) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = AppTheme.colors.onAccent)
                        } else {
                            Text(text = if (saveSuccess) "Saved" else "Save Key", fontSize = 13.sp)
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = onContinue,
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = AppTheme.colors.accent,
                contentColor = AppTheme.colors.onAccent,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            Text(
                text = "Continue",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }

        Spacer(Modifier.height(8.dp))

        TextButton(
            onClick = onContinue,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = "Skip for Now",
                fontSize = 14.sp,
                color = AppTheme.colors.textSecondary,
            )
        }
    }
}

/**
 * Step 7: FIRST BOT
 * Customizing first bot's name, persona, role, and mascot identity.
 */
@Composable
private fun FirstBotBeat(
    botName: String,
    botRole: String,
    botColor: String,
    botMascot: String,
    selectedInstanceId: String,
    selectedModelId: String,
    instances: List<Instance>,
    creating: Boolean,
    errorMessage: String? = null,
    onNameChange: (String) -> Unit,
    onRoleChange: (String) -> Unit,
    onColorChange: (String) -> Unit,
    onMascotChange: (String) -> Unit,
    suggestedRoles: List<String> = emptyList(),
    onCreate: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 20.dp),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "Your First Agent",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = AppTheme.colors.textPrimary,
            )
            Text(
                text = "Configure your primary AI teammate's persona, role, and mascot identity.",
                fontSize = 15.sp,
                lineHeight = 22.sp,
                color = AppTheme.colors.textSecondary,
            )

            // Dynamic Animated Mascot Preview
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .size(112.dp)
                        .clip(RoundedCornerShape(28.dp))
                        .background(Color(MausPalette.argb(botColor)).copy(alpha = 0.12f))
                        .border(2.dp, Color(MausPalette.argb(botColor)).copy(alpha = 0.35f), RoundedCornerShape(28.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    MausAvatar(
                        color = botColor,
                        bodyId = botMascot,
                        size = 80.dp,
                        state = MausState.IDLE,
                        animated = false,
                    )
                }
            }

            // Mascot Shape picker
            Text(
                text = "Mascot Shape",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textSecondary,
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                val mascotShapes = listOf(
                    "cursor" to "Classic",
                    "blob" to "Blob",
                    "star" to "Star",
                    "circle" to "Circle",
                    "squircle" to "Squircle",
                    "shield" to "Shield",
                )
                mascotShapes.forEach { (bodyId, label) ->
                    val isSelected = bodyId == botMascot
                    Surface(
                        modifier = Modifier
                            .clip(RoundedCornerShape(14.dp))
                            .clickable { onMascotChange(bodyId) },
                        color = if (isSelected) Color(MausPalette.argb(botColor)).copy(alpha = 0.18f) else AppTheme.colors.surface,
                        shape = RoundedCornerShape(14.dp),
                        border = androidx.compose.foundation.BorderStroke(
                            width = if (isSelected) 2.dp else 1.dp,
                            color = if (isSelected) Color(MausPalette.argb(botColor)) else AppTheme.colors.border.copy(alpha = 0.5f),
                        ),
                    ) {
                        Column(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            MausAvatar(
                                color = botColor,
                                bodyId = bodyId,
                                size = 36.dp,
                                state = MausState.IDLE,
                                animated = false,
                            )
                            Text(
                                text = label,
                                fontSize = 11.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                color = if (isSelected) AppTheme.colors.textPrimary else AppTheme.colors.textSecondary,
                            )
                        }
                    }
                }
            }

            // Mascot Color picker
            Text(
                text = "Mascot Color",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = AppTheme.colors.textSecondary,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
            ) {
                val colors = listOf("green", "blue", "purple", "cyan", "orange", "pink", "yellow", "teal")
                colors.forEach { colorName ->
                    val isSelected = colorName == botColor
                    val argb = MausPalette.argb(colorName)
                    Box(
                        modifier = Modifier
                            .padding(horizontal = 5.dp)
                            .size(if (isSelected) 32.dp else 26.dp)
                            .clip(CircleShape)
                            .background(Color(argb))
                            .border(
                                width = if (isSelected) 2.5.dp else 0.dp,
                                color = AppTheme.colors.textPrimary,
                                shape = CircleShape,
                            )
                            .clickable { onColorChange(colorName) },
                    )
                }
            }

            Spacer(Modifier.height(4.dp))

            AppTextField(
                value = botName,
                onValueChange = onNameChange,
                label = "Agent Name",
                placeholder = "Togepi",
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            AppTextField(
                value = botRole,
                onValueChange = onRoleChange,
                label = "Specialty / Role",
                placeholder = "Joke Teller",
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            if (suggestedRoles.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    suggestedRoles.forEach { roleOption ->
                        val isSelected = roleOption == botRole
                        Surface(
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { onRoleChange(roleOption) },
                            color = if (isSelected) Color(MausPalette.argb(botColor)).copy(alpha = 0.18f) else AppTheme.colors.surface,
                            shape = RoundedCornerShape(12.dp),
                            border = androidx.compose.foundation.BorderStroke(
                                width = if (isSelected) 1.5.dp else 1.dp,
                                color = if (isSelected) Color(MausPalette.argb(botColor)) else AppTheme.colors.border.copy(alpha = 0.4f),
                            ),
                        ) {
                            Text(
                                text = roleOption,
                                fontSize = 12.sp,
                                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (isSelected) AppTheme.colors.textPrimary else AppTheme.colors.textSecondary,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            )
                        }
                    }
                }
            }
        }

        if (errorMessage != null) {
            Text(
                text = errorMessage,
                fontSize = 13.sp,
                color = AppTheme.colors.destructive,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
            )
        } else {
            Spacer(Modifier.height(16.dp))
        }

        Button(
            onClick = onCreate,
            enabled = !creating && botName.isNotBlank(),
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = AppTheme.colors.accent,
                contentColor = AppTheme.colors.onAccent,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            if (creating) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = AppTheme.colors.onAccent)
            } else {
                Text(
                    text = if (errorMessage != null) "Retry Agent Creation" else "Create Agent & Continue",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

/**
 * Step 8: READY
 * Polish summary card, recap of what was prepared, and launching the first turn.
 */
@Composable
private fun ReadyBeat(
    userName: String,
    botName: String,
    botRole: String,
    botColor: String,
    botMascot: String,
    onStartChat: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(Modifier.height(16.dp))

            // Dynamic Animated Mascot in Active Happy Pose
            Box(
                modifier = Modifier
                    .size(112.dp)
                    .clip(RoundedCornerShape(28.dp))
                    .background(Color(MausPalette.argb(botColor)).copy(alpha = 0.12f))
                    .border(2.dp, Color(MausPalette.argb(botColor)).copy(alpha = 0.35f), RoundedCornerShape(28.dp)),
                contentAlignment = Alignment.Center,
            ) {
                MausAvatar(
                    color = botColor,
                    bodyId = botMascot,
                    size = 80.dp,
                    state = MausState.HAPPY,
                    animated = false,
                )
            }

            Text(
                text = "You're all set!",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = AppTheme.colors.textPrimary,
                textAlign = TextAlign.Center,
            )

            Text(
                text = "MOBOT is configured and ready to collaborate with you.",
                fontSize = 15.sp,
                color = AppTheme.colors.textSecondary,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(8.dp))

            // Configuration Recap Card
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(AppTheme.colors.surface)
                    .border(1.dp, AppTheme.colors.border.copy(alpha = 0.5f), RoundedCornerShape(18.dp))
                    .padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Teammate", fontSize = 13.5.sp, color = AppTheme.colors.textSecondary)
                    Text("$botName ($botRole)", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.textPrimary)
                }
                HorizontalDivider(color = AppTheme.colors.border.copy(alpha = 0.3f))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Mascot", fontSize = 13.5.sp, color = AppTheme.colors.textSecondary)
                    Text("${botMascot.replaceFirstChar { it.uppercase() }} ($botColor)", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.textPrimary)
                }
                HorizontalDivider(color = AppTheme.colors.border.copy(alpha = 0.3f))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Collaborator", fontSize = 13.5.sp, color = AppTheme.colors.textSecondary)
                    Text(userName, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.textPrimary)
                }
                HorizontalDivider(color = AppTheme.colors.border.copy(alpha = 0.3f))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Security", fontSize = 13.5.sp, color = AppTheme.colors.textSecondary)
                    Text("Device Boundaries Enforced", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.positive)
                }
                HorizontalDivider(color = AppTheme.colors.border.copy(alpha = 0.3f))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Environment", fontSize = 13.5.sp, color = AppTheme.colors.textSecondary)
                    Text("Android Standalone", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = AppTheme.colors.textPrimary)
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = onStartChat,
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = AppTheme.colors.accent,
                contentColor = AppTheme.colors.onAccent,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            Text(
                text = "Start First Chat",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/** Provider API key editing dialog matching Settings system. */
@Composable
private fun OnboardingKeyDialog(
    instance: Instance,
    session: Session,
    onSaved: () -> Unit,
    onDismiss: () -> Unit,
) {
    var key by remember { mutableStateOf("") }
    var url by remember { mutableStateOf(if (instance.instanceId == "openaiCompat") "https://api.openai.com/v1" else "") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Configure ${ModelProvidersRules.displayName(instance)}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (instance.instanceId == "openaiCompat") {
                    AppTextField(
                        value = url,
                        onValueChange = { url = it },
                        label = "Base URL",
                        singleLine = true,
                    )
                }
                AppTextField(
                    value = key,
                    onValueChange = { key = it },
                    label = "API Key",
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
                error?.let {
                    Text(text = it, fontSize = 12.sp, color = AppTheme.colors.danger)
                }
                Text(
                    text = "Keys are securely stored on your local device host.",
                    fontSize = 12.sp,
                    color = AppTheme.colors.textTertiary,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    saving = true
                    scope.launch {
                        val saved = session.saveProviderKey(
                            instance.instanceId,
                            url.trim().ifEmpty { null },
                            key.trim().ifEmpty { null },
                        )
                        if (saved != null) {
                            session.testProviderModels(instance.instanceId)
                            onSaved()
                        } else {
                            error = "Could not save credentials. Verify network or host status."
                        }
                        saving = false
                    }
                },
                enabled = !saving && key.isNotBlank(),
            ) {
                if (saving) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                } else {
                    Text("Save & Verify")
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !saving) {
                Text("Cancel")
            }
        },
    )
}

/** Account authentication dialog for Codex and OAuth providers. */
@Composable
private fun OnboardingAuthDialog(
    instance: Instance,
    session: Session,
    onDone: () -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var phase by remember { mutableStateOf<InstanceAuthUi?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var completing by remember { mutableStateOf(false) }
    val context = LocalContext.current

    LaunchedEffect(instance.instanceId) {
        val started = session.startInstanceAuth(instance.instanceId)
        if (started == null) {
            error = session.actionError ?: "The sign-in could not be started."
            return@LaunchedEffect
        }
        if (started.phase == "succeeded") {
            onDone()
            return@LaunchedEffect
        }
        val method = instance.authentication?.method ?: "browser"
        phase = InstanceAuthUi(started.phase, started.flowId, started.authorizationUrl, started.userCode, null, method)
        val url = started.authorizationUrl
        if (method == "browser" && started.userCode == null && url != null) {
            runCatching { openBrowser(context, url) }
        }
        val flowId = started.flowId ?: return@LaunchedEffect
        while (true) {
            delay(1_000)
            val status = session.instanceAuthStatus(instance.instanceId, flowId)
            if (status != null) {
                phase = InstanceAuthUi(status.phase, flowId, status.authorizationUrl, status.userCode, status.message, method)
                if (status.succeeded) {
                    try {
                        val returnIntent = Intent(context, MainActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        }
                        context.startActivity(returnIntent)
                    } catch (_: Exception) {}
                    delay(300)
                    onDone()
                    break
                }
                if (status.dead) break
            }
        }
    }

    LaunchedEffect(phase?.phase) {
        if (phase?.phase == "succeeded") {
            onDone()
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Sign In to ${ModelProvidersRules.displayName(instance)}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val current = phase
                when {
                    error != null -> Text(text = error ?: "", color = AppTheme.colors.danger)
                    current == null -> {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                            Text("Starting sign-in…", fontSize = 14.sp)
                        }
                    }
                    current.phase == "succeeded" -> Text("Signed in successfully.")
                    current.userCode != null -> {
                        Text("Enter this code at the provider page:")
                        Text(
                            text = current.userCode,
                            fontSize = 20.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    else -> Text(current.message ?: "Waiting for authentication in browser…", fontSize = 14.sp)
                }
            }
        },
        confirmButton = {
            val current = phase
            if (current?.phase == "succeeded") {
                TextButton(onClick = onDone) { Text("Done") }
            } else if (current?.method == "paste-code" && current.waiting) {
                TextButton(
                    onClick = {
                        completing = true
                        scope.launch {
                            val flowId = current.flowId
                            if (flowId != null) {
                                val ok = session.completeInstanceAuth(instance.instanceId, flowId, code.trim())
                                if (ok) {
                                    onDone()
                                }
                            }
                            completing = false
                        }
                    },
                    enabled = !completing && code.isNotBlank(),
                ) { Text("Submit") }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
