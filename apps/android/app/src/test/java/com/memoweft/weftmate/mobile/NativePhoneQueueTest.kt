package com.memoweft.weftmate.mobile

import android.content.SharedPreferences
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.lang.reflect.Proxy

class NativePhoneQueueTest {
    private class Environment : NativeChatEnvironment {
        override val preferences = Proxy.newProxyInstance(SharedPreferences::class.java.classLoader,
            arrayOf(SharedPreferences::class.java)) { _, method, args ->
            when (method.name) { "getString" -> args?.get(1); "getBoolean" -> false; else -> null }
        } as SharedPreferences
        override val foreground = true
        val sent = mutableListOf<String>()
        var stopped = 0
        private fun view() = JSONObject().put("ready", true).put("owner", "").put("running", true)
            .put("selectedId", "phone-test").put("messageMode", "queue")
            .put("conversations", JSONArray()).put("pendingMessages", JSONArray(sent.mapIndexed { i, text ->
                JSONObject().put("id", "queued-$i").put("conversationId", "phone-test").put("text", text)
            }))
        override suspend fun phone(action: String, params: JSONObject): JSONObject {
            if (action == "send") sent.add(params.getString("text"))
            if (action == "stop") stopped++
            return view().put("sent", true)
        }
        override suspend fun request(method: String, params: JSONObject) = JSONObject()
        override suspend fun presentation(script: String) = JSONObject()
        override suspend fun directory() = JSONObject()
        override fun showLogin() {}
    }
    private fun model(e: Environment, scope: CoroutineScope) = NativeChatModel(e, scope).apply {
        loggedIn = true; standalone = true; phoneArchive = true; phone = true
        chatId = "phone-test"; modelId = "test-model"; running = true
    }

    @Test fun phoneRunningCanSubmitThreeMessagesAndShowsEachQueuedInput() = runBlocking {
        val e = Environment(); val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        try {
            val m = model(e, scope)
            for (text in listOf("第一条", "第二条", "第三条")) {
                m.edit(text)
                assertEquals(ComposerAction.Send, m.composer.action)
                m.send()
                assertEquals("", m.draft)
            }
            assertEquals(listOf("第一条", "第二条", "第三条"), e.sent)
            assertEquals(e.sent, m.rows.map { it.getJSONObject("data").getString("text") })
            assertTrue(m.rows.all { it.getJSONObject("data").optBoolean("queued") })
            m.stop(); assertEquals(1, e.stopped)
        } finally { scope.cancel() }
    }
}
