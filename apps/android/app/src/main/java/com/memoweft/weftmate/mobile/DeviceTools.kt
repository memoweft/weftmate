package com.memoweft.weftmate.mobile

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject

data class ToolResult(val status: String, val summary: String, val result: JSONObject)
interface DeviceToolExecutor { fun execute(name: String, arguments: JSONObject): ToolResult }

/** Android Intents only. No ADB, shell, accessibility automation or arbitrary paths. */
class DeviceTools(private val context: Context) : DeviceToolExecutor {
    fun launchableApps(): JSONArray {
        val query = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val items = context.packageManager.queryIntentActivities(query, PackageManager.MATCH_ALL)
            .mapNotNull { info ->
                val packageName = info.activityInfo?.packageName ?: return@mapNotNull null
                val label = info.loadLabel(context.packageManager)?.toString()?.take(80) ?: packageName
                packageName to label
            }.distinctBy { it.first }.sortedBy { it.second }.take(100)
        val result = JSONArray()
        for ((id, name) in items) result.put(JSONObject().put("packageName", id).put("name", name))
        return result
    }

    override fun execute(name: String, arguments: JSONObject): ToolResult = when (name) {
        "list_launchable_apps" -> {
            if (arguments.length() != 0) ToolResult("failed", "应用列表参数无效", JSONObject().put("ok", false))
            else {
                val apps = launchableApps()
                ToolResult("observed", "已读取 ${apps.length()} 个可启动应用", JSONObject().put("apps", apps))
            }
        }
        "open_app" -> {
            val id = arguments.optString("packageName")
            val apps = launchableApps()
            if (arguments.length() != 1 || !id.matches(Regex("[A-Za-z0-9_.]{3,180}")) ||
                (0 until apps.length()).none { apps.getJSONObject(it).getString("packageName") == id }) {
                ToolResult("failed", "该应用不可启动", JSONObject().put("ok", false))
            } else {
                val intent = context.packageManager.getLaunchIntentForPackage(id)
                if (intent == null) ToolResult("failed", "该应用不可启动", JSONObject().put("ok", false))
                else try {
                    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    ToolResult("dispatched", "已向系统请求打开应用；尚未核对前台结果", JSONObject().put("dispatched", true))
                } catch (_: Exception) {
                    ToolResult("failed", "系统拒绝启动该应用", JSONObject().put("ok", false))
                }
            }
        }
        "open_settings" -> if (arguments.length() != 0) ToolResult("failed", "设置动作参数无效", JSONObject().put("ok", false)) else try {
            context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            ToolResult("dispatched", "已向系统请求打开设置；尚未核对页面结果", JSONObject().put("dispatched", true))
        } catch (_: Exception) {
            ToolResult("failed", "系统拒绝打开设置", JSONObject().put("ok", false))
        }
        else -> ToolResult("failed", "不支持该手机动作", JSONObject().put("ok", false))
    }
}
