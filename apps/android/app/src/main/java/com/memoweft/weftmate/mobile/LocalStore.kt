package com.memoweft.weftmate.mobile

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.security.MessageDigest

data class LocalConversation(val id: String, val title: String, val ownerKey: String?, val createdAt: String)
data class LocalMessage(val id: String, val role: String, val text: String,
    val serverSeq: Long? = null, val sourceEventId: String? = null)
data class TimelineItem(val text: String, val user: Boolean)
data class PendingSyncEvent(val eventId: String, val body: JSONObject)
data class MessageThumbnail(val attachmentId: String, val name: String, val jpeg: ByteArray)
data class PendingImage(val messageId: String, val conversationId: String, val attachmentId: String,
    val name: String, val contentType: String, val size: Long, val sha256: String)
data class SharedCommandRow(val owner: String, val hostId: String, val sessionId: String,
    val requestId: String, val payload: JSONObject, val state: String, val command: JSONObject?) {
    fun bridge(): JSONObject = JSONObject().put("source", "host").put("sessionId", sessionId)
        .put("requestId", requestId).put("kind", payload.getString("kind")).put("state", state)
        .put("command", command ?: JSONObject.NULL)
        .apply { if (payload.optString("kind") == "chat.message") put("chatId", sessionId).put("text", payload.optString("text")) }
}

/** One private on-device database. Local changes and their outbox entries share a transaction. */
class LocalStore(context: Context, databaseName: String = "weftmate-mobile.db") : SQLiteOpenHelper(context, databaseName, null, 7) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        db.execSQL("CREATE TABLE conversations(id TEXT PRIMARY KEY,owner_key TEXT,title TEXT NOT NULL,created_at TEXT NOT NULL,source_event_id TEXT)")
        db.execSQL("CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,turn_id TEXT,created_at TEXT NOT NULL,server_seq INTEGER,source_event_id TEXT)")
        db.execSQL("CREATE TABLE turns(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL)")
        db.execSQL("CREATE TABLE events(event_id TEXT PRIMARY KEY,owner_key TEXT,conversation_id TEXT NOT NULL,client_seq INTEGER NOT NULL UNIQUE,kind TEXT NOT NULL,occurred_at TEXT NOT NULL,payload TEXT NOT NULL,ack_seq INTEGER)")
        db.execSQL("CREATE INDEX events_pending ON events(owner_key,ack_seq,client_seq)")
        db.execSQL("CREATE TABLE remote_events(owner_key TEXT NOT NULL,seq INTEGER NOT NULL,body TEXT NOT NULL,event_id TEXT,PRIMARY KEY(owner_key,seq))")
        db.execSQL("CREATE UNIQUE INDEX remote_events_id ON remote_events(owner_key,event_id)")
        createSharedCommands(db)
        createConversationHandoffs(db)
        createSharedHistoryCache(db)
        createAccountModelIntents(db)
        createMessageThumbnails(db)
        createMessageImages(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (newVersion != 7 || oldVersion !in 1..6)
            throw IllegalStateException("Unsupported local database migration")
        if (oldVersion <= 4) {
            if (oldVersion == 1) createSharedCommands(db)
            if (oldVersion <= 2) createMessageThumbnails(db)
            if (oldVersion <= 3) createMessageImages(db)
            db.execSQL("ALTER TABLE conversations ADD COLUMN source_event_id TEXT")
            db.execSQL("ALTER TABLE messages ADD COLUMN server_seq INTEGER")
            db.execSQL("ALTER TABLE messages ADD COLUMN source_event_id TEXT")
            db.execSQL("ALTER TABLE remote_events ADD COLUMN event_id TEXT")
            db.execSQL("CREATE UNIQUE INDEX remote_events_id ON remote_events(owner_key,event_id)")
            migrateAcceptedEvents(db)
            db.rawQuery("SELECT owner_key,seq,body FROM remote_events ORDER BY owner_key,seq", null).use { c ->
                while (c.moveToNext()) {
                    val owner = c.getString(0)
                    val seq = c.getLong(1)
                    val row = JSONObject(c.getString(2))
                    db.execSQL("UPDATE remote_events SET event_id=? WHERE owner_key=? AND seq=?",
                        arrayOf(row.getString("eventId"), owner, seq))
                    materializeRemoteEvent(db, owner, row, seq)
                }
            }
        }
        if (oldVersion <= 5) {
            createConversationHandoffs(db)
            createSharedHistoryCache(db)
        }
        createAccountModelIntents(db)
    }

    private fun createMessageImages(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE message_images(owner_key TEXT NOT NULL,conversation_id TEXT NOT NULL,message_id TEXT NOT NULL,attachment_id TEXT NOT NULL,name TEXT NOT NULL,content_type TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,receipt TEXT,published INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(message_id,attachment_id))")
        db.execSQL("CREATE INDEX message_images_owner ON message_images(owner_key,conversation_id,message_id)")
        db.execSQL("CREATE UNIQUE INDEX message_images_attachment ON message_images(owner_key,attachment_id)")
    }

    private fun createMessageThumbnails(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE message_thumbnails(owner_key TEXT NOT NULL,conversation_id TEXT NOT NULL,message_id TEXT NOT NULL,attachment_id TEXT NOT NULL,name TEXT NOT NULL,jpeg BLOB NOT NULL,PRIMARY KEY(message_id,attachment_id))")
        db.execSQL("CREATE INDEX message_thumbnails_owner ON message_thumbnails(owner_key,conversation_id,message_id)")
    }

    private fun createSharedCommands(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE shared_commands(owner_key TEXT NOT NULL,host_id TEXT NOT NULL,session_id TEXT NOT NULL,request_id TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,command_body TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(owner_key,host_id,session_id,request_id))")
        db.execSQL("CREATE INDEX shared_commands_pending ON shared_commands(owner_key,host_id,state,updated_at)")
        db.execSQL("CREATE TABLE shared_sessions(owner_key TEXT NOT NULL,host_id TEXT NOT NULL,session_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_key,host_id,session_id))")
    }

    private fun createConversationHandoffs(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE conversation_handoffs(owner_key TEXT NOT NULL,host_id TEXT NOT NULL,conversation_id TEXT NOT NULL,request_id TEXT NOT NULL,model_profile_id TEXT NOT NULL,expected_sync_seq INTEGER NOT NULL,state TEXT NOT NULL,body TEXT,PRIMARY KEY(owner_key,host_id,conversation_id))")
        db.execSQL("CREATE UNIQUE INDEX conversation_handoffs_request ON conversation_handoffs(owner_key,host_id,request_id)")
        db.execSQL("CREATE TABLE shared_conversation_snapshots(owner_key TEXT NOT NULL,host_id TEXT NOT NULL,conversation_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_key,host_id,conversation_id))")
        db.execSQL("CREATE TABLE local_turn_reservations(owner_key TEXT NOT NULL,host_id TEXT NOT NULL,conversation_id TEXT NOT NULL,turn_id TEXT NOT NULL,source_event_id TEXT NOT NULL,request_id TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(owner_key,host_id,turn_id))")
    }

    @Synchronized fun saveSharedConversationSnapshot(owner: String, hostId: String,
        conversationId: String, body: JSONObject) = write { db ->
        if (body.toString().toByteArray(Charsets.UTF_8).size > 64 * 1024 ||
            body.optString("source") != "host" || body.optString("conversationId") != conversationId ||
            body.optString("hostId") != hostId || body.optString("status") !in
            setOf("unbound", "creating", "active", "uncertain")) throw ApiFailure(502, "BINDING_RECEIPT_INVALID")
        db.execSQL("INSERT OR REPLACE INTO shared_conversation_snapshots(owner_key,host_id,conversation_id,body) VALUES(?,?,?,?)",
            arrayOf(owner, hostId, conversationId, body.toString()))
    }

    @Synchronized fun sharedConversationSnapshot(owner: String, hostId: String,
        conversationId: String): JSONObject? = readableDatabase.rawQuery(
        "SELECT body FROM shared_conversation_snapshots WHERE owner_key=? AND host_id=? AND conversation_id=?",
        arrayOf(owner, hostId, conversationId)).use { cursor ->
        if (cursor.moveToFirst()) JSONObject(cursor.getString(0)) else null }

    private fun createSharedHistoryCache(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE shared_history_events(owner_key TEXT NOT NULL,host_id TEXT NOT NULL,session_id TEXT NOT NULL,seq INTEGER NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL,cached_at INTEGER NOT NULL,PRIMARY KEY(owner_key,host_id,session_id,seq))")
        db.execSQL("CREATE TABLE shared_history_cursors(owner_key TEXT NOT NULL,host_id TEXT NOT NULL,session_id TEXT NOT NULL,next_seq INTEGER NOT NULL,truncated INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,PRIMARY KEY(owner_key,host_id,session_id))")
    }

    private fun createAccountModelIntents(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE account_model_intents(owner_key TEXT NOT NULL,host_id TEXT NOT NULL,request_id TEXT NOT NULL,kind TEXT NOT NULL,payload_hash TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,response TEXT,PRIMARY KEY(owner_key,host_id,request_id))")
        db.execSQL("CREATE INDEX account_model_intents_pending ON account_model_intents(owner_key,host_id,state)")
    }

    @Synchronized fun accountModelIntent(owner: String, hostId: String, requestId: String): JSONObject? =
        readableDatabase.rawQuery("SELECT kind,payload_hash,body,state,response FROM account_model_intents WHERE owner_key=? AND host_id=? AND request_id=?",
            arrayOf(owner, hostId, requestId)).use { cursor ->
            if (!cursor.moveToFirst()) null else JSONObject().put("requestId", requestId)
                .put("kind", cursor.getString(0)).put("payloadHash", cursor.getString(1))
                .put("body", JSONObject(cursor.getString(2))).put("state", cursor.getString(3))
                .apply { if (!cursor.isNull(4)) put("response", JSONObject(cursor.getString(4))) }
        }

    @Synchronized fun queueAccountModelIntent(owner: String, hostId: String, requestId: String,
        kind: String, payloadHash: String, publicBody: JSONObject): JSONObject = write { db ->
        require(owner.isNotBlank() && hostId.isNotBlank() &&
            requestId.matches(Regex("[A-Za-z0-9_.:-]{1,128}")) &&
            kind in setOf("publish", "transfer") && payloadHash.matches(Regex("[a-f0-9]{64}")) &&
            publicBody.toString().toByteArray(Charsets.UTF_8).size <= 4096 &&
            !publicBody.has("apiKey"))
        val previous = accountModelIntent(owner, hostId, requestId)
        if (previous != null) {
            if (previous.getString("kind") != kind || previous.getString("payloadHash") != payloadHash ||
                previous.getJSONObject("body").toString() != publicBody.toString())
                throw ApiFailure(409, "REQUEST_CONFLICT")
            return@write previous
        }
        val count = db.rawQuery("SELECT COUNT(*) FROM account_model_intents WHERE owner_key=? AND host_id=?",
            arrayOf(owner, hostId)).use { it.moveToFirst(); it.getInt(0) }
        if (count >= 100) throw ApiFailure(429, "CAPACITY_LIMIT")
        db.insertOrThrow("account_model_intents", null, ContentValues().apply {
            put("owner_key", owner); put("host_id", hostId); put("request_id", requestId)
            put("kind", kind); put("payload_hash", payloadHash); put("body", publicBody.toString())
            put("state", "pending")
        })
        accountModelIntent(owner, hostId, requestId)!!
    }

    @Synchronized fun updateAccountModelIntent(owner: String, hostId: String,
        requestId: String, state: String, response: JSONObject? = null) = write { db ->
        require(state in setOf("pending", "uncertain", "succeeded", "failed", "credential_conflict"))
        db.execSQL("UPDATE account_model_intents SET state=?,response=? WHERE owner_key=? AND host_id=? AND request_id=?",
            arrayOf(state, response?.toString(), owner, hostId, requestId))
    }

    @Synchronized fun handoffIntent(owner: String, hostId: String, conversationId: String): JSONObject? =
        readableDatabase.rawQuery("SELECT request_id,model_profile_id,expected_sync_seq,state,body FROM conversation_handoffs WHERE owner_key=? AND host_id=? AND conversation_id=?",
            arrayOf(owner, hostId, conversationId)).use { cursor ->
            if (!cursor.moveToFirst()) null else JSONObject().put("source", "host")
                .put("conversationId", conversationId).put("hostId", hostId)
                .put("requestId", cursor.getString(0)).put("modelProfileId", cursor.getString(1))
                .put("expectedSyncSeq", cursor.getLong(2)).put("state", cursor.getString(3))
                .apply { if (!cursor.isNull(4)) put("response", JSONObject(cursor.getString(4))) }
        }

    /** The request body is immutable before the first network call. */
    @Synchronized fun queueHandoffIntent(owner: String, hostId: String, conversationId: String,
        requestId: String, modelProfileId: String, expectedSyncSeq: Long): JSONObject = write { db ->
        require(owner.isNotBlank() && hostId.isNotBlank() && conversationId.isNotBlank() &&
            requestId.isNotBlank() && modelProfileId.isNotBlank() && expectedSyncSeq >= 0)
        val prior = handoffIntent(owner, hostId, conversationId)
        if (prior != null) {
            if (prior.getString("requestId") != requestId ||
                prior.getString("modelProfileId") != modelProfileId ||
                prior.getLong("expectedSyncSeq") != expectedSyncSeq)
                throw ApiFailure(409, "REQUEST_CONFLICT")
            return@write prior
        }
        db.insertOrThrow("conversation_handoffs", null, ContentValues().apply {
            put("owner_key", owner); put("host_id", hostId); put("conversation_id", conversationId)
            put("request_id", requestId); put("model_profile_id", modelProfileId)
            put("expected_sync_seq", expectedSyncSeq); put("state", "pending")
        })
        handoffIntent(owner, hostId, conversationId)!!
    }

    @Synchronized fun recordHandoffResponse(owner: String, hostId: String, conversationId: String,
        requestId: String, state: String, response: JSONObject?) = write { db ->
        require(state in setOf("pending", "uncertain", "creating", "active", "rejected"))
        val prior = handoffIntent(owner, hostId, conversationId)
            ?: throw ApiFailure(409, "REQUEST_CONFLICT")
        if (prior.getString("requestId") != requestId) throw ApiFailure(409, "REQUEST_CONFLICT")
        db.execSQL("UPDATE conversation_handoffs SET state=?,body=? WHERE owner_key=? AND host_id=? AND conversation_id=? AND request_id=?",
            arrayOf(state, response?.toString(), owner, hostId, conversationId, requestId))
    }

    @Synchronized fun hasPendingConversationEvents(owner: String, conversationId: String): Boolean =
        readableDatabase.rawQuery("SELECT 1 FROM events WHERE owner_key=? AND conversation_id=? AND ack_seq IS NULL LIMIT 1",
            arrayOf(owner, conversationId)).use { it.moveToFirst() }

    @Synchronized fun messageSyncEvent(owner: String, conversationId: String,
        messageId: String): JSONObject? = readableDatabase.rawQuery(
        "SELECT e.event_id,e.ack_seq,e.payload FROM messages m JOIN events e ON e.event_id=m.source_event_id WHERE m.id=? AND m.conversation_id=? AND e.owner_key=? AND e.conversation_id=? AND e.kind='message.created'",
        arrayOf(messageId, conversationId, owner, conversationId)).use { cursor ->
        if (!cursor.moveToFirst()) null else JSONObject().put("eventId", cursor.getString(0))
            .put("ackSeq", if (cursor.isNull(1)) JSONObject.NULL else cursor.getLong(1))
            .put("payload", JSONObject(cursor.getString(2)))
    }

    @Synchronized fun queueLocalTurnReservation(owner: String, hostId: String,
        conversationId: String, turnId: String, sourceEventId: String): String = write { db ->
        val requestId = "local-turn:$turnId"
        val prior = db.rawQuery("SELECT conversation_id,source_event_id,request_id FROM local_turn_reservations WHERE owner_key=? AND host_id=? AND turn_id=?",
            arrayOf(owner, hostId, turnId)).use { cursor ->
            if (cursor.moveToFirst()) listOf(cursor.getString(0), cursor.getString(1), cursor.getString(2)) else null }
        if (prior != null) {
            if (prior != listOf(conversationId, sourceEventId, requestId))
                throw ApiFailure(409, "REQUEST_CONFLICT")
            return@write requestId
        }
        db.insertOrThrow("local_turn_reservations", null, ContentValues().apply {
            put("owner_key", owner); put("host_id", hostId); put("conversation_id", conversationId)
            put("turn_id", turnId); put("source_event_id", sourceEventId)
            put("request_id", requestId); put("state", "pending")
        })
        requestId
    }

    @Synchronized fun recordLocalTurnReservation(owner: String, hostId: String,
        turnId: String, state: String) = write { db ->
        require(state in setOf("pending", "running", "uncertain", "finished"))
        db.execSQL("UPDATE local_turn_reservations SET state=? WHERE owner_key=? AND host_id=? AND turn_id=?",
            arrayOf(state, owner, hostId, turnId))
    }

    private fun sharedHistoryDigest(body: String): String = MessageDigest.getInstance("SHA-256")
        .digest(body.toByteArray(Charsets.UTF_8)).joinToString("") {
            (it.toInt() and 0xff).toString(16).padStart(2, '0') }

    private fun pruneSharedHistory(db: SQLiteDatabase, owner: String, hostId: String,
        sessionId: String) {
        val local = mutableListOf<Pair<Long, Int>>()
        db.rawQuery("SELECT seq,length(CAST(body AS BLOB)) FROM shared_history_events WHERE owner_key=? AND host_id=? AND session_id=? ORDER BY seq",
            arrayOf(owner, hostId, sessionId)).use { cursor ->
            while (cursor.moveToNext()) local += cursor.getLong(0) to cursor.getInt(1)
        }
        var bytes = local.sumOf { it.second.toLong() }
        var count = local.size
        for ((seq, size) in local) {
            if (count <= 512 && bytes <= 2L * 1024 * 1024) break
            db.execSQL("DELETE FROM shared_history_events WHERE owner_key=? AND host_id=? AND session_id=? AND seq=?",
                arrayOf(owner, hostId, sessionId, seq))
            count--; bytes -= size
            db.execSQL("UPDATE shared_history_cursors SET truncated=1 WHERE owner_key=? AND host_id=? AND session_id=?",
                arrayOf(owner, hostId, sessionId))
        }
        data class Cached(val host: String, val session: String, val seq: Long, val bytes: Int)
        val all = mutableListOf<Cached>()
        db.rawQuery("SELECT host_id,session_id,seq,length(CAST(body AS BLOB)) FROM shared_history_events WHERE owner_key=? ORDER BY cached_at,rowid",
            arrayOf(owner)).use { cursor ->
            while (cursor.moveToNext()) all += Cached(cursor.getString(0), cursor.getString(1),
                cursor.getLong(2), cursor.getInt(3))
        }
        var totalBytes = all.sumOf { it.bytes.toLong() }
        var totalCount = all.size
        for (item in all) {
            if (totalCount <= 4096 && totalBytes <= 16L * 1024 * 1024) break
            db.execSQL("DELETE FROM shared_history_events WHERE owner_key=? AND host_id=? AND session_id=? AND seq=?",
                arrayOf(owner, item.host, item.session, item.seq))
            db.execSQL("UPDATE shared_history_cursors SET truncated=1 WHERE owner_key=? AND host_id=? AND session_id=?",
                arrayOf(owner, item.host, item.session))
            totalCount--; totalBytes -= item.bytes
        }
        val sessions = mutableListOf<Pair<String, String>>()
        db.rawQuery("SELECT host_id,session_id FROM shared_history_cursors WHERE owner_key=? ORDER BY updated_at DESC,host_id,session_id",
            arrayOf(owner)).use { cursor ->
            while (cursor.moveToNext()) sessions += cursor.getString(0) to cursor.getString(1)
        }
        for ((oldHost, oldSession) in sessions.drop(64)) {
            db.execSQL("DELETE FROM shared_history_events WHERE owner_key=? AND host_id=? AND session_id=?",
                arrayOf(owner, oldHost, oldSession))
            db.execSQL("DELETE FROM shared_history_cursors WHERE owner_key=? AND host_id=? AND session_id=?",
                arrayOf(owner, oldHost, oldSession))
        }
    }

    @Synchronized fun clearSharedHistory(owner: String, hostId: String, sessionId: String) = write { db ->
        db.execSQL("DELETE FROM shared_history_events WHERE owner_key=? AND host_id=? AND session_id=?", arrayOf(owner, hostId, sessionId))
        db.execSQL("DELETE FROM shared_history_cursors WHERE owner_key=? AND host_id=? AND session_id=?", arrayOf(owner, hostId, sessionId))
    }

    /** Cache only projected native events, under their exact owner/host/session identity. */
    @Synchronized fun saveSharedHistoryPage(owner: String, hostId: String, sessionId: String,
        events: JSONArray, nextSeq: Long, hasOlder: Boolean = false) = write { db ->
        require(owner.isNotBlank() && hostId.isNotBlank() && sessionId.isNotBlank() &&
            events.length() <= 100 && nextSeq >= -1)
        val priorCursor = db.rawQuery("SELECT next_seq FROM shared_history_cursors WHERE owner_key=? AND host_id=? AND session_id=?",
            arrayOf(owner, hostId, sessionId)).use { if (it.moveToFirst()) it.getLong(0) else -1L }
        var previous = -1L
        for (index in 0 until events.length()) {
            val event = events.getJSONObject(index)
            val seq = event.getLong("seq")
            if (seq < 0 || seq <= previous || seq > nextSeq ||
                event.optString("type") !in setOf("user.message", "assistant.message", "turn.started", "turn.ended",
                    "step.started", "step.completed", "approval.requested", "approval.resolved", "question.asked",
                    "question.answered", "artifact.created", "task.queued", "task.started", "task.ended"))
                throw ApiFailure(502, "HISTORY_CURSOR_INVALID")
            previous = seq
            val body = event.toString()
            if (body.toByteArray(Charsets.UTF_8).size > 48 * 1024)
                throw ApiFailure(502, "HISTORY_EVENT_INVALID")
            val digest = sharedHistoryDigest(body)
            db.rawQuery("SELECT digest FROM shared_history_events WHERE owner_key=? AND host_id=? AND session_id=? AND seq=?",
                arrayOf(owner, hostId, sessionId, seq.toString())).use { row ->
                if (row.moveToFirst()) {
                    if (row.getString(0) != digest) throw ApiFailure(502, "HISTORY_CONFLICT")
                } else db.insertOrThrow("shared_history_events", null, ContentValues().apply {
                    put("owner_key", owner); put("host_id", hostId); put("session_id", sessionId)
                    put("seq", seq); put("digest", digest); put("body", body)
                    put("cached_at", System.currentTimeMillis())
                })
            }
        }
        val oldTruncated = db.rawQuery("SELECT truncated FROM shared_history_cursors WHERE owner_key=? AND host_id=? AND session_id=?",
            arrayOf(owner, hostId, sessionId)).use { if (it.moveToFirst()) it.getInt(0) else 0 }
        db.execSQL("INSERT OR REPLACE INTO shared_history_cursors(owner_key,host_id,session_id,next_seq,truncated,updated_at) VALUES(?,?,?,?,?,?)",
            arrayOf(owner, hostId, sessionId, maxOf(nextSeq, priorCursor), if (hasOlder) 1 else oldTruncated, System.currentTimeMillis()))
        pruneSharedHistory(db, owner, hostId, sessionId)
    }

    @Synchronized fun cachedSharedHistory(owner: String, hostId: String, sessionId: String,
        afterSeq: Long? = null, beforeSeq: Long? = null): JSONObject {
        val forward = afterSeq != null
        val comparison = if (forward) ">" else "<"
        val order = if (forward) "ASC" else "DESC"
        val boundary = afterSeq ?: beforeSeq ?: Long.MAX_VALUE
        val selected = mutableListOf<JSONObject>()
        readableDatabase.rawQuery("SELECT seq,digest,body FROM shared_history_events WHERE owner_key=? AND host_id=? AND session_id=? AND seq$comparison? ORDER BY seq $order LIMIT 100",
            arrayOf(owner, hostId, sessionId, boundary.toString())).use { cursor ->
            while (cursor.moveToNext()) {
                val body = cursor.getString(2)
                if (sharedHistoryDigest(body) != cursor.getString(1)) throw ApiFailure(502, "HISTORY_CONFLICT")
                selected.add(JSONObject(body))
            }
        }
        if (!forward) selected.reverse()
        val events = JSONArray(); for (event in selected) events.put(event)
        val metadata = readableDatabase.rawQuery("SELECT next_seq,truncated FROM shared_history_cursors WHERE owner_key=? AND host_id=? AND session_id=?",
            arrayOf(owner, hostId, sessionId)).use {
            if (it.moveToFirst()) it.getLong(0) to (it.getInt(1) != 0) else -1L to false }
        val watermark = metadata.first
        val oldest = readableDatabase.rawQuery("SELECT MIN(seq) FROM shared_history_events WHERE owner_key=? AND host_id=? AND session_id=?",
            arrayOf(owner, hostId, sessionId)).use {
            if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null }
        val last = selected.lastOrNull()?.getLong("seq") ?: afterSeq ?: -1L
        val hasMore = forward && last < watermark && readableDatabase.rawQuery(
            "SELECT 1 FROM shared_history_events WHERE owner_key=? AND host_id=? AND session_id=? AND seq>? LIMIT 1",
            arrayOf(owner, hostId, sessionId, last.toString())).use { it.moveToFirst() }
        val first = selected.firstOrNull()?.getLong("seq")
        return JSONObject().put("events", events).put("nextSeq", if (hasMore) last else maxOf(last, watermark))
            .put("hasMore", hasMore).put("cached", true).put("hostAvailable", false)
            .put("tailUnknown", true).put("oldestSeq", oldest ?: JSONObject.NULL)
            .put("historyTruncated", metadata.second && (oldest == null || (afterSeq ?: -1) < oldest - 1))
            .put("latestSeq", watermark).put("nextBeforeSeq", first ?: JSONObject.NULL)
            .put("hasOlder", !forward && first != null && oldest != null && oldest < first)
    }

    /** Resolve only an attachment reference already persisted in this owner/host/session history. */
    @Synchronized fun sharedOriginalAttachment(owner: String, hostId: String, sessionId: String,
        attachmentId: String): JSONObject? {
        var found: JSONObject? = null
        readableDatabase.rawQuery(
            "SELECT digest,body FROM shared_history_events WHERE owner_key=? AND host_id=? AND session_id=? ORDER BY seq DESC",
            arrayOf(owner, hostId, sessionId)).use { cursor -> scan@ while (cursor.moveToNext()) {
            val body = cursor.getString(1)
            if (sharedHistoryDigest(body) != cursor.getString(0)) throw ApiFailure(502, "HISTORY_CONFLICT")
            val event = JSONObject(body)
            if (event.optString("type") != "user.message") continue@scan
            val refs = event.optJSONObject("data")?.optJSONArray("originalAttachments") ?: continue@scan
            for (index in 0 until refs.length()) {
                val ref = refs.getJSONObject(index)
                if (ref.optString("attachmentId") != attachmentId) continue
                val name = ref.optString("name")
                val contentType = ref.optString("contentType")
                val size = ref.optLong("size", -1)
                val sha256 = ref.optString("sha256")
                if (!validImageScopeId(attachmentId) || !name.matches(Regex("[^\\p{Cntrl}/\\\\]{1,128}")) ||
                    !contentType.matches(Regex("[a-z0-9][a-z0-9.+-]{0,63}/[a-z0-9][a-z0-9.+-]{0,63}")) ||
                    size !in 1..AttachmentStore.MAX_IMAGE_BYTES || !sha256.matches(Regex("[a-f0-9]{64}")))
                    throw ApiFailure(502, "HISTORY_EVENT_INVALID")
                found?.let { if (it.toString() != ref.toString()) throw ApiFailure(502, "HISTORY_CONFLICT") }
                found = JSONObject(ref.toString())
            }
        } }
        return found
    }

    @Synchronized fun saveSharedSessions(owner: String, hostId: String, sessions: JSONArray) = write { db ->
        db.execSQL("DELETE FROM shared_sessions WHERE owner_key=? AND host_id=?", arrayOf(owner, hostId))
        for (i in 0 until sessions.length()) {
            val row = sessions.getJSONObject(i)
            val sessionId = row.getString("sessionId")
            if (!sessionId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) continue
            val cached = JSONObject(row.toString())
            if (row.optBoolean("hasTemporaryContent") || row.optString("memoryMode") == "off") {
                cached.put("title", "临时对话")
                db.execSQL("DELETE FROM shared_history_events WHERE owner_key=? AND host_id=? AND session_id=?", arrayOf(owner, hostId, sessionId))
                db.execSQL("DELETE FROM shared_history_cursors WHERE owner_key=? AND host_id=? AND session_id=?", arrayOf(owner, hostId, sessionId))
            }
            db.insertOrThrow("shared_sessions", null, ContentValues().apply {
                put("owner_key", owner); put("host_id", hostId); put("session_id", sessionId)
                put("body", cached.toString())
            })
        }
    }

    @Synchronized fun sharedSession(owner: String, hostId: String, sessionId: String): JSONObject? =
        readableDatabase.rawQuery("SELECT body FROM shared_sessions WHERE owner_key=? AND host_id=? AND session_id=?",
            arrayOf(owner, hostId, sessionId)).use { c -> if (c.moveToFirst()) JSONObject(c.getString(0)) else null }

    @Synchronized fun sharedSessions(owner: String, hostId: String): JSONArray {
        val rows = JSONArray()
        readableDatabase.rawQuery("SELECT body FROM shared_sessions WHERE owner_key=? AND host_id=? ORDER BY session_id",
            arrayOf(owner, hostId)).use { c -> while (c.moveToNext()) rows.put(JSONObject(c.getString(0))) }
        return rows
    }

    @Synchronized fun sharedCommand(owner: String, hostId: String, sessionId: String,
        requestId: String): SharedCommandRow? = readableDatabase.rawQuery(
        "SELECT payload,state,command_body FROM shared_commands WHERE owner_key=? AND host_id=? AND session_id=? AND request_id=?",
        arrayOf(owner, hostId, sessionId, requestId)).use { c ->
        if (!c.moveToFirst()) null else SharedCommandRow(owner, hostId, sessionId, requestId,
            JSONObject(c.getString(0)), c.getString(1), if (c.isNull(2)) null else JSONObject(c.getString(2)))
    }

    /** The exact canonical request is durable before the first network submission. */
    @Synchronized fun queueSharedCommand(owner: String, hostId: String, sessionId: String,
        requestId: String, payload: JSONObject): SharedCommandRow = write { db ->
        require(owner.isNotBlank() && hostId.isNotBlank() && sessionId.isNotBlank() && requestId.isNotBlank())
        val existing = sharedCommand(owner, hostId, sessionId, requestId)
        if (existing != null) {
            if (existing.payload.toString() != payload.toString()) throw ApiFailure(409, "REQUEST_CONFLICT")
            return@write existing
        }
        db.insertOrThrow("shared_commands", null, ContentValues().apply {
            put("owner_key", owner); put("host_id", hostId); put("session_id", sessionId)
            put("request_id", requestId); put("payload", payload.toString())
            put("state", "pending"); put("updated_at", now())
        })
        SharedCommandRow(owner, hostId, sessionId, requestId, payload, "pending", null)
    }

    @Synchronized fun updateSharedCommand(row: SharedCommandRow, state: String,
        command: JSONObject? = null) = write { db ->
        require(state in setOf("pending", "uncertain", "accepted", "rejected"))
        db.execSQL("UPDATE shared_commands SET state=?,command_body=?,updated_at=? WHERE owner_key=? AND host_id=? AND session_id=? AND request_id=?",
            arrayOf(state, command?.toString(), now(), row.owner, row.hostId, row.sessionId, row.requestId))
    }

    @Synchronized fun sharedCommands(owner: String, hostId: String, limit: Int = 100): List<SharedCommandRow> {
        val rows = mutableListOf<SharedCommandRow>()
        readableDatabase.rawQuery("SELECT session_id,request_id,payload,state,command_body FROM shared_commands WHERE owner_key=? AND host_id=? ORDER BY updated_at DESC LIMIT ?",
            arrayOf(owner, hostId, limit.coerceIn(1, 100).toString())).use { c ->
            while (c.moveToNext()) rows += SharedCommandRow(owner, hostId, c.getString(0), c.getString(1),
                JSONObject(c.getString(2)), c.getString(3), if (c.isNull(4)) null else JSONObject(c.getString(4)))
        }
        return rows
    }

    @Synchronized fun sharedAttachmentPending(owner: String, sessionId: String, attachmentId: String): Boolean {
        readableDatabase.rawQuery("SELECT payload FROM shared_commands WHERE owner_key=? AND session_id=? AND state IN ('pending','uncertain')",
            arrayOf(owner, sessionId)).use { c -> while (c.moveToNext()) {
            val refs = JSONObject(c.getString(0)).optJSONArray("attachments") ?: continue
            if ((0 until refs.length()).any { refs.getJSONObject(it).optString("attachmentId") == attachmentId })
                return true
        } }
        return false
    }

    @Synchronized fun acceptedSharedImageCommands(owner: String, hostId: String): List<SharedCommandRow> {
        val rows = mutableListOf<SharedCommandRow>()
        readableDatabase.rawQuery("SELECT session_id,request_id,payload,state,command_body FROM shared_commands WHERE owner_key=? AND host_id=? AND state='accepted'",
            arrayOf(owner, hostId)).use { c -> while (c.moveToNext()) {
            val payload = JSONObject(c.getString(2))
            if (payload.optJSONArray("originalAttachments") == null && payload.optJSONArray("attachments") == null) continue
            rows += SharedCommandRow(owner, hostId, c.getString(0), c.getString(1), payload,
                c.getString(3), if (c.isNull(4)) null else JSONObject(c.getString(4)))
        } }
        return rows
    }

    private fun now() = Instant.now().truncatedTo(ChronoUnit.MILLIS).toString()
    private fun uuid(prefix: String) = "$prefix-${UUID.randomUUID()}"

    private inline fun <T> write(block: (SQLiteDatabase) -> T): T {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val value = block(db)
            db.setTransactionSuccessful()
            return value
        } finally { db.endTransaction() }
    }

    private fun nextClientSeq(db: SQLiteDatabase): Long {
        val old = db.rawQuery("SELECT value FROM meta WHERE key='client_seq'", null).use {
            if (it.moveToFirst()) it.getString(0).toLong() else 0L
        }
        val next = Math.addExact(old, 1)
        db.execSQL("INSERT OR REPLACE INTO meta(key,value) VALUES('client_seq',?)", arrayOf(next.toString()))
        return next
    }

    private fun event(db: SQLiteDatabase, owner: String?, conversationId: String, kind: String, payload: JSONObject): String {
        val eventId = uuid("event")
        val values = ContentValues().apply {
            put("event_id", eventId); put("owner_key", owner)
            put("conversation_id", conversationId); put("client_seq", nextClientSeq(db))
            put("kind", kind); put("occurred_at", now()); put("payload", payload.toString())
        }
        db.insertOrThrow("events", null, values)
        return eventId
    }

    @Synchronized fun createConversation(title: String, owner: String?): LocalConversation = write { db ->
        val id = uuid("conversation")
        val bounded = title.trim().take(120).ifBlank { "新对话" }
        val createdAt = now()
        db.insertOrThrow("conversations", null, ContentValues().apply {
            put("id", id); put("owner_key", owner); put("title", bounded); put("created_at", createdAt)
        })
        val eventId = event(db, owner, id, "conversation.created", JSONObject().put("title", bounded))
        db.execSQL("UPDATE conversations SET source_event_id=? WHERE id=?", arrayOf(eventId, id))
        LocalConversation(id, bounded, owner, createdAt)
    }

    @Synchronized fun addMessage(conversationId: String, role: String, text: String, turnId: String? = null,
        thumbnails: List<MessageThumbnail> = emptyList(), images: List<ChatAttachment> = emptyList()): String = write { db ->
        require(role == "user" || role == "assistant")
        require((text.isNotBlank() || images.isNotEmpty()) && text.length <= 16_384)
        require(thumbnails.isEmpty() || role == "user")
        require(thumbnails.size <= 4 && thumbnails.map { it.attachmentId }.distinct().size == thumbnails.size)
        require(images.isEmpty() || role == "user")
        val owner = ownerOf(db, conversationId)
        if (thumbnails.isNotEmpty() && owner == null) throw ApiFailure(409, "LOGIN_REQUIRED")
        val id = uuid("message")
        db.insertOrThrow("messages", null, ContentValues().apply {
            put("id", id); put("conversation_id", conversationId); put("role", role)
            put("text", text); put("turn_id", turnId); put("created_at", now())
        })
        for (thumb in thumbnails) {
            require(thumb.attachmentId.matches(Regex("attachment-[0-9a-f-]{36}")) &&
                thumb.name.length <= 120 && thumb.jpeg.size in 1..12_000)
            db.insertOrThrow("message_thumbnails", null, ContentValues().apply {
                put("owner_key", owner); put("conversation_id", conversationId); put("message_id", id)
                put("attachment_id", thumb.attachmentId); put("name", thumb.name); put("jpeg", thumb.jpeg)
            })
        }
        for (image in images) {
            require(owner != null && image.owner == owner && image.conversationId == conversationId &&
                image.sizeBytes in 1..AttachmentStore.MAX_IMAGE_BYTES)
            db.insertOrThrow("message_images", null, ContentValues().apply {
                put("owner_key", owner); put("conversation_id", conversationId); put("message_id", id)
                put("attachment_id", image.id); put("name", image.name)
                put("content_type", image.mimeType); put("size", image.sizeBytes); put("sha256", image.sha256)
            })
        }
        val eventId = event(db, owner, conversationId, "message.created",
            JSONObject().put("messageId", id).put("role", role).put("text", text))
        db.execSQL("UPDATE messages SET source_event_id=? WHERE id=?", arrayOf(eventId, id))
        id
    }

    @Synchronized fun pendingImages(owner: String, messageId: String): List<PendingImage> {
        val rows = mutableListOf<PendingImage>()
        readableDatabase.rawQuery("SELECT conversation_id,attachment_id,name,content_type,size,sha256 FROM message_images WHERE owner_key=? AND message_id=? AND receipt IS NULL ORDER BY attachment_id",
            arrayOf(owner, messageId)).use { c -> while (c.moveToNext()) rows += PendingImage(messageId,
            c.getString(0), c.getString(1), c.getString(2), c.getString(3), c.getLong(4), c.getString(5)) }
        return rows
    }

    @Synchronized fun markImageUploaded(owner: String, row: PendingImage, receipt: JSONObject) = write { db ->
        require(receipt.getString("attachmentId") == row.attachmentId && receipt.getString("name") == row.name &&
            receipt.getString("contentType") == row.contentType && receipt.getLong("size") == row.size &&
            receipt.getString("sha256") == row.sha256)
        db.execSQL("UPDATE message_images SET receipt=? WHERE owner_key=? AND conversation_id=? AND message_id=? AND attachment_id=? AND receipt IS NULL",
            arrayOf(receipt.toString(), owner, row.conversationId, row.messageId, row.attachmentId))
    }

    @Synchronized fun uploadedImages(owner: String, messageId: String): JSONArray {
        val result = JSONArray()
        readableDatabase.rawQuery("SELECT receipt FROM message_images WHERE owner_key=? AND message_id=? AND receipt IS NOT NULL ORDER BY attachment_id",
            arrayOf(owner, messageId)).use { c -> while (c.moveToNext()) result.put(JSONObject(c.getString(0))) }
        return result
    }

    /** null: legacy draft; false: saved image awaiting upload; true: server receipt stored. */
    @Synchronized fun imageUploadState(owner: String, conversationId: String, attachmentId: String): Boolean? =
        readableDatabase.rawQuery("SELECT receipt IS NOT NULL FROM message_images WHERE owner_key=? AND conversation_id=? AND attachment_id=?",
            arrayOf(owner, conversationId, attachmentId)).use { c -> if (c.moveToFirst()) c.getInt(0) != 0 else null }

    @Synchronized fun imageForMessage(owner: String, conversationId: String, messageId: String,
        attachmentId: String): Pair<Boolean, Boolean>? = readableDatabase.rawQuery(
        "SELECT receipt IS NOT NULL,published FROM message_images WHERE owner_key=? AND conversation_id=? AND message_id=? AND attachment_id=?",
        arrayOf(owner, conversationId, messageId, attachmentId)).use { c ->
        if (c.moveToFirst()) (c.getInt(0) != 0) to (c.getInt(1) != 0) else null
    }

    @Synchronized fun imagePublished(owner: String, conversationId: String, attachmentId: String): Boolean? =
        readableDatabase.rawQuery("SELECT published FROM message_images WHERE owner_key=? AND conversation_id=? AND attachment_id=?",
            arrayOf(owner, conversationId, attachmentId)).use { c -> if (c.moveToFirst()) c.getInt(0) != 0 else null }

    @Synchronized fun publishedImages(owner: String): List<PendingImage> {
        val rows = mutableListOf<PendingImage>()
        readableDatabase.rawQuery("SELECT message_id,conversation_id,attachment_id,name,content_type,size,sha256 FROM message_images WHERE owner_key=? AND published=1",
            arrayOf(owner)).use { c -> while (c.moveToNext()) rows += PendingImage(c.getString(0),
            c.getString(1), c.getString(2), c.getString(3), c.getString(4), c.getLong(5), c.getString(6)) }
        return rows
    }

    @Synchronized fun messageThumbnails(conversationId: String, owner: String?, messageId: String): JSONArray {
        val result = JSONArray()
        if (owner == null || ownerOf(readableDatabase, conversationId) != owner) return result
        val messageOwned = readableDatabase.rawQuery(
            "SELECT 1 FROM messages WHERE id=? AND conversation_id=? AND role='user'",
            arrayOf(messageId, conversationId)).use { it.moveToFirst() }
        if (!messageOwned) return result
        readableDatabase.rawQuery(
            "SELECT attachment_id,name,jpeg FROM message_thumbnails WHERE owner_key=? AND conversation_id=? AND message_id=? ORDER BY attachment_id",
            arrayOf(owner, conversationId, messageId)).use { c ->
            while (c.moveToNext()) {
                val bytes = c.getBlob(2)
                if (bytes.size !in 1..12_000) continue
                result.put(JSONObject().put("attachmentId", c.getString(0)).put("name", c.getString(1))
                    .put("thumbnailDataUrl", "data:image/jpeg;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}")
                    .apply { imageForMessage(owner, conversationId, messageId, c.getString(0))?.let { state ->
                        put("previewUrl", imagePreviewUrl(conversationId, messageId, c.getString(0)))
                        put("displayUrl", imagePreviewUrl(conversationId, messageId, c.getString(0)) + "&variant=display")
                        put("syncStatus", if (state.second) "shared" else "pending")
                    } })
            }
        }
        readableDatabase.rawQuery(
            "SELECT attachment_id,name,published FROM message_images WHERE owner_key=? AND conversation_id=? AND message_id=? ORDER BY attachment_id",
            arrayOf(owner, conversationId, messageId)).use { c -> while (c.moveToNext()) {
            val id = c.getString(0)
            if ((0 until result.length()).any { result.getJSONObject(it).getString("attachmentId") == id }) continue
            result.put(JSONObject().put("attachmentId", id).put("name", c.getString(1))
                .put("previewUrl", imagePreviewUrl(conversationId, messageId, id))
                .put("displayUrl", imagePreviewUrl(conversationId, messageId, id) + "&variant=display")
                .put("syncStatus", if (c.getInt(2) != 0) "shared" else "pending"))
        } }
        return result
    }

    @Synchronized fun startTurn(conversationId: String): String = write { db ->
        ownerOf(db, conversationId)
        val id = uuid("turn")
        db.insertOrThrow("turns", null, ContentValues().apply {
            put("id", id); put("conversation_id", conversationId); put("status", "running"); put("created_at", now())
        })
        id
    }

    @Synchronized fun finishTurn(turnId: String, status: String, errorCode: String? = null,
        upstreamHttpStatus: Int? = null, originalModel: JSONObject? = null) = write { db ->
        require(status in setOf("completed", "cancelled", "failed", "interrupted"))
        val row = db.rawQuery("SELECT conversation_id,status FROM turns WHERE id=?", arrayOf(turnId)).use {
            if (!it.moveToFirst()) throw IllegalArgumentException("Unknown turn")
            it.getString(0) to it.getString(1)
        }
        if (row.second == "running") {
            db.execSQL("UPDATE turns SET status=? WHERE id=?", arrayOf(status, turnId))
            val payload = JSONObject().put("turnId", turnId).put("status", status)
            if (errorCode != null) payload.put("errorCode", errorCode)
            if (originalModel != null) {
                val keys = originalModel.keys().asSequence().toSet()
                val label = originalModel.optString("displayName")
                val route = originalModel.opt("routeFingerprint")
                val valid = keys in setOf(
                    setOf("modelId", "displayName", "routeFingerprint"),
                    setOf("modelId", "displayName", "routeFingerprint", "hostProfileId")) &&
                    originalModel.optString("modelId").matches(Regex("[A-Za-z0-9._:/-]{1,128}")) &&
                    label.codePointCount(0, label.length) in 1..100 &&
                    label.none { it.isISOControl() } &&
                    (route == JSONObject.NULL || route is String && route.matches(Regex("[a-f0-9]{64}"))) &&
                    (!originalModel.has("hostProfileId") || originalModel.optString("hostProfileId")
                        .matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")))
                if (valid) payload.put("originalModel", originalModel)
            }
            if (status == "failed" && errorCode == "MODEL_UPSTREAM_ERROR" && upstreamHttpStatus in 400..599)
                payload.put("upstreamHttpStatus", upstreamHttpStatus)
            event(db, ownerOf(db, row.first), row.first, "turn.finished", payload)
        }
    }

    @Synchronized fun recoverInterruptedTurns() = write { db ->
        val running = mutableListOf<String>()
        db.rawQuery("SELECT id FROM turns WHERE status='running'", null).use { c ->
            while (c.moveToNext()) running += c.getString(0)
        }
        for (id in running) {
            val conversationId = db.rawQuery("SELECT conversation_id FROM turns WHERE id=?", arrayOf(id)).use {
                it.moveToFirst(); it.getString(0)
            }
            db.execSQL("UPDATE turns SET status='interrupted' WHERE id=?", arrayOf(id))
            event(db, ownerOf(db, conversationId), conversationId, "turn.finished",
                JSONObject().put("turnId", id).put("status", "interrupted"))
        }
    }

    @Synchronized fun toolReceipt(conversationId: String, toolCallId: String, toolName: String, status: String, summary: String) = write { db ->
        require(status in setOf("dispatched", "observed", "failed", "uncertain"))
        event(db, ownerOf(db, conversationId), conversationId, "tool.receipt",
            JSONObject().put("toolCallId", toolCallId).put("toolName", toolName)
                .put("status", status).put("summary", summary.take(500)))
    }

    private fun ownerOf(db: SQLiteDatabase, id: String): String? = db.rawQuery(
        "SELECT owner_key FROM conversations WHERE id=?", arrayOf(id)).use {
        if (!it.moveToFirst()) throw IllegalArgumentException("Unknown conversation")
        if (it.isNull(0)) null else it.getString(0)
    }

    @Synchronized fun bindUnboundTo(owner: String) = write { db ->
        require(owner.isNotBlank())
        db.execSQL("UPDATE conversations SET owner_key=? WHERE owner_key IS NULL", arrayOf(owner))
        db.execSQL("UPDATE events SET owner_key=? WHERE owner_key IS NULL", arrayOf(owner))
    }

    @Synchronized fun unboundConversationCount(): Int = readableDatabase.rawQuery(
        "SELECT COUNT(*) FROM conversations WHERE owner_key IS NULL", null).use { cursor ->
        cursor.moveToFirst(); cursor.getInt(0)
    }

    @Synchronized fun listConversations(owner: String?): List<LocalConversation> {
        val items = mutableListOf<LocalConversation>()
        val query = if (owner == null) "SELECT id,title,owner_key,created_at FROM conversations WHERE owner_key IS NULL ORDER BY created_at DESC" else
            "SELECT id,title,owner_key,created_at FROM conversations WHERE owner_key=? ORDER BY created_at DESC"
        readableDatabase.rawQuery(query, if (owner == null) null else arrayOf(owner)).use { c ->
            while (c.moveToNext()) items += LocalConversation(c.getString(0), c.getString(1), if (c.isNull(2)) null else c.getString(2), c.getString(3))
        }
        return items
    }

    @Synchronized fun messages(conversationId: String, owner: String?): List<LocalMessage> {
        val items = mutableListOf<LocalMessage>()
        val allowed = readableDatabase.rawQuery("SELECT owner_key FROM conversations WHERE id=?", arrayOf(conversationId)).use { c ->
            c.moveToFirst() && (if (c.isNull(0)) null else c.getString(0)) == owner
        }
        if (!allowed) return items
        readableDatabase.rawQuery("SELECT id,role,text,server_seq,source_event_id FROM messages WHERE conversation_id=? ORDER BY server_seq IS NULL,server_seq,rowid", arrayOf(conversationId)).use { c ->
            while (c.moveToNext()) items += LocalMessage(c.getString(0), c.getString(1), c.getString(2),
                if (c.isNull(3)) null else c.getLong(3), if (c.isNull(4)) null else c.getString(4))
        }
        return items
    }

    @Synchronized fun timeline(conversationId: String, owner: String?): List<TimelineItem> {
        val allowed = readableDatabase.rawQuery("SELECT owner_key FROM conversations WHERE id=?", arrayOf(conversationId)).use { c ->
            c.moveToFirst() && (if (c.isNull(0)) null else c.getString(0)) == owner
        }
        if (!allowed) return emptyList()
        val items = mutableListOf<TimelineItem>()
        readableDatabase.rawQuery("SELECT kind,payload FROM events WHERE conversation_id=? ORDER BY client_seq DESC LIMIT 500",
            arrayOf(conversationId)).use { c ->
            while (c.moveToNext()) {
                val payload = JSONObject(c.getString(1))
                when (c.getString(0)) {
                    "message.created" -> {
                        val user = payload.optString("role") == "user"
                        items += TimelineItem("${if (user) "我" else "助手"} · ${payload.optString("text")}", user)
                    }
                    "tool.receipt" -> {
                        val name = when (payload.optString("toolName")) {
                            "open_settings" -> "系统设置"
                            "open_app" -> "打开应用"
                            "list_launchable_apps" -> "应用列表"
                            else -> "手机动作"
                        }
                        val state = when (payload.optString("status")) {
                            "dispatched" -> "已请求，待核对"
                            "observed" -> "已观察到结果"
                            "failed" -> "未完成"
                            else -> "结果待确认"
                        }
                        items += TimelineItem("$name · $state · ${payload.optString("summary")}", false)
                    }
                    "turn.finished" -> when (payload.optString("status")) {
                        "cancelled" -> items += TimelineItem("本轮已停止", false)
                        "interrupted" -> items += TimelineItem("上次退出时，本轮中断了", false)
                        "failed" -> items += TimelineItem("本轮未完成，请查看连接或模型设置", false)
                    }
                }
            }
        }
        return items.asReversed()
    }

    @Synchronized fun pending(owner: String, limit: Int = 50): List<PendingSyncEvent> {
        val items = mutableListOf<PendingSyncEvent>()
        readableDatabase.rawQuery("SELECT event_id,conversation_id,client_seq,kind,occurred_at,payload FROM events WHERE owner_key=? AND ack_seq IS NULL ORDER BY client_seq LIMIT ?",
            arrayOf(owner, limit.coerceIn(1, 50).toString())).use { c ->
            while (c.moveToNext()) {
                val payload = JSONObject(c.getString(5))
                if (c.getString(3) == "message.created") {
                    val images = uploadedImages(owner, payload.getString("messageId"))
                    if (images.length() > 0) payload.put("attachments", images)
                }
                val body = JSONObject().put("eventId", c.getString(0)).put("conversationId", c.getString(1))
                    .put("clientSeq", c.getLong(2)).put("kind", c.getString(3))
                    .put("occurredAt", c.getString(4)).put("payload", payload)
                items += PendingSyncEvent(c.getString(0), body)
            }
        }
        return items
    }

    @Synchronized fun markAccepted(owner: String, accepted: JSONArray) = write { db ->
        for (i in 0 until accepted.length()) {
            val row = accepted.getJSONObject(i)
            db.rawQuery("SELECT kind,payload FROM events WHERE owner_key=? AND event_id=?",
                arrayOf(owner, row.getString("eventId"))).use { c -> if (c.moveToFirst() && c.getString(0) == "message.created") {
                val messageId = JSONObject(c.getString(1)).optString("messageId")
                db.execSQL("UPDATE messages SET server_seq=? WHERE id=? AND source_event_id=?",
                    arrayOf(row.getLong("seq"), messageId, row.getString("eventId")))
                db.execSQL("UPDATE message_images SET published=1 WHERE owner_key=? AND message_id=? AND receipt IS NOT NULL",
                    arrayOf(owner, messageId))
            } }
            db.execSQL("UPDATE events SET ack_seq=? WHERE owner_key=? AND event_id=? AND ack_seq IS NULL",
                arrayOf(row.getLong("seq"), owner, row.getString("eventId")))
        }
    }

    @Synchronized fun cursor(owner: String): Long = readableDatabase.rawQuery(
        "SELECT value FROM meta WHERE key=?", arrayOf("cursor:$owner")).use {
        if (it.moveToFirst()) it.getString(0).toLong() else 0L
    }

    private fun syncConflict(): Nothing = throw ApiFailure(409, "SYNC_CONFLICT")

    private fun migrateAcceptedEvents(db: SQLiteDatabase) {
        db.rawQuery("SELECT event_id,conversation_id,kind,payload,ack_seq FROM events WHERE kind IN ('conversation.created','message.created')",
            null).use { c -> while (c.moveToNext()) {
            val eventId = c.getString(0)
            val conversationId = c.getString(1)
            if (c.getString(2) == "conversation.created")
                db.execSQL("UPDATE conversations SET source_event_id=? WHERE id=? AND source_event_id IS NULL",
                    arrayOf(eventId, conversationId))
            else {
                val messageId = JSONObject(c.getString(3)).getString("messageId")
                db.execSQL("UPDATE messages SET source_event_id=?,server_seq=? WHERE id=? AND source_event_id IS NULL",
                    arrayOf(eventId, if (c.isNull(4)) null else c.getLong(4), messageId))
            }
        } }
    }

    private fun materializeRemoteEvent(db: SQLiteDatabase, owner: String, row: JSONObject, seq: Long) {
        val eventId = row.getString("eventId")
        val conversationId = row.getString("conversationId")
        val kind = row.getString("kind")
        val payload = row.getJSONObject("payload")
        if (owner.isBlank() || !validImageScopeId(eventId) || !validImageScopeId(conversationId)) syncConflict()
        db.rawQuery("SELECT conversation_id,kind,payload FROM events WHERE owner_key=? AND event_id=?",
            arrayOf(owner, eventId)).use { c -> if (c.moveToFirst()) {
            if (c.getString(0) != conversationId || c.getString(1) != kind) syncConflict()
            val local = JSONObject(c.getString(2))
            if (kind == "conversation.created" && local.optString("title") != payload.optString("title")) syncConflict()
            if (kind == "message.created" && (local.optString("messageId") != payload.optString("messageId") ||
                local.optString("role") != payload.optString("role") || local.optString("text") != payload.optString("text"))) syncConflict()
            db.execSQL("UPDATE events SET ack_seq=? WHERE owner_key=? AND event_id=? AND (ack_seq IS NULL OR ack_seq=?)",
                arrayOf(seq, owner, eventId, seq))
        } }
        when (kind) {
            "conversation.created" -> {
                val title = payload.getString("title")
                if (title.isBlank() || title.length > 256) syncConflict()
                db.rawQuery("SELECT owner_key,title,source_event_id FROM conversations WHERE id=?",
                    arrayOf(conversationId)).use { c -> if (c.moveToFirst()) {
                    if (c.getString(0) != owner || c.getString(1) != title ||
                        !c.isNull(2) && c.getString(2) != eventId) syncConflict()
                    db.execSQL("UPDATE conversations SET source_event_id=? WHERE id=? AND source_event_id IS NULL",
                        arrayOf(eventId, conversationId))
                } else db.insertOrThrow("conversations", null, ContentValues().apply {
                    put("id", conversationId); put("owner_key", owner); put("title", title)
                    put("created_at", row.getString("occurredAt")); put("source_event_id", eventId)
                }) }
            }
            "message.created" -> {
                val messageId = payload.getString("messageId")
                val role = payload.getString("role")
                val text = payload.getString("text")
                val refs = payload.optJSONArray("attachments")
                if (!validImageScopeId(messageId) || role !in setOf("user", "assistant") ||
                    text.length > 16_384 || text.isBlank() && (refs == null || refs.length() == 0)) syncConflict()
                val belongs = db.rawQuery("SELECT owner_key FROM conversations WHERE id=?",
                    arrayOf(conversationId)).use { c -> c.moveToFirst() && c.getString(0) == owner }
                if (!belongs) syncConflict()
                db.rawQuery("SELECT conversation_id,role,text,server_seq,source_event_id FROM messages WHERE id=?",
                    arrayOf(messageId)).use { c -> if (c.moveToFirst()) {
                    if (c.getString(0) != conversationId || c.getString(1) != role || c.getString(2) != text ||
                        !c.isNull(3) && c.getLong(3) != seq || !c.isNull(4) && c.getString(4) != eventId) syncConflict()
                    db.execSQL("UPDATE messages SET server_seq=?,source_event_id=? WHERE id=?",
                        arrayOf(seq, eventId, messageId))
                } else db.insertOrThrow("messages", null, ContentValues().apply {
                    put("id", messageId); put("conversation_id", conversationId); put("role", role)
                    put("text", text); put("created_at", row.getString("occurredAt"))
                    put("server_seq", seq); put("source_event_id", eventId)
                }) }
                if (refs != null) for (i in 0 until refs.length()) {
                    val ref = refs.getJSONObject(i)
                    val attachmentId = ref.getString("attachmentId")
                    val name = ref.getString("name")
                    val contentType = ref.getString("contentType")
                    val size = ref.getLong("size")
                    val hash = ref.getString("sha256")
                    if (!validImageScopeId(attachmentId) || name.isBlank() || name.length > 128 ||
                        contentType !in setOf("image/png", "image/jpeg", "image/webp", "image/gif") ||
                        size !in 1..AttachmentStore.MAX_IMAGE_BYTES || !hash.matches(Regex("[a-f0-9]{64}"))) syncConflict()
                    db.rawQuery("SELECT conversation_id,message_id,name,content_type,size,sha256 FROM message_images WHERE owner_key=? AND attachment_id=?",
                        arrayOf(owner, attachmentId)).use { c -> if (c.moveToFirst()) {
                        if (c.getString(0) != conversationId || c.getString(1) != messageId ||
                            c.getString(2) != name || c.getString(3) != contentType ||
                            c.getLong(4) != size || c.getString(5) != hash) syncConflict()
                        db.execSQL("UPDATE message_images SET receipt=?,published=1 WHERE owner_key=? AND attachment_id=?",
                            arrayOf(ref.toString(), owner, attachmentId))
                    } else db.insertOrThrow("message_images", null, ContentValues().apply {
                        put("owner_key", owner); put("conversation_id", conversationId)
                        put("message_id", messageId); put("attachment_id", attachmentId)
                        put("name", name); put("content_type", contentType); put("size", size)
                        put("sha256", hash); put("receipt", ref.toString()); put("published", 1)
                    }) }
                }
            }
        }
    }

    @Synchronized fun applyRemotePage(owner: String, events: JSONArray, nextSeq: Long) = write { db ->
        val old = cursor(owner)
        var expected = old
        for (i in 0 until events.length()) {
            val row = events.getJSONObject(i)
            val seq = row.getLong("seq")
            if (seq <= old) {
                val prior = db.rawQuery("SELECT body FROM remote_events WHERE owner_key=? AND seq=?",
                    arrayOf(owner, seq.toString())).use { c -> if (c.moveToFirst()) JSONObject(c.getString(0)) else null }
                if (prior == null || prior.getString("eventId") != row.getString("eventId") ||
                    prior.getString("conversationId") != row.getString("conversationId") ||
                    prior.getString("kind") != row.getString("kind") ||
                    prior.getJSONObject("payload").toString() != row.getJSONObject("payload").toString()) syncConflict()
                continue
            }
            if (seq != expected + 1 || seq > nextSeq) syncConflict()
            expected = seq
            val eventId = row.getString("eventId")
            val existing = db.rawQuery("SELECT seq FROM remote_events WHERE owner_key=? AND event_id=?",
                arrayOf(owner, eventId)).use { c -> if (c.moveToFirst()) c.getLong(0) else null }
            if (existing != null) syncConflict()
            materializeRemoteEvent(db, owner, row, seq)
            db.execSQL("INSERT INTO remote_events(owner_key,seq,body,event_id) VALUES(?,?,?,?)",
                arrayOf(owner, seq, row.toString(), eventId))
        }
        if (nextSeq > old && expected != nextSeq) syncConflict()
        if (expected > old) db.execSQL("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)",
            arrayOf("cursor:$owner", expected.toString()))
    }

    @Synchronized fun remoteEvents(owner: String): List<JSONObject> {
        val result = mutableListOf<JSONObject>()
        readableDatabase.rawQuery("SELECT body FROM remote_events WHERE owner_key=? ORDER BY seq", arrayOf(owner)).use { c ->
            while (c.moveToNext()) result += JSONObject(c.getString(0))
        }
        return result
    }

    @Synchronized fun latestTurnStatus(conversationId: String): String? = readableDatabase.rawQuery(
        "SELECT status FROM turns WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1", arrayOf(conversationId)).use {
        if (it.moveToFirst()) it.getString(0) else null
    }

    @Synchronized fun turnStatus(turnId: String): String? = readableDatabase.rawQuery(
        "SELECT status FROM turns WHERE id=?", arrayOf(turnId)).use {
        if (it.moveToFirst()) it.getString(0) else null
    }

    /** Exposes only validated failure metadata from the latest turn of the requested account. */
    @Synchronized fun latestTurnFailure(conversationId: String, owner: String?): JSONObject? {
        val db = readableDatabase
        if (ownerOf(db, conversationId) != owner) return null
        val turnId = db.rawQuery("SELECT id,status FROM turns WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1",
            arrayOf(conversationId)).use { cursor ->
            if (!cursor.moveToFirst() || cursor.getString(1) != "failed") return null
            cursor.getString(0)
        }
        db.rawQuery("SELECT payload FROM events WHERE conversation_id=? AND kind='turn.finished' ORDER BY client_seq DESC",
            arrayOf(conversationId)).use { cursor ->
            while (cursor.moveToNext()) {
                val payload = JSONObject(cursor.getString(0))
                if (payload.optString("turnId") != turnId) continue
                val code = payload.optString("errorCode")
                if (!code.matches(Regex("[A-Z_0-9]{1,64}"))) return null
                val result = JSONObject().put("turnErrorCode", code)
                val httpStatus = payload.optInt("upstreamHttpStatus", 0)
                if (code == "MODEL_UPSTREAM_ERROR" && httpStatus in 400..599)
                    result.put("upstreamHttpStatus", httpStatus)
                return result
            }
        }
        return null
    }

    @Synchronized fun toolReceipts(conversationId: String, owner: String?): List<JSONObject> {
        val allowed = readableDatabase.rawQuery("SELECT owner_key FROM conversations WHERE id=?", arrayOf(conversationId)).use { c ->
            c.moveToFirst() && (if (c.isNull(0)) null else c.getString(0)) == owner
        }
        if (!allowed) return emptyList()
        val result = mutableListOf<JSONObject>()
        readableDatabase.rawQuery("SELECT payload FROM events WHERE conversation_id=? AND kind='tool.receipt' ORDER BY client_seq",
            arrayOf(conversationId)).use { c -> while (c.moveToNext()) result += JSONObject(c.getString(0)) }
        return result
    }
}
