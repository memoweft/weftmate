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
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class MiMoUpstreamInstrumentedTest {
    private val noTools = object : DeviceToolExecutor {
        override fun execute(name: String, arguments: JSONObject): ToolResult = throw AssertionError("No tool expected")
    }
    private val history = listOf(LocalMessage("synthetic-user", "user", "合成测试"))

    private fun withServer(status: Int, contentType: String = "application/json", response: String = "{}",
        action: (String, AtomicReference<JSONObject?>) -> Unit) {
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
            val body = AtomicReference<JSONObject?>()
            val failure = AtomicReference<Throwable?>()
            val listener = Thread {
                try {
                    server.accept().use { socket ->
                        socket.soTimeout = 5000
                        val input = socket.getInputStream()
                        fun line(): String {
                            val bytes = java.io.ByteArrayOutputStream()
                            while (true) {
                                val next = input.read()
                                if (next < 0 || next == '\n'.code) break
                                if (next != '\r'.code) bytes.write(next)
                            }
                            return bytes.toString("UTF-8")
                        }
                        var contentLength = 0
                        while (true) {
                            val header = line()
                            if (header.isEmpty()) break
                            if (header.startsWith("Content-Length:", ignoreCase = true))
                                contentLength = header.substringAfter(':').trim().toInt()
                        }
                        val bytes = ByteArray(contentLength)
                        var read = 0
                        while (read < contentLength) {
                            val count = input.read(bytes, read, contentLength - read)
                            if (count < 0) break
                            read += count
                        }
                        if (read == contentLength && read > 0) body.set(JSONObject(String(bytes, Charsets.UTF_8)))
                        val responseBytes = response.toByteArray(Charsets.UTF_8)
                        socket.getOutputStream().write(("HTTP/1.1 $status Synthetic\r\n" +
                            "Content-Type: $contentType\r\nContent-Length: ${responseBytes.size}\r\nConnection: close\r\n\r\n")
                            .toByteArray(Charsets.UTF_8))
                        socket.getOutputStream().write(responseBytes)
                        socket.getOutputStream().flush()
                    }
                } catch (error: Throwable) { failure.set(error) }
            }.apply { start() }
            try { action("http://127.0.0.1:${server.localPort}/v1", body) }
            finally {
                listener.join(5000)
                assertFalse("Synthetic server still running", listener.isAlive)
                failure.get()?.let { throw AssertionError("Synthetic server failed", it) }
            }
        }
    }

    @Test fun savedUppercaseMiMoUsesCanonicalIdAndSseCompletes() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val prefs = "mimo-test-$suffix"
        val alias = "mimo-test-$suffix"
        try {
            val settings = SecureSettings(context, prefs, alias)
            settings.saveModel(ModelSettings("https://api.xiaomimimo.com/v1", "MiMo-V2.6-Flash", "synthetic-key"))
            val saved = SecureSettings(context, prefs, alias).model()!!
            assertEquals("MiMo-V2.6-Flash", saved.modelId)
            val frames = "data: {\"choices\":[{\"delta\":{\"content\":\"合成回复\"}}]}\n\n" +
                "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n" +
                "data: [DONE]\n\n"
            withServer(200, "text/event-stream", frames) { localUrl, captured ->
                val forwarding = object : SseTransport by JsonHttp() {
                    override fun streamRequest(url: String, body: JSONObject, headers: Map<String, String>,
                        active: AtomicReference<HttpURLConnection?>, readTimeoutMs: Int,
                        onData: (String) -> Unit): JSONObject? {
                        assertEquals("https://api.xiaomimimo.com/v1/chat/completions", url)
                        return JsonHttp().streamRequest(Endpoints.modelUrl(localUrl), body, emptyMap(), active,
                            readTimeoutMs, onData)
                    }
                }
                val result = ModelClient(context, forwarding, noTools).complete(saved, history,
                    receipt = { _, _, _, _ -> })
                assertEquals("合成回复", result)
                assertEquals("mimo-v2.6-flash", captured.get()?.getString("model"))
                assertTrue(captured.get()?.getBoolean("stream") == true)
                assertTrue(captured.get()?.has("tools") == true)
                assertEquals("auto", captured.get()?.getString("tool_choice"))
            }
        } finally {
            context.getSharedPreferences(prefs, 0).edit().clear().commit()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }

    @Test fun onlyOfficialMiMoIdsChangeOnWire() {
        val official = ModelSettings("https://api.xiaomimimo.com/v1", "MiMo-V2.6-Flash", "")
        assertEquals("mimo-v2.6-flash", requestModelId(official))
        assertEquals("Custom-V2.6-Flash", requestModelId(official.copy(modelId = "Custom-V2.6-Flash")))
        assertEquals("MiMo-V2.6-Flash", requestModelId(official.copy(endpoint = "https://model.example/v1")))
        assertEquals("MiMo-V2.6-Flash", requestModelId(official.copy(endpoint = "https://api.xiaomimimo.com.evil.test/v1")))
        assertEquals("MiMo-V2.6-Flash", requestModelId(official.copy(endpoint = "https://api.xiaomimimo.com:8443/v1")))
        assertEquals("MiMo-V2.6-Flash", requestModelId(official.copy(endpoint = "https://api.xiaomimimo.com/custom/v1")))
    }

    @Test fun upstreamStatusesSurviveWithoutResponseBodyAndFinishOnce() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        for (status in listOf(400, 401, 429, 503)) {
            withServer(status, response = "{\"error\":\"synthetic-private-detail\"}") { localUrl, _ ->
                val failure = try {
                    JsonHttp().streamRequest(Endpoints.modelUrl(localUrl),
                        JSONObject().put("model", "synthetic").put("stream", true), emptyMap(),
                        AtomicReference(), 3000) { }
                    fail("Expected HTTP $status")
                    throw AssertionError()
                } catch (error: ApiFailure) { error }
                assertEquals("MODEL_UPSTREAM_ERROR", failure.safeCode)
                assertEquals(status, upstreamHttpStatus(failure))
                val name = "mimo-status-${UUID.randomUUID()}.db"
                try {
                    LocalStore(context, name).use { store ->
                        val conversation = store.createConversation("Synthetic", "owner-a")
                        val turn = store.startTurn(conversation.id)
                        store.finishTurn(turn, "failed", failure.safeCode, upstreamHttpStatus(failure))
                        store.finishTurn(turn, "failed", failure.safeCode, upstreamHttpStatus(failure))
                        val events = store.pending("owner-a").filter { it.body.getString("kind") == "turn.finished" }
                        assertEquals(1, events.size)
                        val payload = events.single().body.getJSONObject("payload")
                        assertEquals(status, payload.getInt("upstreamHttpStatus"))
                        assertFalse(payload.toString().contains("synthetic-private-detail"))
                        val reopened = store.latestTurnFailure(conversation.id, "owner-a")!!
                        assertEquals("MODEL_UPSTREAM_ERROR", reopened.getString("turnErrorCode"))
                        assertEquals(status, reopened.getInt("upstreamHttpStatus"))
                        assertNull(store.latestTurnFailure(conversation.id, "owner-b"))
                    }
                } finally { context.deleteDatabase(name) }
            }
        }
        assertNull(upstreamHttpStatus(ApiFailure(399, "MODEL_UPSTREAM_ERROR")))
        assertNull(upstreamHttpStatus(ApiFailure(600, "MODEL_UPSTREAM_ERROR")))
        assertNull(upstreamHttpStatus(ApiFailure(401, "LOGIN_REQUIRED")))
        assertNull(upstreamHttpStatus(ModelCancelled()))
    }

    @Test fun cancellationHasOneTerminalEventWithoutUpstreamStatus() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "mimo-cancel-${UUID.randomUUID()}.db"
        try {
            LocalStore(context, name).use { store ->
                val conversation = store.createConversation("Synthetic", "owner-a")
                val turn = store.startTurn(conversation.id)
                store.finishTurn(turn, "cancelled")
                store.finishTurn(turn, "failed", "MODEL_UPSTREAM_ERROR", 503)
                val events = store.pending("owner-a").filter { it.body.getString("kind") == "turn.finished" }
                assertEquals(1, events.size)
                assertEquals("cancelled", events.single().body.getJSONObject("payload").getString("status"))
                assertFalse(events.single().body.getJSONObject("payload").has("upstreamHttpStatus"))
                assertNull(store.latestTurnFailure(conversation.id, "owner-a"))
            }
        } finally { context.deleteDatabase(name) }
    }
}
