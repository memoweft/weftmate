package com.memoweft.weftmate.mobile

import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import java.util.UUID

/**
 * The one way native pages reach shared logic (`src/ui-core`): run an async expression in the
 * embedded engine, where `uiCore` is the shared core, and read back its JSON value. A thrown
 * `{status, code}` becomes an [ApiFailure].
 */
internal class NativeCore(private val activity: NativeActivity) {
    /**
     * Shared writes run as the natively signed-in, connected account: the engine adopts that identity and online
     * state when it lacks either.
     */
    suspend fun write(expression: String, timeoutMs: Long = 120000): JSONObject = call(
        "if(!uiCore.state.csrfToken||!uiCore.state.online)uiCore.adoptNativeSession(await uiCore.accessApi('/auth/me'));" + expression,
        timeoutMs,
    )

    suspend fun call(expression: String, timeoutMs: Long = 15000): JSONObject {
        val key = JSONObject.quote(UUID.randomUUID().toString())
        activity.embeddedWeb.evaluateJavascript(
            "(()=>{window.weftCoreResults??={};window.weftCoreResults[$key]=null;" +
                "Promise.resolve().then(async()=>{$expression})" +
                ".then(value=>{if(Object.hasOwn(window.weftCoreResults,$key))window.weftCoreResults[$key]={value:value??{}}})" +
                ".catch(e=>{if(Object.hasOwn(window.weftCoreResults,$key))window.weftCoreResults[$key]={error:{status:e?.status||0,code:e?.code||'NETWORK_FAILED',message:String(e?.message||'')}}})})()",
            null,
        )
        try {
            return nativePageRead(timeoutMs) {
                while (true) {
                    val result = suspendCancellableCoroutine<JSONObject?> { c ->
                        activity.embeddedWeb.evaluateJavascript("JSON.stringify(window.weftCoreResults?.[$key]||null)") { raw ->
                            if (c.isActive) c.resumeWith(Result.success(runCatching { if (raw == "null") null else JSONObject(org.json.JSONTokener(raw).nextValue().toString()) }.getOrNull()))
                        }
                    }
                    if (result != null) {
                        result.optJSONObject("error")?.let { throw NativeCoreFailure(it.optInt("status"), it.optString("code"), it.optString("message")) }
                        return@nativePageRead result.optJSONObject("value") ?: JSONObject()
                    }
                    delay(50)
                }
                @Suppress("UNREACHABLE_CODE") JSONObject()
            }
        } finally {
            activity.embeddedWeb.evaluateJavascript("delete window.weftCoreResults?.[$key]", null)
        }
    }
}

/** Shared-core errors keep their human message, which the core already writes for people. */
internal class NativeCoreFailure(status: Int, code: String, val text: String) : ApiFailure(status, code)
