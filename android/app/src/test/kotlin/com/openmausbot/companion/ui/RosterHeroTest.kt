package com.openmausbot.companion.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/**
 * The roster hero's words, pinned without a device.
 *
 * What opens the app is a greeting and a count of the fleet. Both are derived
 * rather than written, so both are pinned here: a greeting at the wrong hour or
 * a count that reads "1 bots" are exactly the mistakes a screenshot would only
 * catch if someone happened to look at the right moment.
 *
 * There is no date test because there is no date: the hero used to open on
 * `08.10 THU` and does not any more.
 */
class RosterHeroTest {
    @Test
    fun `the greeting changes with the hour, and late night is its own line`() {
        assertEquals("Still up", RosterHeroSpec.greeting(0))
        assertEquals("Still up", RosterHeroSpec.greeting(4))
        assertEquals("Good morning", RosterHeroSpec.greeting(5))
        assertEquals("Good morning", RosterHeroSpec.greeting(11))
        assertEquals("Good afternoon", RosterHeroSpec.greeting(12))
        assertEquals("Good afternoon", RosterHeroSpec.greeting(17))
        assertEquals("Good evening", RosterHeroSpec.greeting(18))
        assertEquals("Good evening", RosterHeroSpec.greeting(23))
    }

    @Test
    fun `the summary says how many bots there are and how many are working`() {
        assertEquals("No bots yet", RosterHeroSpec.summary(bots = 0, working = 0))
        assertEquals("1 bot · all quiet", RosterHeroSpec.summary(bots = 1, working = 0))
        assertEquals("12 bots · all quiet", RosterHeroSpec.summary(bots = 12, working = 0))
        assertEquals("3 bots · 1 working", RosterHeroSpec.summary(bots = 3, working = 1))
        assertEquals("12 bots · 4 working", RosterHeroSpec.summary(bots = 12, working = 4))
    }

    @Test
    fun `a single bot working is counted, not described`() {
        // `1 bots` is the failure mode of a naive plural, and `working = 1` is the
        // common case on a phone with one bot on it.
        val line = RosterHeroSpec.summary(bots = 1, working = 1)
        assertEquals("1 bot · 1 working", line)
        assertFalse(line.contains("1 bots"), "no ungrammatical plural: $line")
    }
}
