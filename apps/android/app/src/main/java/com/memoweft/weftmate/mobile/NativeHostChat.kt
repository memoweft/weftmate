package com.memoweft.weftmate.mobile

import org.json.JSONObject

internal fun checkedNativeDecisionRequest(checkCurrent: () -> Unit, request: () -> JSONObject): JSONObject {
    checkCurrent()
    val result = request()
    checkCurrent()
    return result
}

internal fun hostChatTitle(chat: JSONObject): String =
    chat.stringOrEmpty("displayTitle").ifEmpty { if (chat.optString("kind") == "main") "WeftMate" else chat.stringOrEmpty("title").ifEmpty { "新对话" } }

internal suspend fun nativeMessageDetail(sessionId: String, seq: Long,
    request: suspend (String, JSONObject) -> JSONObject): JSONObject =
    request("shared.sessions.eventDetail", JSONObject().put("sessionId", sessionId).put("seq", seq))

internal fun hostModelServicesDeclared(status: JSONObject?): Boolean =
    status?.optJSONObject("personalCapabilities")?.opt("modelServices") == 1

internal suspend fun hostModelServicesRequest(declared: Boolean, request: suspend () -> JSONObject): JSONObject {
    if (!declared) throw ApiFailure(426, "COMPUTER_UPDATE_REQUIRED")
    return request()
}

/** Logical chat.message is only the main chat; side chats keep their native session. */
internal fun hostChatSendTarget(kind: String, chatId: String, sessionId: String): JSONObject =
    if (kind == "main") JSONObject().put("chatId", chatId)
    else JSONObject().put("sessionId", sessionId.takeIf { it.isNotBlank() } ?: throw ApiFailure(409, "SESSION_UNAVAILABLE"))

internal fun hostChatUsesPhoneStorage(chat: JSONObject): Boolean = !chat.optBoolean("phoneHistory") &&
    (chat.optString("source") == "phone" || !chat.has("chatId") && chat.has("id"))

internal fun sharedSendRejected(error: Exception): Boolean = error is ApiFailure &&
    (error.status == 400 || error.status == 401 || error.status == 403 || error.status == 404 || error.status == 422 ||
        error.safeCode in setOf("SESSION_READ_ONLY", "SESSION_UNAVAILABLE", "MODEL_UNAVAILABLE", "REQUEST_CONFLICT", "INVALID_REQUEST", "CHAT_UNAVAILABLE"))

internal fun hostDeliveryMessage(row: JSONObject): String = when (row.optString("state")) {
    "pending" -> "电脑已收到，正在准备回复。"
    "rejected" -> "消息没有发出，原文已保留。请重新打开对话后发送。"
    else -> "发送结果还没确认，原消息已保留。请点按核对，避免重复发送。"
}
