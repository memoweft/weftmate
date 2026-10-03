package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class Stage13AccountModelsTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun versionSixUpgradePreservesPhoneRowsAndAddsPrivateModelIntents() {
        val database = "stage13-upgrade-${UUID.randomUUID()}.db"
        val path = context.getDatabasePath(database)
        path.parentFile?.mkdirs()
        val old = SQLiteDatabase.openOrCreateDatabase(path, null)
        try {
            old.execSQL("CREATE TABLE conversations(id TEXT PRIMARY KEY,owner_key TEXT,title TEXT NOT NULL,created_at TEXT NOT NULL,source_event_id TEXT)")
            old.execSQL("INSERT INTO conversations(id,owner_key,title,created_at) VALUES('conversation-old','owner-old','原手机消息','2026-10-03T00:00:00Z')")
            old.version = 6
        } finally { old.close() }
        val store = LocalStore(context, database)
        try {
            store.readableDatabase.rawQuery("SELECT title FROM conversations WHERE id='conversation-old'", null).use {
                assertTrue(it.moveToFirst())
                assertEquals("原手机消息", it.getString(0))
            }
            val body = JSONObject().put("modelId", "mimo-v2.6-flash")
            store.queueAccountModelIntent("owner-old", "host-old", "request-old", "publish",
                "a".repeat(64), body)
            assertEquals("publish", store.accountModelIntent("owner-old", "host-old", "request-old")
                ?.getString("kind"))
        } finally { store.close(); context.deleteDatabase(database) }
    }

    @Test fun nativePublishAndTransferKeepSecretsOutOfBridgeAndPreserveSelectionOnConflict() {
        val suffix = UUID.randomUUID().toString()
        val database = "stage13-model-$suffix.db"
        val prefs = "stage13-model-$suffix"
        val alias = "stage13-model-$suffix"
        val store = LocalStore(context, database)
        val secrets = SecureSettings(context, prefs, alias)
        val host = HostIdentity("http://127.0.0.1:18188", "Synthetic", "owner-$suffix",
            "device-host-$suffix", "device-phone-$suffix", "synthetic-cookie", "synthetic-csrf")
        val owner = Endpoints.ownerKey(host.origin, host.ownerId)
        val local = ModelSettings("https://api.xiaomimimo.com/v1/chat/completions", "MiMo-V2.6-Flash",
            "synthetic-private-phone-key", "MiMo phone")
        val other = ModelSettings("https://other.example/v1", "other", "synthetic-other-key", "Other")
        secrets.saveModel(local, owner)
        secrets.saveModel(other, owner)
        var creates = 0
        var transfers = 0
        var savedOperation: JSONObject? = null
        val shared = JSONObject().put("accountModelId", "account-model-$suffix")
            .put("revision", 1).put("profileId", "private-$suffix")
            .put("name", "MiMo account").put("provider", "openai-compatible")
            .put("baseUrl", "https://api.xiaomimimo.com/v1")
            .put("modelId", "mimo-v2.6-flash")
            .put("routeFingerprint", "a".repeat(64)).put("configured", true)
            .put("status", "active")
        val transport = object : JsonTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply = when {
                url.endsWith("/sync/capabilities") -> HttpReply(200, JSONObject()
                    .put("deviceId", host.deviceId).put("sharedConversations", 1).put("nativeVersionCode", 12))
                url.endsWith("/account/models/by-request/publish-$suffix") ->
                    savedOperation?.let { HttpReply(200, it) } ?: throw ApiFailure(404, "NOT_FOUND")
                url.endsWith("/account/models") && method == "POST" -> {
                    creates++
                    assertEquals("synthetic-private-phone-key", body?.getString("apiKey"))
                    assertEquals("mimo-v2.6-flash", body!!.getString("modelId"))
                    assertEquals("https://api.xiaomimimo.com/v1", body.getString("baseUrl"))
                    savedOperation = JSONObject().put("operation", JSONObject()
                        .put("requestId", "publish-$suffix").put("kind", "create")
                        .put("accountModelId", shared.getString("accountModelId"))
                        .put("status", "succeeded").put("resultRevision", 1)).put("model", shared)
                    HttpReply(200, savedOperation!!)
                }
                url.endsWith("/account/models/${shared.getString("accountModelId")}") && method == "GET" ->
                    HttpReply(200, JSONObject().put("model", shared))
                url.endsWith("/account/models/${shared.getString("accountModelId")}/transfer") -> {
                    transfers++
                    HttpReply(200, JSONObject().put("model", shared)
                        .put("apiKey", "synthetic-account-transfer-key"))
                }
                else -> throw AssertionError("Unexpected synthetic account-model request")
            }
        }
        try {
            val account = AccountModels(store, PersonalApi(transport), secrets)
            val first = account.publishSaved(host, local.endpoint, local.modelId,
                "publish-$suffix") { true }
            assertEquals("succeeded", first.getString("state"))
            assertEquals(1, creates)
            assertFalse(first.toString().contains("synthetic-private-phone-key"))
            assertFalse(store.accountModelIntent(owner, host.hostId, "publish-$suffix")
                .toString().contains("synthetic-private-phone-key"))
            account.publishSaved(host, local.endpoint, local.modelId, "publish-$suffix") { true }
            assertEquals(1, creates)
            val conflict = account.importToPhone(host, shared.getString("accountModelId"), 1,
                "transfer-keep-$suffix", false) { true }
            assertEquals("credential_conflict", conflict.getString("status"))
            assertEquals("other", secrets.model(owner)?.modelId)
            assertEquals("synthetic-private-phone-key", secrets.modelProfiles(owner)
                .first { it.modelId == local.modelId }.apiKey)
            val replaced = account.importToPhone(host, shared.getString("accountModelId"), 1,
                "transfer-replace-$suffix", true) { true }
            assertEquals("saved", replaced.getString("status"))
            assertFalse(replaced.toString().contains("synthetic-account-transfer-key"))
            assertEquals("import cannot silently activate the account model",
                "other", secrets.model(owner)?.modelId)
            assertEquals("synthetic-account-transfer-key", secrets.modelProfiles(owner)
                .first { it.modelId == "mimo-v2.6-flash" }.apiKey)
            assertEquals(2, transfers)
        } finally {
            store.close();context.deleteDatabase(database)
            context.getSharedPreferences(prefs, android.content.Context.MODE_PRIVATE).edit().clear().commit()
            val keys = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (keys.containsAlias(alias)) keys.deleteEntry(alias)
        }
    }
}
