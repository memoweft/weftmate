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
        var directoryHosts = JSONArray()
        var offlineReady=false
        var lastPresentation=""
        var creations = 0
        var sent = 0
        var phoneMessages = JSONObject().put("messages", JSONArray()).put("turnStatus", "")
        var sentText = ""
        var approval = "auto"
        var selectedProfile = "test-model"
        var selectionFailure: ApiFailure? = null
        var selectionBody: JSONObject? = null
        var selectionRead = false
        var phoneHostChoice = ""
        var createdProfile = ""
        var boundSession = ""
        var boundSessionProfile = "test-model"
        var sentProfile = ""
        val approvalWrites = mutableListOf<String>()
        val project = JSONObject().put("projectId", "test-project").put("name", "测试文件夹")
        var workEntered: CompletableDeferred<Unit>? = null
        var workRelease: CompletableDeferred<Unit>? = null
        private var work = false
        private val identity = java.util.UUID.randomUUID().toString()
        val model get() = JSONObject().put("profileId", phoneHostChoice.ifEmpty { "test-model" })
            .put("displayName", if (phoneHostChoice.isEmpty()) "测试模型" else "MiMo v2.5").put("configured", true)
        private fun chat() = JSONObject().put("chatId", "test-chat-$identity-$creations").put("kind", "side")
            .put("activeSessionId", "test-session-$identity-$creations").put("mode", if (work) "work" else "chat")
            .put("sendAvailable", true).put("approvalMode", approval).apply { if (work) put("workDirectory", project) }
        override suspend fun request(method: String, params: JSONObject): JSONObject = when (method) {
            "app.bootstrap" -> JSONObject().put("owner", account).put("loggedIn", true).apply { if (configured) put("model", model) }
            "settings.appearance" -> JSONObject().put("value", "light")
            "models.host" -> JSONObject().put("models", if (configured) JSONArray().put(model) else JSONArray())
            "models.selectHost" -> { phoneHostChoice = params.getString("profileId"); JSONObject().put("profileId", phoneHostChoice) }
            "shared.conversations.get" -> JSONObject().put("status", if (boundSession.isEmpty()) "unbound" else "active")
                .put("cached", false).put("binding", JSONObject().put("sessionId", boundSession))
            "host.business" -> {
                if (!online) throw IOException("synthetic offline")
                val path = params.getString("path").removePrefix("/personal/v1")
                val body = params.optJSONObject("body")
                when {
                    path.startsWith("/model-services/") && path.endsWith("/select") -> {
                        assertEquals("/model-services/model-service-00000000-0000-4000-8000-000000000048/select", path)
                        selectionBody = body
                        selectionFailure?.let { throw it }
                        // The host rejects extra fields; serviceId belongs only in the route.
                        if (body!!.keys().asSequence().any { it !in setOf("modelId", "sessionId", "requestId") }) throw ApiFailure(400, "INVALID_REQUEST")
                        assertEquals("POST", params.getString("method"))
                        assertEquals("mimo-v2.5", body.getString("modelId"))
                        assertTrue(body.getString("requestId").isNotBlank())
                        selectedProfile = "test-v25-profile"
                        if (boundSession.isNotEmpty() && body.optString("sessionId") == boundSession) boundSessionProfile = selectedProfile
                        JSONObject().put("profileId", selectedProfile).put("models", JSONArray().put(JSONObject().put("profileId", selectedProfile).put("configured", true)))
                    }
                    path == "/status" -> JSONObject().put("hostId", "test-computer").put("personalCapabilities", JSONObject().put("workAndChat", 1))
                    path == "/projects" -> JSONObject().put("projects", JSONArray().put(project))
                    path == "/chats" -> JSONObject().put("items", JSONArray())
                    path == "/chats/main" -> throw IOException("no main history")
                    path == "/commands" || path == "/projects/test-project/sessions" -> {
                        creations++
                        check(body!!.getString("modelProfileId").isNotBlank()) { "MODEL_REQUIRED" }
                        createdProfile = body.getString("modelProfileId")
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
                    path.startsWith("/chats/") -> { selectionRead = true; JSONObject().put("chat", chat()) }
                    else -> JSONObject()
                }
            }
            "shared.send" -> {
                assertTrue(params.getString("sessionId").isNotBlank())
                assertEquals(selectedProfile, params.getString("modelProfileId"))
                sent++; JSONObject().put("state", "accepted")
            }
            "chat.send" -> {
                assertEquals("phone-created-conversation", params.getString("conversationId"))
                // Delegated turns follow the bound session, rather than the phone's saved default.
                sentText = params.getString("text")
                sentProfile = boundSessionProfile; sent++; JSONObject().put("state", "accepted")
            }
            "conversations.messages" -> phoneMessages
            else -> JSONObject()
        }
        override suspend fun phone(action: String, params: JSONObject) = JSONObject()
        override suspend fun presentation(script: String):JSONObject {lastPresentation=script;return JSONObject().put("ready",offlineReady)}
        override suspend fun directory() = JSONObject().put("hosts",directoryHosts)
        override fun showLogin() {}
    }
    private class Fixture(val environment: Environment) {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        val chat = NativeChatModel(environment, scope)
        fun close() { chat.close(); scope.cancel() }
    }
    private suspend fun until(condition: () -> Boolean) { withTimeout(6000) { while (!condition()) delay(10) } }

    private val service = JSONObject().put("serviceId", "model-service-00000000-0000-4000-8000-000000000048")
    private val v25 = JSONObject().put("modelId", "mimo-v2.5").put("name", "MiMo v2.5")

    @Test fun failedPairedPhoneReplyRemainsVisibleAfterRefreshAndCanRetryWithoutLosingDraft() = runBlocking {
        val e=Environment();val f=Fixture(e)
        try {
            f.chat.bootstrap()
            e.phoneMessages=JSONObject().put("turnStatus","failed").put("turnErrorCode","OPERATION_FAILED")
                .put("messages",JSONArray().put(JSONObject().put("id","synthetic-user").put("role","user").put("text","合成失败消息")))
            f.chat.select(JSONObject().put("id","phone-created-conversation").put("source","phone"))
            f.chat.refresh()
            assertTrue(f.chat.error.contains("回复没能完成"))
            assertTrue(f.chat.canRetryPhoneReply)
            f.chat.edit("尚未发送的新草稿")
            f.chat.retryPhoneReply()
            until { e.sent == 1 }
            assertEquals("合成失败消息",e.sentText)
            assertEquals("尚未发送的新草稿",f.chat.draft)
            e.phoneMessages.put("turnStatus","completed").remove("turnErrorCode")
            f.chat.refresh()
            assertEquals("",f.chat.error)
            assertFalse(f.chat.canRetryPhoneReply)
        } finally { f.close() }
    }

    @Test fun modelMenuSelectionSendsHostContractAndUsesItsReceiptForTheNextMessage() = runBlocking {
        val e = Environment(); val f = Fixture(e)
        try {
            f.chat.bootstrap(); f.chat.hostModelServices = true
            val selected = chooseNativeServiceModel(f.chat, service, v25) { error("Must use the computer") }!!
            assertEquals(service.getString("serviceId"), selected.getString("serviceId"))
            assertEquals("mimo-v2.5", selected.getString("modelId"))
            assertEquals("test-v25-profile", f.chat.modelId)
            assertEquals("MiMo v2.5", f.chat.modelLabel)
            assertEquals(f.chat.sessionId, e.selectionBody!!.getString("sessionId"))
            f.chat.edit("切换后发一句"); f.chat.send(); until { e.sent == 1 }
        } finally { f.close() }
    }

    @Test fun modelMenuResolvesExistingChatSessionBeforeSelecting() = runBlocking {
        val e = Environment(); val f = Fixture(e)
        try {
            f.chat.bootstrap(); f.chat.hostModelServices = true; f.chat.sessionId = ""; e.selectionRead = false
            chooseNativeServiceModel(f.chat, service, v25) { error("Must use the computer") }
            assertTrue(e.selectionRead)
            assertTrue(e.selectionBody!!.getString("sessionId").startsWith("test-session-"))
        } finally { f.close() }
    }

    @Test fun modelMenuOnNewChatOmitsSessionAndKeepsTheChosenProfile() = runBlocking {
        val e = Environment(); val f = Fixture(e)
        try {
            f.chat.bootstrap(); f.chat.hostModelServices = true; f.chat.chatId = ""; f.chat.sessionId = ""
            chooseNativeServiceModel(f.chat, service, v25) { error("Must use the computer") }
            assertFalse(e.selectionBody!!.has("sessionId"))
            assertEquals("test-v25-profile", f.chat.modelId)
        } finally { f.close() }
    }

    @Test fun phoneCreatedConversationUsesTheExistingSavedComputerRouteAfterReconnect() = runBlocking {
        val e = Environment(); val f = Fixture(e)
        try {
            f.chat.hostModelServices = true; f.chat.phone = true; f.chat.chatId = "phone-created-conversation"
            chooseNativeServiceModel(f.chat, service, v25) { error("Must use the computer") }
            assertFalse(e.selectionRead); assertFalse(e.selectionBody!!.has("sessionId"))
            assertEquals("test-v25-profile", e.phoneHostChoice)
            assertEquals("test-v25-profile", f.chat.modelId)
        } finally { f.close() }
    }

    @Test fun newWorkModelSurvivesRefreshAndIsUsedToCreateAndSendTheWork() = runBlocking {
        val e = Environment(); val f = Fixture(e)
        try {
            f.chat.bootstrap(); f.chat.hostModelServices = true; f.chat.newChat("work").join()
            assertTrue(f.chat.newWork); assertEquals("", f.chat.chatId)
            chooseNativeServiceModel(f.chat, service, v25) { error("Must use the computer") }
            f.chat.refresh()
            assertEquals("test-v25-profile", f.chat.modelId)
            assertEquals("MiMo v2.5", f.chat.modelLabel)
            f.chat.chooseWorkProject(e.project)
            until { !f.chat.newWork && !f.chat.workBusy }
            assertEquals("test-v25-profile", e.createdProfile)
            f.chat.edit("用刚选的型号开始工作"); f.chat.send(); until { e.sent == 1 }
        } finally { f.close() }
    }

    @Test fun handedOffPhoneConversationSelectsItsBoundSessionBeforeTheNextTurn() = runBlocking {
        val e = Environment().apply { boundSession = "computer-bound-session" }; val f = Fixture(e)
        try {
            f.chat.bootstrap(); f.chat.hostModelServices = true
            f.chat.select(JSONObject().put("id", "phone-created-conversation").put("source", "phone")
                .put("binding", JSONObject().put("sessionId", e.boundSession)))
            assertTrue(f.chat.phone)
            chooseNativeServiceModel(f.chat, service, v25) { error("Must use the computer") }
            assertEquals(e.boundSession, e.selectionBody!!.optString("sessionId"))
            f.chat.edit("交给电脑以后换型号继续"); f.chat.send(); until { e.sent == 1 }
            assertEquals("test-v25-profile", e.sentProfile)
        } finally { f.close() }
    }

    @Test fun phoneModelMenuUpdatesTheComposerIdAsWellAsTheLabel() = runBlocking {
        val f = Fixture(Environment())
        try {
            f.chat.standalone = true; f.chat.modelId = "mimo-v2.6-flash"
            val selected = chooseNativeServiceModel(f.chat, service, v25) { body ->
                assertEquals(setOf("serviceId", "modelId"), body.keys().asSequence().toSet())
                JSONObject().put("model", JSONObject().put("modelId", body.getString("modelId")))
            }!!
            assertEquals("mimo-v2.5", f.chat.modelId)
            assertEquals("MiMo v2.5", f.chat.modelLabel)
            assertEquals("mimo-v2.5", selected.getString("modelId"))
        } finally { f.close() }
    }

    @Test fun unsupportedSelectionExplainsHowToUpdateWithoutChangingTheComposer() = runBlocking {
        for (failure in listOf(ApiFailure(405, "METHOD_NOT_ALLOWED"), ApiFailure(426, "COMPUTER_UPDATE_REQUIRED"))) {
            val e = Environment(); e.selectionFailure = failure; val f = Fixture(e)
            try {
                f.chat.hostModelServices = true; f.chat.modelId = "original"; f.chat.modelLabel = "原型号"
                try { chooseNativeServiceModel(f.chat, service, v25) { error("Must use the computer") }; fail("Must explain unsupported selection") }
                catch (error: Exception) { assertEquals("电脑上的 WeftMate 版本太旧，到电脑上更新后就能切换模型。", error.message) }
                assertEquals("original", f.chat.modelId); assertEquals("原型号", f.chat.modelLabel)
            } finally { f.close() }
        }
    }

    @Test fun undeclaredComputerSelectionDoesNotSendAnUnsupportedRequest() = runBlocking {
        val e = Environment(); val f = Fixture(e)
        try {
            f.chat.modelId = "original"
            try { chooseNativeServiceModel(f.chat, service, v25) { error("Must use the computer") }; fail("Must require an update") }
            catch (error: Exception) { assertEquals("电脑上的 WeftMate 版本太旧，到电脑上更新后就能切换模型。", error.message) }
            assertNull(e.selectionBody); assertEquals("original", f.chat.modelId)
        } finally { f.close() }
    }

    @Test fun selectionErrorsExplainUnavailableModelAndExpiredLogin() = runBlocking {
        for ((failure, message) in listOf(
            ApiFailure(422, "MODEL_UNAVAILABLE") to "这个型号暂时不可用，请重新打开模型菜单，选择可用的型号。",
            ApiFailure(401, "UNAUTHORIZED") to "登录已失效，请重新登录后切换模型。",
            ApiFailure(404, "SESSION_UNAVAILABLE") to "这段对话暂时不可用，请重新打开对话后切换模型。",
        )) {
            val e = Environment(); e.selectionFailure = failure; val f = Fixture(e)
            try {
                f.chat.hostModelServices = true; f.chat.modelId = "original"
                try { chooseNativeServiceModel(f.chat, service, v25) { error("Must use the computer") }; fail("Must explain failure") }
                catch (error: Exception) { assertEquals(message, error.message) }
                assertEquals("original", f.chat.modelId)
            } finally { f.close() }
        }
    }

    @Test fun missingSelectionReceiptDoesNotPublishAnOptimisticPhoneChoice() = runBlocking {
        val f = Fixture(Environment())
        try {
            f.chat.standalone = true; f.chat.modelId = "original"
            try { chooseNativeServiceModel(f.chat, service, v25) { JSONObject() }; fail("Missing receipt") }
            catch (error: Exception) { assertTrue(error.message!!.contains("型号暂时不可用")) }
            assertEquals("original", f.chat.modelId)
        } finally { f.close() }
    }

    @Test fun lateSelectionReceiptCannotRenameAnotherConversation() = runBlocking {
        val f = Fixture(Environment())
        try {
            f.chat.standalone = true; f.chat.modelId = "original"; f.chat.chatId = "first"
            val selected = chooseNativeServiceModel(f.chat, service, v25) {
                f.chat.chatId = "second"
                JSONObject().put("model", JSONObject().put("modelId", "mimo-v2.5"))
            }
            assertNull(selected); assertEquals("original", f.chat.modelId)
        } finally { f.close() }
    }

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
    @Test fun originalWorkExplainsItsNamedComputerIsOfflineAndResumesWithoutChangingOwnership() = runBlocking {
        val e=Environment();val f=Fixture(e)
        try{
            f.chat.bootstrap();f.chat.newChat("work").join();f.chat.chooseWorkProject(e.project)
            until{!f.chat.newWork&&f.chat.chatId.isNotBlank()}
            f.chat.edit("上线后接着读说明")
            val chat=f.chat.chatId;val session=f.chat.sessionId;val host=f.chat.hostId;val project=f.chat.workProject
            e.directoryHosts=JSONArray().put(JSONObject().put("hostId",host).put("name","书房电脑").put("online",false))
                .put(JSONObject().put("hostId","other-computer").put("name","另一台电脑").put("online",true))
            e.online=false;f.chat.refresh()
            assertTrue("the original computer must be named",f.chat.error.contains("书房电脑"))
            assertTrue(f.chat.error.contains("离线"));assertFalse(f.chat.error.contains("正在重连"))
            assertFalse(f.chat.connected);assertFalse(f.chat.canSend)
            assertEquals(chat,f.chat.chatId);assertEquals(session,f.chat.sessionId);assertEquals(host,f.chat.hostId);assertEquals(project,f.chat.workProject)
            assertEquals("上线后接着读说明",f.chat.draft)
            e.online=true;f.chat.refresh()
            assertTrue(f.chat.connected);assertEquals("",f.chat.error)
            assertEquals(chat,f.chat.chatId);assertEquals(session,f.chat.sessionId);assertEquals(host,f.chat.hostId)
            assertEquals("上线后接着读说明",f.chat.draft)
        }finally{f.close()}
    }
    @Test fun anOfflineOtherComputerOrUnknownDirectoryDoesNotRelabelTheOriginalComputer() = runBlocking {
        val e=Environment();val f=Fixture(e)
        try{
            f.chat.bootstrap();val host=f.chat.hostId;e.online=false
            for(original in listOf(JSONObject().put("hostId",host).put("online",true),JSONObject().put("hostId",host))){
                e.directoryHosts=JSONArray().put(original).put(JSONObject().put("hostId","other").put("online",false))
                f.chat.refresh();assertFalse(f.chat.computerOffline);assertEquals("连接暂时中断，正在重连。",f.chat.error);assertEquals(host,f.chat.hostId)
            }
        }finally{f.close()}
    }
    @Test fun offlineTaskEntryRefreshesItsCapabilityWithoutReadingTheDisconnectedComputersProjects() = runBlocking {
        val e=Environment();val f=Fixture(e)
        try{
            f.chat.bootstrap();e.online=false;e.offlineReady=true
            f.chat.refreshOfflineWorkAvailability().join()
            assertTrue(f.chat.offlineWorkReady)
            e.offlineReady=false;f.chat.refreshOfflineWorkAvailability().join();assertFalse(f.chat.offlineWorkReady)
        }finally{f.close()}
    }
    @Test fun aNewOfflineTaskUsesTheDraftRatherThanRepeatingAnEarlierWorkRequest() = runBlocking {
        val e=Environment();val f=Fixture(e)
        try{
            f.chat.bootstrap();f.chat.edit("上线后读一下新的说明")
            val chat=f.chat.chatId;val session=f.chat.sessionId;val host=f.chat.hostId
            f.chat.openOfflineWork();until{f.chat.tab=="web-chat"}
            assertTrue(e.lastPresentation.contains(JSONObject.quote("上线后读一下新的说明")))
            assertEquals(chat,f.chat.chatId);assertEquals(session,f.chat.sessionId);assertEquals(host,f.chat.hostId)
        }finally{f.close()}
    }
}
