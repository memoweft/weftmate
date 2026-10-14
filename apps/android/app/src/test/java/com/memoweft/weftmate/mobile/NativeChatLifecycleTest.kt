package com.memoweft.weftmate.mobile

import android.content.SharedPreferences
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class NativeChatLifecycleTest {
    private class Preferences : SharedPreferences {
        private val values = mutableMapOf<String, Any?>()
        override fun getAll() = values.toMap()
        override fun getString(key: String?, fallback: String?) = values[key] as? String ?: fallback
        override fun getStringSet(key: String?, fallback: MutableSet<String>?) = fallback
        override fun getInt(key: String?, fallback: Int) = values[key] as? Int ?: fallback
        override fun getLong(key: String?, fallback: Long) = values[key] as? Long ?: fallback
        override fun getFloat(key: String?, fallback: Float) = values[key] as? Float ?: fallback
        override fun getBoolean(key: String?, fallback: Boolean) = values[key] as? Boolean ?: fallback
        override fun contains(key: String?) = values.containsKey(key)
        override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
        override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
        override fun edit() = object : SharedPreferences.Editor {
            private val changes = mutableMapOf<String, Any?>()
            private var clear = false
            override fun putString(key: String, value: String?) = apply { changes[key] = value }
            override fun putStringSet(key: String, value: MutableSet<String>?) = apply { changes[key] = value }
            override fun putInt(key: String, value: Int) = apply { changes[key] = value }
            override fun putLong(key: String, value: Long) = apply { changes[key] = value }
            override fun putFloat(key: String, value: Float) = apply { changes[key] = value }
            override fun putBoolean(key: String, value: Boolean) = apply { changes[key] = value }
            override fun remove(key: String) = apply { changes[key] = null }
            override fun clear() = apply { clear = true }
            override fun commit(): Boolean {
                if (clear) values.clear()
                changes.forEach { (key, value) -> if (value == null) values.remove(key) else values[key] = value }
                return true
            }
            override fun apply() { commit() }
        }
    }

    /** Only external shell I/O is supplied; every transition runs NativeChatModel itself. */
    private class Environment(override val preferences: SharedPreferences = Preferences()) : NativeChatEnvironment {
        override val foreground = true
        var account = "mode2a-test-owner"
        var configured = true
        var online = true
        var creations = 0
        var sent = 0
        var approval = "auto"
        val approvalWrites = mutableListOf<String>()
        val project = JSONObject().put("projectId", "test-project").put("name", "测试文件夹")
        var workEntered: CompletableDeferred<Unit>? = null
        var workRelease: CompletableDeferred<Unit>? = null
        private var work = false
        private val identity = java.util.UUID.randomUUID().toString()
        val model get() = JSONObject().put("profileId", "test-model").put("displayName", "测试模型").put("configured", true)
        private fun chat() = JSONObject().put("chatId", "test-chat-$identity-$creations").put("kind", "side")
            .put("activeSessionId", "test-session-$identity-$creations").put("mode", if (work) "work" else "chat")
            .put("sendAvailable", true).put("approvalMode", approval).apply { if (work) put("workDirectory", project) }
        override suspend fun request(method: String, params: JSONObject): JSONObject = when (method) {
            "app.bootstrap" -> JSONObject().put("owner", account).put("loggedIn", true).apply { if (configured) put("model", model) }
            "settings.appearance" -> JSONObject().put("value", "light")
            "models.host" -> JSONObject().put("models", if (configured) JSONArray().put(model) else JSONArray())
            "host.business" -> {
                if (!online) throw IOException("synthetic offline")
                val path = params.getString("path").removePrefix("/personal/v1")
                val body = params.optJSONObject("body")
                when {
                    path == "/status" -> JSONObject().put("hostId", "test-computer").put("personalCapabilities", JSONObject().put("workAndChat", 1))
                    path == "/projects" -> JSONObject().put("projects", JSONArray().put(project))
                    path == "/chats" -> JSONObject().put("items", JSONArray())
                    path == "/chats/main" -> throw IOException("no main history")
                    path == "/commands" || path == "/projects/test-project/sessions" -> {
                        creations++
                        check(body!!.getString("modelProfileId").isNotBlank()) { "MODEL_REQUIRED" }
                        work = path.startsWith("/projects/")
                        if (work) { workEntered?.complete(Unit); workRelease?.await() }
                        JSONObject().put("command", JSONObject().put("state", "observed").put("sessionId", "test-session-$identity-$creations"))
                    }
                    path.endsWith("/approval-mode") -> {
                        if (params.getString("method") == "PATCH") { approval = body!!.getString("mode"); approvalWrites.add(approval) }
                        JSONObject().put("mode", approval)
                    }
                    path.endsWith("/chat") -> JSONObject().put("chatId", "test-chat-$identity-$creations")
                    path.contains("/events?") || path.contains("/changes?") -> JSONObject().put("items", JSONArray())
                    path.startsWith("/chats/") -> JSONObject().put("chat", chat())
                    else -> JSONObject()
                }
            }
            "shared.send" -> {
                assertTrue(params.getString("sessionId").isNotBlank())
                assertEquals("test-model", params.getString("modelProfileId"))
                sent++; JSONObject().put("state", "accepted")
            }
            else -> JSONObject()
        }
        override suspend fun phone(action: String, params: JSONObject) = JSONObject()
        override suspend fun presentation(script: String) = JSONObject()
        override suspend fun directory() = JSONObject()
        override fun showLogin() {}
    }
    private class Fixture(val environment: Environment) {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        val chat = NativeChatModel(environment, scope)
        fun close() { chat.close(); scope.cancel() }
    }
    private suspend fun until(condition: () -> Boolean) { withTimeout(6000) { while (!condition()) delay(10) } }

    @Test fun workCreationSavesTheLatestApprovalChoiceAfterTheRequestReturns() = runBlocking {
        val e = Environment(); val f = Fixture(e)
        try {
            f.chat.bootstrap(); f.chat.newChat("work").join()
            f.chat.setApprovalMode("allow-all")
            e.workEntered = CompletableDeferred(); e.workRelease = CompletableDeferred()
            f.chat.chooseWorkProject(e.project); e.workEntered!!.await()
            f.chat.setApprovalMode("ask")
            assertEquals("ask", f.chat.mode)
            e.workRelease!!.complete(Unit)
            until { !f.chat.newWork && !f.chat.submitting && !f.chat.workBusy }
            assertEquals(listOf("ask"), e.approvalWrites)
            assertEquals("ask", f.chat.mode)
            f.chat.edit("继续工作"); f.chat.send(); until { e.sent == 1 }
            assertEquals("ask", e.approval)
        } finally { f.close() }
    }

    @Test fun unboundWorkDraftSurvivesClosingAndMovesToTheCreatedConversation() = runBlocking {
        val e = Environment(); val first = Fixture(e)
        try {
            first.chat.bootstrap(); first.chat.newChat("work").join(); first.chat.edit("重开后继续这段工作")
            assertEquals("", first.chat.chatId)
        } finally { first.close() }
        val reopened = Fixture(Environment(e.preferences))
        try {
            reopened.chat.bootstrap()
            assertTrue("Reopen the saved new-work identity", reopened.chat.newWork)
            assertEquals("重开后继续这段工作", reopened.chat.draft)
            reopened.chat.chooseWorkProject(reopened.environment.project)
            until { !reopened.chat.newWork && !reopened.chat.workBusy }
            assertEquals("重开后继续这段工作", reopened.chat.draft)
            assertEquals(reopened.chat.draft, e.preferences.getString("draft:${reopened.chat.owner}:${reopened.chat.chatId}", null))
            reopened.chat.edit("")
            reopened.chat.newChat("work").join()
            assertEquals("", reopened.chat.draft)
            reopened.chat.edit("当前账号的工作草稿")
            reopened.environment.account = "another-test-owner"
            reopened.chat.bootstrap()
            assertFalse(reopened.chat.newWork)
            assertEquals("", reopened.chat.draft)
        } finally { reopened.close() }
        val other = Fixture(Environment(e.preferences).apply { account = "another-test-owner" })
        try { other.chat.bootstrap(); assertEquals("", other.chat.draft); assertFalse(other.chat.newWork) }
        finally { other.close() }
    }

    @Test fun noModelKeepsAnUncreatedDraftAndSelectingAModelCanSendDirectly() = runBlocking {
        val e = Environment().apply { configured = false }; val f = Fixture(e)
        try {
            f.chat.bootstrap()
            assertEquals("No empty-model session.create", 0, e.creations)
            assertEquals("", f.chat.chatId); assertFalse(f.chat.canSend)
            f.chat.edit("配好模型就发这句话")
            e.configured = true
            f.chat.selectModel(e.model)
            until { f.chat.modelId == "test-model" }
            f.chat.send(); until { e.sent == 1 }
            assertEquals(1, e.creations); assertTrue(f.chat.chatId.isNotBlank())
            assertEquals("", f.chat.draft)
        } finally { f.close() }
        // Adding a service in Settings returns through returnToChat rather than
        // the legacy model picker. That path must recover the same empty draft.
        val added = Environment().apply { configured = false }; val configuredInSettings = Fixture(added)
        try {
            configuredInSettings.chat.bootstrap(); configuredInSettings.chat.edit("设置返回后直接发送")
            added.configured = true
            configuredInSettings.chat.returnToChat()
            until { configuredInSettings.chat.canSend }
            assertEquals(0, added.creations)
            configuredInSettings.chat.send(); until { added.sent == 1 }
            assertEquals(1, added.creations)
        } finally { configuredInSettings.close() }
    }

    @Test fun newWorkRecoversItsConnectionByPollingAndCanBindAProjectAfterRecovery() = runBlocking {
        val e = Environment(); val f = Fixture(e)
        try {
            f.chat.bootstrap(); e.online = false; f.chat.refresh()
            assertFalse(f.chat.connected)
            f.chat.newChat("work").join(); f.chat.edit("恢复网络后继续")
            assertTrue(f.chat.newWork); assertFalse(f.chat.connected)
            e.online = true
            until { f.chat.connected && f.chat.projects.isNotEmpty() }
            assertEquals("恢复网络后继续", f.chat.draft)
            f.chat.chooseWorkProject(e.project)
            until { !f.chat.newWork && f.chat.canSend && !f.chat.submitting }
            f.chat.send(); until { e.sent == 1 }
        } finally { f.close() }
    }
}
