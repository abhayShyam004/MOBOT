package com.openmausbot.companion.signer

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The freshness state machine, tested without a device.
 *
 * Each case is a way a rollback, a crash, or a concurrent writer could try to
 * move the anchor somewhere it should not go.
 */
class AnchorLedgerTest {

    private fun digest(fill: Char): String = fill.toString().repeat(64)

    @Test
    fun `a fresh store starts at generation one`() {
        val ledger = AnchorLedger()
        assertNull(ledger.head("store-a"))

        ledger.prepare("store-a", 1, digest('a'))
        assertNotNull(ledger.head("store-a"))
        assertNull(ledger.head("store-a")!!.pending)

        ledger.commit("store-a", 1, digest('a'))
        assertEquals(1, ledger.head("store-a")!!.generation)
        assertEquals(digest('a'), ledger.head("store-a")!!.digest)
    }

    @Test
    fun `a later generation cannot be prepared for a store that was never anchored`() {
        val ledger = AnchorLedger()
        val refused = assertFailsWith<AnchorLedger.Refused> { ledger.prepare("store-a", 4, digest('a')) }
        assertTrue(refused.message!!.contains("baseline"))
        assertNull(ledger.head("store-a"))
    }

    @Test
    fun `only the next generation can be prepared`() {
        val ledger = AnchorLedger()
        ledger.prepare("store-a", 1, digest('a'))
        ledger.commit("store-a", 1, digest('a'))

        // A rollback attempt: a shell that rolled the files back asks for the
        // generation it is holding, which is behind the committed one.
        assertFailsWith<AnchorLedger.Refused> { ledger.prepare("store-a", 1, digest('b')) }
        assertFailsWith<AnchorLedger.Refused> { ledger.prepare("store-a", 2 + 3, digest('b')) }

        ledger.prepare("store-a", 2, digest('b'))
        assertEquals(1, ledger.head("store-a")!!.generation)
        ledger.commit("store-a", 2, digest('b'))
        assertEquals(2, ledger.head("store-a")!!.generation)
    }

    @Test
    fun `commit refuses a digest that was not prepared`() {
        val ledger = AnchorLedger()
        ledger.prepare("store-a", 1, digest('a'))
        ledger.commit("store-a", 1, digest('a'))
        ledger.prepare("store-a", 2, digest('b'))

        assertFailsWith<AnchorLedger.Refused> { ledger.commit("store-a", 2, digest('c')) }
        // Nothing moved: the wrong candidate was not blessed.
        assertEquals(1, ledger.head("store-a")!!.generation)
        assertEquals(digest('b'), ledger.head("store-a")!!.pending!!.digest)
    }

    @Test
    fun `commit without a prepared candidate is refused`() {
        val ledger = AnchorLedger()
        // A store whose first write never reached prepare cannot be committed,
        // even with a digest that later happens to be correct: the anchor only
        // moves for a candidate it was shown beforehand.
        assertFailsWith<AnchorLedger.Refused> { ledger.commit("store-a", 1, digest('a')) }
        assertNull(ledger.head("store-a"))

        ledger.prepare("store-a", 1, digest('a'))
        ledger.commit("store-a", 1, digest('a'))
        assertFailsWith<AnchorLedger.Refused> { ledger.commit("store-a", 2, digest('b')) }
    }

    @Test
    fun `a repeated commit of the committed generation is idempotent`() {
        val ledger = AnchorLedger()
        ledger.prepare("store-a", 1, digest('a'))
        ledger.commit("store-a", 1, digest('a'))
        // A retried write must not fail just because the first one finished.
        ledger.commit("store-a", 1, digest('a'))
        assertEquals(1, ledger.head("store-a")!!.generation)
    }

    @Test
    fun `preparing the same generation again replaces the candidate`() {
        val ledger = AnchorLedger()
        ledger.prepare("store-a", 1, digest('a'))
        ledger.commit("store-a", 1, digest('a'))

        // Two writers, one crash between prepare and commit: the later prepare
        // for the same generation wins, and the abandoned one cannot commit.
        ledger.prepare("store-a", 2, digest('b'))
        ledger.prepare("store-a", 2, digest('c'))
        assertFailsWith<AnchorLedger.Refused> { ledger.commit("store-a", 2, digest('b')) }
        ledger.commit("store-a", 2, digest('c'))
        assertEquals(digest('c'), ledger.head("store-a")!!.digest)
    }

    @Test
    fun `baseline establishes a first anchor and refuses to overwrite one`() {
        val ledger = AnchorLedger()
        ledger.baseline("store-a", 7, digest('a'))
        assertEquals(7, ledger.head("store-a")!!.generation)

        // A second baseline would erase the history that makes rollback visible.
        assertFailsWith<AnchorLedger.Refused> { ledger.baseline("store-a", 2, digest('b')) }
        assertEquals(7, ledger.head("store-a")!!.generation)
    }

    @Test
    fun `invalid generations and digests are refused before anything changes`() {
        val ledger = AnchorLedger()
        assertFailsWith<AnchorLedger.Refused> { ledger.prepare("store-a", 0, digest('a')) }
        assertFailsWith<AnchorLedger.Refused> { ledger.prepare("store-a", 1, "not-a-digest") }
        assertFailsWith<AnchorLedger.Refused> { ledger.prepare("", 1, digest('a')) }
        assertFailsWith<AnchorLedger.Refused> { ledger.baseline("store-a", 1, digest('A')) }
        assertTrue(ledger.isEmpty())
    }

    @Test
    fun `stores advance independently`() {
        val ledger = AnchorLedger()
        ledger.prepare("bot-one", 1, digest('a'))
        ledger.commit("bot-one", 1, digest('a'))
        ledger.prepare("bot-one", 2, digest('b'))
        ledger.commit("bot-one", 2, digest('b'))
        ledger.prepare("shared", 1, digest('c'))
        ledger.commit("shared", 1, digest('c'))

        assertEquals(2, ledger.head("bot-one")!!.generation)
        assertEquals(1, ledger.head("shared")!!.generation)
        assertNull(ledger.head("bot-two"))
    }

    @Test
    fun `a snapshot round-trips through restore`() {
        val ledger = AnchorLedger()
        ledger.prepare("bot-one", 1, digest('a'))
        ledger.commit("bot-one", 1, digest('a'))
        ledger.prepare("bot-one", 2, digest('b'))
        ledger.baseline("shared", 5, digest('c'))

        val entries = ledger.snapshot().map { (key, entry, pending) ->
            AnchorLedger.EntryWithKey(key, entry.generation, entry.digest, pending)
        }
        val restored = AnchorLedger()
        restored.restore(entries)

        assertEquals(1, restored.head("bot-one")!!.generation)
        assertEquals(digest('b'), restored.head("bot-one")!!.pending!!.digest)
        assertEquals(5, restored.head("shared")!!.generation)
        assertNull(restored.head("other"))
    }
}
