package com.memoweft.weftmate.mobile

import org.json.JSONObject
import java.io.IOException

internal sealed class ConversationSendRoute {
    data class Phone(val reserved: Boolean, val requestId: String? = null) : ConversationSendRoute()
    data class Host(val sessionId: String, val sourceSyncEventId: String,
        val acceptedText: String) : ConversationSendRoute()
    data object Unconfirmed : ConversationSendRoute()
}

/** A phone conversation keeps its ID while a server-bound DSH session takes over future turns. */
internal class ConversationHandoff(private val store: LocalStore, private val api: PersonalApi,
    private val attachments: AttachmentStore) {
    private fun owner(host: HostIdentity) = Endpoints.ownerKey(host.origin, host.ownerId)

    fun status(host: HostIdentity, conversationId: String, current: () -> Boolean): JSONObject {
        if (!validImageScopeId(conversationId) || !current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val scope = owner(host)
        if (store.listConversations(scope).none { it.id == conversationId })
            throw ApiFailure(404, "SESSION_UNAVAILABLE")
        return try {
            val result = api.sharedConversation(host, conversationId)
            if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
            if (result.optString("conversationId") != conversationId ||
                result.optString("hostId") != host.hostId || result.optString("source") != "host")
                throw ApiFailure(502, "BINDING_RECEIPT_INVALID")
            store.saveSharedConversationSnapshot(scope, host.hostId, conversationId, result)
            result.put("hostAvailable", true).put("cached", false)
        } catch (error: Exception) {
            if (error is ApiFailure && error.status in 400..499) throw error
            val cached = store.sharedConversationSnapshot(scope, host.hostId, conversationId)
                ?: throw error
            cached.put("hostAvailable", false).put("cached", true)
                .put("status", if (cached.optString("status") == "active") "uncertain"
                    else cached.optString("status"))
        }
    }

    fun adopt(host: HostIdentity, conversationId: String, modelProfileId: String,
        requestId: String, current: () -> Boolean): JSONObject {
        if (!validImageScopeId(conversationId) ||
            !modelProfileId.matches(Regex("[A-Za-z0-9._-]{1,128}")) ||
            !requestId.matches(Regex("[A-Za-z0-9_.:-]{1,128}")) || !current())
            throw ApiFailure(400, "INVALID_REQUEST")
        val scope = owner(host)
        if (store.listConversations(scope).none { it.id == conversationId })
            throw ApiFailure(404, "SESSION_UNAVAILABLE")
        // The direct model is already idle at the caller. Sync every local event
        // and image before freezing the server's accepted conversation cut.
        SyncManager(store, api, attachments).syncOnce(host, current)
        if (!current() || store.hasPendingConversationEvents(scope, conversationId))
            throw ApiFailure(409, "CONVERSATION_SYNC_PENDING")
        val initial = status(host, conversationId, current)
        if (initial.optBoolean("cached")) throw ApiFailure(503, "HOST_UNAVAILABLE")
        if (initial.optString("status") == "active") {
            val binding = initial.optJSONObject("binding")
                ?: throw ApiFailure(502, "BINDING_RECEIPT_INVALID")
            if (binding.optString("modelProfileId") != modelProfileId)
                throw ApiFailure(409, "REQUEST_CONFLICT")
            val saved = store.handoffIntent(scope, host.hostId, conversationId)
            if (saved?.optString("requestId") == requestId &&
                saved.optString("modelProfileId") == modelProfileId) {
                val command = api.commandByRequest(host, requestId)
                if (command.optString("requestId") != requestId ||
                    command.optString("kind") != "session.create" ||
                    command.optString("sessionId") != binding.optString("sessionId") ||
                    command.optString("commandId") != binding.optString("adoptCommandId"))
                    throw ApiFailure(502, "COMMAND_RECEIPT_INVALID")
                return initial.put("command", command)
            }
            return initial.put("alreadyShared", true)
        }
        val prior = store.handoffIntent(scope, host.hostId, conversationId)
        val expected = if (prior != null) prior.getLong("expectedSyncSeq")
            else initial.optLong("syncThroughSeq", -1)
        if (expected < 0) throw ApiFailure(502, "BINDING_RECEIPT_INVALID")
        if (prior == null) {
            if (initial.optString("status") != "unbound") throw ApiFailure(409, "BINDING_PENDING")
            store.queueHandoffIntent(scope, host.hostId, conversationId, requestId, modelProfileId, expected)
        } else if (prior.optString("requestId") != requestId ||
            prior.optString("modelProfileId") != modelProfileId) throw ApiFailure(409, "REQUEST_CONFLICT")
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val known = try { api.commandByRequest(host, requestId) }
        catch (error: ApiFailure) {
            if (error.status == 404 && error.safeCode == "NOT_FOUND") null else throw error
        }
        if (known != null) {
            if (known.optString("requestId") != requestId ||
                known.optString("kind") != "session.create" ||
                !validImageScopeId(known.optString("sessionId")))
                throw ApiFailure(502, "COMMAND_RECEIPT_INVALID")
            val latest = status(host, conversationId, current)
            store.recordHandoffResponse(scope, host.hostId, conversationId, requestId,
                if (latest.optString("status") == "active") "active" else "creating", latest)
            return latest.put("command", known)
        }
        return try {
            val result = api.adoptSharedConversation(host, conversationId, requestId, modelProfileId, expected)
            if (!current() || result.optString("conversationId") != conversationId ||
                result.optString("hostId") != host.hostId ||
                result.optJSONObject("command")?.optString("requestId") != requestId)
                throw ApiFailure(502, "BINDING_RECEIPT_INVALID")
            store.saveSharedConversationSnapshot(scope, host.hostId, conversationId, result)
            store.recordHandoffResponse(scope, host.hostId, conversationId, requestId,
                if (result.optString("status") == "active") "active" else "creating", result)
            result.put("hostAvailable", true).put("cached", false)
        } catch (error: Exception) {
            store.recordHandoffResponse(scope, host.hostId, conversationId, requestId, "uncertain", null)
            if (error is ApiFailure && error.status in setOf(400, 403, 404, 409, 422)) throw error
            JSONObject().put("source", "host").put("conversationId", conversationId)
                .put("hostId", host.hostId).put("status", "uncertain")
                .put("hostAvailable", false).put("requestId", requestId)
        }
    }

    /** Sync the exact user event, then arbitrate with adoption before local inference. */
    fun routeNewUserTurn(host: HostIdentity, conversationId: String, turnId: String,
        messageId: String, current: () -> Boolean): ConversationSendRoute {
        val scope = owner(host)
        val saved = store.messageSyncEvent(scope, conversationId, messageId)
            ?: throw ApiFailure(409, "CONVERSATION_SYNC_PENDING")
        val sourceEventId = saved.getString("eventId")
        val acceptedText = saved.getJSONObject("payload").getString("text")
        try { SyncManager(store, api, attachments).syncOnce(host, current) }
        catch (error: IOException) {
            if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
            // A previous adoption POST may have committed while losing its
            // reply. An old unbound snapshot cannot authorize local inference.
            val intent = store.handoffIntent(scope, host.hostId, conversationId)
            if (intent != null && intent.optString("state") != "rejected")
                return ConversationSendRoute.Unconfirmed
            val cached = store.sharedConversationSnapshot(scope, host.hostId, conversationId)
            return if (cached?.optString("status") == "active" || cached?.optString("status") == "creating")
                ConversationSendRoute.Unconfirmed else ConversationSendRoute.Phone(false)
        }
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val acked = store.messageSyncEvent(scope, conversationId, messageId)
        if (acked?.isNull("ackSeq") != false) return ConversationSendRoute.Unconfirmed
        val view = try { status(host, conversationId, current) }
        catch (error: IOException) { return ConversationSendRoute.Unconfirmed }
        if (view.optBoolean("cached")) return ConversationSendRoute.Unconfirmed
        fun adopted(result: JSONObject): ConversationSendRoute? {
            if (result.optString("status") != "active") return null
            val sessionId = result.optJSONObject("binding")?.optString("sessionId") ?: ""
            if (!validImageScopeId(sessionId)) throw ApiFailure(502, "BINDING_RECEIPT_INVALID")
            return ConversationSendRoute.Host(sessionId, sourceEventId, acceptedText)
        }
        adopted(view)?.let { return it }
        if (view.optString("status") != "unbound") return ConversationSendRoute.Unconfirmed
        val requestId = store.queueLocalTurnReservation(scope, host.hostId, conversationId,
            turnId, sourceEventId)
        try {
            val known = try { api.localTurn(host, conversationId, turnId) }
                catch (error: ApiFailure) {
                    if (error.status == 404) null else throw error
                }
            val reserved = known ?: api.reserveLocalTurn(host, conversationId, turnId,
                sourceEventId, requestId)
            if (!current() || reserved.optString("turnId") != turnId ||
                reserved.optString("requestId") != requestId ||
                reserved.optString("state") != "running") {
                store.recordLocalTurnReservation(scope, host.hostId, turnId, "uncertain")
                return ConversationSendRoute.Unconfirmed
            }
            store.recordLocalTurnReservation(scope, host.hostId, turnId, "running")
            return ConversationSendRoute.Phone(true, requestId)
        } catch (error: Exception) {
            if (error is ApiFailure && error.status == 409) {
                adopted(status(host, conversationId, current))?.let { return it }
            }
            // A lost POST reply can mean the lease exists. Never infer that it
            // failed and start a second model without the exact GET proof.
            val recovered = try { api.localTurn(host, conversationId, turnId) } catch (_: Exception) { null }
            if (recovered?.optString("state") == "running" &&
                recovered.optString("requestId") == requestId) {
                store.recordLocalTurnReservation(scope, host.hostId, turnId, "running")
                return ConversationSendRoute.Phone(true, requestId)
            }
            store.recordLocalTurnReservation(scope, host.hostId, turnId, "uncertain")
            return ConversationSendRoute.Unconfirmed
        }
    }

    fun renew(host: HostIdentity, conversationId: String, turnId: String,
        requestId: String, current: () -> Boolean): Boolean {
        if (!current()) return false
        return try {
            val result = api.updateLocalTurn(host, conversationId, turnId, requestId, "renew")
            current() && result.optString("state") == "running" &&
                result.optString("turnId") == turnId && result.optString("requestId") == requestId
        } catch (_: Exception) { false }
    }

    fun finish(host: HostIdentity, conversationId: String, turnId: String,
        requestId: String, current: () -> Boolean): Boolean {
        if (!current()) return false
        return try {
            SyncManager(store, api, attachments).syncOnce(host, current)
            if (!current()) return false
            val result = api.updateLocalTurn(host, conversationId, turnId, requestId, "finish")
            val finished = result.optString("state") == "finished" && result.optString("turnId") == turnId
            store.recordLocalTurnReservation(owner(host), host.hostId, turnId,
                if (finished) "finished" else "uncertain")
            finished
        } catch (_: Exception) {
            store.recordLocalTurnReservation(owner(host), host.hostId, turnId, "uncertain")
            false
        }
    }
}
