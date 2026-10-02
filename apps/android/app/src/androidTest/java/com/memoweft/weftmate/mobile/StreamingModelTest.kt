package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicReference

/** Synthetic SSE frames; no model, network or device Intent is invoked. */
@RunWith(AndroidJUnit4::class)
class StreamingModelTest {
    @Test fun lengthFinishIsPartialForStreamAndJson() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val history = listOf(LocalMessage("msg-1", "user", "解释一下"))
        val tools = object : DeviceToolExecutor {
            override fun execute(name: String, arguments: JSONObject): ToolResult = throw AssertionError("No tool")
        }
        val stream = object : SseTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply = throw AssertionError("No JSON")
            override fun streamRequest(url: String, body: JSONObject, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>, readTimeoutMs: Int,
                onData: (String) -> Unit): JSONObject? {
                onData("""{"choices":[{"delta":{"content":"前半段"}}]}""")
                onData("""{"choices":[{"delta":{},"finish_reason":"length"}]}""")
                return null // Synthetic complete [DONE] frame at transport level.
            }
        }
        val json = object : JsonTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply = HttpReply(200,
                JSONObject().put("choices", org.json.JSONArray().put(JSONObject().put("finish_reason", "length")
                    .put("message", JSONObject().put("role", "assistant").put("content", "前半段")))))
        }
        for (transport in listOf(stream, json)) {
            try {
                ModelClient(context, transport, tools).complete(ModelSettings("https://model.example/v1", "synthetic", ""),
                    history, receipt = { _, _, _, _ -> })
                fail("Length must never become completed")
            } catch (error: ModelNotCompleted) {
                assertEquals("MODEL_OUTPUT_LIMIT", error.code)
                assertEquals("前半段", error.partialText)
            }
        }
        val filtered = object : JsonTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply = HttpReply(200,
                JSONObject().put("choices", org.json.JSONArray().put(JSONObject().put("finish_reason", "content_filter")
                    .put("message", JSONObject().put("role", "assistant").put("content", "保留部分")))))
        }
        try {
            ModelClient(context, filtered, tools).complete(ModelSettings("https://model.example/v1", "synthetic", ""),
                history, receipt = { _, _, _, _ -> })
            fail("Filtered output must not complete")
        } catch (error: ModelNotCompleted) { assertEquals("MODEL_CONTENT_FILTERED", error.code) }
    }

    @Test fun truncatedSseNeverBecomesCompletedReply() {
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
            val listener = Thread {
                server.accept().use { socket ->
                    val input = socket.getInputStream().bufferedReader()
                    while (input.readLine()?.isNotEmpty() == true) { }
                    socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n"+
                        "data: {\"choices\":[{\"delta\":{\"content\":\"只生成一半\"}}]}\n\n").toByteArray())
                    socket.getOutputStream().flush()
                }
            }.apply { start() }
            val received = mutableListOf<String>()
            try {
                JsonHttp().streamRequest("http://127.0.0.1:${server.localPort}/v1/chat/completions",
                    JSONObject().put("model", "synthetic").put("stream", true), emptyMap(), AtomicReference(), 3000,
                    received::add)
                fail("Expected missing [DONE] rejection")
            } catch (error: ApiFailure) { assertEquals("MODEL_STREAM_INCOMPLETE", error.safeCode) }
            assertEquals(1, received.size)
            listener.join(2000)
        }
    }
    @Test fun collectorKeepsActualReasoningPhaseAndToolArguments() {
        val phases = mutableListOf<String>()
        val partials = mutableListOf<String>()
        val collector = SseMessageCollector(partials::add, phases::add)
        collector.accept("""{"choices":[{"delta":{"reasoning_content":"private thought"}}]}""")
        collector.accept("""{"choices":[{"delta":{"content":"你好"}}]}""")
        collector.accept("""{"choices":[{"delta":{"content":"，世界"}}]}""")
        assertEquals(listOf("reasoning", "answering"), phases)
        assertEquals(listOf("你好", "你好，世界"), partials)
        assertEquals("你好，世界", collector.message().getString("content"))
        assertFalse(collector.message().toString().contains("private thought"))
    }

    @Test fun cancellationCarriesGeneratedTextWithoutInventingCompletion() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        lateinit var client: ModelClient
        val transport = object : SseTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
                fail("Streaming transport should not use JSON request")
                throw AssertionError()
            }
            override fun streamRequest(url: String, body: JSONObject, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>, readTimeoutMs: Int,
                onData: (String) -> Unit): JSONObject? {
                assertTrue(body.getBoolean("stream"))
                onData("""{"choices":[{"delta":{"content":"已经生成的正文"}}]}""")
                client.cancel()
                throw ModelCancelled()
            }
        }
        client = ModelClient(context, transport, object : DeviceToolExecutor {
            override fun execute(name: String, arguments: JSONObject): ToolResult {
                fail("No tool should execute")
                throw AssertionError()
            }
        })
        try {
            client.complete(ModelSettings("https://model.example/v1", "selected-model", ""),
                listOf(LocalMessage("msg-1", "user", "你好")), receipt = { _, _, _, _ -> })
            fail("Expected cancellation")
        } catch (error: ModelCancelled) {
            assertEquals("已经生成的正文", error.partialText)
        }
    }
}
