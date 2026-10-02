package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class ModelLibraryTest {
    @Test fun twoEndpointsKeepIndependentKeysAndNamesAcrossRestart() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val prefsName = "synthetic-model-$suffix"
        val alias = "synthetic-model-$suffix"
        try {
            val settings = SecureSettings(context, prefsName, alias)
            settings.saveModel(ModelSettings("https://one.example/v1", "model-one", "synthetic-one", "第一档"))
            settings.saveModel(ModelSettings("https://two.example/v1", "model-two", "synthetic-two", "第二档"))
            val first = settings.selectModel("https://one.example/v1", "model-one")
            assertEquals("synthetic-one", first.apiKey)
            assertEquals("第一档", first.displayName)
            val again = SecureSettings(context, prefsName, alias)
            assertEquals("第一档", again.model()?.displayName)
            assertEquals("synthetic-two", again.modelProfiles().first { it.modelId == "model-two" }.apiKey)
            again.saveModel(ModelSettings("https://two.example/v1", "model-three", "", "第三档"))
            assertEquals("synthetic-two", again.model()?.apiKey)
            assertEquals("synthetic-one", again.modelProfiles().first { it.modelId == "model-one" }.apiKey)
            val encrypted = context.getSharedPreferences(prefsName, android.content.Context.MODE_PRIVATE)
            val scoped = encrypted.getString("models_v3:local", null)!!
            assertFalse(scoped.contains("synthetic-one"))
            assertFalse(scoped.contains("synthetic-two"))
            assertFalse(encrypted.contains("models_v2"))
        } finally {
            context.deleteSharedPreferences(prefsName)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }

    @Test fun differentAccountsNeverSeeEachOthersPhoneProviderKeys() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val prefsName = "synthetic-owners-$suffix"
        val alias = "synthetic-owners-$suffix"
        val a = HostIdentity("https://home.example", "alice", "owner-a", "host", "device-a", "synthetic-a", "csrf-a")
        val b = HostIdentity("https://home.example", "bob", "owner-b", "host", "device-b", "synthetic-b", "csrf-b")
        try {
            val settings = SecureSettings(context, prefsName, alias)
            settings.saveHost(a)
            settings.saveModel(ModelSettings("https://alice.example/v1", "alice-model", "synthetic-alice-key"))
            val scopeA = Endpoints.ownerKey(a.origin, a.ownerId)
            val scopeB = Endpoints.ownerKey(b.origin, b.ownerId)
            settings.saveProfile(scopeA, JSONObject().put("displayName", "Alice synthetic"))
            settings.saveHost(b)
            assertNull(settings.model())
            assertTrue(settings.modelProfiles().isEmpty())
            assertNull(settings.cachedProfile(scopeB))
            settings.saveModel(ModelSettings("https://bob.example/v1", "bob-model", "synthetic-bob-key"))
            settings.saveProfile(scopeB, JSONObject().put("displayName", "Bob synthetic"))
            settings.saveHost(a)
            assertEquals("alice-model", settings.model()?.modelId)
            assertEquals("synthetic-alice-key", settings.model()?.apiKey)
            assertEquals(1, settings.modelProfiles().size)
            assertEquals("Alice synthetic", settings.cachedProfile(scopeA)?.getString("displayName"))
            settings.clearHost()
            assertNull(settings.model())
            settings.saveModel(ModelSettings("https://local.example/v1", "local-model", "synthetic-local-key"))
            settings.saveHost(b)
            assertEquals("bob-model", settings.model()?.modelId)
            assertEquals("synthetic-bob-key", settings.model()?.apiKey)
            assertEquals("Bob synthetic", settings.cachedProfile(scopeB)?.getString("displayName"))
        } finally {
            context.deleteSharedPreferences(prefsName)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }

    @Test fun catalogUsesProviderDisplayNameWithoutPersistingItUntilSelection() {
        val fake = object : JsonTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
                assertEquals("https://one.example/v1/models", url)
                assertEquals("Bearer synthetic-key", headers["Authorization"])
                assertEquals("GET", method)
                return HttpReply(200, JSONObject().put("data", JSONArray().put(JSONObject()
                    .put("id", "provider-model").put("display_name", "好记的名字"))))
            }
        }
        val models = ModelCatalogClient(fake).discover(ModelSettings("https://one.example/v1", "provider-model", "synthetic-key"))
        assertEquals(listOf(DiscoveredModel("provider-model", "好记的名字")), models)
    }
}
