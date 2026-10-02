package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class ModelLoopTest {
    @Test fun repeatedDispatchedToolStopsWithoutSecondDeviceAction() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        var modelCalls = 0
        var deviceCalls = 0
        val transport = object : JsonTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
                modelCalls += 1
                val call = JSONObject().put("id", "provider-call-$modelCalls").put("function",
                    JSONObject().put("name", "open_settings").put("arguments", "{}"))
                return HttpReply(200, JSONObject().put("choices", JSONArray().put(JSONObject().put("message",
                    JSONObject().put("tool_calls", JSONArray().put(call))))))
            }
        }
        val fakeTools = object : DeviceToolExecutor {
            override fun execute(name: String, arguments: JSONObject): ToolResult {
                deviceCalls += 1
                return ToolResult("dispatched", "synthetic dispatch", JSONObject().put("dispatched", true))
            }
        }
        val receipts = mutableListOf<String>()
        val client = ModelClient(context, transport, fakeTools)
        try {
            client.complete(ModelSettings("https://model.example/v1", "test-model", ""),
                listOf(LocalMessage("msg-1", "user", "打开设置")),
                receipt = { id, _, _, _ -> receipts += id })
            fail("Expected bounded repeat")
        } catch (_: ModelLimitReached) { }
        assertEquals(2, modelCalls)
        assertEquals(1, deviceCalls)
        assertEquals(1, receipts.size)
        assertTrue(receipts.single().matches(Regex("tool-[0-9a-f-]{36}")))
    }
}
