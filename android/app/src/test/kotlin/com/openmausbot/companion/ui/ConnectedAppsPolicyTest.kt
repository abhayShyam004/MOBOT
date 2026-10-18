package com.openmausbot.companion.ui

import com.openmausbot.companion.core.ConnectorCard
import com.openmausbot.companion.core.ConnectorCatalog
import com.openmausbot.companion.core.ConnectorStatus
import com.openmausbot.companion.core.ConnectorStatuses
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConnectedAppsPolicyTest {
    @Test
    fun `unavailable credential store preserves the last authoritative inventory`() {
        val known = ConnectedAppsInventory(
            statuses = mapOf("gmail" to ConnectorStatus(connected = true)),
        )
        val afterFailure = ConnectedAppsPolicy.accept(
            known,
            ConnectorStatuses(
                configured = false,
                credentialStore = "unavailable",
                services = emptyMap(),
            ),
        )

        assertEquals(known.statuses, afterFailure.statuses)
        assertTrue(afterFailure.credentialStoreUnreadable)
        assertFalse(
            ConnectedAppsPolicy.showSetupNotice(
                ConnectorCatalog(configured = false, cards = emptyList()),
                afterFailure.credentialStoreUnreadable,
            ),
            "an unreadable store is ignorance, not evidence that setup is missing",
        )
    }

    @Test
    fun `first unreadable response remains unknown rather than disconnected`() {
        val afterFailure = ConnectedAppsPolicy.accept(
            ConnectedAppsInventory(),
            ConnectorStatuses(
                configured = false,
                credentialStore = "unavailable",
                services = emptyMap(),
            ),
        )

        assertNull(afterFailure.statuses)
        assertTrue(afterFailure.credentialStoreUnreadable)
    }

    @Test
    fun `authoritative refresh replaces stale inventory and clears its warning`() {
        val refreshed = ConnectedAppsPolicy.accept(
            ConnectedAppsInventory(
                statuses = mapOf("gmail" to ConnectorStatus(connected = true)),
                credentialStoreUnreadable = true,
            ),
            ConnectorStatuses(
                configured = true,
                credentialStore = "ok",
                services = mapOf("slack" to ConnectorStatus(connected = true)),
            ),
        )

        assertEquals(setOf("slack"), refreshed.statuses?.keys)
        assertFalse(refreshed.credentialStoreUnreadable)
    }

    @Test
    fun `a wire status is read as words, not as a protocol token`() {
        assertEquals("Active", ConnectedAppsPolicy.statusLabel("ACTIVE"))
        assertEquals("Initiated", ConnectedAppsPolicy.statusLabel("initiated"))
        assertEquals("Not Connected", ConnectedAppsPolicy.statusLabel("not_connected"))
        assertEquals("Expired Token", ConnectedAppsPolicy.statusLabel("EXPIRED_TOKEN"))
        assertEquals("", ConnectedAppsPolicy.statusLabel(""))
    }

    @Test
    fun `search matches label and slug without changing order`() {
        val gmail = ConnectorCard("gmail", "Gmail", "Mail")
        val calendar = ConnectorCard("googlecalendar", "Google Calendar", "Events", domain = "calendar.google.com")
        val slack = ConnectorCard("slack", "Slack", "Messages", domain = "slack.com")

        assertEquals(listOf(calendar), ConnectedAppsPolicy.filterCards(listOf(gmail, calendar, slack), "GOOGLE"))
        assertEquals(listOf(slack), ConnectedAppsPolicy.filterCards(listOf(gmail, calendar, slack), "sla"))
        assertEquals(listOf(gmail, calendar, slack), ConnectedAppsPolicy.filterCards(listOf(gmail, calendar, slack), "  "))
        assertEquals(listOf(calendar), ConnectedAppsPolicy.filterCards(listOf(gmail, calendar, slack), "google calendar"))
        assertEquals(listOf(slack), ConnectedAppsPolicy.filterCards(listOf(gmail, calendar, slack), "slack.com"))
    }

    @Test
    fun `resolveState resolves deterministic, mutually exclusive states`() {
        assertEquals(com.openmausbot.companion.core.ServiceConnectionState.NOT_CONNECTED, com.openmausbot.companion.core.ConnectedAppsRules.resolveState(null))

        val connectedStatus = ConnectorStatus(connected = true)
        assertEquals(com.openmausbot.companion.core.ServiceConnectionState.CONNECTED, com.openmausbot.companion.core.ConnectedAppsRules.resolveState(connectedStatus))

        val pendingStatus = ConnectorStatus(connected = false, pending = true)
        assertEquals(com.openmausbot.companion.core.ServiceConnectionState.PENDING, com.openmausbot.companion.core.ConnectedAppsRules.resolveState(pendingStatus))

        val connectingStatus = ConnectorStatus(connected = false, pending = true, status = "connecting")
        assertEquals(com.openmausbot.companion.core.ServiceConnectionState.CONNECTING, com.openmausbot.companion.core.ConnectedAppsRules.resolveState(connectingStatus))

        val activeAccountStatus = ConnectorStatus(
            connected = false,
            accounts = listOf(com.openmausbot.companion.core.ConnectorAccount("ca_1", "Work", "ACTIVE")),
        )
        assertEquals(com.openmausbot.companion.core.ServiceConnectionState.CONNECTED, com.openmausbot.companion.core.ConnectedAppsRules.resolveState(activeAccountStatus))

        val expiredAccountStatus = ConnectorStatus(
            connected = false,
            accounts = listOf(com.openmausbot.companion.core.ConnectorAccount("ca_2", "Personal", "EXPIRED")),
        )
        assertEquals(com.openmausbot.companion.core.ServiceConnectionState.EXPIRED, com.openmausbot.companion.core.ConnectedAppsRules.resolveState(expiredAccountStatus))

        val failedAccountStatus = ConnectorStatus(
            connected = false,
            accounts = listOf(com.openmausbot.companion.core.ConnectorAccount("ca_3", "Client", "FAILED")),
        )
        assertEquals(com.openmausbot.companion.core.ServiceConnectionState.FAILED, com.openmausbot.companion.core.ConnectedAppsRules.resolveState(failedAccountStatus))

        val cancelledAccountStatus = ConnectorStatus(
            connected = false,
            accounts = listOf(com.openmausbot.companion.core.ConnectorAccount("ca_4", "Client", "CANCELLED")),
        )
        assertEquals(com.openmausbot.companion.core.ServiceConnectionState.CANCELLED, com.openmausbot.companion.core.ConnectedAppsRules.resolveState(cancelledAccountStatus))

        val disconnectedAccountStatus = ConnectorStatus(
            connected = false,
            accounts = listOf(com.openmausbot.companion.core.ConnectorAccount("ca_5", "Client", "DISCONNECTED")),
        )
        assertEquals(com.openmausbot.companion.core.ServiceConnectionState.DISCONNECTED, com.openmausbot.companion.core.ConnectedAppsRules.resolveState(disconnectedAccountStatus))
    }

    @Test
    fun `statusTone matches expected visual hierarchy for states and statuses`() {
        assertEquals(StatusTone.GOOD, ConnectedAppsPolicy.statusTone(com.openmausbot.companion.core.ServiceConnectionState.CONNECTED))
        assertEquals(StatusTone.WARN, ConnectedAppsPolicy.statusTone(com.openmausbot.companion.core.ServiceConnectionState.CONNECTING))
        assertEquals(StatusTone.WARN, ConnectedAppsPolicy.statusTone(com.openmausbot.companion.core.ServiceConnectionState.PENDING))
        assertEquals(StatusTone.WARN, ConnectedAppsPolicy.statusTone(com.openmausbot.companion.core.ServiceConnectionState.EXPIRED))
        assertEquals(StatusTone.BAD, ConnectedAppsPolicy.statusTone(com.openmausbot.companion.core.ServiceConnectionState.FAILED))
        assertEquals(StatusTone.PLAIN, ConnectedAppsPolicy.statusTone(com.openmausbot.companion.core.ServiceConnectionState.NOT_CONNECTED))
        assertEquals(StatusTone.PLAIN, ConnectedAppsPolicy.statusTone(com.openmausbot.companion.core.ServiceConnectionState.CANCELLED))
        assertEquals(StatusTone.PLAIN, ConnectedAppsPolicy.statusTone(com.openmausbot.companion.core.ServiceConnectionState.DISCONNECTED))

        assertEquals(StatusTone.GOOD, ConnectedAppsPolicy.statusTone("ACTIVE"))
        assertEquals(StatusTone.WARN, ConnectedAppsPolicy.statusTone("INITIATED"))
        assertEquals(StatusTone.BAD, ConnectedAppsPolicy.statusTone("ERROR"))
        assertEquals(StatusTone.WARN, ConnectedAppsPolicy.statusTone("EXPIRED"))
        assertEquals(StatusTone.PLAIN, ConnectedAppsPolicy.statusTone("NOT_CONNECTED"))
    }
}
