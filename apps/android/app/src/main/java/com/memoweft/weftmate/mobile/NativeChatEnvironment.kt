package com.memoweft.weftmate.mobile

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** The existing shell operations, kept separate from conversation state and its lifetime. */
internal interface NativeChatEnvironment {
    val preferences: SharedPreferences
    val foreground: Boolean
    suspend fun request(method: String, params: JSONObject): JSONObject
    suspend fun phone(action: String, params: JSONObject = JSONObject()): JSONObject
    suspend fun presentation(script: String): JSONObject
    suspend fun directory(): JSONObject
    fun showLogin()
}

internal class ActivityNativeChatEnvironment(private val activity: NativeActivity) : NativeChatEnvironment {
    override val preferences = activity.getSharedPreferences("native-chat", Context.MODE_PRIVATE)
    override val foreground get() = activity.nativeForeground
    override suspend fun request(method: String, params: JSONObject): JSONObject = suspendCancellableCoroutine { c ->
        val cancel = activity.nativeRequest(method, params) { r -> if (c.isActive) r.fold({ c.resume(it) }, { c.resumeWithException(it) }) }
        c.invokeOnCancellation { cancel() }
    }
    override suspend fun phone(action: String, params: JSONObject) = activity.phonePresentation(action, params)
    override suspend fun presentation(script: String) = activity.goals.presentation(script)
    override suspend fun directory() = nativePageRead { NativeSettingsBridge(activity).call("directory") }
    override fun showLogin() = activity.showLogin()
}
