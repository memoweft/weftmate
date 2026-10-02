package com.memoweft.weftmate.mobile

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

object NotificationScopeGate {
    fun mayShow(sourceScope: String, activeScope: String, foreground: Boolean, switching: Boolean): Boolean =
        sourceScope != "local" && sourceScope == activeScope && !foreground && !switching
}

/** A bounded private inbox with optional Android notifications for real local outcomes. */
class MobileNotifications(private val context: Context, private val scope: String = "local") {
    private val prefs = context.getSharedPreferences("mobile-notifications", Context.MODE_PRIVATE)
    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val categories = setOf("reply", "action", "sync")
    private fun key(value: String) = "$scope:$value"

    init {
        require(scope == "local" || scope.matches(Regex("[a-f0-9]{64}")))
        for ((id, title) in listOf("reply" to "回复完成", "action" to "手机动作结果", "sync" to "同步问题"))
            manager.createNotificationChannel(NotificationChannel("weftmate-$id", title, NotificationManager.IMPORTANCE_DEFAULT))
    }

    fun state(): JSONObject {
        val selected = JSONObject()
        for (category in categories) selected.put(category, prefs.getBoolean(key("enabled:$category"), true))
        val allowed = manager.areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
        return JSONObject().put("categories", selected).put("systemAllowed", allowed)
            .put("needsPermission", Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
    }

    fun setEnabled(category: String, enabled: Boolean): JSONObject {
        require(category in categories)
        check(prefs.edit().putBoolean(key("enabled:$category"), enabled).commit())
        return state()
    }

    @Synchronized fun inbox(): JSONArray = try { JSONArray(prefs.getString(key("inbox"), "[]")) } catch (_: Exception) { JSONArray() }

    @Synchronized fun cancelVisible() {
        try {
            for (item in manager.activeNotifications) if (item.tag == scope) manager.cancel(item.tag, item.id)
        } catch (_: Exception) { }
    }

    @Synchronized fun record(category: String, title: String, summary: String,
        conversationId: String? = null, showSystem: Boolean = true): JSONObject {
        require(category in categories)
        val item = JSONObject().put("id", UUID.randomUUID().toString())
            .put("category", category).put("title", title.take(80)).put("summary", summary.take(240))
            .put("conversationId", conversationId ?: "").put("createdAt", Instant.now().toString())
        val old = inbox()
        val fresh = JSONArray().put(item)
        for (index in 0 until minOf(old.length(), 99)) fresh.put(old.get(index))
        check(prefs.edit().putString(key("inbox"), fresh.toString()).commit())
        if (showSystem && prefs.getBoolean(key("enabled:$category"), true) && state().optBoolean("systemAllowed")) {
            val intent = Intent(context, HybridActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("conversationId", conversationId ?: "")
                putExtra("ownerScope", scope)
            }
            val pending = PendingIntent.getActivity(context, item.getString("id").hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notification = android.app.Notification.Builder(context, "weftmate-$category")
                .setSmallIcon(R.drawable.ic_stat_weftmate).setContentTitle(title.take(80))
                .setContentText(summary.take(240)).setContentIntent(pending).setAutoCancel(true).build()
            manager.notify(scope, item.getString("id").hashCode(), notification)
        }
        return item
    }
}
