package com.memoweft.weftmate.mobile

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

/** A message as the host knows it: its source session and original sequence, not the timeline index. */
internal data class MessageRef(val sessionId: String, val event: JSONObject)

internal fun messageRef(raw: JSONObject?, fallbackSession: String): MessageRef? {
    raw ?: return null
    val source = raw.optJSONObject("sourceRef")
    val session = source?.stringOrEmpty("sessionId").orEmpty().ifEmpty { fallbackSession }
    if (session.isBlank()) return null
    val event = JSONObject(raw.toString())
    if (source?.optString("kind") == "native" && source.has("seq")) event.put("seq", source.optLong("seq"))
    return MessageRef(session, event)
}

/** Why editing or regenerating is off right now, or null when it is allowed. */
internal fun messageMutationBlock(local: Boolean, running: Boolean, connected: Boolean, readOnly: Boolean): String? = when {
    local -> "这段是在手机上聊的，需要先由电脑接续"
    readOnly -> "这段对话只能查看"
    running -> "回复进行中，结束后再操作"
    !connected -> "电脑不在线，连上后再操作"
    else -> null
}

/** The shared-core calls behind each action; arguments are JSON literals, never spliced text. */
internal object MessageScripts {
    private fun q(value: String) = JSONObject.quote(value)
    fun branch(ref: MessageRef, action: String, text: String?, model: String?) =
        "const b=await uiCore.branchMessage(${q(ref.sessionId)},${ref.event},${q(action)},${text?.let(::q) ?: "null"},${model?.let(::q) ?: "null"},crypto.randomUUID());return b||{};"
    fun versions(sessionId: String) =
        "return await uiCore.accessApi('/sessions/'+encodeURIComponent(${q(sessionId)})+'/message-branches').catch(()=>({groups:[]}));"
    fun feedback(ref: MessageRef, rating: String?) =
        "await uiCore.saveMessageFeedback(${q(ref.sessionId)},${ref.event.optLong("seq")},${rating?.let(::q) ?: "null"});return {};"
    fun export(sessionId: String, title: String) =
        "const events=await uiCore.conversationExportEvents(${q(sessionId)});return {text:uiCore.messageExport(events,${q(title)})};"
}

/** Which version bar, if any, belongs under this message. */
internal fun messageVersion(groups: List<JSONObject>, sessionId: String, event: JSONObject, sessionEvents: List<JSONObject>): Pair<Int, List<String>>? {
    for (group in groups) {
        val versions = group.optJSONArray("versions")?.objects().orEmpty()
        val index = versions.indexOfFirst { it.stringOrEmpty("sessionId") == sessionId }
        if (index < 0) continue
        val version = versions[index]
        val role = if (group.optString("action") == "edit") "user.message" else "assistant.message"
        if (event.optString("type") != role) continue
        val seq = event.optLong("seq")
        val anchor = if (version.has("anchorSeq")) version.optLong("anchorSeq")
            else sessionEvents.filter { it.optString("type") == role && it.optLong("seq") > version.optLong("afterSeq") }.minOfOrNull { it.optLong("seq") }
        if (anchor == seq) return index to versions.map { it.stringOrEmpty("sessionId") }
    }
    return null
}

@Composable internal fun NativeReplyActions(m: NativeChatModel, e: JSONObject, text: String) {
    val activity = LocalContext.current as NativeActivity
    val scope = rememberCoroutineScope()
    val ref = remember(e.optString("eventId"), m.rows) { messageRef(m.rows.find { it.optString("eventId") == e.optString("eventId") } ?: e, m.sessionId) }
    var menu by remember { mutableStateOf(false) }
    var models by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf("") }
    var failure by remember { mutableStateOf("") }
    val block = messageMutationBlock(m.phoneArchive || m.standalone, m.running, m.connected, false)
    fun run(label: String, write: Boolean = true, then: suspend (JSONObject) -> Unit = {}, script: () -> String) = scope.launch {
        busy = label; failure = ""
        try { then(if (write) activity.core.write(script()) else activity.core.call(script(), 120000)) }
        catch (error: NativeCoreFailure) { failure = error.text.ifBlank { "没能完成，请重试。" } }
        catch (error: kotlinx.coroutines.CancellationException) { throw error }
        catch (_: Exception) { failure = "没能完成，请重试。" }
        finally { busy = "" }
    }
    suspend fun openBranch(result: JSONObject) {
        m.refreshChats()
        val session = result.stringOrEmpty("sessionId")
        m.chats.find { it.stringOrEmpty("activeSessionId") == session || it.stringOrEmpty("sessionId") == session }?.let { m.select(it) } ?: m.refresh()
    }
    Column {
        NativeReplyVersions(m, ref, e)
        Row(verticalAlignment = Alignment.CenterVertically) {
            NativeIconButton(R.drawable.wm_copy, "复制回复", compact = true) { m.copyReply(text) }
            NativeIconButton(R.drawable.wm_chat, "引用回复", compact = true) { m.edit("> ${text.take(300).replace("\n", "\n> ")}\n\n"); m.focused = true }
            if (ref != null && !m.phoneArchive) NativeIconButton(R.drawable.wm_export, "分享或导出对话", compact = true) {
                run("正在准备导出…", write = false, then = { result ->
                    activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/markdown").putExtra(Intent.EXTRA_TEXT, result.optString("text")), "分享对话"))
                }) { MessageScripts.export(ref.sessionId, m.title) }
            }
            if (ref != null && !m.phoneArchive) Box {
                NativeIconButton(R.drawable.wm_more, "更多回复操作", compact = true) { menu = true }
                NativeMenu(menu, onDismissRequest = { menu = false; models = false }) {
                    if (!models) {
                        NativeMenuItem(text = { Text("有用") }, onClick = { menu = false; run("") { MessageScripts.feedback(ref, "helpful") } })
                        NativeMenuItem(text = { Text("没用") }, onClick = { menu = false; run("") { MessageScripts.feedback(ref, "unhelpful") } })
                        NativeMenuItem(text = { Text("重新生成") }, enabled = block == null, leadingIcon = { Icon(painterResource(R.drawable.wm_refresh), null) },
                            onClick = { menu = false; run("正在重新生成…", then = ::openBranch) { MessageScripts.branch(ref, "regenerate", null, null) } })
                        NativeMenuItem(text = { Text("换模型重新生成") }, enabled = block == null, leadingIcon = { Icon(painterResource(R.drawable.wm_model), null) },
                            trailingIcon = { Icon(painterResource(R.drawable.wm_right), null) }, onClick = { models = true })
                    } else m.models.filter { it.optBoolean("configured", true) && it.optBoolean("available", true) }.forEach { model ->
                        NativeMenuItem(text = { Text(model.stringOrEmpty("name").ifEmpty { model.stringOrEmpty("id") }) }, onClick = {
                            menu = false; models = false
                            run("正在重新生成…", then = ::openBranch) { MessageScripts.branch(ref, "regenerate", null, model.stringOrEmpty("id")) }
                        })
                    }
                }
            }
        }
        val note = busy.ifBlank { failure.ifBlank { block?.takeIf { menu } ?: "" } }
        if (note.isNotBlank()) Text(note, fontSize = DesignTokens.font12.sp,
            color = if (failure.isNotBlank()) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** 「第 N / M 版」with previous and next, read from the host's message branches. */
@Composable private fun NativeReplyVersions(m: NativeChatModel, ref: MessageRef?, e: JSONObject) {
    ref ?: return
    val activity = LocalContext.current as NativeActivity
    val scope = rememberCoroutineScope()
    var groups by remember(ref.sessionId) { mutableStateOf(emptyList<JSONObject>()) }
    LaunchedEffect(ref.sessionId, m.rows.size) {
        groups = runCatching { activity.core.call(MessageScripts.versions(ref.sessionId)).optJSONArray("groups")?.objects().orEmpty() }.getOrDefault(emptyList())
    }
    val sessionEvents = m.rows.filter { (it.optJSONObject("sourceRef")?.stringOrEmpty("sessionId") ?: m.sessionId) == ref.sessionId }
        .map { messageRef(it, m.sessionId)!!.event }
    val (index, sessions) = messageVersion(groups, ref.sessionId, ref.event, sessionEvents) ?: return
    fun open(session: String) = scope.launch {
        m.refreshChats()
        m.chats.find { it.stringOrEmpty("activeSessionId") == session || it.stringOrEmpty("sessionId") == session }?.let { m.select(it) }
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.space4.dp)) {
        NativeIconButton(R.drawable.wm_back, "上一版", compact = true, enabled = index > 0) { open(sessions[index - 1]) }
        Text("第 ${index + 1} / ${sessions.size} 版", fontSize = DesignTokens.font12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        NativeIconButton(R.drawable.wm_right, "下一版", compact = true, enabled = index < sessions.size - 1) { open(sessions[index + 1]) }
    }
}

/** Long-press menu on your own message: copy, quote and, for a quiet computer chat, edit into a new version. */
@Composable internal fun NativeUserMessageMenu(m: NativeChatModel, e: JSONObject, text: String, open: Boolean, onDismiss: () -> Unit) {
    val activity = LocalContext.current as NativeActivity
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf("") }
    val host = !m.phoneArchive && !m.standalone
    val block = messageMutationBlock(!host, m.running, m.connected, false)
    NativeMenu(open, onDismissRequest = onDismiss) {
        NativeMenuItem(text = { Text("复制") }, leadingIcon = { Icon(painterResource(R.drawable.wm_copy), null) }, onClick = { onDismiss(); m.copyReply(text) })
        NativeMenuItem(text = { Text("引用") }, leadingIcon = { Icon(painterResource(R.drawable.wm_chat), null) },
            onClick = { onDismiss(); m.edit("> ${text.take(300).replace("\n", "\n> ")}\n\n"); m.focused = true })
        if (host) NativeMenuItem(text = { Text(block ?: "编辑") }, enabled = block == null, leadingIcon = { Icon(painterResource(R.drawable.wm_edit), null) },
            onClick = { onDismiss(); failure = ""; editing = true })
    }
    if (editing) {
        var draft by remember(e.optString("eventId")) { mutableStateOf(text) }
        var busy by remember { mutableStateOf(false) }
        AlertDialog(onDismissRequest = { if (!busy) editing = false }, title = { Text("编辑消息") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(DesignTokens.space8.dp)) {
                    OutlinedTextField(draft, { draft = it }, Modifier.fillMaxWidth(), minLines = 3, maxLines = 8, enabled = !busy)
                    Text("会从这条消息开始生成一个新版本，原来的版本仍可切回。", fontSize = DesignTokens.font12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (failure.isNotBlank()) Text(failure, fontSize = DesignTokens.font12.sp, color = MaterialTheme.colorScheme.error)
                }
            },
            confirmButton = {
                TextButton(enabled = !busy && draft.isNotBlank() && draft != text, onClick = {
                    val ref = messageRef(m.rows.find { it.optString("eventId") == e.optString("eventId") } ?: e, m.sessionId) ?: return@TextButton
                    busy = true
                    scope.launch {
                        try {
                            val branch = activity.core.write(MessageScripts.branch(ref, "edit", draft.trim(), null))
                            editing = false
                            m.refreshChats()
                            m.chats.find { it.stringOrEmpty("activeSessionId") == branch.stringOrEmpty("sessionId") }?.let { m.select(it) } ?: m.refresh()
                        } catch (error: kotlinx.coroutines.CancellationException) { throw error }
                        catch (error: NativeCoreFailure) { failure = error.text.ifBlank { "没能发送修改，请重试。" } }
                        catch (_: Exception) { failure = "没能发送修改，请重试。" }
                        finally { busy = false }
                    }
                }) { Text(if (busy) "正在发送…" else "发送修改") }
            },
            dismissButton = { TextButton(enabled = !busy, onClick = { editing = false }) { Text("取消") } })
    }
}
