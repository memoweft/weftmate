package com.memoweft.weftmate.mobile

import org.json.JSONObject

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
