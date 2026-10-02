package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class XiaomiCatalogFilterTest {
    private val rows = JSONArray().put(JSONObject().put("id", "mimo-v2.6-flash"))
        .put(JSONObject().put("id", "mimo-v2.5-asr"))
        .put(JSONObject().put("id", "mimo-v2.5-tts"))
        .put(JSONObject().put("id", "mimo-v2.5-tts-voice"))
        .put(JSONObject().put("id", "mimo-v2.5-tts-turbo"))
        .put(JSONObject().put("id", "custom-chat-model"))

    private val transport = object : JsonTransport {
        override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
            active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
            assertTrue(url.endsWith("/v1/models"))
            assertEquals("GET", method)
            return HttpReply(200, JSONObject().put("data", rows))
        }
    }

    @Test fun onlyOfficialXiaomiCatalogHidesKnownNonChatFamilies() {
        val client = ModelCatalogClient(transport)
        val official = ModelSettings("https://api.xiaomimimo.com/v1", "custom-chat-model", "")
        assertEquals(listOf("mimo-v2.6-flash", "custom-chat-model"),
            client.discover(official).map { it.id })
        assertEquals("custom-chat-model", official.modelId)
        assertEquals(rows.length(), client.discover(ModelSettings("https://other.example/v1", "mimo-v2.5-asr", "")).size)
        assertEquals(rows.length(), client.discover(ModelSettings("https://api.xiaomimimo.com:444/v1", "mimo-v2.5-asr", "")).size)
    }
}
