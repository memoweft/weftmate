package com.memoweft.weftmate.mobile

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import java.util.UUID
import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class PhoneModelServicesTest {
    @Test fun nativeClaudeServiceListsAllPagesKeepsDeclaredAbilitiesAndUsesMessages() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val storage = "synthetic-claude-service-$suffix"
        val alias = "synthetic-claude-service-$suffix"
        val credential = UUID.randomUUID().toString()
        val accountId = "synthetic-$suffix"
        var pages = 0
        try {
            val settings = SecureSettings(context, storage, alias)
            settings.saveAppValue("credentials", JSONObject().put("app-tokens:synthetic", JSONObject().put("sub", accountId)).toString())
            val transport = object : JsonTransport {
                override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                    active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
                    assertTrue(headers["x-api-key"] == credential)
                    assertEquals("2023-06-01", headers["anthropic-version"])
                    assertFalse(headers.containsKey("Authorization"))
                    if (method == "GET") {
                        pages++
                        if (pages == 1) return HttpReply(200, JSONObject().put("data", JSONArray().put(JSONObject()
                            .put("id", "claude-haiku-current"))).put("has_more", true).put("last_id", "claude-haiku-current"))
                        assertTrue(url.endsWith("/models?after_id=claude-haiku-current"))
                        return HttpReply(200, JSONObject().put("data", JSONArray().put(JSONObject()
                            .put("id", "claude-quality-current").put("display_name", "质量模型").put("max_input_tokens", 200000)
                            .put("capabilities", JSONObject().put("image_input", JSONObject().put("supported", true))
                                .put("thinking", JSONObject().put("supported", true).put("types", JSONObject()
                                    .put("adaptive", JSONObject().put("supported", true)).put("enabled", JSONObject().put("supported", false)))))))
                            .put("has_more", false))
                    }
                    assertEquals("https://model.example/custom/messages", url)
                    assertEquals("claude-quality-current", body!!.getString("model"))
                    assertEquals("adaptive", body.getJSONObject("thinking").getString("type"))
                    assertFalse(body.getJSONObject("thinking").has("budget_tokens"))
                    return HttpReply(200, JSONObject().put("stop_reason", "end_turn").put("content", JSONArray()
                        .put(JSONObject().put("type", "text").put("text", "已使用所选型号。"))))
                }
            }
            val phone = PhoneAccount(context, settings, transport)
            phone.adopt(JSONObject().put("origin", "https://account.example").put("email", "synthetic@example.test")
                .put("accountId", accountId).put("deviceId", "synthetic-phone"))
            val configured = phone.models("serviceConfigure", JSONObject().put("name", "合成 Claude")
                .put("endpoint", "https://model.example/custom/messages").put("interfaceType", "anthropic").put("apiKey", credential))
            val service = configured.getJSONArray("services").getJSONObject(0)
            assertEquals(2, pages)
            assertEquals(2, service.getJSONArray("models").length())
            val model = service.getJSONArray("models").getJSONObject(1)
            assertTrue(model.getJSONObject("capabilities").getBoolean("vision"))
            assertEquals(200000, model.getJSONObject("capabilities").getInt("contextWindow"))
            assertEquals("adaptive", model.getJSONObject("deepThinking").getString("type"))
            val serviceId = service.getString("serviceId")
            phone.models("serviceSelect", JSONObject().put("serviceId", serviceId).put("modelId", "claude-quality-current"))
            val completed = phone.complete(JSONObject().put("model", "claude-quality-current")
                .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "你好")))
                .put("thinking", JSONObject().put("type", "adaptive")), AtomicReference(), serviceId) { }
            assertEquals("已使用所选型号。", completed.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content"))
            assertFalse(configured.toString().contains(credential))
        } finally {
            context.deleteSharedPreferences(storage)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }

    @Test fun newPhoneServiceBridgeReturnsAllModelsKeepsLegacyFieldsAndSelectsWithoutReturningTheKey() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val storage = "synthetic-service-bridge-$suffix"
        val alias = "synthetic-service-bridge-$suffix"
        val credential = UUID.randomUUID().toString()
        val accountId = "synthetic-$suffix"
        try {
            val settings = SecureSettings(context, storage, alias)
            settings.saveAppValue("credentials", JSONObject().put("app-tokens:synthetic", JSONObject().put("sub", accountId)).toString())
            val transport = object : JsonTransport {
                override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                    active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
                    assertEquals("https://model.example/v1/models", url)
                    assertEquals("GET", method)
                    assertTrue(headers["Authorization"] == "Bearer $credential")
                    return HttpReply(200, JSONObject().put("data", JSONArray()
                        .put(JSONObject().put("id", "mimo-v2.6-flash"))
                        .put(JSONObject().put("id", "mimo-v2.6-pro"))
                        .put(JSONObject().put("id", "mimo-v2.5-asr"))))
                }
            }
            val phone = PhoneAccount(context, settings, transport)
            phone.adopt(JSONObject().put("origin", "https://account.example").put("email", "synthetic@example.test")
                .put("accountId", accountId).put("deviceId", "synthetic-phone"))
            val result = phone.models("serviceConfigure", JSONObject().put("name", "合成服务")
                .put("endpoint", "https://model.example/v1").put("apiKey", credential))
            val service = result.getJSONArray("services").getJSONObject(0)
            assertEquals(2, service.getJSONArray("models").length())
            assertEquals("available", service.getJSONObject("catalog").getString("status"))
            val selected = phone.models("serviceSelect", JSONObject().put("serviceId", service.getString("serviceId"))
                .put("modelId", "mimo-v2.6-pro"))
            assertEquals("mimo-v2.6-pro", selected.getString("modelId"))
            val old = phone.models("list", JSONObject())
            assertEquals(2, old.getJSONArray("models").length())
            assertEquals("mimo-v2.6-pro", old.getJSONObject("selected").getString("modelId"))
            assertTrue(old.getJSONArray("models").getJSONObject(0).has("endpoint"))
            assertFalse(old.toString().contains(credential))
            assertFalse(selected.toString().contains(credential))
            phone.models("serviceUpdate", JSONObject().put("serviceId", service.getString("serviceId"))
                .put("enabledModelIds", JSONArray().put("mimo-v2.6-flash")))
            assertEquals("mimo-v2.6-flash", phone.models("list", JSONObject()).getJSONObject("selected").getString("modelId"))
        } finally {
            context.deleteSharedPreferences(storage)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }

    @Test fun oldEncryptedLibraryMigratesOnceAndKeepsSelectionCredentialsAndBackupAcrossRestart() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val storage = "synthetic-service-$suffix"
        val alias = "synthetic-service-$suffix"
        val credential = UUID.randomUUID().toString()
        try {
            val settings = SecureSettings(context, storage, alias)
            val old = JSONObject().put("version", 1).put("providers", JSONArray().put(JSONObject()
                .put("endpoint", "https://model.example/v1").put("apiKey", credential)
                .put("models", JSONArray().put(JSONObject().put("id", "chat-first").put("label", "Chat First"))
                    .put(JSONObject().put("id", "chat-second").put("label", "Chat Second")))))
                .put("activeEndpoint", "https://model.example/v1").put("activeModelId", "chat-second")
            val encrypt = SecureSettings::class.java.getDeclaredMethod("encrypt", String::class.java).apply { isAccessible = true }
            val ciphertext = encrypt.invoke(settings, old.toString()) as String
            val prefs = context.getSharedPreferences(storage, Context.MODE_PRIVATE)
            check(prefs.edit().putBoolean("models_v3_migrated", true).putBoolean("legacy_owner_captured", true)
                .putString("models_v3:local", ciphertext).commit())
            val services = settings.modelServices("local").getJSONArray("services")
            assertEquals(1, services.length())
            val id = services.getJSONObject(0).getString("serviceId")
            assertEquals(2, services.getJSONObject(0).getJSONArray("models").length())
            assertEquals("chat-second", settings.model("local")?.modelId)
            assertTrue(settings.model("local")?.apiKey == credential)
            assertEquals(ciphertext, prefs.getString("models_service_backup:local", null))
            assertFalse(prefs.getString("models_v3:local", "")!!.contains(credential))
            assertFalse(settings.modelServices("local").toString().contains(credential))
            val again = SecureSettings(context, storage, alias)
            assertEquals(id, again.modelServices("local").getJSONArray("services").getJSONObject(0).getString("serviceId"))
            assertEquals("chat-second", again.model("local")?.modelId)
            assertTrue(again.model("local")?.apiKey == credential)
            again.cacheModelServiceCatalog(id, listOf(DiscoveredModel("chat-third", "Chat Third")), "available", "local")
            assertEquals(3, again.modelServices("local").getJSONArray("services").getJSONObject(0).getJSONArray("models").length())
            again.selectServiceModel(id, "chat-third", "local")
            assertEquals("chat-third", SecureSettings(context, storage, alias).model("local")?.modelId)
            // A broken replacement reads the encrypted pre-migration backup without losing the old model.
            check(prefs.edit().putString("models_v3:local", "broken-ciphertext").commit())
            assertEquals("chat-second", SecureSettings(context, storage, alias).model("local")?.modelId)
            assertTrue(SecureSettings(context, storage, alias).model("local")?.apiKey == credential)
        } finally {
            context.deleteSharedPreferences(storage)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }
}
