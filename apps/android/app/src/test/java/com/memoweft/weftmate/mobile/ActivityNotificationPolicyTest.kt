package com.memoweft.weftmate.mobile

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class ActivityNotificationPolicyTest {
    private val host = HostIdentity("http://127.0.0.1:12345", "synthetic", "owner-a", "host-a", "device-a", "synthetic-cookie", "synthetic-csrf")
    @Test fun hostDecisionIsTheOnlyAuthority() {
        for (type in listOf("approval.pending", "question.pending", "task.completed", "task.failed", "reminder.triggered", "memory.paused", "system.notification.test"))
            for (notify in listOf(true, false)) for (read in listOf(true, false)) for (seen in listOf(true, false)) {
                assertEquals(notify && !read && !seen, ActivityNotificationPolicy.shouldNotify(notify, read, type, "pending", seen))
            }
    }
    @Test fun handledApprovalCannotReappearAndReadCancelsAllTypes() {
        for (state in listOf("completed", "unavailable")) for (type in listOf("approval.pending", "question.pending"))
            assertFalse(ActivityNotificationPolicy.shouldNotify(true, false, type, state, false))
        assertFalse(ActivityNotificationPolicy.shouldNotify(true, true, "task.completed", "completed", false))
        assertTrue(ActivityNotificationPolicy.shouldNotify(true, false, "task.completed", "completed", false))
    }
    @Test fun soundAndSilentChannelsAreDistinctForEveryCategory() {
        val types = mapOf("approval.pending" to "approval", "question.pending" to "approval", "task.failed" to "task", "reminder.triggered" to "reminder", "memory.report" to "memory", "system.update.available" to "system")
        for ((type, category) in types) {
            assertEquals(category, ActivityNotificationPolicy.category(type))
            assertNotEquals(ActivityNotificationPolicy.channel(type, true), ActivityNotificationPolicy.channel(type, false))
        }
        assertEquals(10, ActivityNotificationPolicy.categories.keys.flatMap { listOf(ActivityNotificationPolicy.channel("$it.event", true), ActivityNotificationPolicy.channel("$it.event", false)) }.toSet().size)
    }
    @Test fun ledgerScopeSurvivesOriginChangesButSeparatesAccountsAndHosts() {
        assertEquals(ActivityNotificationPolicy.scope(host), ActivityNotificationPolicy.scope(host.copy(origin="https://relay.example.com")))
        assertNotEquals(ActivityNotificationPolicy.scope(host), ActivityNotificationPolicy.scope(host.copy(ownerId="owner-b")))
        assertNotEquals(ActivityNotificationPolicy.scope(host), ActivityNotificationPolicy.scope(host.copy(hostId="host-b")))
    }
    @Test fun workerStopsForRetiredCredentialsAndRetriesNetworkFailures() {
        assertTrue(ActivityNotificationPolicy.current(host, host.copy()))
        assertFalse(ActivityNotificationPolicy.current(host, host.copy(cookie="new-login")))
        assertFalse(ActivityNotificationPolicy.current(host, host.copy(ownerId="owner-b")))
        assertFalse(ActivityNotificationPolicy.current(host, null))
        for (status in listOf(401, 403, 404)) assertFalse(ActivityNotificationPolicy.retry(status))
        for (status in listOf(409, 429, 500, 503)) assertTrue(ActivityNotificationPolicy.retry(status))
    }
    @Test fun registersNoProviderUsingCurrentDeviceCredentialsAndNoToken() {
        val fake = object : JsonTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>, active: java.util.concurrent.atomic.AtomicReference<java.net.HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
                assertEquals("${host.origin}/personal/v1/push/registration", url); assertEquals("PUT", method)
                assertEquals("android", body!!.getString("platform")); assertEquals("none", body.getString("provider")); assertTrue(body.isNull("token"))
                assertEquals(host.cookie, headers["Cookie"]); assertEquals(host.csrf, headers["X-WeftMate-CSRF"])
                return HttpReply(200, JSONObject().put("configured", false))
            }
        }
        assertFalse(PersonalApi(fake).registerPush(host).getBoolean("configured"))
    }
    @Test fun exactActivityRoutesPermitOpaqueCursorsAndRejectForeignRoutes() {
        assertTrue(validBusinessPath("/personal/v1/activity/changes?limit=200&cursor=opaque.token-123"))
        assertTrue(validBusinessPath("/personal/v1/activity/activity-id/read"))
        assertFalse(validBusinessPath("/personal/v1/activity/../auth/login"))
        assertFalse(validBusinessPath("/personal/v1/push/registration"))
    }
}
