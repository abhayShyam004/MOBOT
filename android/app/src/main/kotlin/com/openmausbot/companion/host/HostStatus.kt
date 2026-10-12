package com.openmausbot.companion.host

/**
 * Lifecycle of the embedded MOBOT host process.
 *
 * [Failed] always carries the human-readable reason and the last lines of
 * process output — a failed host must be diagnosable from what the user can
 * see, never silently "offline".
 */
sealed interface HostStatus {
    /** Not running, not asked to run. */
    data object Idle : HostStatus

    /** Copying the bundled server out of the APK into app-private storage. */
    data object Extracting : HostStatus

    /** Process launched; waiting for /api/health. */
    data class Starting(val port: Int) : HostStatus

    /** Health endpoint green; the UI can connect to localhost. */
    data class Running(val port: Int, val startedAtMs: Long) : HostStatus

    /** Process exited on its own (or was killed); restart policy exhausted or disabled. */
    data class Failed(val reason: String, val exitCode: Int?, val outputTail: List<String>) : HostStatus

    /** Asked to stop; in-flight. */
    data object Stopping : HostStatus
}
