package com.memoweft.weftmate.mobile

import org.json.JSONObject

/** No client DND, quota or importance override. Absent host decisions never notify. */
object ActivityNotificationPolicy {
    val categories = linkedMapOf("approval" to "审批与待回答", "task" to "任务", "reminder" to "提醒", "memory" to "记忆", "system" to "系统")
    fun category(type: String): String = when (type.substringBefore('.')) {
        "approval", "question" -> "approval"
        "task" -> "task"
        "reminder" -> "reminder"
        "memory" -> "memory"
        else -> "system"
    }
    fun channel(type: String, sound: Boolean) = "weftmate-activity-${category(type)}-${if (sound) "sound" else "silent"}"
    fun shouldNotify(notify: Boolean, read: Boolean, type: String, state: String, seen: Boolean): Boolean =
        notify && !read && !seen && !(type in setOf("approval.pending", "question.pending") && state != "pending")
    fun retry(status: Int) = status !in setOf(401, 403, 404)
    fun scope(host: HostIdentity) = Endpoints.ownerKey(host.hostId, host.ownerId)
    fun current(expected: HostIdentity, actual: HostIdentity?) = expected == actual
    fun title(row: JSONObject) = row.optJSONObject("notification")?.optString("title")?.takeIf { it.isNotBlank() } ?: row.optString("title")
    fun body(row: JSONObject) = row.optJSONObject("notification")?.optString("body")?.takeIf { it.isNotBlank() } ?: row.optString("summary")
}
