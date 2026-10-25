package com.openmausbot.companion.host

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The authority decision that decides which Keystore key seals memory.
 *
 * Measured on the Galaxy A07: after a reinstall, the host spawned ~40 ms before
 * signer enrollment completed, because the wait was a fixed 5 s that expired
 * while the signer service was still cold-starting. The spawn then carried
 * `OMB_MEMORY_INTEGRITY_SIGNER=0`, and a store the signer had sealed was
 * re-sealed under the app UID's key — the freshness anchor dropped silently.
 * A signer that is installed but slow must not be treated like an absent one.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MemorySignerClientTest {

    @Test
    fun `an absent signer package is reported as not installed`() {
        // The unit-test app declares no signer service, which is the same
        // answer the client gets on a device without the package.
        assertFalse(MemorySignerClient.installed(RuntimeEnvironment.getApplication()))
    }

    @Test
    fun `ready returns an explicit false quickly when no signer exists`() {
        MemorySignerClient.install(RuntimeEnvironment.getApplication())

        val started = System.currentTimeMillis()
        val ready = MemorySignerClient.ready(400)
        val elapsed = System.currentTimeMillis() - started

        assertFalse(ready)
        // No signer means no long grace period: the caller may fall back to
        // the historical in-app authority, and only signer-sealed stores
        // (v3) fail closed from that point.
        assertTrue("ready waited ${elapsed} ms without a signer installed", elapsed < 3_000)
    }
}
