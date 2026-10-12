package com.openmausbot.companion.host

/**
 * The loopback port the embedded host binds and the seeded self-pairing
 * dials. A single constant, deliberately: the pairing record is persisted,
 * so the port cannot be chosen at runtime without invalidating every saved
 * pairing (or forcing a migration) — deterministic beats clever.
 */
val HarnessHostPort: Int = StandalonePairing.HOST_PORT
