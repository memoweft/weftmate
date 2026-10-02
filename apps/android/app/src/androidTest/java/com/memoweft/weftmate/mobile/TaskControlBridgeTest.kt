package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class TaskControlBridgeTest {
    private class CaptureTransport : JsonTransport {
        data class Call(val url: String, val method: String, val body: JSONObject?, val headers: Map<String, String>)
        val calls = mutableListOf<Call>()
        override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
            active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
            calls += Call(url, method, body, headers)
            return HttpReply(202, JSONObject().put("task", JSONObject().put("taskId", "task-one")
                .put("control", JSONObject().put("state", "stop_requested"))))
        }
    }

    @Test fun taskWritesUseExactOwnerCookieCsrfAndActionBody() {
        val transport = CaptureTransport()
        val api = PersonalApi(transport)
        val a = HostIdentity("https://example.test", "a", "owner-a", "host-one", "device-a", "cookie=A", "csrf-A")
        val b = HostIdentity("https://example.test", "b", "owner-b", "host-one", "device-b", "cookie=B", "csrf-B")
        api.taskControl(a, "task-one", "supplements", "request-one", "补充资料")
        api.taskControl(a, "task-one", "stop", "request-two")
        api.taskControl(b, "task-one", "resume", "request-three", "核对旧文件后继续")
        assertEquals(listOf("supplements", "stop", "resume"), transport.calls.map { it.url.substringAfterLast('/') })
        assertTrue(transport.calls.all { it.method == "POST" && it.url.startsWith("https://example.test/personal/v1/tasks/task-one/") })
        assertEquals("补充资料", transport.calls[0].body!!.getString("text"))
        assertFalse(transport.calls[1].body!!.has("text"))
        assertEquals("核对旧文件后继续", transport.calls[2].body!!.getString("text"))
        assertEquals(listOf("cookie=A", "cookie=A", "cookie=B"), transport.calls.map { it.headers["Cookie"] })
        assertEquals(listOf("csrf-A", "csrf-A", "csrf-B"), transport.calls.map { it.headers["X-WeftMate-CSRF"] })
        assertEquals(listOf("https://example.test", "https://example.test", "https://example.test"),
            transport.calls.map { it.headers["Origin"] })
    }

    @Test fun activityProjectionCarriesTaskGroupingIdentityOnlyWhenPresent() {
        val child = JSONObject().put("commandId", "follow-one")
            .put("kind", "session.message").put("state", "accepted_by_dsh")
            .put("rootTaskId", "root-one").put("taskAction", "supplement")
        val projected = activityCommandProjection(child)
        assertEquals("root-one", projected.getString("rootTaskId"))
        assertEquals("supplement", projected.getString("taskAction"))
        assertEquals("follow-one", projected.getString("commandId"))
        assertEquals("accepted_by_dsh", projected.getString("status"))

        val root = activityCommandProjection(JSONObject().put("commandId", "root-one")
            .put("kind", "session.message").put("state", "accepted_by_dsh"))
        assertFalse(root.has("rootTaskId"))
        assertFalse(root.has("taskAction"))
    }
}
