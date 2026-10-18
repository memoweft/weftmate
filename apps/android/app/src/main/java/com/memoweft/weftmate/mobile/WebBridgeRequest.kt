package com.memoweft.weftmate.mobile

import org.json.JSONObject

internal data class WebBridgeRequest(val value: JSONObject, val errorCode: String? = null)

/** Decode the existing trusted-frame bridge envelope before scheduling any work. */
internal fun readWebBridgeRequest(raw: String): WebBridgeRequest? {
    if (raw.length > 10 * 1024 * 1024) {
        // The shipped transport writes id/method before params. Read only that
        // bounded header to reject huge payloads without parsing their contents.
        val header = Regex("""^\s*\{\s*"id"\s*:\s*"([A-Za-z0-9_-]{1,80})"\s*,\s*"method"\s*:\s*"([A-Za-z.]{1,64})"\s*,""").find(raw.take(1024)) ?: return null
        val method = header.groupValues[2]
        return WebBridgeRequest(JSONObject().put("id", header.groupValues[1]).put("method", method),
            if (method == "phone.offline.save" || method == "offline.save") "OFFLINE_STORAGE_TOO_LARGE" else "BRIDGE_REQUEST_TOO_LARGE")
    }
    val request = try { JSONObject(raw) } catch (_: Exception) { return null }
    val id = request.optString("id")
    val method = request.optString("method")
    if (!id.matches(Regex("[A-Za-z0-9_-]{1,80}"))) return null
    if (!method.matches(Regex("[A-Za-z.]{1,64}"))) return WebBridgeRequest(request, "INVALID_REQUEST")
    val large = method.startsWith("offline.") || method in setOf("phone.offline.save", "conversation.export", "clipboard.copy")
    return WebBridgeRequest(request, if (!large && raw.length > 128 * 1024) "BRIDGE_REQUEST_TOO_LARGE" else null)
}

internal fun requireOfflineVaultSize(value: JSONObject) {
    if (value.toString().toByteArray(Charsets.UTF_8).size > 8 * 1024 * 1024) throw ApiFailure(413, "OFFLINE_STORAGE_TOO_LARGE")
}
