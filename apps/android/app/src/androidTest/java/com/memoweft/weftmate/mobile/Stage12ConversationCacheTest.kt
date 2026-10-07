package com.memoweft.weftmate.mobile

import android.database.sqlite.SQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID
import java.io.IOException
import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference

class Stage12ConversationCacheTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun id(prefix: String) = "$prefix-${UUID.randomUUID()}"

    @Test fun timelineCacheOpensTailPagesOlderAndKeepsLegacyForwardReading() {
        val database = "timeline-pages-${UUID.randomUUID()}.db"
        val owner = id("owner"); val host = id("host"); val session = id("session")
        val store = LocalStore(context, database)
        try {
            for (batch in 0 until 3) {
                val events = JSONArray()
                for (index in 0 until 100) events.put(JSONObject().put("seq", batch * 100 + index)
                    .put("type", if (index == 0) "step.started" else "assistant.message")
                    .put("data", JSONObject().put("text", "synthetic timeline")))
                store.saveSharedHistoryPage(owner, host, session, events, batch * 100L + 99)
            }
            val tail = store.cachedSharedHistory(owner, host, session)
            assertEquals(200, tail.getJSONArray("events").getJSONObject(0).getLong("seq"))
            assertEquals(299, tail.getLong("nextSeq")); assertTrue(tail.getBoolean("hasOlder"))
            val older = store.cachedSharedHistory(owner, host, session, beforeSeq = tail.getLong("nextBeforeSeq"))
            assertEquals(100, older.getJSONArray("events").getJSONObject(0).getLong("seq"))
            assertEquals(199, older.getJSONArray("events").getJSONObject(99).getLong("seq"))
            assertEquals(299, older.getLong("nextSeq"))
            val forward = store.cachedSharedHistory(owner, host, session, -1)
            assertEquals(0, forward.getJSONArray("events").getJSONObject(0).getLong("seq"))
            assertTrue(forward.getBoolean("hasMore"))
            assertEquals(0, store.cachedSharedHistory(id("other"), host, session).getJSONArray("events").length())
        } finally { store.close(); context.deleteDatabase(database) }
    }

    @Test fun ownerScopedHandoffAndHistoryTailSurviveRestartWithoutReplayingSync() {
        val database = "stage12-cache-${UUID.randomUUID()}.db"
        val owner = id("owner")
        val other = id("owner")
        val hostId = id("device")
        val sessionId = id("session")
        var store = LocalStore(context, database)
        try {
            val conversation = store.createConversation("Phone fact", owner)
            val messageId = store.addMessage(conversation.id, "user", "synthetic fact")
            val source = store.messageSyncEvent(owner, conversation.id, messageId)!!
            assertTrue(source.isNull("ackSeq"))
            store.queueHandoffIntent(owner, hostId, conversation.id, id("request"), "model-local", 7)
            val binding = JSONObject().put("source", "host").put("conversationId", conversation.id)
                .put("hostId", hostId).put("status", "active")
                .put("binding", JSONObject().put("sessionId", sessionId).put("cutoverSyncSeq", 7))
            store.saveSharedConversationSnapshot(owner, hostId, conversation.id, binding)
            val event = JSONObject().put("seq", 3).put("type", "assistant.message")
                .put("data", JSONObject().put("text", "host answer"))
            store.saveSharedHistoryPage(owner, hostId, sessionId, JSONArray().put(event), 4)
            assertEquals(1, store.cachedSharedHistory(owner, hostId, sessionId, -1)
                .getJSONArray("events").length())
            assertEquals(0, store.cachedSharedHistory(other, hostId, sessionId, -1)
                .getJSONArray("events").length())
            store.close()
            store = LocalStore(context, database)
            assertNotNull(store.handoffIntent(owner, hostId, conversation.id))
            assertEquals("active", store.sharedConversationSnapshot(owner, hostId, conversation.id)?.getString("status"))
            val cached = store.cachedSharedHistory(owner, hostId, sessionId, -1)
            assertEquals("host answer", cached.getJSONArray("events").getJSONObject(0)
                .getJSONObject("data").getString("text"))
            assertTrue(cached.getBoolean("tailUnknown"))
            assertFalse(cached.getBoolean("hostAvailable"))
            try {
                store.saveSharedHistoryPage(owner, hostId, sessionId,
                    JSONArray().put(JSONObject(event.toString()).put("data", JSONObject().put("text", "tampered"))), 4)
                throw AssertionError("changed event was accepted")
            } catch (error: ApiFailure) { assertEquals("HISTORY_CONFLICT", error.safeCode) }
            assertEquals(1, store.cachedSharedHistory(owner, hostId, sessionId, -1)
                .getJSONArray("events").length())
        } finally { store.close(); context.deleteDatabase(database) }
    }

    @Test fun invalidOptionalModelIdentityCannotBlockTerminalSyncOrLeakEndpoint() {
        val database = "stage12-model-optional-${UUID.randomUUID()}.db"
        val owner = id("owner")
        val store = LocalStore(context, database)
        try {
            val conversation = store.createConversation("Retained", owner)
            store.addMessage(conversation.id, "user", "normal goal")
            val turnId = store.startTurn(conversation.id)
            store.finishTurn(turnId, "completed", originalModel = JSONObject()
                .put("modelId", "bad model id with spaces")
                .put("displayName", "Display")
                .put("routeFingerprint", JSONObject.NULL)
                .put("apiKey", "synthetic-private-marker"))
            val terminal = store.pending(owner).map { it.body }
                .first { it.getString("kind") == "turn.finished" }
            assertEquals("completed", terminal.getJSONObject("payload").getString("status"))
            assertFalse(terminal.getJSONObject("payload").has("originalModel"))
            assertFalse(terminal.toString().contains("synthetic-private-marker"))
        } finally { store.close(); context.deleteDatabase(database) }
    }

    @Test fun versionFiveMessagesRemainAfterAdditiveVersionSixUpgrade() {
        val database = "stage12-v5-${UUID.randomUUID()}.db"
        val file = context.getDatabasePath(database)
        file.parentFile?.mkdirs()
        val conversation = id("conversation")
        val owner = id("owner")
        SQLiteDatabase.openOrCreateDatabase(file, null).use { db ->
            db.execSQL("CREATE TABLE conversations(id TEXT PRIMARY KEY,owner_key TEXT,title TEXT NOT NULL,created_at TEXT NOT NULL,source_event_id TEXT)")
            db.execSQL("CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,turn_id TEXT,created_at TEXT NOT NULL,server_seq INTEGER,source_event_id TEXT)")
            db.execSQL("INSERT INTO conversations(id,owner_key,title,created_at) VALUES(?,?,?,?)",
                arrayOf(conversation, owner, "Retained", "2026-10-03T00:00:00Z"))
            db.execSQL("INSERT INTO messages(id,conversation_id,role,text,created_at) VALUES(?,?,?,?,?)",
                arrayOf(id("message"), conversation, "user", "retained text", "2026-10-03T00:00:00Z"))
            db.version = 5
        }
        val store = LocalStore(context, database)
        try {
            assertEquals("Retained", store.listConversations(owner).single().title)
            assertEquals("retained text", store.messages(conversation, owner).single().text)
            assertEquals(0, store.cachedSharedHistory(owner, id("device"), id("session"), -1)
                .getJSONArray("events").length())
        } finally { store.close(); context.deleteDatabase(database) }
    }

    @Test fun boundedTailEvictsOldestWithoutMovingScanWatermarkBackwards() {
        val database = "stage12-evict-${UUID.randomUUID()}.db"
        val owner = id("owner")
        val hostId = id("device")
        val sessionId = id("session")
        var store = LocalStore(context, database)
        try {
            for (batch in 0 until 7) {
                val events = JSONArray()
                for (index in 0 until 100) events.put(JSONObject().put("seq", batch * 100 + index)
                    .put("type", "assistant.message")
                    .put("data", JSONObject().put("text", "synthetic ${"x".repeat(3200)}")))
                store.saveSharedHistoryPage(owner, hostId, sessionId, events, batch * 100L + 99)
            }
            val first = store.cachedSharedHistory(owner, hostId, sessionId, -1)
            assertTrue(first.getBoolean("historyTruncated"))
            assertTrue(first.getLong("oldestSeq") > 0)
            assertTrue(first.getJSONArray("events").length() <= 100)
            val recent = store.cachedSharedHistory(owner, hostId, sessionId, 699)
            assertEquals(699, recent.getLong("nextSeq"))
            store.close()
            store = LocalStore(context, database)
            val recovered = store.cachedSharedHistory(owner, hostId, sessionId, -1)
            assertEquals(first.getLong("oldestSeq"), recovered.getLong("oldestSeq"))
            assertTrue(recovered.getBoolean("historyTruncated"))
            val oldPage = JSONArray()
            for (index in 0 until 100) oldPage.put(JSONObject().put("seq", index)
                .put("type", "assistant.message")
                .put("data", JSONObject().put("text", "synthetic ${"x".repeat(3200)}")))
            store.saveSharedHistoryPage(owner, hostId, sessionId, oldPage, 99)
            assertEquals(699, store.cachedSharedHistory(owner, hostId, sessionId, 699).getLong("nextSeq"))
            for (index in 0 until 65) {
                val session = "session-${UUID.randomUUID()}"
                store.saveSharedHistoryPage(owner, hostId, session, JSONArray().put(JSONObject()
                    .put("seq", 0).put("type", "assistant.message")
                    .put("data", JSONObject().put("text", "session $index"))), 0)
            }
            assertEquals(0, store.cachedSharedHistory(owner, hostId, sessionId, -1)
                .getJSONArray("events").length())
        } finally { store.close(); context.deleteDatabase(database) }
    }

    @Test fun lostAdoptionReplyWithOldUnboundCacheCannotStartPhoneModelOffline() {
        val database = "stage12-lost-adopt-${UUID.randomUUID()}.db"
        val store = LocalStore(context, database)
        try {
            val host = HostIdentity("http://127.0.0.1:18188", "Stage12SyntheticOwner",
                id("owner"), id("device"), id("device"), "synthetic-cookie", "synthetic-csrf")
            val owner = Endpoints.ownerKey(host.origin, host.ownerId)
            val conversation = store.createConversation("Old unbound cache", owner)
            val message = store.addMessage(conversation.id, "user", "new synthetic goal")
            val turnId = store.startTurn(conversation.id)
            store.queueHandoffIntent(owner, host.hostId, conversation.id, id("request"), "model-host", 1)
            store.recordHandoffResponse(owner, host.hostId, conversation.id,
                store.handoffIntent(owner, host.hostId, conversation.id)!!.getString("requestId"),
                "uncertain", null)
            store.saveSharedConversationSnapshot(owner, host.hostId, conversation.id,
                JSONObject().put("source", "host").put("hostId", host.hostId)
                    .put("conversationId", conversation.id).put("status", "unbound"))
            val offline = object : JsonTransport {
                override fun request(url: String, method: String, body: JSONObject?,
                    headers: Map<String, String>, active: AtomicReference<HttpURLConnection?>?,
                    readTimeoutMs: Int): HttpReply = throw IOException("synthetic offline")
            }
            val route = ConversationHandoff(store, PersonalApi(offline), AttachmentStore(context, store))
                .routeNewUserTurn(host, conversation.id, turnId, message) { true }
            assertTrue("An uncertain adopted session must never start the direct model",
                route is ConversationSendRoute.Unconfirmed)
        } finally { store.close(); context.deleteDatabase(database) }
    }
}
