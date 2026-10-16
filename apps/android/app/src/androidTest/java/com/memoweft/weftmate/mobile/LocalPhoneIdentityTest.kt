package com.memoweft.weftmate.mobile

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyStore
import java.util.UUID

class LocalPhoneIdentityTest {
    @Test fun localSpaceSurvivesCloudAccountAdoptionAndReturnsAfterLogout() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val storage = "synthetic-local-$suffix"
        val alias = "synthetic-local-$suffix"
        val settings = SecureSettings(context, storage, alias)
        val phone = PhoneAccount(context, settings)
        val local = phone.bootstrapIdentity()
        val localVault = OfflineVault(context, local)
        var cloud: HostIdentity? = null
        try {
            assertEquals("phone-local", local.authSource)
            assertTrue(local.cookie.isEmpty() && local.csrf.isEmpty())
            assertNull(settings.appValue("credentials"))
            val original = JSONObject().put("turns", JSONArray()).put("conversations", JSONArray()
                .put(JSONObject().put("id", "local-chat").put("title", "本机合成记录")))
            localVault.save(original)
            phone.models("configure", JSONObject().put("endpoint", "https://model.example/v1")
                .put("modelId", "synthetic-model").put("apiKey", "synthetic-local-key"))
            assertEquals(local, PhoneAccount(context, SecureSettings(context, storage, alias)).bootstrapIdentity())
            try {
                phone.adopt(JSONObject().put("origin", "https://cloud.example").put("accountId", "unauthorized")
                    .put("email", "synthetic@example.test").put("deviceId", "cloud-device"))
                fail("Cloud adoption must require a real saved credential subject")
            } catch (_: IllegalArgumentException) { }
            settings.saveAppValue("credentials", JSONObject().put("app-tokens:synthetic", JSONObject().put("sub", "cloud-owner")).toString())
            cloud = phone.adopt(JSONObject().put("origin", "https://cloud.example").put("accountId", "cloud-owner")
                .put("email", "synthetic@example.test").put("deviceId", "cloud-device"))
            settings.saveHost(cloud)
            assertEquals(cloud, phone.bootstrapIdentity())
            assertEquals("cloud-owner", phone.identity().ownerId)
            assertFalse(local.ownerId == cloud.ownerId)
            assertEquals(0, phone.models("list", JSONObject()).getJSONArray("models").length())
            assertEquals(0, OfflineVault(context, cloud).load().getJSONArray("conversations").length())
            assertEquals("本机合成记录", localVault.load().getJSONArray("conversations").getJSONObject(0).getString("title"))
            settings.clearHost()
            val restored = PhoneAccount(context, SecureSettings(context, storage, alias)).bootstrapIdentity()
            assertEquals(local, restored)
            assertEquals("synthetic-model", phone.models("list", JSONObject()).getJSONObject("selected").getString("modelId"))
            assertEquals(original.toString(), OfflineVault(context, restored).load().toString())
        } finally {
            localVault.clear()
            cloud?.let { OfflineVault(context, it).clear() }
            context.deleteSharedPreferences(storage)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }

    @Test fun existingAuthenticatedHostIsNeverReplacedOnBootstrap() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val settings = SecureSettings(context, "synthetic-existing-$suffix", "synthetic-existing-$suffix")
        try {
            for (source in listOf("local", "cloud", "phone")) {
                val host = HostIdentity("https://host.example", "synthetic", "owner", "host", "device", "cookie", "csrf", source)
                settings.saveHost(host)
                assertEquals(host, PhoneAccount(context, settings).bootstrapIdentity())
                assertNull(settings.appValue("local-phone-account"))
            }
        } finally {
            context.deleteSharedPreferences("synthetic-existing-$suffix")
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("synthetic-existing-$suffix") }
        }
    }
}
