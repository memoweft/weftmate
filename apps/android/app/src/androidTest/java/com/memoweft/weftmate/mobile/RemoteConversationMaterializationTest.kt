package com.memoweft.weftmate.mobile

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class RemoteConversationMaterializationTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun id(prefix: String) = "$prefix-${UUID.randomUUID()}"
    private fun event(seq: Long, conversationId: String, kind: String, payload: JSONObject,
        eventId: String = id("event")): JSONObject = JSONObject().put("seq", seq)
        .put("eventId", eventId).put("sourceDeviceId", id("device"))
        .put("conversationId", conversationId).put("clientSeq", seq)
        .put("kind", kind).put("occurredAt", "2026-09-27T00:00:00.000Z").put("payload", payload)

    @Test fun phoneAndDesktopMessagesMergeByServerSequenceWithoutModelReplayOrCrossAccountLeak() {
        val database = "remote-materialize-${UUID.randomUUID()}.db"
        val ownerA = "owner-A-${UUID.randomUUID()}"
        val ownerB = "owner-B-${UUID.randomUUID()}"
        var store = LocalStore(context, database)
        try {
            val conversation = store.createConversation("A conversation", ownerA)
            val localMessage = store.addMessage(conversation.id, "user", "A_LOCAL")
            val own = store.pending(ownerA)
            assertEquals(2, own.size)
            store.markAccepted(ownerA, JSONArray().put(JSONObject().put("eventId", own[0].eventId).put("seq", 1))
                .put(JSONObject().put("eventId", own[1].eventId).put("seq", 2)))
            val desktopMessage = id("message")
            val imageMessage = id("message")
            val attachmentId = id("attachment")
            val ref = JSONObject().put("attachmentId", attachmentId).put("name", "synthetic.png")
                .put("contentType", "image/png").put("size", 512)
                .put("sha256", "a".repeat(64))
            val page = JSONArray()
                .put(JSONObject(own[0].body.toString()).put("seq", 1).put("sourceDeviceId", id("device")))
                .put(JSONObject(own[1].body.toString()).put("seq", 2).put("sourceDeviceId", id("device")))
                .put(event(3, conversation.id, "message.created", JSONObject()
                    .put("messageId", desktopMessage).put("role", "assistant").put("text", "PC_REMOTE")))
                .put(event(4, conversation.id, "message.created", JSONObject()
                    .put("messageId", imageMessage).put("role", "user").put("text", "")
                    .put("attachments", JSONArray().put(ref))))
            store.applyRemotePage(ownerA, page, 4)
            assertEquals(listOf("A_LOCAL", "PC_REMOTE", ""), store.messages(conversation.id, ownerA).map { it.text })
            assertEquals(listOf(localMessage, desktopMessage, imageMessage),
                store.messages(conversation.id, ownerA).map { it.id })
            val preview = store.messageThumbnails(conversation.id, ownerA, imageMessage).getJSONObject(0)
            assertEquals("shared", preview.getString("syncStatus"))
            assertEquals(imagePreviewUrl(conversation.id, imageMessage, attachmentId), preview.getString("previewUrl"))
            assertFalse(preview.has("thumbnailDataUrl"))
            assertTrue(store.listConversations(ownerB).isEmpty())
            assertTrue(store.messages(conversation.id, ownerB).isEmpty())
            assertEquals(0, store.messageThumbnails(conversation.id, ownerB, imageMessage).length())
            store.close()
            store = LocalStore(context, database)
            assertEquals(4, store.cursor(ownerA))
            assertEquals(3, store.messages(conversation.id, ownerA).size)
            store.applyRemotePage(ownerA, JSONArray(), 4)
            store.applyRemotePage(ownerA, page, 4) // Another sync worker fetched the same page before cursor advanced.
            assertEquals(3, store.messages(conversation.id, ownerA).size)
            val duplicate = event(5, conversation.id, "message.created", JSONObject()
                .put("messageId", desktopMessage).put("role", "assistant").put("text", "PC_REMOTE"),
                page.getJSONObject(2).getString("eventId"))
            try { store.applyRemotePage(ownerA, JSONArray().put(duplicate), 5); fail("duplicate event") }
            catch (error: ApiFailure) { assertEquals("SYNC_CONFLICT", error.safeCode) }
            assertEquals(4, store.cursor(ownerA))
            val conflicting = event(5, conversation.id, "message.created", JSONObject()
                .put("messageId", desktopMessage).put("role", "assistant").put("text", "CHANGED"))
            try { store.applyRemotePage(ownerA, JSONArray().put(conflicting), 5); fail("message conflict") }
            catch (error: ApiFailure) { assertEquals("SYNC_CONFLICT", error.safeCode) }
            assertEquals(4, store.cursor(ownerA))
        } finally { store.close(); context.deleteDatabase(database) }
    }

    @Test fun versionFourCachedRemoteEventsBecomeReadableAfterUpgrade() {
        val database = "remote-v4-${UUID.randomUUID()}.db"
        val owner = "owner-${UUID.randomUUID()}"
        val conversationId = id("conversation")
        val messageId = id("message")
        val file = context.getDatabasePath(database)
        val db = SQLiteDatabase.openOrCreateDatabase(file, null)
        try {
            db.execSQL("CREATE TABLE conversations(id TEXT PRIMARY KEY,owner_key TEXT,title TEXT NOT NULL,created_at TEXT NOT NULL)")
            db.execSQL("CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,turn_id TEXT,created_at TEXT NOT NULL)")
            db.execSQL("CREATE TABLE events(event_id TEXT PRIMARY KEY,owner_key TEXT,conversation_id TEXT NOT NULL,client_seq INTEGER NOT NULL UNIQUE,kind TEXT NOT NULL,occurred_at TEXT NOT NULL,payload TEXT NOT NULL,ack_seq INTEGER)")
            db.execSQL("CREATE TABLE remote_events(owner_key TEXT NOT NULL,seq INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_key,seq))")
            db.execSQL("CREATE TABLE message_images(owner_key TEXT NOT NULL,conversation_id TEXT NOT NULL,message_id TEXT NOT NULL,attachment_id TEXT NOT NULL,name TEXT NOT NULL,content_type TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,receipt TEXT,published INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(message_id,attachment_id))")
            db.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            val created = event(1, conversationId, "conversation.created", JSONObject().put("title", "PC history"))
            val message = event(2, conversationId, "message.created", JSONObject()
                .put("messageId", messageId).put("role", "user").put("text", "FROM_PC"))
            db.execSQL("INSERT INTO remote_events(owner_key,seq,body) VALUES(?,?,?)",
                arrayOf(owner, 1, created.toString()))
            db.execSQL("INSERT INTO remote_events(owner_key,seq,body) VALUES(?,?,?)",
                arrayOf(owner, 2, message.toString()))
            db.execSQL("INSERT INTO meta(key,value) VALUES(?,?)", arrayOf("cursor:$owner", "2"))
            db.version = 4
        } finally { db.close() }
        val upgraded = LocalStore(context, database)
        try {
            assertEquals(2, upgraded.cursor(owner))
            assertEquals(conversationId, upgraded.listConversations(owner).single().id)
            assertEquals("FROM_PC", upgraded.messages(conversationId, owner).single().text)
            assertEquals(2, upgraded.remoteEvents(owner).size)
        } finally { upgraded.close(); context.deleteDatabase(database) }
    }
}
