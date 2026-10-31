package com.memoweft.weftmate.mobile

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** D55: decision needed > running > failed > unread. */
internal enum class ChatDot { Attention, Running, Failed, Unread, None }

internal fun chatDot(row: JSONObject): ChatDot = when {
    row.optString("attention") in setOf("approval", "question") -> ChatDot.Attention
    row.optBoolean("running") -> ChatDot.Running
    row.optBoolean("unread") && row.optString("lastOutcome") == "failed" -> ChatDot.Failed
    row.optBoolean("unread") -> ChatDot.Unread
    else -> ChatDot.None
}

internal data class ChatSection(val title: String, val rows: List<JSONObject>)

private fun chatInstant(row: JSONObject) = listOf("at", "updatedAt", "lastActivityAt", "createdAt").firstNotNullOfOrNull { key ->
    row.stringOrEmpty(key).takeIf { it.isNotBlank() }?.let { runCatching { Instant.parse(it) }.getOrNull() }
}

internal fun chatSections(rows: List<JSONObject>, today: LocalDate, zone: ZoneId): List<ChatSection> {
    val buckets = linkedMapOf("置顶" to mutableListOf<JSONObject>(), "今天" to mutableListOf(), "昨天" to mutableListOf(), "更早" to mutableListOf(), "手机上的对话" to mutableListOf())
    for (row in rows.sortedByDescending { chatInstant(it) ?: Instant.EPOCH }) {
        val day = chatInstant(row)?.atZone(zone)?.toLocalDate()
        buckets.getValue(when {
            row.optBoolean("nativePhone") -> "手机上的对话"
            row.optBoolean("pinned") -> "置顶"
            day == today -> "今天"
            day == today.minusDays(1) -> "昨天"
            else -> "更早"
        }) += row
    }
    return buckets.filterValues { it.isNotEmpty() }.map { (title, list) -> ChatSection(title, list) }
}

internal fun chatTime(row: JSONObject, today: LocalDate, zone: ZoneId): String {
    val time = chatInstant(row)?.atZone(zone) ?: return ""
    return when (time.toLocalDate()) {
        today -> "%02d:%02d".format(time.hour, time.minute)
        today.minusDays(1) -> "昨天"
        else -> "${time.monthValue}月${time.dayOfMonth}日"
    }
}

internal fun chatMatches(row: JSONObject, query: String) = query.isBlank() || hostChatTitle(row).contains(query.trim(), ignoreCase = true)

/** Which long-press actions a row offers; phone-only rows and the main chat cannot take host metadata changes. */
internal fun chatMenu(row: JSONObject, standalone: Boolean): List<String> = when {
    standalone || row.optBoolean("nativePhone") -> emptyList()
    row.optString("kind") == "main" -> listOf("unread")
    else -> listOf("pin", "unread", "rename", "archive", "more")
}

internal fun chatWriteBody(row: JSONObject, change: JSONObject = JSONObject()): JSONObject =
    JSONObject(change.toString()).put("requestId", UUID.randomUUID().toString()).put("expectedRevision", row.optLong("revision"))

internal fun tokenEasing(css: String): Easing =
    Regex("cubic-bezier\\(([^)]*)\\)").find(css)?.groupValues?.get(1)?.split(',')?.map { it.trim().toFloat() }
        ?.let { (a, b, c, d) -> CubicBezierEasing(a, b, c, d) } ?: LinearEasing

private val easeOut = tokenEasing(DesignTokens.motionEaseOut)
private val easeInOut = tokenEasing(DesignTokens.motionEaseInOut)

@Composable internal fun NativeChatList(m: NativeChatModel, modifier: Modifier) {
    val activity = LocalContext.current as NativeActivity
    val reduced = activity.settings.home.optBoolean("reducedMotion")
    var query by rememberSaveable { mutableStateOf("") }
    var archived by rememberSaveable { mutableStateOf(false) }
    var remote by remember { mutableStateOf<List<JSONObject>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { runCatching { m.refreshChats() } }
    LaunchedEffect(query, archived, reload, m.standalone) {
        failure = ""
        if (m.standalone || (!archived && query.isBlank())) { remote = null; return@LaunchedEffect }
        delay(DesignTokens.motionDur2.toLong())
        loading = true
        remote = runCatching {
            val params = buildList { if (archived) add("archived=true"); if (query.isNotBlank()) add("q=" + URLEncoder.encode(query.trim(), "UTF-8")) }.joinToString("&")
            m.business("/chats?$params").optJSONArray("items")?.objects().orEmpty() +
                if (archived) emptyList() else m.chats.filter { it.optBoolean("nativePhone") && chatMatches(it, query) }
        }.onFailure { failure = "对话列表暂时没能读取。" }.getOrNull()
        loading = false
    }
    val rows = remote ?: m.chats.filter { chatMatches(it, query) }
    val zone = runCatching { ZoneId.of(m.timeZone) }.getOrDefault(ZoneId.systemDefault())
    val today = LocalDate.now(zone)
    val sections = remember(rows, today) { chatSections(rows, today, zone) }
    val collapsed = remember { mutableStateMapOf<String, Boolean>() }
    var renaming by remember { mutableStateOf<JSONObject?>(null) }
    fun act(row: JSONObject, action: suspend () -> Unit) = m.scope.launch {
        failure = ""
        runCatching { action(); m.refreshChats(); reload++ }.onFailure { failure = "没能完成，请重试。" }
    }
    fun run(row: JSONObject, id: String) {
        val chat = "/chats/${row.stringOrEmpty("chatId")}"
        when (id) {
            "pin" -> act(row) { m.business("$chat/metadata", "PATCH", chatWriteBody(row, JSONObject().put("pinned", !row.optBoolean("pinned")))) }
            "unread" -> act(row) { m.business("$chat/metadata", "PATCH", chatWriteBody(row, JSONObject().put("unread", !row.optBoolean("unread")))) }
            "archive" -> act(row) { m.business(if (row.optBoolean("archived")) "$chat/unarchive" else "$chat/archive", "POST", chatWriteBody(row)) }
            "rename" -> renaming = row
            "more" -> m.tab = "web-home"
        }
    }

    Column(modifier.fillMaxWidth()) {
        NativeChatSearch(query, archived, onQuery = { query = it }, onLeaveArchive = { archived = false })
        AnimatedContent(targetState = Triple(archived, query.isBlank(), sections.isEmpty()), label = "chat-list",
            transitionSpec = { fadeIn(tween(if (reduced) 0 else DesignTokens.motionDur3, easing = easeOut)) togetherWith fadeOut(tween(if (reduced) 0 else DesignTokens.motionDur1)) },
            modifier = Modifier.weight(1f)) { _ ->
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = DesignTokens.space16.dp, end = DesignTokens.space16.dp, bottom = DesignTokens.space24.dp)) {
                if (failure.isNotBlank()) item {
                    Row(Modifier.fillMaxWidth().padding(vertical = DesignTokens.space8.dp).clip(RoundedCornerShape(DesignTokens.radiuscard.dp)).background(MaterialTheme.colorScheme.errorContainer)
                        .padding(horizontal = DesignTokens.space16.dp, vertical = DesignTokens.space8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(failure, Modifier.weight(1f), fontSize = DesignTokens.font13.sp)
                        TextButton(onClick = { reload++ }) { Text("重试") }
                    }
                }
                if (sections.isEmpty() && !loading) item {
                    Text(if (query.isNotBlank()) "没有找到「${query.trim()}」" else if (archived) "没有已归档的对话" else "还没有对话，从新对话开始聊聊。",
                        Modifier.fillMaxWidth().padding(vertical = DesignTokens.space48.dp), fontSize = DesignTokens.font14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                val orderOf = sections.flatMap { it.rows }.withIndex().associate { (i, r) -> r to i }
                for (section in sections) {
                    val open = collapsed[section.title] != true
                    item(key = "h:${section.title}") { NativeChatSectionHeader(section.title, open) { collapsed[section.title] = open } }
                    item(key = "s:${section.title}") {
                        AnimatedVisibility(open, enter = expandVertically(tween(if (reduced) 0 else DesignTokens.motionDur4, easing = easeOut)) + fadeIn(tween(if (reduced) 0 else DesignTokens.motionDur3)),
                            exit = shrinkVertically(tween(if (reduced) 0 else DesignTokens.motionDur3, easing = easeInOut)) + fadeOut(tween(if (reduced) 0 else DesignTokens.motionDur1))) {
                            val pinned = section.title == "置顶"
                            Column(Modifier.fillMaxWidth().then(if (pinned) Modifier.clip(RoundedCornerShape(DesignTokens.radiuspanel.dp)).background(MaterialTheme.colorScheme.primaryContainer) else Modifier)
                                .padding(vertical = if (pinned) DesignTokens.space4.dp else 0.dp)) {
                                section.rows.forEach { row ->
                                    NativeChatRow(row, chatTime(row, today, zone), orderOf[row] ?: 0, reduced, chatMenu(row, m.standalone),
                                        onOpen = { m.launch { m.select(row); m.tab = "chat" } }, onAction = { run(row, it) })
                                }
                            }
                        }
                    }
                }
                if (!archived && query.isBlank() && !m.standalone) item(key = "archived") {
                    Row(Modifier.fillMaxWidth().padding(top = DesignTokens.space16.dp).clip(RoundedCornerShape(DesignTokens.radiuscard.dp)).clickable { archived = true }
                        .heightIn(min = DesignTokens.space44.dp).padding(horizontal = DesignTokens.space8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.space8.dp)) {
                        Icon(painterResource(R.drawable.wm_archive), null, Modifier.size(DesignTokens.iconTouch.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("已归档", Modifier.weight(1f), fontSize = DesignTokens.font14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Icon(painterResource(R.drawable.wm_right), null, Modifier.size(DesignTokens.space16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
    renaming?.let { row ->
        var title by remember(row) { mutableStateOf(hostChatTitle(row)) }
        AlertDialog(onDismissRequest = { renaming = null }, title = { Text("重命名") },
            text = { OutlinedTextField(title, { title = it }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(enabled = title.isNotBlank(), onClick = { renaming = null; act(row) { m.business("/chats/${row.stringOrEmpty("chatId")}/metadata", "PATCH", chatWriteBody(row, JSONObject().put("title", title.trim()))) } }) { Text("保存") } },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("取消") } })
    }
}

@Composable private fun NativeChatSearch(query: String, archived: Boolean, onQuery: (String) -> Unit, onLeaveArchive: () -> Unit) {
    val c = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space16.dp, vertical = DesignTokens.space8.dp), verticalArrangement = Arrangement.spacedBy(DesignTokens.space8.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = DesignTokens.space44.dp).clip(RoundedCornerShape(DesignTokens.radius999.dp)).background(c.surfaceVariant)
            .padding(horizontal = DesignTokens.space16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.space8.dp)) {
            Icon(painterResource(R.drawable.wm_search), null, Modifier.size(DesignTokens.space18.dp), tint = c.onSurfaceVariant)
            BasicTextField(query, onQuery, singleLine = true, modifier = Modifier.weight(1f).semantics { contentDescription = "搜索对话" },
                textStyle = TextStyle(color = c.onSurface, fontSize = DesignTokens.font15.sp), cursorBrush = SolidColor(c.primary),
                decorationBox = { inner -> Box { if (query.isEmpty()) Text(if (archived) "搜索已归档的对话" else "搜索对话", color = c.onSurfaceVariant, fontSize = DesignTokens.font15.sp); inner() } })
            if (query.isNotEmpty()) NativeIconButton(R.drawable.wm_close, "清空搜索", compact = true) { onQuery("") }
        }
        if (archived) Row(verticalAlignment = Alignment.CenterVertically) {
            NativeIconButton(R.drawable.wm_back, "返回全部对话", compact = true) { onLeaveArchive() }
            Text("已归档", fontSize = DesignTokens.font15.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable private fun NativeChatSectionHeader(title: String, open: Boolean, onToggle: () -> Unit) {
    val turn by animateFloatAsState(if (open) 0f else -90f, tween(DesignTokens.motionDur3, easing = easeOut), label = "section-chevron")
    Row(Modifier.fillMaxWidth().padding(top = DesignTokens.space16.dp, bottom = DesignTokens.space4.dp).clip(RoundedCornerShape(DesignTokens.radiuscontrol.dp))
        .clickable(onClick = onToggle).heightIn(min = DesignTokens.space32.dp).padding(horizontal = DesignTokens.space8.dp)
        .semantics { contentDescription = if (open) "收起$title" else "展开$title" }, verticalAlignment = Alignment.CenterVertically) {
        if (title == "置顶") Icon(painterResource(R.drawable.wm_pin), null, Modifier.size(DesignTokens.space14.dp).padding(end = DesignTokens.space2.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(title, Modifier.weight(1f).padding(start = DesignTokens.space4.dp), fontSize = DesignTokens.font13.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Icon(painterResource(R.drawable.wm_down), null, Modifier.size(DesignTokens.space16.dp).graphicsLayer { rotationZ = turn }, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable private fun NativeChatRow(row: JSONObject, time: String, order: Int, reduced: Boolean, menu: List<String>, onOpen: () -> Unit, onAction: (String) -> Unit) {
    val c = MaterialTheme.colorScheme
    val dark = LocalNativeDark.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val press by animateFloatAsState(if (pressed && !reduced) .97f else 1f, tween(DesignTokens.motionDur1, easing = easeOut), label = "row-press")
    // First appearance rises in a capped stagger; recycled rows stay put.
    val rise = remember(row.stringOrEmpty("chatId").ifEmpty { row.stringOrEmpty("id") }) { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(rise) { if (rise.value < 1f) { delay((order.coerceAtMost(8) * DesignTokens.durationStagger / 4)); rise.animateTo(1f, tween(DesignTokens.motionDur4, easing = easeOut)) } }
    var menuOpen by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.fillMaxWidth().graphicsLayer { scaleX = press; scaleY = press; alpha = rise.value; translationY = (1f - rise.value) * DesignTokens.space12.dp.toPx() }
            .clip(RoundedCornerShape(DesignTokens.radiuscard.dp))
            .combinedClickable(interactionSource = interaction, indication = LocalIndication.current, onClick = onOpen, onLongClick = if (menu.isEmpty()) null else ({ menuOpen = true }))
            .heightIn(min = DesignTokens.space56.dp).padding(horizontal = DesignTokens.space12.dp, vertical = DesignTokens.space10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.space12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(DesignTokens.space2.dp)) {
                Text(hostChatTitle(row), fontSize = DesignTokens.font16.sp, fontWeight = if (row.optBoolean("unread")) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val preview = row.stringOrEmpty("preview").ifEmpty { row.optJSONObject("lastMessage")?.stringOrEmpty("text").orEmpty() }
                if (preview.isNotBlank()) Text(preview, fontSize = DesignTokens.font13.sp, color = c.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(DesignTokens.space6.dp)) {
                if (time.isNotBlank()) Text(time, fontSize = DesignTokens.font12.sp, color = c.onSurfaceVariant)
                when (chatDot(row)) {
                    ChatDot.Attention -> NativeChatDot(Color(DesignTokens.nativeWarning), "等你处理")
                    ChatDot.Running -> CircularProgressIndicator(Modifier.size(DesignTokens.space16.dp).semantics { contentDescription = "运行中" }, color = c.onSurfaceVariant, strokeWidth = DesignTokens.space2.dp)
                    ChatDot.Failed -> NativeChatDot(c.error, "失败")
                    ChatDot.Unread -> NativeChatDot(Color(if (dark) DesignTokens.nativeDarkBrand else DesignTokens.nativeBrand), "未读")
                    ChatDot.None -> Unit
                }
            }
        }
        NativeMenu(menuOpen, onDismissRequest = { menuOpen = false }) {
            val label = mapOf("pin" to if (row.optBoolean("pinned")) "取消置顶" else "置顶", "unread" to if (row.optBoolean("unread")) "标为已读" else "标为未读",
                "rename" to "重命名", "archive" to if (row.optBoolean("archived")) "取消归档" else "归档", "more" to "删除、分叉、分组…")
            val icon = mapOf("pin" to R.drawable.wm_pin, "unread" to R.drawable.wm_bell, "rename" to R.drawable.wm_edit, "archive" to R.drawable.wm_archive, "more" to R.drawable.wm_more)
            menu.forEach { id -> NativeMenuItem(text = { Text(label.getValue(id)) }, leadingIcon = { Icon(painterResource(icon.getValue(id)), null, Modifier.size(DesignTokens.iconTouch.dp)) }, onClick = { menuOpen = false; onAction(id) }) }
        }
    }
}

@Composable private fun NativeChatDot(color: Color, label: String) =
    Box(Modifier.size(DesignTokens.space8.dp).background(color, CircleShape).semantics { contentDescription = label })
