package com.openmausbot.companion.core

import java.net.URI
import java.util.Base64
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** The one JSON configuration used for every sidecar payload. */
val CompanionJson = Json {
    ignoreUnknownKeys = true
}

@Serializable
data class SkillRequestCardData(
    val version: Int,
    val requestId: String,
    val botId: String,
    val threadId: String,
    val stagedId: String,
    val action: String,
    val name: String,
    val gist: String,
    /** Optional so approval cards persisted by older desktop builds still decode. */
    val source: String? = null,
    /** The exact, secret-scrubbed instructions the approval enables. */
    val preview: String? = null,
    val sha256: String? = null,
    val warnings: List<String> = emptyList(),
    val createdAt: Long,
) {
    /**
     * A current client echoes this hash only after it can show the complete proposal. Legacy or
     * malformed cards remain visible but deny-only.
     */
    val reviewedSha256: String?
        get() = sha256?.takeIf { hash ->
            !preview.isNullOrEmpty() && hash.length == 64 && hash.all { character ->
                character in '0'..'9' || character in 'a'..'f' || character in 'A'..'F'
            }
        }
}

@Serializable
data class OptionCard(
    val title: String,
    val subtitle: String,
    val options: List<String>,
    val answered: String? = null,
    val dismissed: Boolean? = null,
    val requestId: String? = null,
    val tool: String? = null,
    val held: String? = null,
    val allowKey: String? = null,
    /** Learned skills require a complete, hash-bound review before approval. */
    val skillRequest: SkillRequestCardData? = null,
    /**
     * The model's own questions and options (Claude's `AskUserQuestion`).
     * Present only on a structured ask; every other card leaves it null.
     */
    val questionRequest: QuestionRequestCardData? = null,
    /**
     * What an answered question was answered WITH. `answered` only records the
     * behavior once the harness settles a live ask, so without this a settled
     * question card would read "answer" instead of the reply.
     */
    val answeredText: String? = null,
) {
    val isPending: Boolean get() = requestId != null && answered == null && dismissed != true
    val isPermission: Boolean get() = tool != null

    /**
     * A structured ask draws its own card: the model posed real questions with
     * real options, and a flat row of buttons cannot say which question a tap
     * answered.
     */
    val questions: List<AskQuestion> get() = questionRequest?.questions.orEmpty()

    fun responseBehavior(choice: String): String = responseBehavior(choice, isPermission)

    fun shouldRememberPermission(choice: String): Boolean =
        isPermission && allowKey != null && choice.trim().equals("Always allow", ignoreCase = true)

    companion object {
        fun responseBehavior(choice: String, isPermission: Boolean): String = when {
            !isPermission -> "answer"
            isRefusal(choice) -> "deny"
            else -> "allow"
        }

        fun isRefusal(choice: String): Boolean = choice.trim().lowercase() in
            setOf("deny", "cancel", "dismiss")
    }
}

@ConsistentCopyVisibility
data class NotificationTarget private constructor(
    val botId: String,
    val threadId: String,
) {
    fun requiresTaskSwitch(activeThreadId: String): Boolean = threadId != activeThreadId

    companion object {
        fun from(botId: String?, threadId: String?): NotificationTarget? {
            if (botId.isNullOrBlank() || threadId.isNullOrBlank()) return null
            return NotificationTarget(botId, threadId)
        }

        fun from(payload: Map<String, String>): NotificationTarget? =
            from(payload["botId"], payload["threadId"])
    }
}

@Serializable
data class ToolActivity(
    val name: String,
    val ok: Boolean? = null,
    val spoken: String? = null,
    val setup: Boolean? = null,
    val error: String? = null,
    val output: String? = null,
    val durationMs: Long? = null,
)

/**
 * The thread an activity chip opened — "Opened thread #Title on Scout" — so
 * the phone can go there. Newer computers only; a chip without one is just a
 * receipt.
 */
@Serializable
data class ThreadRef(
    val botId: String,
    val threadId: String,
    val title: String,
)

@Serializable
data class Sender(
    val botId: String,
    val name: String,
    val color: String,
)

@Serializable
data class Reaction(val emoji: String, val by: String)

@Serializable
data class CommChip(
    val groupId: String,
    val withBotId: String,
    val withName: String,
    val withColor: String,
)

/**
 * A turn that failed, as the harness wrote it — what went wrong, which engine
 * and model it happened to, and what to do about it.
 *
 * Every string here is the harness's own. The provider's report — an HTTP
 * status and often its JSON body — is diagnostics, and the computer keeps it
 * in its log instead of sending it; a phone cannot render `upstream HTTP 429:
 * {"error":…}` as anything a person should read. [kind] is what the actions
 * key off, so a client decides nothing from the copy.
 */
@Serializable
data class FailureCard(
    val kind: String,
    val title: String,
    val detail: String,
    val advice: String,
    /** The status the provider answered with, when the failure was one. */
    val status: Int? = null,
    /** The engine that failed, so its settings row can be found by id. */
    val instanceId: String? = null,
    val provider: String? = null,
    val model: String? = null,
    /** Automatic attempts the turn made before giving up. */
    val attempts: Int? = null,
)

@Serializable
data class Message(
    val id: String,
    val role: Role,
    val kind: Kind,
    val at: Double,
    val text: String? = null,
    val card: OptionCard? = null,
    /**
     * Set on the activity row a failed turn leaves behind. Absent on an
     * ordinary tool receipt, and absent on a computer too old to classify
     * failures — in which case the row is the quiet chip it always was.
     */
    val failure: FailureCard? = null,
    /**
     * An app the bot needs connected before it can continue. Cards are live:
     * the harness patches the same message in place as authorization
     * progresses, so a client renders whatever this field says right now.
     */
    val connector: ConnectorRequestCard? = null,
    val tool: ToolActivity? = null,
    val threadRef: ThreadRef? = null,
    val parentId: String? = null,
    val from: Sender? = null,
    val reactions: List<Reaction>? = null,
    val comm: CommChip? = null,
    val hasImage: Boolean? = null,
    val png: String? = null,
    val mime: String? = null,
    /**
     * A user line the engine took INTO the turn that was already running,
     * rather than one that started a turn of its own.
     */
    val steered: Boolean? = null,
    /**
     * The steer-queue entry this user line drained from. It is how a client
     * showing the held message knows which row to retire when the real line
     * finally lands.
     */
    val queueId: String? = null,
    /**
     * Files the computer attached to this reply — currently pictures the bot
     * fetched from the internet, published as app-owned attachments and
     * fetched back through the session. Absent on older computers.
     */
    val attachments: List<MessageAttachment>? = null,
    /**
     * Native structured response payload carrying versioned components (Phase J).
     */
    val structured: StructuredResponseData? = null,
) {
    @Serializable(with = MessageKindSerializer::class)
    enum class Kind { TEXT, OPTIONS, ACTIVITY, SCREEN, CONNECTOR, STRUCTURED, UNKNOWN }

    @Serializable(with = MessageRoleSerializer::class)
    enum class Role { BOT, USER }
}

object MessageKindSerializer : KSerializer<Message.Kind> {
    override val descriptor = PrimitiveSerialDescriptor("Message.Kind", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): Message.Kind = when (decoder.decodeString()) {
        "text" -> Message.Kind.TEXT
        "options" -> Message.Kind.OPTIONS
        "activity" -> Message.Kind.ACTIVITY
        "screen" -> Message.Kind.SCREEN
        "connector" -> Message.Kind.CONNECTOR
        "structured" -> Message.Kind.STRUCTURED
        else -> Message.Kind.UNKNOWN
    }

    override fun serialize(encoder: Encoder, value: Message.Kind) {
        encoder.encodeString(value.name.lowercase())
    }
}

object MessageRoleSerializer : KSerializer<Message.Role> {
    override val descriptor = PrimitiveSerialDescriptor("Message.Role", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): Message.Role = when (decoder.decodeString()) {
        "user" -> Message.Role.USER
        else -> Message.Role.BOT
    }

    override fun serialize(encoder: Encoder, value: Message.Role) {
        encoder.encodeString(value.name.lowercase())
    }
}

@Serializable
data class ModelSelection(
    val instanceId: String,
    val model: String,
    /**
     * Optional reasoning effort passed through to engines that support it.
     * Older computers omit this field, which means the engine default — and a
     * null here is *omitted* on the wire, never sent as `null`, so an old
     * server's validator does not see a field it does not know.
     */
    val effort: String? = null,
)

/**
 * The bot that opened a thread, on itself or on a teammate. Absent — which is
 * every thread from an older computer — means the person opened it.
 */
@Serializable
data class ThreadOpener(
    val botId: String,
    val name: String,
    val delegationId: String? = null,
    val at: Double,
)

/**
 * The bot that closed a thread with close_thread, once its result was read.
 * Absent means the thread is open; the computer clears it the moment a new
 * turn starts there, so a reopened thread simply loses the stamp.
 */
@Serializable
data class ThreadCloser(
    val botId: String,
    val name: String,
    val at: Double,
)

/** A folder within one bot, in the order saved on the computer. */
@Serializable
data class BotProject(val id: String, val name: String, val emoji: String? = null)

@Serializable
data class BotTask(
    val threadId: String,
    val title: String,
    val createdAt: Double,
    /** When this thread last received a message, from the harness's own
     * transcript. The thread list orders by it; absent on a harness from
     * before the field existed, and null on a thread with no messages yet. */
    val lastMessageAt: Double? = null,
    val modelSelection: ModelSelection? = null,
    val activity: String? = null,
    val busy: Boolean? = null,
    /** This thread's own turn is done and a dispatched teammate has not
     * settled yet (#1223): a wait, never work. Newer harnesses only. */
    val waitingOnTeammate: Boolean? = null,
    val unread: Boolean? = null,
    val approvalMode: String? = null,
    val autoApprove: Boolean? = null,
    val alwaysAllow: List<String>? = null,
    val projectId: String? = null,
    val openedBy: ThreadOpener? = null,
    val closedBy: ThreadCloser? = null,
    /** The person put this thread away. Present means archived — a stamp of
     * 0 is still archived, because the task API accepts any epoch number. */
    val archivedAt: Double? = null,
    /** Bot-only internal execution. Keep it addressable, but out of thread pickers. */
    val routineRunId: String? = null,
)

/** The thread list's quiet second line, worded as the desktop words it. */
val BotTask.openedByLabel: String?
    get() = openedBy?.let { "opened by ${it.name}" }

/** A bot closed this thread and nothing has happened there since. */
val BotTask.isClosed: Boolean
    get() = closedBy != null

/** Archived is the presence of the stamp, not its value: archivedAt 0 counts. */
val BotTask.isArchived: Boolean
    get() = archivedAt != null

/**
 * The one line under a title: who closed it once a bot has, otherwise who
 * opened it, otherwise nothing. Closed wins because it is the newer fact;
 * archived wins over the opener because it explains why the row sits where
 * it does.
 */
val BotTask.bylineLabel: String?
    get() = closedBy?.let { "closed by ${it.name}" } ?: if (isArchived) "Archived" else openedByLabel

@Serializable
data class Bot(
    val id: String,
    val threadId: String,
    val name: String,
    val title: String,
    val description: String,
    val notifications: Boolean,
    val color: String,
    val unread: Boolean,
    val modelSelection: ModelSelection,
    val createdAt: Double,
    val avatarUrl: String? = null,
    val avatarCrop: AvatarCrop? = null,
    val busy: Boolean? = null,
    val activity: String? = null,
    /** A dispatched teammate has not settled; the bot waits, it does not work. */
    val waitingOnTeammate: Boolean? = null,
    val pinned: Boolean? = null,
    val hidden: Boolean? = null,
    /** Desktop sidebar section. Missing or blank means the built-in Bots area. */
    val section: String? = null,
    val chiefOfStaff: Boolean? = null,
    /** ask, auto, full, or custom; null when paired to an older harness. */
    val approvalMode: String? = null,
    val autoApprove: Boolean? = null,
    val alwaysAllow: List<String>? = null,
    val computer: String? = null,
    val cloudBackend: String? = null,
    /** Per-bot MCP selection: null = every enabled server; [] = none.
     * Absent means the harness is too old to carry the field. */
    val mcpServers: List<String>? = null,
    /**
     * Whether this bot may use the workspace's connected apps. The server's
     * own gate is `bot.composio !== false`, so absent and true mean the same
     * thing; only an explicit false closes the door. Read it through
     * [isConnectedAppsAllowed] rather than comparing the raw field.
     */
    val composio: Boolean? = null,
    val speakReplies: Boolean? = null,
    val voice: String? = null,
    val mascotExpression: String? = null,
    /**
     * Which body from the mascot body catalog this bot wears. Absent (an older
     * harness included) means the shipped `cursor` silhouette.
     */
    val mascotBody: String? = null,
    val tasks: List<BotTask>? = null,
    val messages: List<Message>? = null,
    val activeLeafId: String? = null,
    val hasMore: Boolean? = null,
    val projects: List<BotProject>? = null,
    val contract: AgentContractWire? = null,
)

@Serializable
data class AgentContractWire(
    val contractVersion: Int = 1,
    val role: String,
    val roleTitle: String,
    val identity: AgentIdentityWire? = null,
    val cognitiveStance: CognitiveStanceWire? = null,
    val toolAffinity: ToolAffinityWire? = null,
    val verificationPolicy: VerificationPolicyWire? = null,
    val contextSensitivity: ContextSensitivityWire? = null,
    val autonomyPolicy: AutonomyPolicyWire? = null,
    val outputDelivery: OutputDeliveryWire? = null,
)

@Serializable
data class AgentIdentityWire(
    val name: String? = null,
    val purpose: String? = null,
    val coreMission: String? = null,
    val behavioralStance: String? = null,
)

@Serializable
data class CognitiveStanceWire(
    val reasoningDepth: String? = null,
    val creativityBias: String? = null,
    val skepticismLevel: String? = null,
    val actionOrientation: String? = null,
)

@Serializable
data class ToolAffinityWire(
    val preferredCategories: List<String> = emptyList(),
    val discouragedCategories: List<String> = emptyList(),
    val autoExecutionConfidenceThreshold: Double = 0.8,
)

@Serializable
data class VerificationPolicyWire(
    val preExecutionCheck: Boolean = false,
    val empiricalVerificationRequired: Boolean = false,
    val rigorLevel: String = "standard",
    val artifactValidation: Boolean = false,
)

@Serializable
data class ContextSensitivityWire(
    val deviceStateSensitivity: String = "medium",
    val locationSensitivity: String = "medium",
    val temporalSensitivity: String = "medium",
    val memorySensitivity: String = "medium",
    val goalAlignmentSensitivity: String = "medium",
)

@Serializable
data class AutonomyPolicyWire(
    val initiativeLevel: String = "balanced",
    val userCheckpointPreference: String = "standard",
    val allowDelegation: Boolean = true,
    val maxAutonomousHorizon: String = "multi_turn",
)

@Serializable
data class OutputDeliveryWire(
    val defaultVerbosity: String = "concise",
    val preferredFormat: String = "structured_cards",
    val toneProfile: String = "",
)

/** Project only task-local controls; the original fleet record stays profile-global. */
fun Bot.forTask(requestedThreadId: String): Bot? {
    val task = tasks?.firstOrNull { it.threadId == requestedThreadId }
    if (task == null) return takeIf { threadId == requestedThreadId }
    val selected = threadId == requestedThreadId
    return copy(
        threadId = requestedThreadId,
        modelSelection = task.modelSelection ?: modelSelection,
        busy = task.busy ?: if (selected) busy else false,
        activity = task.activity ?: if (selected) activity else null,
        waitingOnTeammate = task.waitingOnTeammate ?: if (selected) waitingOnTeammate else null,
        unread = task.unread ?: if (selected) unread else false,
        approvalMode = task.approvalMode ?: task.autoApprove?.let { if (it) "auto" else "ask" } ?: approvalMode,
        autoApprove = task.autoApprove ?: autoApprove,
        alwaysAllow = task.alwaysAllow ?: alwaysAllow,
        messages = if (selected) messages else null,
        activeLeafId = if (selected) activeLeafId else null,
        hasMore = if (selected) hasMore else null,
    )
}

@Serializable(with = AvatarCropSerializer::class)
enum class AvatarCrop { MASCOT, CIRCLE, ROUNDED, SQUARE }

object AvatarCropSerializer : KSerializer<AvatarCrop> {
    override val descriptor = PrimitiveSerialDescriptor("AvatarCrop", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): AvatarCrop {
        val raw = decoder.decodeString()
        return AvatarCrop.entries.firstOrNull { it.name.lowercase() == raw }
            ?: AvatarCrop.MASCOT
    }

    override fun serialize(encoder: Encoder, value: AvatarCrop) {
        encoder.encodeString(value.name.lowercase())
    }
}

@Serializable
data class GroupResponder(val kind: String, val botId: String? = null)

/** One file attached to a message by the computer: an image the bot pulled
 * from the internet, addressed as `/api/attachments/<name>`. */
@Serializable
data class MessageAttachment(
    val kind: String,
    val path: String,
    val mime: String? = null,
    val name: String? = null,
) {
    val isImage: Boolean get() = kind == "image"
}

/** What a bot's memory file costs against the load budget, and its hash so a
 * save can prove it edited what it read. */
@Serializable
data class MemoryCapacity(
    val lines: Int = 0,
    val bytes: Int = 0,
    val maxLines: Int = 0,
    val maxBytes: Int = 0,
    val loadedLines: Int = 0,
    val loadedBytes: Int = 0,
    val truncated: Boolean = false,
    val hash: String = "",
)

/** One topic or log file under a bot's memory folder. */
@Serializable
data class MemoryFileInfo(
    val path: String,
    val name: String,
    val bytes: Int = 0,
    val modifiedAt: Double = 0.0,
)

/** Everything a bot remembers: the always-loaded index plus its topic and log
 * files. `workspacePath` is where the plain markdown lives on the computer. */
@Serializable
data class MemoryOverview(
    val botId: String = "",
    val workspacePath: String = "",
    val index: MemoryCapacity = MemoryCapacity(),
    val topics: List<MemoryFileInfo> = emptyList(),
    val logs: List<MemoryFileInfo> = emptyList(),
    /** Whole-file text, when the endpoint sends it (the shared partition and
     * the one-release compatibility shape of the bot endpoint both do). */
    val text: String = "",
)

/** One memory document, with the hash a save must present. */
@Serializable
data class MemoryDoc(
    val path: String,
    val text: String = "",
    val hash: String = "",
    val exists: Boolean = false,
    val overview: MemoryOverview? = null,
)

/** Partitioned Memory snippet representation (Phase 6). */
@Serializable
data class PartitionedMemorySnippet(
    val path: String,
    val content: String,
)

/** Query for partitioned memory across shared and bot-specialized partitions (Phase 6). */
@Serializable
data class PartitionedMemoryQuery(
    val botId: String,
    val queryText: String = "",
    val includeShared: Boolean = true,
    val maxSharedSnippets: Int = 5,
    val maxSpecializedSnippets: Int = 5,
)

/** Formal result of partitioned memory query with explicit partition paths (Phase 6). */
@Serializable
data class PartitionedMemoryResult(
    val sharedSnippets: List<PartitionedMemorySnippet> = emptyList(),
    val specializedSnippets: List<PartitionedMemorySnippet> = emptyList(),
)

@Serializable
data class Room(
    val id: String,
    val threadId: String,
    val name: String,
    val memberIds: List<String>,
    val defaultResponder: GroupResponder,
    val bulletin: String,
    val unread: Boolean,
    val createdAt: Double,
    val dm: Boolean? = null,
    /** True while the room still owes its first-run setup; such a room
     * refuses its first message until a client finishes or skips it. */
    val setupPending: Boolean? = null,
    /** Desktop sidebar section. Missing or blank means the built-in Channels area. */
    val section: String? = null,
    val busyBotId: String? = null,
    /** Independent user conversations in this channel. DMs omit this field. */
    val tasks: List<BotTask>? = null,
    val messages: List<Message>? = null,
    val hasMore: Boolean? = null,
)

@Serializable(with = FleetSerializer::class)
data class Fleet(
    val bots: List<Bot>,
    val groups: List<Room>,
    /**
     * Held sends for every bot thread, the same snapshot the bot.queued
     * frames carry. Older computers omit it; a missing or unreadable field
     * reads as absent, never as an empty queue.
     */
    val botQueuedMessages: Map<String, List<QueuedSend>>? = null,
)

object FleetSerializer : KSerializer<Fleet> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("Fleet")

    override fun deserialize(decoder: Decoder): Fleet {
        val input = decoder as? JsonDecoder
            ?: throw SerializationException("Fleet can only be decoded from JSON")
        val objectValue = input.decodeJsonElement().jsonObject

        fun <T> lossyArray(name: String, decode: (kotlinx.serialization.json.JsonElement) -> T): List<T> {
            val element = objectValue[name] ?: return emptyList()
            if (element is JsonNull) return emptyList()
            val array = element as? JsonArray
                ?: throw SerializationException("Fleet.$name must be an array")
            return array.mapNotNull { runCatching { decode(it) }.getOrNull() }
        }

        return Fleet(
            bots = lossyArray("bots") { input.json.decodeFromJsonElement(Bot.serializer(), it) },
            groups = lossyArray("groups") { input.json.decodeFromJsonElement(Room.serializer(), it) },
            // One malformed entry must not cost the whole fleet: the roster
            // is worth more than the queue note beside it.
            botQueuedMessages = runCatching {
                objectValue["botQueuedMessages"]?.jsonObject?.mapValues { (_, entries) ->
                    entries.jsonArray.mapNotNull { element ->
                        runCatching { element.jsonObject.queuedSendOrNull() }.getOrNull()
                    }
                }
            }.getOrNull(),
        )
    }

    override fun serialize(encoder: Encoder, value: Fleet) {
        val output = encoder as? JsonEncoder
            ?: throw SerializationException("Fleet can only be encoded as JSON")
        output.encodeJsonElement(buildJsonObject {
            put("bots", JsonArray(value.bots.map { output.json.encodeToJsonElement(Bot.serializer(), it) }))
            put("groups", JsonArray(value.groups.map { output.json.encodeToJsonElement(Room.serializer(), it) }))
            value.botQueuedMessages?.let { queues ->
                put("botQueuedMessages", buildJsonObject {
                    queues.forEach { (threadId, sends) ->
                        put(threadId, JsonArray(sends.map { it.toJsonObject() }))
                    }
                })
            }
        })
    }
}

@Serializable
data class ThreadPage(val messages: List<Message>, val hasMore: Boolean? = null, val activeLeafId: String? = null)

@Serializable
data class SearchHit(
    val threadId: String,
    val messageId: String,
    val at: Double,
    val role: Message.Role,
    val kind: Message.Kind,
    val snippet: String,
    val matchStart: Int,
    val matchLength: Int,
    val botId: String? = null,
    val groupId: String? = null,
    val name: String,
    val task: String? = null,
    val onActivePath: Boolean,
) {
    val id: String get() = "$threadId:$messageId"
}

data class TranscriptExport(val data: ByteArray, val filename: String, val contentType: String)

@Serializable
data class PairedDevice(
    val id: String,
    val name: String,
    val createdAt: Double,
    val lastSeenAt: Double,
)

@Serializable(with = PairResponseSerializer::class)
data class PairResponse(
    val token: String,
    val device: PairedDevice,
    val serverName: String,
    val hosts: List<String>? = null,
    val endpoints: List<CompanionEndpoint>? = null,
)

/**
 * Pairing has already minted the durable token by the time this body arrives. Endpoint metadata
 * is therefore lossy per element: a future kind or malformed advisory route cannot discard the
 * usable token and legacy host fields beside it.
 */
object PairResponseSerializer : KSerializer<PairResponse> {
    override val descriptor: SerialDescriptor = JsonObject.serializer().descriptor

    override fun deserialize(decoder: Decoder): PairResponse {
        val input = decoder as? JsonDecoder
            ?: throw SerializationException("PairResponse must be decoded from JSON")
        val value = input.decodeJsonElement() as? JsonObject
            ?: throw SerializationException("PairResponse must be a JSON object")
        val json = input.json
        val token = json.decodeFromJsonElement<String>(
            value["token"] ?: throw SerializationException("PairResponse.token is required"),
        )
        val device = json.decodeFromJsonElement<PairedDevice>(
            value["device"] ?: throw SerializationException("PairResponse.device is required"),
        )
        val serverName = json.decodeFromJsonElement<String>(
            value["serverName"] ?: throw SerializationException("PairResponse.serverName is required"),
        )
        val hosts = value["hosts"]?.takeUnless { it is JsonNull }?.let {
            json.decodeFromJsonElement<List<String>>(it)
        }
        val endpoints = when (val element = value["endpoints"]) {
            null -> null
            is JsonArray -> element.mapNotNull { candidate ->
                runCatching { json.decodeFromJsonElement<CompanionEndpoint>(candidate) }.getOrNull()
            }
            // The field is advisory and the token already exists. A malformed container is
            // discarded just like malformed entries, but is handled explicitly rather than
            // becoming an empty array through a nullable cast.
            else -> emptyList()
        }
        return PairResponse(token, device, serverName, hosts, endpoints)
    }

    override fun serialize(encoder: Encoder, value: PairResponse) {
        val output = encoder as? JsonEncoder
            ?: throw SerializationException("PairResponse must be encoded as JSON")
        output.encodeJsonElement(buildJsonObject {
            put("token", value.token)
            put("device", output.json.encodeToJsonElement(value.device))
            put("serverName", value.serverName)
            value.hosts?.let { put("hosts", output.json.encodeToJsonElement(it)) }
            value.endpoints?.let { put("endpoints", output.json.encodeToJsonElement(it)) }
        })
    }
}

/** Non-secret connection snapshot returned by GET /api/companion/endpoints. */
@Serializable(with = CompanionConnectionMetadataSerializer::class)
data class CompanionConnectionMetadata(
    val serverName: String,
    val hosts: List<String>? = null,
    val endpoints: List<CompanionEndpoint>,
)

/**
 * Refresh metadata also drops malformed individual routes, but unlike PairResponse it is a
 * replacement snapshot. With no usable route the whole response is rejected so callers retain
 * their last known-good connection.
 */
object CompanionConnectionMetadataSerializer : KSerializer<CompanionConnectionMetadata> {
    override val descriptor: SerialDescriptor = JsonObject.serializer().descriptor

    override fun deserialize(decoder: Decoder): CompanionConnectionMetadata {
        val input = decoder as? JsonDecoder
            ?: throw SerializationException("Companion connection metadata must be JSON")
        val value = input.decodeJsonElement() as? JsonObject
            ?: throw SerializationException("Companion connection metadata must be a JSON object")
        val json = input.json
        val serverName = json.decodeFromJsonElement<String>(
            value["serverName"]
                ?: throw SerializationException("Companion connection metadata needs serverName"),
        )
        val hosts = value["hosts"]?.takeUnless { it is JsonNull }?.let {
            json.decodeFromJsonElement<List<String>>(it)
        }
        val decoded = (value["endpoints"] as? JsonArray).orEmpty().mapNotNull { element ->
            runCatching { json.decodeFromJsonElement<CompanionEndpoint>(element) }.getOrNull()
        }
        val endpoints = decoded.withIndex()
            .sortedWith(compareBy<IndexedValue<CompanionEndpoint>> { it.value.priority }.thenBy { it.index })
            .map { it.value }
            .distinctBy { it.url }
            .take(8)
        if (endpoints.isEmpty()) {
            throw SerializationException(
                "Companion endpoint metadata must contain at least one valid route.",
            )
        }
        return CompanionConnectionMetadata(serverName, hosts, endpoints)
    }

    override fun serialize(encoder: Encoder, value: CompanionConnectionMetadata) {
        val output = encoder as? JsonEncoder
            ?: throw SerializationException("Companion connection metadata must be JSON")
        output.encodeJsonElement(buildJsonObject {
            put("serverName", value.serverName)
            value.hosts?.let { put("hosts", output.json.encodeToJsonElement(it)) }
            put("endpoints", output.json.encodeToJsonElement(value.endpoints))
        })
    }
}

@Serializable(with = CloudDesktopSessionSerializer::class)
data class CloudDesktopSession(val url: URI)

object CloudDesktopSessionSerializer : KSerializer<CloudDesktopSession> {
    @Serializable
    private data class Wire(@SerialName("joinUrl") val joinUrl: String)

    override val descriptor: SerialDescriptor = Wire.serializer().descriptor

    override fun deserialize(decoder: Decoder): CloudDesktopSession {
        val raw = Wire.serializer().deserialize(decoder).joinUrl
        val parsed = runCatching { URI(raw) }.getOrNull()
        if (parsed == null || !parsed.scheme.equals("https", ignoreCase = true) || parsed.host.isNullOrEmpty()) {
            throw SerializationException("Cloud desktop URL must be HTTPS with a host")
        }
        return CloudDesktopSession(parsed)
    }

    override fun serialize(encoder: Encoder, value: CloudDesktopSession) {
        Wire.serializer().serialize(encoder, Wire(value.url.toASCIIString()))
    }
}

@Serializable
data class ProviderSnapshot(
    val state: String,
    val reason: String? = null,
    val authenticated: Boolean? = null,
    /** Vetted display identity from the provider, never credentials. */
    val account: ProviderAccount? = null,
    val version: String? = null,
) {
    val isAvailable: Boolean get() = state == "available"
}

/** Who the engine reports it is signed in as; display only. */
@Serializable
data class ProviderAccount(
    val email: String? = null,
    val organization: String? = null,
    val method: String? = null,
)

@Serializable
data class ProviderIconDto(
    val kind: String,
    val preset: String? = null,
    val dataUrl: String? = null,
)

@Serializable
data class ModelOption(
    val id: String,
    val label: String,
    val custom: Boolean? = null,
    val provider: String? = null,
    val contextWindow: Long? = null,
)

@Serializable
data class ModelCatalog(
    @SerialName("default") val defaultModel: String,
    val options: List<ModelOption>,
)

@Serializable
data class Instance(
    val instanceId: String,
    val driverKind: String,
    val displayName: String? = null,
    val snapshot: ProviderSnapshot,
    val models: ModelCatalog,
    /** Older computers omit capabilities; omission is intentionally not permission. */
    val capabilities: InstanceCapabilities? = null,
    /** How this engine is configured — "subscription" (a CLI sign-in) or
     * "custom" (custom configuration; see EngineAccess in the server's
     * contracts). Older computers omit it, which reads as the historical
     * default. Which custom engines are key-and-URL providers is a screen
     * decision (ModelProvidersRules), not a wire fact. */
    val access: String? = null,
    /** The account sign-in this engine offers, absent when it has none. */
    val authentication: InstanceAuthentication? = null,
    val icon: ProviderIconDto? = null,
    val docsUrl: String? = null,
    val isDefault: Boolean = false,
) {
    val id: String get() = instanceId

    /** Subscription engines authenticate by sign-in; the rest by a key in settings. */
    val isSubscription: Boolean get() = access != "apikey"
}

/** One engine's account sign-in, as the server describes it. */
@Serializable
data class InstanceAuthentication(
    /** "browser" | "device-code" | "paste-code" — how the sign-in completes. */
    val method: String,
    /** The stored sign-in can be removed to switch accounts. */
    val signOut: Boolean? = null,
    /** Whether the sign-in can run on this host WITHOUT the engine's runtime
     * installed. The Codex ChatGPT device flow is native (true); Claude's
     * sign-in is the CLI's own login and exists exactly while the runtime
     * does (false, with a reason). Absent reads as available, preserving
     * older hosts that only ever offered sign-in next to a working runtime. */
    val available: Boolean? = null,
    /** Why sign-in is not offered, in the server's own words. */
    val reason: String? = null,
)

/** A just-started account sign-in flow. */
@Serializable
data class InstanceAuthStart(
    val phase: String,
    val flowId: String? = null,
    val authorizationUrl: String? = null,
    val expiresAt: String? = null,
    val userCode: String? = null,
)

/** Where a sign-in flow stands; `message` is server-authored, safe copy. */
@Serializable
data class InstanceAuthStatus(
    val phase: String,
    val flowId: String? = null,
    val authorizationUrl: String? = null,
    val expiresAt: String? = null,
    val userCode: String? = null,
    val message: String? = null,
) {
    val succeeded: Boolean get() = phase == "succeeded"
    val waiting: Boolean get() = phase == "waiting"
    val dead: Boolean get() = phase == "failed" || phase == "expired" || phase == "cancelled"
}

/** The harness wraps sign-in responses in an `auth` envelope
 * (`json(res, 200, { auth })` in server/index.ts); reading the bare flow
 * object instead is exactly how the phone failed every sign-in with a
 * decode error before the flow could even start. */
@Serializable
data class AuthStartResponse(val auth: InstanceAuthStart)

@Serializable
data class AuthStatusResponse(val auth: InstanceAuthStatus)

/**
 * The small, phone-safe part of an engine's capabilities. Missing capabilities
 * or effort levels mean the engine offers no reasoning control.
 */
@Serializable
data class InstanceCapabilities(
    val images: Boolean? = null,
    val effortLevels: List<String>? = null,
    /**
     * The engine can take a message into a turn that is already running.
     * Engines without it hold mid-turn sends until the turn settles, which is
     * a different promise and deserves different words in the composer.
     */
    val queueing: Boolean? = null,
)

@Serializable
data class InstanceList(val instances: List<Instance>)

/**
 * Which engine actually speaks. `VoiceProvider` in `server/tts/index.ts`;
 * [wire] is the exact string the config write carries, and [fromWire] applies
 * the server's own fallback: a missing field — an older desktop that predates
 * the choice — and a provider this build has never heard of both mean
 * ElevenLabs, keeping an unrecognised engine from being explained with copy
 * written for a different one.
 */
enum class VoiceProvider(val wire: String) {
    ELEVENLABS("elevenlabs"),
    FISH("fish"),
    SYSTEM("system"),
    CHATTERBOX("chatterbox");

    companion object {
        fun fromWire(value: String?): VoiceProvider = entries.firstOrNull { it.wire == value } ?: ELEVENLABS
    }
}

@Serializable
data class ConfigFlag(
    val configured: Boolean,
    /**
     * How the host reaches the connected-apps service: "managed" (the
     * packaged app's own service), "self-hosted" (a project API key on this
     * host), or "unavailable". Only the composio flag carries it today.
     */
    val mode: String? = null,
    val apiKeyConfigured: Boolean? = null,
    val ready: Boolean? = null,
    val voice: String? = null,
    /**
     * The voice engine, absent on desktops older than the built-in provider.
     * Read it through `ConfigStatus.voiceProvider`, which applies the
     * server's own fallback; nothing should compare this string directly.
     */
    val provider: String? = null,
)

@Serializable
data class Profile(val name: String, val email: String)

@Serializable
data class OpenAICompatStatus(val configured: Boolean = false, val url: String = "")

@Serializable
data class AgentPermissions(
    val terminal: String = "granted",
    val filesystem: String = "granted",
    val browser: String = "granted",
    val composio: String = "granted",
)

@Serializable
data class ConfigStatus(
    val composio: ConfigFlag? = null,
    val box: ConfigFlag? = null,
    val tts: ConfigFlag? = null,
    val imageGen: ConfigFlag? = null,
    val profile: Profile? = null,
    /** Base URL is a setting, not a secret; the key is reported as configured-or-not. */
    val openaiCompat: OpenAICompatStatus? = null,
    /**
     * The owner's standing "never stop for approvals" grant. When true the
     * host runs every bot's turns with full access, so no permission card is
     * opened. Absent on older hosts, so it defaults to the asking behaviour.
     */
    val neverAskPermissions: Boolean = false,
    val agentPermissions: AgentPermissions? = null,
) {
    /**
     * "This engine can speak", not "a key is on file" — under the built-in
     * provider `providerConfigured` in `server/tts/index.ts` reports whether
     * the computer has usable voices, and no credential exists at all. The
     * flag stays provider-neutral; only the reason behind it changes.
     */
    val isTTSConfigured: Boolean
        get() = tts?.configured == true || tts?.apiKeyConfigured == true

    val hasWorkspaceDefaultVoice: Boolean
        get() = !tts?.voice.isNullOrBlank()

    fun canSpeak(agentVoice: String?): Boolean =
        isTTSConfigured && (!agentVoice.isNullOrBlank() || hasWorkspaceDefaultVoice)

    /**
     * `voiceProvider(cfg)` in `server/tts/index.ts`: only a known, exact wire
     * value selects its engine. Everything else falls back to ElevenLabs
     * through [VoiceProvider.fromWire], which is the server's own rule.
     */
    val voiceProvider: VoiceProvider
        get() = VoiceProvider.fromWire(tts?.provider)
}

enum class ServiceConnectionState(
    val wireName: String,
    val label: String,
) {
    NOT_CONNECTED("not_connected", "Not Connected"),
    CONNECTING("connecting", "Connecting…"),
    PENDING("pending", "Pending"),
    CONNECTED("connected", "Connected"),
    FAILED("failed", "Failed"),
    CANCELLED("cancelled", "Cancelled"),
    EXPIRED("expired", "Expired"),
    DISCONNECTED("disconnected", "Disconnected");

    val isUsable: Boolean get() = this == CONNECTED
}

object ConnectedAppsRules {
    const val MAX_ACCOUNT_ALIAS_LENGTH = 64
    const val MAX_ACCOUNTS_PER_CONNECTOR = 5
    const val PRIMARY_ACCOUNT_LABEL = "Primary account"

    val firstAccountAlias: String? = null

    fun additionalAccountAlias(input: String): String? =
        trimmedAlias(input)?.take(MAX_ACCOUNT_ALIAS_LENGTH)

    fun canAddAnotherAccount(accounts: List<ConnectorAccount>): Boolean =
        accounts.size < MAX_ACCOUNTS_PER_CONNECTOR

    fun resolveState(status: ConnectorStatus?): ServiceConnectionState {
        if (status == null) return ServiceConnectionState.NOT_CONNECTED

        if (status.connected) return ServiceConnectionState.CONNECTED

        val rawStatus = status.status?.trim()?.lowercase().orEmpty()
        val accounts = status.accounts.orEmpty()

        if (accounts.any { it.isActive }) return ServiceConnectionState.CONNECTED
        if (accounts.any { it.status.lowercase().let { s -> s == "initiated" || s == "initializing" || s == "pending" } }) {
            return ServiceConnectionState.PENDING
        }
        if (accounts.any { it.status.lowercase().startsWith("expired") }) {
            return ServiceConnectionState.EXPIRED
        }
        if (accounts.any { it.status.lowercase().let { s -> s.startsWith("fail") || s.startsWith("error") } }) {
            return ServiceConnectionState.FAILED
        }
        if (accounts.any { it.status.lowercase().startsWith("cancel") }) {
            return ServiceConnectionState.CANCELLED
        }
        if (accounts.any { it.status.lowercase().startsWith("disconnect") }) {
            return ServiceConnectionState.DISCONNECTED
        }

        if (status.pending == true) {
            return if (rawStatus.startsWith("connect")) ServiceConnectionState.CONNECTING else ServiceConnectionState.PENDING
        }

        return when {
            rawStatus == "active" || rawStatus == "connected" -> ServiceConnectionState.CONNECTED
            rawStatus.startsWith("connect") -> ServiceConnectionState.CONNECTING
            rawStatus == "pending" || rawStatus == "initiated" || rawStatus == "initializing" -> ServiceConnectionState.PENDING
            rawStatus.startsWith("expired") -> ServiceConnectionState.EXPIRED
            rawStatus.startsWith("fail") || rawStatus.startsWith("error") -> ServiceConnectionState.FAILED
            rawStatus.startsWith("cancel") -> ServiceConnectionState.CANCELLED
            rawStatus.startsWith("disconnect") -> ServiceConnectionState.DISCONNECTED
            rawStatus == "not_connected" || rawStatus.isEmpty() -> ServiceConnectionState.NOT_CONNECTED
            else -> ServiceConnectionState.NOT_CONNECTED
        }
    }

    internal fun trimmedAlias(input: String?): String? =
        input?.trim { it.isWhitespace() }?.takeIf { it.isNotEmpty() }
}

@Serializable
data class ConnectorCard(
    val slug: String,
    val label: String,
    val blurb: String,
    val logo: String? = null,
    val domain: String? = null,
) {
    val id: String get() = slug
}

@Serializable
data class ConnectorAccount(
    val id: String,
    val alias: String? = null,
    val status: String,
) {
    val displayName: String
        get() = ConnectedAppsRules.trimmedAlias(alias) ?: ConnectedAppsRules.PRIMARY_ACCOUNT_LABEL

    val isActive: Boolean
        get() = status.trim { it.isWhitespace() }.uppercase() == "ACTIVE"
}

@Serializable
data class ConnectorStatus(
    val connected: Boolean,
    val pending: Boolean? = null,
    val status: String? = null,
    val accounts: List<ConnectorAccount>? = null,
)

@Serializable
data class ConnectorCatalog(
    val configured: Boolean,
    val mode: String? = null,
    val source: String? = null,
    val cards: List<ConnectorCard>,
    val totalCount: Int? = null,
    val hasMore: Boolean? = null,
    val nextCursor: String? = null,
)


@Serializable
data class ConnectorStatuses(
    val configured: Boolean,
    val services: Map<String, ConnectorStatus>,
    /**
     * "ok", "unavailable", or absent on a desktop that predates the field.
     * Read it through `isAuthoritative`; nothing should compare it directly.
     */
    val credentialStore: String? = null,
) {
    /**
     * Whether `services` is an inventory or an admission of ignorance.
     *
     * `server/index.ts` answers an unreadable Composio credential store with
     * an empty map *and* `credentialStore: "unavailable"`, because not being
     * able to read the store means we do not know what is connected — which
     * is not the same as knowing nothing is. An empty map that arrives this
     * way must never be shown as "nothing is connected"; every account may
     * still be live on the computer.
     *
     * Only that exact string withdraws the claim. "ok" is authoritative, and
     * so is a missing field: a desktop old enough not to send it would
     * otherwise have every answer treated as unknowable.
     */
    val isAuthoritative: Boolean
        get() = credentialStore != "unavailable"
}

/**
 * One connection the bot asked for, as the harness stores it on the message.
 * The card is live: the same message is patched in place as the person opens
 * the provider's sign-in page, finishes it, or dismisses the request.
 */
@Serializable
data class ConnectorRequestCard(
    val slug: String,
    val label: String,
    val description: String,
    /** required | authorizing | connected | failed */
    val status: String,
    /** Cards created by one agent request are continued together. */
    val resumeKey: String,
    val alias: String? = null,
    val error: String? = null,
    val dismissed: Boolean? = null,
    val resumed: Boolean? = null,
)

/**
 * The card's status words, kept in one place so the renderer and every test
 * read the same rule. The wire values are protocol words, not prose — case
 * never matters, and an unknown word is treated as "still required" so a
 * newer harness cannot strand the person on a blank card.
 */
object ConnectorCardRules {
    const val NOT_NOW = "Not now"

    fun isDismissed(card: ConnectorRequestCard): Boolean = card.dismissed == true

    fun isConnected(card: ConnectorRequestCard): Boolean = word(card) == "connected"

    fun isAuthorizing(card: ConnectorRequestCard): Boolean = word(card) == "authorizing"

    fun isFailed(card: ConnectorRequestCard): Boolean = word(card) == "failed"

    fun isResumed(card: ConnectorRequestCard): Boolean = card.resumed == true

    /** The sign-in button speaks the state: open again while waiting,
     * try again after a failure, connect otherwise. */
    fun connectActionLabel(card: ConnectorRequestCard): String = when {
        isAuthorizing(card) -> "Open again"
        isFailed(card) -> "Try again"
        else -> "Connect securely"
    }

    /** The footer line under the card. */
    fun progressLabel(card: ConnectorRequestCard): String = when {
        isAuthorizing(card) -> "Waiting for sign-in…"
        isConnected(card) -> "Ready to use"
        else -> "Requested by the bot"
    }

    private fun word(card: ConnectorRequestCard): String = card.status.trim().lowercase()
}

/** [Bot.composio] holds three states in one nullable boolean; this is the
 * single reader of that contract. */
fun Bot.isConnectedAppsAllowed(): Boolean = composio != false

@Serializable(with = BotProfilePatchSerializer::class)
data class BotProfilePatch(
    val name: String? = null,
    val title: String? = null,
    val description: String? = null,
    val notifications: Boolean? = null,
    /** The bot's own colour (mascot tint and name pill), one of the ten
     * palette names. Null keeps the saved one. */
    val color: String? = null,
    val mascotBody: String? = null,
    val avatarUrl: AvatarURL? = null,
    val avatarCrop: AvatarCrop? = null,
    val voice: String? = null,
    val speakReplies: Boolean? = null,
    /** Sentinel-free: `null` here means "send mcpServers: null" (all enabled).
     * Omitted keeps the current selection. Use [BotMcpSelection] wrappers. */
    val mcpServers: List<String>? = null,
    val mcpServersAbsent: Boolean = true,
) {
    sealed interface AvatarURL {
        data class Set(val path: String) : AvatarURL
        data object Clear : AvatarURL
    }
}

/** The three states of a bot's MCP server selection, phrased the way the
 * server defines them: `null` = every enabled server, `[]` = none, a list =
 * exactly those names (disabled servers in the list stay unmounted). */
object BotMcpSelection {
    fun all(): BotProfilePatch = BotProfilePatch(mcpServers = null, mcpServersAbsent = false)
    fun none(): BotProfilePatch = BotProfilePatch(mcpServers = emptyList(), mcpServersAbsent = false)
    fun only(names: List<String>): BotProfilePatch =
        BotProfilePatch(mcpServers = names, mcpServersAbsent = false)
}

/** One configured custom MCP server, as GET /api/mcp/servers returns it.
 * Secrets never round-trip: a stdio entry exposes env key NAMES only, a
 * remote entry header key NAMES only — values live in the server's own
 * write-only store. */
@Serializable
data class McpServerListing(
    val name: String,
    val enabled: Boolean = false,
    // stdio shape
    val command: String? = null,
    val args: List<String>? = null,
    val envKeys: List<String>? = null,
    // remote shape ("http" or "sse")
    val type: String? = null,
    val url: String? = null,
    val headerKeys: List<String>? = null,
) {
    val isRemote: Boolean get() = url != null
}

@Serializable
data class McpServerList(val servers: List<McpServerListing> = emptyList())

/** POST /api/mcp/servers/:name/test — the bounded handshake probe. */
@Serializable
data class McpProbeResult(
    val ok: Boolean,
    val tools: List<McpProbeTool> = emptyList(),
    val error: String? = null,
)

@Serializable
data class McpProbeTool(
    val name: String,
    val description: String? = null,
)

/** A server to add or edit, the way the desktop form sends it. Secrets (env
 * values / header values) live only in this object, never in any listing.
 * [KeepEnv] / [KeepHeader] send the registry's write-only `true` placeholder,
 * which keeps an already stored value — the API refuses it for a key it has
 * never saved, which is the honest error. */
sealed interface McpServerConfig {
    val enabled: Boolean

    data class Command(
        val command: String,
        val args: List<String> = emptyList(),
        val env: Map<String, McpSecret> = emptyMap(),
        override val enabled: Boolean = false,
    ) : McpServerConfig

    /** @param type "http" or "sse", matching the upstream registry. */
    data class Url(
        val type: String,
        val url: String,
        val headers: Map<String, McpSecret> = emptyMap(),
        override val enabled: Boolean = false,
    ) : McpServerConfig
}

/** One value of an env/header map: newly typed, or "keep the stored one". */
sealed interface McpSecret {
    data class Value(val value: String) : McpSecret
    data object KeepStored : McpSecret
}

/** The ten palette names the wire accepts (shared MausColor); an unknown
 * value is dropped rather than forwarded to a server that would reject it. */
private val MAUS_COLOR_NAMES = setOf(
    "green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral",
)

object BotProfilePatchSerializer : KSerializer<BotProfilePatch> {
    private val fieldNames = setOf(
        "name",
        "title",
        "description",
        "notifications",
        "color",
        "mascotBody",
        "avatarUrl",
        "avatarCrop",
        "voice",
        "speakReplies",
        "mcpServers",
    )

    override val descriptor = buildClassSerialDescriptor("BotProfilePatch") {
        element<String>("name", isOptional = true)
        element<String>("title", isOptional = true)
        element<String>("description", isOptional = true)
        element<Boolean>("notifications", isOptional = true)
        element<String>("color", isOptional = true)
        element<String>("mascotBody", isOptional = true)
        element<JsonElement>("avatarUrl", isOptional = true)
        element<String>("avatarCrop", isOptional = true)
        element<String>("voice", isOptional = true)
        element<Boolean>("speakReplies", isOptional = true)
        element<List<String>>("mcpServers", isOptional = true)
    }

    override fun serialize(encoder: Encoder, value: BotProfilePatch) {
        val output = encoder as? JsonEncoder
            ?: throw SerializationException("BotProfilePatch can only be encoded as JSON")
        output.encodeJsonElement(buildJsonObject {
            value.name?.let { put("name", it) }
            value.title?.let { put("title", it) }
            value.description?.let { put("description", it) }
            value.notifications?.let { put("notifications", it) }
            value.color?.let { put("color", it) }
            value.mascotBody?.let { put("mascotBody", it) }
            when (val avatarUrl = value.avatarUrl) {
                is BotProfilePatch.AvatarURL.Set -> put("avatarUrl", avatarUrl.path)
                BotProfilePatch.AvatarURL.Clear -> put("avatarUrl", JsonNull)
                null -> Unit
            }
            value.avatarCrop?.let { put("avatarCrop", it.name.lowercase()) }
            value.voice?.let { put("voice", it) }
            value.speakReplies?.let { put("speakReplies", it) }
            if (!value.mcpServersAbsent) put("mcpServers", value.mcpServers?.let { names -> JsonArray(names.map { JsonPrimitive(it) }) } ?: JsonNull) // null = all enabled
        })
    }

    override fun deserialize(decoder: Decoder): BotProfilePatch {
        val input = decoder as? JsonDecoder
            ?: throw SerializationException("BotProfilePatch can only be decoded from JSON")
        val value = input.decodeJsonElement().jsonObject
        val unknown = value.keys - fieldNames
        if (unknown.isNotEmpty()) {
            throw SerializationException("Unsupported profile field: ${unknown.first()}")
        }

        fun string(name: String): String? {
            val element = value[name] ?: return null
            if (element is JsonNull) throw SerializationException("$name must be a string")
            val primitive = element as? JsonPrimitive
                ?: throw SerializationException("$name must be a string")
            if (!primitive.isString) throw SerializationException("$name must be a string")
            return primitive.content
        }

        fun boolean(name: String): Boolean? {
            val element = value[name] ?: return null
            val primitive = element as? JsonPrimitive
                ?: throw SerializationException("$name must be true or false")
            return primitive.booleanOrNull
                ?: throw SerializationException("$name must be true or false")
        }

        val avatarUrl = when (val element = value["avatarUrl"]) {
            null -> null
            JsonNull -> BotProfilePatch.AvatarURL.Clear
            else -> BotProfilePatch.AvatarURL.Set(string("avatarUrl")!!)
        }
        val crop = string("avatarCrop")?.let { raw ->
            AvatarCrop.entries.firstOrNull { it.name.lowercase() == raw }
                ?: AvatarCrop.MASCOT
        }
        return BotProfilePatch(
            name = string("name"),
            title = string("title"),
            description = string("description"),
            notifications = boolean("notifications"),
            color = string("color")?.takeIf { it in MAUS_COLOR_NAMES },
            mascotBody = string("mascotBody"),
            avatarUrl = avatarUrl,
            avatarCrop = crop,
            voice = string("voice"),
            speakReplies = boolean("speakReplies"),
        )
    }
}

@Serializable
data class Voice(
    val id: String,
    val label: String,
    val description: String? = null,
)

@Serializable
data class RoutineSchedule(
    val type: Kind,
    val at: Double? = null,
    val time: String? = null,
    val weekdays: List<Int>? = null,
    val everyMinutes: Int? = null,
    val anchorAt: Long? = null,
) {
    @Serializable(with = RoutineScheduleKindSerializer::class)
    enum class Kind { ONCE, DAILY, INTERVAL, UNKNOWN }

    companion object {
        fun once(atMillis: Double): RoutineSchedule = RoutineSchedule(Kind.ONCE, at = atMillis)

        fun daily(time: String, weekdays: List<Int>): RoutineSchedule =
            RoutineSchedule(Kind.DAILY, time = time, weekdays = weekdays)

        fun interval(everyMinutes: Int, anchorAtMillis: Long): RoutineSchedule =
            RoutineSchedule(
                Kind.INTERVAL,
                everyMinutes = everyMinutes,
                anchorAt = anchorAtMillis,
            )
    }
}

object RoutineScheduleKindSerializer : KSerializer<RoutineSchedule.Kind> {
    override val descriptor = PrimitiveSerialDescriptor("RoutineSchedule.Kind", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): RoutineSchedule.Kind = when (decoder.decodeString()) {
        "once" -> RoutineSchedule.Kind.ONCE
        "daily" -> RoutineSchedule.Kind.DAILY
        "interval" -> RoutineSchedule.Kind.INTERVAL
        else -> RoutineSchedule.Kind.UNKNOWN
    }

    override fun serialize(encoder: Encoder, value: RoutineSchedule.Kind) {
        encoder.encodeString(value.name.lowercase())
    }
}

@Serializable
data class Routine(
    val id: String,
    val name: String,
    val prompt: String,
    val botId: String,
    val runOn: String,
    val enabled: Boolean,
    val schedule: RoutineSchedule,
    /** Legacy calendar/display length retained for older desktop compatibility. */
    val durationMinutes: Int,
    /** Optional execution guard. Missing means the routine has no time limit. */
    val timeoutMinutes: Int? = null,
    val nextRunAt: Double? = null,
    val createdAt: Double,
    val updatedAt: Double,
    val description: String? = null,
    val taskObjective: String? = null,
) {
    val runLocation: RoutineRunLocation
        get() = RoutineRunLocation.entries.firstOrNull { it.wireValue == runOn }
            ?: RoutineRunLocation.MAUS

    fun canToggle(atMillis: Double = System.currentTimeMillis().toDouble()): Boolean = when (schedule.type) {
        RoutineSchedule.Kind.DAILY -> true
        RoutineSchedule.Kind.INTERVAL ->
            (schedule.everyMinutes ?: 0) in 5..1_440 && schedule.anchorAt != null
        RoutineSchedule.Kind.ONCE -> (schedule.at ?: Double.NEGATIVE_INFINITY) > atMillis
        RoutineSchedule.Kind.UNKNOWN -> false
    }
}

@Serializable
data class RoutineRun(
    val id: String,
    val routineId: String,
    val routineName: String,
    val prompt: String? = null,
    /** Legacy calendar/display length snapshot. */
    val durationMinutes: Int? = null,
    /** Optional execution-guard snapshot. */
    val timeoutMinutes: Int? = null,
    val botId: String,
    val runOn: String,
    val scheduledFor: Double,
    val status: String,
    val manual: Boolean,
    val triggerSource: String? = null,
    val threadId: String? = null,
    val startedAt: Double? = null,
    val finishedAt: Double? = null,
    val output: String? = null,
    val error: String? = null,
    val createdAt: Double,
    val seenAt: Double? = null,
    val itemsFound: Int? = null,
    val itemsDelivered: Int? = null,
    val suppressedNotification: Boolean? = null,
    val verificationStatus: String? = null,
)

@Serializable
data class RoutineInput(
    val name: String,
    val prompt: String,
    val botId: String,
    val runOn: String = "maus",
    val enabled: Boolean? = null,
    val schedule: RoutineSchedule,
    /** Still required by older paired desktops; it is not the execution timeout. */
    val durationMinutes: Int = 30,
    /** A value replaces the stored limit; null leaves it unchanged on PATCH. */
    val timeoutMinutes: Int? = null,
    /** Interpreted by CompanionClient as an explicit JSON null. */
    @kotlinx.serialization.Transient val clearTimeout: Boolean = false,
)

@Serializable
enum class RoutineRunLocation(val wireValue: String) {
    @SerialName("maus")
    MAUS("maus"),

    @SerialName("cloud")
    CLOUD("cloud"),
}

data class RoutineRunAvailability(
    val cloudConfigured: Boolean,
    val cloudInstanceAvailable: Boolean,
) {
    constructor(config: ConfigStatus?, instances: List<Instance>) : this(
        cloudConfigured = config?.box?.configured == true,
        cloudInstanceAvailable = instances.any {
            it.driverKind == "boxAgent" && it.snapshot.isAvailable
        },
    )

    val cloudReady: Boolean get() = cloudConfigured && cloudInstanceAvailable

    fun canSelect(location: RoutineRunLocation, preserving: RoutineRunLocation): Boolean =
        location == RoutineRunLocation.MAUS || cloudReady || preserving == RoutineRunLocation.CLOUD
}

@Serializable
data class APIErrorBody(val error: String)

data class ScreenFrame(val png: String, val mime: String) {
    val data: ByteArray?
        get() = try {
            Base64.getDecoder().decode(png)
        } catch (_: IllegalArgumentException) {
            null
        }
}

@Serializable
data class CreatedBot(val bot: Bot)

@Serializable
data class CreatedRoom(val group: Room)

@Serializable
internal data class SearchResponse(val hits: List<SearchHit>)

@Serializable
internal data class MessageResponse(val message: Message)

@Serializable
internal data class ActiveBranchResponse(val activeLeafId: String)

@Serializable
internal data class BotResponse(val bot: Bot)

@Serializable
internal data class RoomResponse(val group: Room)

/** The narrow sidebar organizer route returns just the affected bots. */
@Serializable
internal data class SidebarSectionResponse(val section: String, val bots: List<Bot>)

@Serializable
internal data class VoiceListResponse(val voices: List<Voice>, val error: String? = null)

@Serializable
internal data class AttachmentResponse(val path: String, val mime: String, val bytes: Int)

@Serializable
internal data class FileUploadResponse(val path: String, val name: String, val mime: String, val bytes: Int)

@Serializable
internal data class GeneratedAvatarResponse(val avatarUrl: String, val bot: Bot)

@Serializable
data class RoutinesResponse(val routines: List<Routine>, val runs: List<RoutineRun>)

@Serializable
internal data class RoutineResponse(val routine: Routine)

@Serializable
internal data class RoutineRunResponse(val run: RoutineRun)

@Serializable
internal data class ConnectorAuthorizationResponse(val url: String)

@Serializable
data class BotOverviewWho(val name: String, val title: String, val blurb: String, val soulLead: String)

@Serializable
data class BotOverviewRecent(val at: Double, val summary: String)

@Serializable
data class CalendarItemOverview(
    val id: String,
    val title: String,
    val type: String,
    val time: String,
    val status: String,
    val description: String? = null,
    val routineId: String? = null,
)

@Serializable
data class CalendarDayOverview(
    val dayDate: String,
    val dayName: String,
    val dayNumber: Int,
    val isToday: Boolean,
    val items: List<CalendarItemOverview> = emptyList(),
)

@Serializable
data class UpcomingItemOverview(
    val id: String,
    val title: String,
    val scheduledAt: Double,
    val formattedTime: String,
    val type: String,
    val status: String,
    val cadence: String? = null,
    val target: String? = null,
)

@Serializable
data class MemoryItemOverview(
    val id: String,
    val text: String,
    val category: String,
    val source: String? = null,
    val date: String? = null,
)

@Serializable
data class AutomationOverview(
    val id: String,
    val name: String,
    val status: String,
    val schedule: String,
    val lastRunAt: Double? = null,
    val lastRunStatus: String? = null,
    val nextRunAt: Double? = null,
)

@Serializable
data class AbilityOverview(
    val id: String,
    val name: String,
    val description: String,
    val available: Boolean,
    val category: String,
)

@Serializable
data class GoalOverview(
    val id: String,
    val title: String,
    val status: String,
    val progress: Int,
    val milestoneCount: Int,
    val completedMilestones: Int,
    val nextAction: String? = null,
    val blockers: List<String> = emptyList(),
)

@Serializable
data class WatchOverview(
    val id: String,
    val target: String,
    val condition: String,
    val source: String,
    val status: String,
    val cadenceMinutes: Int,
    val lastChecked: Double? = null,
    val lastKnownState: String? = null,
)

@Serializable
data class ActivityOverview(
    val id: String,
    val summary: String,
    val at: Double,
    val type: String,
)

@Serializable
data class BotOverview(
    val who: BotOverviewWho,
    val does: List<String> = emptyList(),
    val reaches: List<String> = emptyList(),
    val wont: List<String> = emptyList(),
    val recent: List<BotOverviewRecent> = emptyList(),
    val calendar: List<CalendarDayOverview> = emptyList(),
    val upcoming: List<UpcomingItemOverview> = emptyList(),
    val memory: List<MemoryItemOverview> = emptyList(),
    val automations: List<AutomationOverview> = emptyList(),
    val abilities: List<AbilityOverview> = emptyList(),
    val goals: List<GoalOverview> = emptyList(),
    val watches: List<WatchOverview> = emptyList(),
    val activities: List<ActivityOverview> = emptyList(),
)

