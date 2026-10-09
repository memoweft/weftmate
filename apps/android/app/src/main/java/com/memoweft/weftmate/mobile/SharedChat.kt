package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** All remote session commands pass through one durable, owner-scoped request ledger. */
internal class SharedChat(private val store: LocalStore, private val api: PersonalApi,
    private val attachments: AttachmentStore? = null) {
    private val sessionIdPattern = Regex("[A-Za-z0-9_-]{1,128}")
    private val requestIdPattern = Regex("[A-Za-z0-9_.:-]{1,128}")

    fun sessions(host: HostIdentity): JSONObject {
        val owner = Endpoints.ownerKey(host.origin, host.ownerId)
        return try {
            api.me(host)
            val result = api.remoteSessions(host)
            val rows = result.getJSONArray("sessions")
            for (i in 0 until rows.length()) rows.getJSONObject(i).put("source", "host")
            store.saveSharedSessions(owner, host.hostId, rows)
            JSONObject().put("source", "host").put("hostAvailable", true).put("sessions", rows).put("groups", result.optJSONArray("groups") ?: JSONArray())
        } catch (error: Exception) {
            if (error is ApiFailure && error.status in 400..499) throw error
            JSONObject().put("source", "host").put("hostAvailable", false)
                .put("sessions", store.sharedSessions(owner, host.hostId))
        }
    }

    fun history(host: HostIdentity, sessionId: String, afterSeq: Long? = null, beforeSeq: Long? = null): JSONObject {
        if (!sessionIdPattern.matches(sessionId) || afterSeq != null && afterSeq < -1 || beforeSeq != null && beforeSeq < 0 || afterSeq != null && beforeSeq != null) throw ApiFailure(400, "INVALID_REQUEST")
        val owner = Endpoints.ownerKey(host.origin, host.ownerId)
        return try {
            api.me(host)
            val result = api.remoteHistory(host, sessionId, afterSeq, beforeSeq)
            val events = result.getJSONArray("events")
            val next = result.getLong("nextSeq")
            if (next < (afterSeq ?: -1) || events.length() > 100 ||
                result.optBoolean("hasMore") && next == afterSeq)
                throw ApiFailure(502, "HISTORY_CURSOR_INVALID")
            store.saveSharedHistoryPage(owner, host.hostId, sessionId, events, next, result.optBoolean("hasOlder"))
            result.put("source", "host").put("sessionId", sessionId)
                .put("hostAvailable", true).put("cached", false)
        } catch (error: Exception) {
            if (error is ApiFailure && error.status in 400..499) throw error
            store.cachedSharedHistory(owner, host.hostId, sessionId, afterSeq, beforeSeq)
                .put("source", "host").put("sessionId", sessionId)
        }
    }

    private fun checked(row: SharedCommandRow, command: JSONObject): JSONObject {
        if (command.optString("requestId") != row.requestId ||
            command.optString("sessionId") != row.sessionId ||
            command.optString("kind") != row.payload.getString("kind") ||
            row.payload.has("sourceSyncEventId") &&
            command.optString("sourceSyncEventId") != row.payload.getString("sourceSyncEventId"))
            throw ApiFailure(502, "COMMAND_RECEIPT_INVALID")
        val state = when (command.optString("state")) {
            "accepted_by_dsh", "observed" -> "accepted"
            "rejected" -> "rejected"
            else -> "uncertain"
        }
        store.updateSharedCommand(row, state, command)
        if (state == "accepted") {
            val refs = row.payload.optJSONArray("originalAttachments") ?: row.payload.optJSONArray("attachments")
            if (refs != null) attachments?.consumeShared(row.owner, row.sessionId,
                (0 until refs.length()).map { refs.getJSONObject(it).getString("attachmentId") }, row.requestId)
        }
        val result = row.bridge().put("state", state).put("command", command)
        if (state == "rejected") {
            val code = command.optString("errorCode")
            if (code.matches(Regex("[A-Z_]{1,64}"))) result.put("errorCode", code)
        }
        return result
    }

    /** Query the server first, including when the previous POST may have committed but lost its reply. */
    @Synchronized fun reconcile(host: HostIdentity, row: SharedCommandRow, current: () -> Boolean): JSONObject {
        if (row.owner != Endpoints.ownerKey(host.origin, host.ownerId) || row.hostId != host.hostId)
            throw ApiFailure(409, "ACCOUNT_SWITCHED")
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        api.me(host)
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val prior = try { api.commandByRequest(host, row.requestId) }
        catch (error: ApiFailure) {
            if (error.status != 404 || error.safeCode != "NOT_FOUND") {
                store.updateSharedCommand(row, "uncertain")
                throw error
            }
            null
        }
        if (prior != null) {
            if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
            return checked(row, prior)
        }
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val originalRefs = row.payload.optJSONArray("originalAttachments")
        val refs = row.payload.optJSONArray("attachments")
        val originals = originalRefs ?: refs
        if (originals != null) {
            val ids = (0 until originals.length()).map { originals.getJSONObject(it).getString("attachmentId") }
            val originals = attachments ?: throw ApiFailure(409, "ATTACHMENT_UNAVAILABLE")
            originals.bindSharedAttempt(row.owner, row.sessionId, ids, row.requestId)
            val originalMessageId = row.payload.optString("attachmentMessageId")
            if (originalRefs != null) {
                if (!originalMessageId.matches(Regex("message-[0-9a-f-]{36}"))) throw ApiFailure(409, "ATTACHMENT_STATE_CHANGED")
                val rows = originals.get(row.owner, row.sessionId, ids)
                for (i in rows.indices) {
                    if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
                    val rowRef = rows[i]
                    val uploaded = api.uploadImage(host, PendingImage(originalMessageId, row.sessionId, rowRef.id,
                        rowRef.name, rowRef.mimeType, rowRef.sizeBytes, rowRef.sha256), rowRef.file)
                    val expected = originalRefs.getJSONObject(i)
                    if (uploaded.optString("attachmentId") != expected.optString("attachmentId") ||
                        uploaded.optString("name") != expected.optString("name") ||
                        uploaded.optString("contentType") != expected.optString("contentType") ||
                        uploaded.optLong("size") != expected.optLong("size") ||
                        uploaded.optString("sha256") != expected.optString("sha256"))
                        throw ApiFailure(502, "ATTACHMENT_RECEIPT_INVALID")
                }
            }
        }
        if (refs != null) {
            val ids = (0 until refs.length()).map { refs.getJSONObject(it).getString("attachmentId") }
            val originals = attachments ?: throw ApiFailure(409, "ATTACHMENT_UNAVAILABLE")
            val sourceRows = originals.get(row.owner, row.sessionId, ids)
            val rows = sourceRows.mapIndexed { index, source ->
                val expected = refs.getJSONObject(index)
                if (source.kind == "file") originals.modelAttachment(source, expected.getInt("size"))
                else originals.modelAttachment(source)
            }
            for (i in rows.indices) {
                if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
                val uploaded = api.uploadSharedImage(host, row.sessionId, row.requestId, rows[i])
                val expected = refs.getJSONObject(i)
                if (uploaded.optString("attachmentId") != expected.optString("attachmentId") ||
                    uploaded.optString("name") != expected.optString("name") ||
                    uploaded.optString("contentType") != expected.optString("contentType") ||
                    uploaded.optLong("size") != expected.optLong("size") ||
                    uploaded.optString("sha256") != expected.optString("sha256"))
                    throw ApiFailure(502, "ATTACHMENT_RECEIPT_INVALID")
            }
        }
        // The same requestId and byte-equivalent canonical body are reused. The host de-duplicates it.
        store.updateSharedCommand(row, "uncertain")
        return try {
            if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
            val command = api.postCommand(host, row.payload)
            if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
            checked(row, command)
        }
        catch (error: Exception) {
            val rejected = error is ApiFailure && error.safeCode in setOf("SESSION_READ_ONLY",
                "SESSION_UNAVAILABLE", "MODEL_UNAVAILABLE", "REQUEST_CONFLICT", "INVALID_REQUEST")
            store.updateSharedCommand(row, if (rejected) "rejected" else "uncertain")
            throw error
        }
    }

    @Synchronized fun submit(host: HostIdentity, sessionId: String, text: String?, kind: String,
        requestId: String?, attachmentIds: List<String> = emptyList(),
        sourceSyncEventId: String? = null, intent: String = "queue", current: () -> Boolean): JSONObject {
        if (intent !in setOf("steer", "queue")) throw ApiFailure(400, "INVALID_REQUEST")
        if (!sessionIdPattern.matches(sessionId) || kind !in setOf("session.message", "session.cancel"))
            throw ApiFailure(400, "INVALID_REQUEST")
        if (kind == "session.message" && ((text.isNullOrBlank() && attachmentIds.isEmpty()) ||
            (text?.length ?: 0) > 16_384))
            throw ApiFailure(400, "MESSAGE_INVALID")
        if (kind != "session.message" && attachmentIds.isNotEmpty()) throw ApiFailure(400, "INVALID_REQUEST")
        if (sourceSyncEventId != null && (kind != "session.message" ||
            !validImageScopeId(sourceSyncEventId))) throw ApiFailure(400, "INVALID_REQUEST")
        val id = requestId ?: "mobile-${UUID.randomUUID()}"
        if (!requestIdPattern.matches(id)) throw ApiFailure(400, "INVALID_REQUEST")
        val owner = Endpoints.ownerKey(host.origin, host.ownerId)
        try { api.me(host) }
        catch (error: ApiFailure) { if (error.status in 400..499) throw error }
        catch (_: Exception) { /* A previously verified session may be queued offline. */ }
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        var selected = store.sharedSession(owner, host.hostId, sessionId)
        if (selected == null) {
            val listing = sessions(host)
            if (!listing.getBoolean("hostAvailable")) throw ApiFailure(503, "HOST_UNAVAILABLE")
            selected = store.sharedSession(owner, host.hostId, sessionId)
                ?: throw ApiFailure(404, "SESSION_UNAVAILABLE")
        }
        if (!selected.optBoolean("sendAvailable")) throw ApiFailure(409, "SESSION_READ_ONLY")
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val payload = JSONObject().put("requestId", id).put("kind", kind)
            .put("targetDeviceId", host.hostId).put("sessionId", sessionId)
        if (kind == "session.message") payload.put("text", text)
            .put("intent", intent)
        if (sourceSyncEventId != null) payload.put("sourceSyncEventId", sourceSyncEventId)
        if (attachmentIds.isNotEmpty()) {
            val rows = attachments?.get(owner, sessionId, attachmentIds)
                ?: throw ApiFailure(409, "ATTACHMENT_UNAVAILABLE")
            if (rows.any { it.attemptTurnId != null && it.attemptTurnId != id })
                throw ApiFailure(409, "ATTACHMENT_IN_USE")
            val messageId = "message-${UUID.randomUUID()}"
            payload.put("attachmentMessageId", messageId).put("originalAttachments", JSONArray(rows.map { original ->
                JSONObject().put("attachmentId", original.id).put("name", original.name).put("contentType", original.mimeType)
                    .put("size", original.sizeBytes).put("sha256", original.sha256) }))
            var remainingTextBytes = AttachmentStore.MAX_MODEL_TEXT_BYTES
            val modelRows = JSONArray()
            for (original in rows) {
                if (!attachments!!.modelReadable(original)) continue
                val row = if (original.kind == "file") {
                    if (remainingTextBytes <= 0) continue
                    attachments.modelAttachment(original, remainingTextBytes)
                } else attachments.modelAttachment(original)
                if (row.kind == "file") remainingTextBytes -= row.sizeBytes.toInt()
                modelRows.put(JSONObject().put("attachmentId", row.id).put("name", row.name)
                    .put("contentType", row.mimeType).put("size", row.sizeBytes).put("sha256", row.sha256))
            }
            if (modelRows.length() > 0) payload.put("attachments", modelRows)
        }
        val row = store.queueSharedCommand(owner, host.hostId, sessionId, id, payload)
        return try {
            var result = reconcile(host, row, current)
            if (attachmentIds.isNotEmpty() && result.optString("state") == "uncertain") {
                repeat(4) {
                    if (!current() || result.optString("state") != "uncertain") return@repeat
                    Thread.sleep(250)
                    val latest = store.sharedCommand(owner, host.hostId, sessionId, id) ?: row
                    result = reconcile(host, latest, current)
                }
            }
            result
        }
        catch (error: Exception) {
            val latest = store.sharedCommand(owner, host.hostId, sessionId, id) ?: row
            val state = if (latest.state == "rejected") "rejected" else "uncertain"
            if (state == "uncertain") store.updateSharedCommand(row, state)
            row.bridge().put("state", state)
                .put("errorCode", (error as? ApiFailure)?.safeCode ?: "SERVICE_UNAVAILABLE")
        }
    }

    /** Receipt lookup also settles the original durable outbox row, without sending. */
    @Synchronized fun commandByRequest(host: HostIdentity, requestId: String, current: () -> Boolean): JSONObject {
        if (!requestIdPattern.matches(requestId)) throw ApiFailure(400, "INVALID_REQUEST")
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val command = api.commandByRequest(host, requestId)
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val row = store.sharedCommand(Endpoints.ownerKey(host.origin, host.ownerId), host.hostId,
            command.optString("sessionId"), requestId)
        if (row != null) checked(row, command)
        return command
    }

    fun outbox(host: HostIdentity): JSONObject = JSONObject().put("source", "host")
        .put("commands", JSONArray(store.sharedCommands(Endpoints.ownerKey(host.origin, host.ownerId), host.hostId)
            .map { it.bridge() }))

    fun reconcileOutbox(host: HostIdentity, current: () -> Boolean): JSONObject {
        val owner = Endpoints.ownerKey(host.origin, host.ownerId)
        for (accepted in store.acceptedSharedImageCommands(owner, host.hostId)) {
            if (!current()) break
            val refs = accepted.payload.optJSONArray("originalAttachments") ?: accepted.payload.getJSONArray("attachments")
            try { attachments?.consumeShared(owner, accepted.sessionId,
                (0 until refs.length()).map { refs.getJSONObject(it).getString("attachmentId") },
                accepted.requestId) } catch (_: Exception) { /* The accepted command remains the durable receipt. */ }
        }
        val rows = store.sharedCommands(owner, host.hostId).filter { it.state != "accepted" && it.state != "rejected" }
        val results = JSONArray()
        for (row in rows) {
            if (!current()) break
            try { results.put(reconcile(host, row, current)) }
            catch (error: Exception) {
                val latest = store.sharedCommand(owner, host.hostId, row.sessionId, row.requestId) ?: row
                results.put(row.bridge().put("state", latest.state)
                    .put("errorCode", (error as? ApiFailure)?.safeCode ?: "SERVICE_UNAVAILABLE"))
                if (error is ApiFailure && error.status in setOf(401, 403)) break
            }
        }
        return JSONObject().put("source", "host").put("commands", results)
    }
}
