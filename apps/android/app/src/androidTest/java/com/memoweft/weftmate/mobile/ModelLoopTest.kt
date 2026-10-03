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
    @Test fun requestHookReportsTheActualMiMoModelAndRouteWithoutAnyCredential() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val observed = mutableListOf<Pair<String, String>>()
        val transport = object : JsonTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
                assertEquals("mimo-v2.6-flash", body?.getString("model"))
                return HttpReply(200, JSONObject().put("choices", JSONArray().put(JSONObject()
                    .put("message", JSONObject().put("content", "synthetic answer"))
                    .put("finish_reason", "stop"))))
            }
        }
        val tools = object : DeviceToolExecutor {
            override fun execute(name: String, arguments: JSONObject): ToolResult =
                throw AssertionError("No device action expected")
        }
        val answer = ModelClient(context, transport, tools).complete(
            ModelSettings("https://api.xiaomimimo.com/v1", "MiMo-V2.6-Flash", "synthetic-key"),
            listOf(LocalMessage("msg-1", "user", "synthetic goal")),
            receipt = { _, _, _, _ -> }, onRequestStart = { route, model -> observed += route to model })
        assertEquals("synthetic answer", answer)
        assertEquals(listOf("https://api.xiaomimimo.com/v1/chat/completions" to "mimo-v2.6-flash"), observed)
    }

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
