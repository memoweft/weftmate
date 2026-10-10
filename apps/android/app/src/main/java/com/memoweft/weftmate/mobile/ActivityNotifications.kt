package com.memoweft.weftmate.mobile

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

/** One durable identity ledger for foreground polling and WorkManager, without content copies. */
class ActivityNotifications(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val prefs = context.getSharedPreferences("activity-notifications", Context.MODE_PRIVATE)
    init {
        for ((category, title) in ActivityNotificationPolicy.categories) for (sound in listOf(true, false)) {
            val importance = if (!sound) NotificationManager.IMPORTANCE_LOW else if (category in setOf("approval", "reminder")) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT
            val channel = NotificationChannel(ActivityNotificationPolicy.channel("$category.event", sound), "$title · ${if (sound) "有声" else "静默"}", importance)
            if (!sound) { channel.setSound(null, null); channel.enableVibration(false) }
            manager.createNotificationChannel(channel)
        }
    }
    fun allowed() = manager.areNotificationsEnabled() && (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    fun state(): JSONObject {
        val channels = JSONArray()
        for ((category, title) in ActivityNotificationPolicy.categories) for (sound in listOf(true, false)) {
            val id = ActivityNotificationPolicy.channel("$category.event", sound)
            val channel = manager.getNotificationChannel(id)
            channels.put(JSONObject().put("id", id).put("name", "$title · ${if (sound) "有声" else "静默"}")
                .put("enabled", channel.importance != NotificationManager.IMPORTANCE_NONE).put("soundEnabled", channel.sound != null))
        }
        return JSONObject().put("activityDeliveryVersion", 1).put("systemAllowed", allowed()).put("needsPermission", Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            .put("channels", channels).put("backgroundRestricted", Build.VERSION.SDK_INT >= 28 && context.getSystemService(android.app.ActivityManager::class.java).isBackgroundRestricted)
            .put("batteryOptimized", !context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName))
            .put("permissionAsked", prefs.getBoolean("permissionAsked", false))
    }
    fun markPermissionAsked() { prefs.edit().putBoolean("permissionAsked", true).commit() }
    private fun tag(host: HostIdentity) = "activity:${ActivityNotificationPolicy.scope(host)}"
    fun cancelScope(host: HostIdentity) { for (row in manager.activeNotifications) if (row.tag?.startsWith("${tag(host)}:") == true) manager.cancel(row.tag, row.id) }
    private fun cancel(host: HostIdentity, id: String) { manager.cancel("${tag(host)}:$id", 0) }
    private fun pending(host: HostIdentity, id: String, outcome: String? = null): PendingIntent {
        val nonceKey = "${tag(host)}:$id:intent"
        val nonce = prefs.getString(nonceKey, null) ?: UUID.randomUUID().toString().also { check(prefs.edit().putString(nonceKey, it).commit()) }
        val intent = Intent(context, HybridActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            data = android.net.Uri.parse("weftmate-notification://activity/$id/${outcome ?: "open"}")
            putExtra("activityId", id); putExtra("ownerScope", Endpoints.ownerKey(host.origin, host.ownerId))
            putExtra("notificationNonce", nonce)
            if (outcome != null) putExtra("notificationOutcome", outcome)
        }
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    fun validIntent(host: HostIdentity, intent: Intent): Boolean {
        val id = intent.getStringExtra("activityId") ?: return false
        val nonce = intent.getStringExtra("notificationNonce") ?: return false
        return intent.getStringExtra("ownerScope") == Endpoints.ownerKey(host.origin, host.ownerId) && nonce == prefs.getString("${tag(host)}:$id:intent", null)
    }
    private fun show(host: HostIdentity, row: JSONObject): Boolean {
        val id = row.getString("id"); val type = row.getString("type")
        val decision = row.optJSONObject("notification") ?: return false
        val key = "${tag(host)}:$id"
        if (!ActivityNotificationPolicy.shouldNotify(decision.optBoolean("notify", false), row.optBoolean("read"), type, row.optString("state"), prefs.getBoolean(key, false))) {
            if (row.optBoolean("read") || !decision.optBoolean("notify") || type in setOf("approval.pending", "question.pending") && row.optString("state") != "pending") cancel(host, id)
            return false
        }
        if (!allowed()) return true
        val sound = decision.optBoolean("sound", false)
        val builder = Notification.Builder(context, ActivityNotificationPolicy.channel(type, sound))
            .setSmallIcon(R.drawable.ic_stat_weftmate).setContentTitle(row.optString("title").take(80))
            .setContentText(row.optString("summary").take(160)).setContentIntent(pending(host, id))
            .setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
        if (type == "approval.pending" && row.optJSONArray("actions")?.let { actions -> (0 until actions.length()).any { actions.getJSONObject(it).optString("kind") == "respond_approval" } } == true) {
            for ((title, outcome) in listOf("批准" to "allowed-once", "拒绝" to "rejected")) {
                val action = Notification.Action.Builder(null, title, pending(host, id, outcome))
                if (Build.VERSION.SDK_INT >= 31) action.setAuthenticationRequired(true)
                builder.addAction(action.build())
            }
        }
        manager.notify(key, 0, builder.build())
        check(prefs.edit().putBoolean(key, true).commit())
        return false
    }
    fun poll(host: HostIdentity, api: PersonalApi = PersonalApi(), current: () -> Boolean): Boolean = synchronized(LOCK) {
        if (!current()) return@synchronized false
        val scope = tag(host)
        if (!prefs.getBoolean("$scope:registered:${host.deviceId}", false)) {
            val status = api.status(host)
            if (status.optJSONObject("personalCapabilities")?.optInt("activity") != 1) return@synchronized false
            if (status.optJSONObject("personalCapabilities")?.optInt("pushRegistration") == 1) {
                try { api.registerPush(host) }
                catch (error: ApiFailure) {
                    // Legacy read/command devices have no account:manage. Optional
                    // no-provider declaration must not block authorized activity reads.
                    if (error.status != 403) throw error
                }
                if (!current()) return@synchronized false
                check(prefs.edit().putBoolean("$scope:registered:${host.deviceId}", true).commit())
            }
        }
        var cursor = prefs.getString("$scope:cursor", null); var needsPermission = false
        do {
            val page = api.business(host, "/personal/v1/activity/changes?limit=200" + (cursor?.let { "&cursor=${URLEncoder.encode(it, "UTF-8")}" } ?: ""), "GET", null)
            if (!current()) return@synchronized false
            val removals = page.getJSONArray("removals")
            for (index in 0 until removals.length()) cancel(host, removals.getString(index))
            val rows = page.getJSONArray("upserts")
            for (index in 0 until rows.length()) { if (!current()) return@synchronized false; needsPermission = show(host, rows.getJSONObject(index)) || needsPermission }
            cursor = page.getString("nextCursor")
            if (!needsPermission) check(prefs.edit().putString("$scope:cursor", cursor).commit())
        } while (page.optBoolean("hasMore") && current())
        needsPermission
    }
    fun find(host: HostIdentity, id: String, api: PersonalApi, current: () -> Boolean): JSONObject? {
        var cursor: String? = null
        do {
            val page = api.business(host, "/personal/v1/activity?limit=200" + (cursor?.let { "&cursor=${URLEncoder.encode(it, "UTF-8")}" } ?: ""), "GET", null)
            if (!current()) return null
            val rows = page.getJSONArray("items")
            for (index in 0 until rows.length()) if (rows.getJSONObject(index).optString("id") == id) return rows.getJSONObject(index)
            cursor = page.optString("nextCursor").takeIf { it.isNotBlank() && it != "null" }
        } while (cursor != null)
        return null
    }
    fun respond(host: HostIdentity, id: String, outcome: String, current: () -> Boolean): JSONObject {
        require(outcome in setOf("allowed-once", "rejected"))
        val api = PersonalApi(); val row = find(host, id, api, current) ?: throw ApiFailure(404, "APPROVAL_UNAVAILABLE")
        val actions = row.getJSONArray("actions")
        val action = (0 until actions.length()).map { actions.getJSONObject(it) }.firstOrNull { it.optString("kind") == "respond_approval" } ?: throw ApiFailure(404, "APPROVAL_UNAVAILABLE")
        val target = action.getJSONObject("target")
        if (row.optString("state") != "pending") throw ApiFailure(409, "APPROVAL_UNAVAILABLE")
        val key = "${tag(host)}:$id:receipt:$outcome"
        val requestId = prefs.getString(key, null) ?: UUID.randomUUID().toString().also { check(prefs.edit().putString(key, it).commit()) }
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val result = api.decideApproval(host, target.getString("sessionId"), target.getString("approvalId"), requestId, outcome)
        val receipt = result.optJSONObject("approval") ?: throw ApiFailure(502, "APPROVAL_RECEIPT_INVALID")
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        if (receipt.optString("approvalId") != target.getString("approvalId") || receipt.optString("decisionOutcome") != outcome || receipt.optString("status") == "pending") throw ApiFailure(502, "APPROVAL_RECEIPT_INVALID")
        cancel(host, id); return result
    }
    companion object { private val LOCK = Any() }
}
