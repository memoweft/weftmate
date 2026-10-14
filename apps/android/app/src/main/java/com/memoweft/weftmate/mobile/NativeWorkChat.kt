package com.memoweft.weftmate.mobile

import org.json.JSONObject

internal fun hostWorkAndChatDeclared(status: JSONObject?): Boolean =
    status?.optJSONObject("personalCapabilities")?.opt("workAndChat") == 1

internal fun nativeConversationMode(chat: JSONObject): String = when {
    chat.optBoolean("phoneHistory") || chat.optBoolean("nativePhone") || hostChatUsesPhoneStorage(chat) -> "chat"
    chat.stringOrEmpty("mode") in listOf("chat", "work") -> chat.getString("mode")
    chat.stringOrEmpty("projectId").isNotEmpty() || chat.stringOrEmpty("workspaceKind") == "browser" -> "work"
    else -> "chat"
}

internal fun nativeWorkSwitchText(row: JSONObject, rows: List<JSONObject>, draft: String): String {
    val users = rows.filter { it.optString("type") == "user.message" }
    val receipt = row.stringOrEmpty("sourceReceiptId")
    val source = users.lastOrNull { receipt.isNotEmpty() && it.optJSONObject("data")?.stringOrEmpty("receiptId") == receipt } ?: users.lastOrNull()
    return source?.optJSONObject("data")?.stringOrEmpty("text")?.ifEmpty { null } ?: draft
}

internal fun nativeModeChats(chats: List<JSONObject>, mode: String, supported: Boolean): List<JSONObject> =
    if (supported) chats.filter { nativeConversationMode(it) == mode } else chats

internal fun nativeWorkCreateBody(requestId: String, modelId: String): JSONObject =
    JSONObject().put("requestId", requestId).put("modelProfileId", modelId)

internal suspend fun nativeCreateWork(hostId: String, projectId: String, requestId: String, modelId: String,
    request: suspend (String, String, JSONObject) -> JSONObject): JSONObject =
    request(hostId, "/projects/$projectId/sessions", nativeWorkCreateBody(requestId, modelId))

internal fun nativeApprovalBody(requestId: String, outcome: String, scope: String? = null,
    workProjectId: String? = null): JSONObject = JSONObject().put("requestId", requestId).put("outcome", outcome).apply {
    if (scope != null) put("scope", scope)
    if (workProjectId != null) {
        require(outcome == "allowed-once" && (scope == null || scope == "once") && workProjectId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        put("workProjectId", workProjectId)
    }
}

/** Refresh mode metadata without replacing the chat identity, source references or timeline. */
internal fun nativeChatMetadata(current: JSONObject, fresh: JSONObject): JSONObject = JSONObject(current.toString()).apply {
    for (key in listOf("title", "displayTitle", "mode", "hostId", "workHostId", "projectId", "projectRevision", "workDirectory", "logicalHistory", "activeSessionId", "sendAvailable"))
        if (fresh.has(key)) put(key, fresh.get(key))
}
