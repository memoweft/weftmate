package com.memoweft.weftmate.mobile

import org.json.JSONObject
import kotlinx.coroutines.CancellationException

internal fun nativeModelSelectionMessage(error: ApiFailure): String = when {
    error.safeCode == "COMPUTER_UPDATE_REQUIRED" || error.status in listOf(405, 426, 501) || error.status == 404 && error.safeCode == "NOT_FOUND" ->
        "电脑上的 WeftMate 版本太旧，到电脑上更新后就能切换模型。"
    error.safeCode in setOf("MODEL_UNAVAILABLE", "MODEL_NOT_FOUND", "MODEL_NOT_CONFIGURED") -> "这个型号暂时不可用，请重新打开模型菜单，选择可用的型号。"
    error.safeCode == "ACCOUNT_MODEL_SECRET_REQUIRED" -> "这个模型服务还没有可用的密钥，请到模型设置里补上密钥。"
    error.safeCode in setOf("TURN_RUNNING", "ACCOUNT_MODEL_BUSY") -> "当前回复还在进行，请等回复结束后再切换模型。"
    error.safeCode in setOf("SESSION_UNAVAILABLE", "CHAT_UNAVAILABLE") -> "这段对话暂时不可用，请重新打开对话后切换模型。"
    error.status == 401 -> "登录已失效，请重新登录后切换模型。"
    error.status == 403 -> "这台手机暂时不能修改电脑上的模型，请到电脑上检查登录和连接。"
    error.safeCode == "INVALID_REQUEST" -> "电脑没有接受这次模型选择，请检查并更新电脑和手机上的 WeftMate 后再试。"
    else -> "暂时无法连接模型服务，请检查连接后重新选择型号。"
}

/** Selection transport and its composer receipt are shared by the menu and model settings. */
internal suspend fun chooseNativeServiceModel(
    chat: NativeChatModel, service: JSONObject, model: JSONObject,
    phoneSelect: suspend (JSONObject) -> JSONObject,
): JSONObject? {
    val owner = chat.owner
    val chatId = chat.chatId
    val standalone = chat.standalone
    val phone = chat.phone
    val current = { owner == chat.owner && chatId == chat.chatId && standalone == chat.standalone && phone == chat.phone }
    val serviceId = service.getString("serviceId")
    val p = JSONObject().put("modelId", model.getString("modelId"))
    try {
        val response = if (standalone) phoneSelect(p.put("serviceId", serviceId)) else {
            val session = if (phone) "" else chat.sessionId.ifEmpty {
                if (!phone && chatId.isNotBlank()) chat.business("/chats/$chatId").optJSONObject("chat")?.let {
                    it.stringOrEmpty("activeSessionId").ifEmpty { it.stringOrEmpty("sessionId") }
                }.orEmpty() else ""
            }
            if (!current()) return null
            if (session.isNotBlank()) p.put("sessionId", session)
            // The host route already identifies the service. Its strict body schema
            // accepts only modelId, sessionId and requestId.
            chat.business("/model-services/$serviceId/select", "POST", p.put("requestId", java.util.UUID.randomUUID().toString()))
        }
        if (!current()) return null
        val id = if (standalone) (response.optJSONObject("model") ?: response).stringOrEmpty("modelId") else response.stringOrEmpty("profileId")
        if (id.isBlank()) throw ApiFailure(502, "MODEL_UNAVAILABLE")
        // A conversation created on the phone before the computer reconnected still
        // sends through chat.send, whose existing routing reads the saved host choice.
        if (phone && !standalone) {
            chat.call("models.selectHost", JSONObject().put("profileId", id))
            if (!current()) return null
        }
        chat.modelId = id
        chat.modelLabel = model.optString("name", model.getString("modelId"))
        if (!standalone) chat.models = chat.models.filterNot { it.stringOrEmpty("profileId") == id } +
            JSONObject(model.toString()).put("source", "host").put("profileId", id).put("displayName", chat.modelLabel).put("configured", true)
        if (standalone || chat.workAndChat && chatId.isBlank()) chat.sendAvailable = !chat.newWork && id.isNotBlank() && (standalone || chat.connected)
        return JSONObject(model.toString()).put("serviceId", serviceId).apply { if (!standalone) put("profileId", id) }
    } catch (error: CancellationException) { throw error
    } catch (error: ApiFailure) { throw IllegalStateException(nativeModelSelectionMessage(error), error)
    } catch (error: java.io.IOException) { throw IllegalStateException("暂时无法连接模型服务，请检查连接后重新选择型号。", error) }
}
