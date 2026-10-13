package com.memoweft.weftmate.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val feedGap = DesignTokens.space8.dp
private val feedTouch = DesignTokens.space44.dp
private val feedPill = RoundedCornerShape(DesignTokens.radius999.dp)
private val feedBodyLeading = (DesignTokens.font16 * 1.9f).sp
private val feedFilters = listOf("all" to "全部", "actionable" to "待处理", "task" to "任务", "reminder" to "提醒", "memory" to "记忆")
private data class FeedEntry(val key: String, val day: String, val row: JSONObject? = null)

@Composable internal fun NativeFeedToolbar(feed: NativeFeedModel, back: () -> Unit, onDrawer: () -> Unit = {}, onSettings: () -> Unit = {}) {
    val detail = feed.detail != null || feed.webDetail != null
    Row(Modifier.fillMaxWidth().heightIn(min = (DesignTokens.space64 + DesignTokens.space16).dp).padding(DesignTokens.space12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (detail) NativeIconButton(R.drawable.wm_back, "返回动态", action = back)
        else NativeIconButton(R.drawable.wm_panel, "打开侧栏", action = onDrawer)
        Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
            Text(if (detail) "动态详情" else "动态", fontSize = DesignTokens.font18.sp, fontWeight = FontWeight.SemiBold)
        }
        if (detail) Spacer(Modifier.size(feedTouch))
        else NativeIconButton(R.drawable.wm_user, "打开个人设置", action = onSettings)
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable internal fun NativeFeedPage(feed: NativeFeedModel, modifier: Modifier = Modifier) {
    LaunchedEffect(Unit) { feed.refresh(full = true) }
    val listState = rememberLazyListState()
    val refreshState = rememberPullToRefreshState()
    val entries = remember(feed.items, feed.timeZone) {
        val days = feed.items.groupBy { feedDate(it.optString("at"), feed.timeZone) }
        buildList {
            days.forEach { (day, rows) ->
                add(FeedEntry("day:$day", day))
                rows.forEach { add(FeedEntry("row:${it.getString("id")}", day, it)) }
            }
        }
    }
    LaunchedEffect(feed.focusRowId, entries) {
        val id = feed.focusRowId
        if (id.isNotEmpty()) {
            val index = entries.indexOfFirst { it.row?.optString("id") == id }
            if (index >= 0) { listState.scrollToItem(index + 3); feed.clearRowFocus() }
        }
    }
    PullToRefreshBox(
        isRefreshing = feed.refreshingGesture,
        onRefresh = { feed.refresh(full = true, gesture = true) },
        state = refreshState,
        indicator = { PullToRefreshDefaults.Indicator(state = refreshState, isRefreshing = feed.refreshingGesture, modifier = Modifier.align(Alignment.TopCenter), containerColor = MaterialTheme.colorScheme.surface, color = MaterialTheme.colorScheme.primary) },
        modifier = modifier.fillMaxWidth()
    ) {
        LazyColumn(Modifier.fillMaxSize().semantics { contentDescription = "动态列表" }, state = listState,
            contentPadding = PaddingValues(start = DesignTokens.space20.dp, top = DesignTokens.space24.dp, end = DesignTokens.space20.dp, bottom = DesignTokens.space32.dp)) {
            item(key = "heading") {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("动态", Modifier.weight(1f), fontSize = DesignTokens.font24.sp, fontWeight = FontWeight.Bold)
                    NativeIconButton(R.drawable.wm_check_circle, "全部标为已读", enabled = feed.unread > 0 && !feed.loading && !feed.busy) { feed.markAll() }
                    NativeIconButton(R.drawable.wm_refresh, "刷新动态", enabled = !feed.loading && !feed.noComputer, compact = true) { feed.refresh(full = true) }
                }
                Text("提醒、任务结果和需要你处理的事项，都在这里。", Modifier.padding(top = DesignTokens.space12.dp), fontSize = DesignTokens.font16.sp, lineHeight = feedBodyLeading, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            item(key = "filters") {
                FlowRow(Modifier.fillMaxWidth().padding(top = DesignTokens.space24.dp, bottom = DesignTokens.space12.dp), horizontalArrangement = Arrangement.spacedBy(DesignTokens.space4.dp), verticalArrangement = Arrangement.spacedBy(DesignTokens.space4.dp)) {
                    feedFilters.forEach { (id, label) ->
                        Text(label, Modifier.heightIn(min = feedTouch).clip(feedPill)
                            .background(if (feed.filter == id) feedSelected(feed.dark) else Color.Transparent)
                            .selectable(selected = feed.filter == id, enabled = !feed.loading && !feed.busy, role = Role.Tab, onClick = { feed.choose(id) })
                            .padding(horizontal = DesignTokens.space12.dp, vertical = feedGap),
                            fontSize = DesignTokens.font16.sp, lineHeight = feedBodyLeading,
                            color = if (feed.filter == id) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                    }
                }
            }
            item(key = "notice") {
                if (!feed.noComputer) Text(if (feed.error.isNotEmpty()) feed.error else if (feed.loading) "正在读取动态…" else "${feed.unread} 条未读" + if (feed.actionable > 0) " · ${feed.actionable} 项待处理" else "",
                    Modifier.heightIn(min = DesignTokens.space24.dp), fontSize = DesignTokens.font13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (entries.isEmpty()) item(key = "empty") {
                when {
                    feed.noComputer -> FeedEmpty(R.drawable.wm_bell, "连上电脑后，提醒和任务进展会出现在这里。")
                    feed.loading -> FeedSkeleton()
                    feed.error.isNotEmpty() -> FeedEmpty(R.drawable.wm_warning, feed.error, "重试") { feed.refresh(full = true) }
                    else -> FeedEmpty(R.drawable.wm_bell, if (feed.filter == "all") "还没有动态。设一个提醒，或让助手做件事。" else "这里暂时没有相关动态。")
                }
            }
            items(entries, key = { it.key }) { entry ->
                if (entry.row == null) Text(feedDayLabel(entry.day, feed.timeZone), Modifier.padding(top = DesignTokens.space32.dp, bottom = feedGap), fontSize = DesignTokens.font14.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                else FeedRow(entry.row, feed)
            }
            if (entries.isNotEmpty() && feed.error.isNotEmpty()) item(key = "retry") { FeedEmpty(R.drawable.wm_warning, feed.error, "重试") { feed.refresh(full = true) } }
            if (feed.nextCursor.isNotEmpty()) item(key = "more") { FeedTextAction("更多动态", !feed.loading) { feed.refresh(more = true) } }
        }
    }
}

private fun feedSelected(dark: Boolean) = Color(if (dark) DesignTokens.nativeDarkAccentSoft else DesignTokens.nativeAccentSoft)
private fun feedSoft(dark: Boolean) = Color(if (dark) DesignTokens.nativeDarkSoft else DesignTokens.nativeSoft)
private fun feedDate(at: String, zone: String) = runCatching { Instant.parse(at).atZone(ZoneId.of(zone)).toLocalDate().toString() }.getOrDefault("")
private fun feedDayLabel(date: String, zone: String): String = runCatching {
    val day = LocalDate.parse(date); val today = Instant.now().atZone(ZoneId.of(zone)).toLocalDate()
    when { day == today -> "今天"; day == today.minusDays(1) -> "昨天"; day >= today.minusDays(6) && day < today -> listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")[day.dayOfWeek.value - 1]; else -> "${day.monthValue} 月 ${day.dayOfMonth} 日" }
}.getOrDefault("")
private fun feedClock(at: String, zone: String) = runCatching { Instant.parse(at).atZone(ZoneId.of(zone)).format(DateTimeFormatter.ofPattern("H:mm", Locale.CHINA)) }.getOrDefault("")
private fun feedReportDate(value: String, zone: String, subtractDay: Boolean = false) = runCatching {
    val date = if (value.length == 10) LocalDate.parse(value) else Instant.parse(value).atZone(ZoneId.of(zone)).toLocalDate()
    val day = if (subtractDay) date.minusDays(1) else date
    "${day.monthValue} 月 ${day.dayOfMonth} 日"
}.getOrDefault("")

@Composable private fun FeedRow(row: JSONObject, feed: NativeFeedModel) {
    var menu by remember(row.optString("id")) { mutableStateOf(false) }
    val unread = !row.optBoolean("read")
    val actions = row.optJSONArray("actions")?.objects().orEmpty()
    val canOpen = unread || actions.any { it.optString("kind") in listOf("open_chat", "answer_question", "view_memory", "view_settings", "view_library") }
    val report = row.optJSONObject("weeklyInsight")
    Column(Modifier.fillMaxWidth().padding(vertical = DesignTokens.space12.dp).clip(RoundedCornerShape(DesignTokens.radius26.dp)).background(feedSoft(feed.dark))
        .clickable(enabled = !feed.busy && canOpen) { feed.open(row) }.semantics { contentDescription = "打开动态 ${row.optString("title")}" }.padding(vertical = feedGap)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(feedGap)) {
            Column(Modifier.weight(1f).padding(horizontal = feedGap, vertical = DesignTokens.space12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(feedGap), verticalAlignment = Alignment.Top) {
                    if (unread) Box(Modifier.size(DesignTokens.space6.dp).align(Alignment.CenterVertically).background(MaterialTheme.colorScheme.primary, CircleShape).semantics { contentDescription = "未读" })
                    Text(row.optString("title"), Modifier.weight(1f).alignByBaseline(), fontSize = DesignTokens.font16.sp, fontWeight = FontWeight.SemiBold)
                    Text(feedClock(row.optString("at"), feed.timeZone), Modifier.alignByBaseline(), fontSize = DesignTokens.font12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(if (report == null) row.optString("summary") else "${feedReportDate(report.optString("from"), "UTC")} — ${feedReportDate(report.optString("to"), "UTC", true)}",
                    Modifier.padding(top = feedGap), fontSize = DesignTokens.font16.sp, lineHeight = feedBodyLeading, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val reason = when (row.optJSONObject("notification")?.optString("reason")) { "dnd" -> "因勿扰未提醒"; "daily_limit" -> "已达每日主动提醒上限"; "type_disabled" -> "已设为只进动态"; else -> "" }
                if (reason.isNotEmpty()) Text(reason, fontSize = DesignTokens.font12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val status = when { row.optString("state") == "pending" -> "待处理"; row.optString("state") == "unavailable" -> "已失效"; row.optString("type").startsWith("approval.") || row.optString("type").startsWith("question.") -> "已完成"; else -> "" }
                if (status.isNotEmpty()) Text(status, fontSize = DesignTokens.font12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Box {
                NativeIconButton(R.drawable.wm_more, "更多操作 ${row.optString("title")}", enabled = !feed.busy && (actions.isNotEmpty() || unread || row.has("memoryDigest") || row.has("weeklyInsight")), compact = true) { menu = true }
                FeedMenu(menu, { menu = false }) {
                    if (row.optString("type") == "approval.pending" && row.optString("state") == "pending") actions.firstOrNull { it.optString("kind") == "respond_approval" }?.let { action ->
                        FeedMenuItem("批准", !feed.busy) { menu = false; feed.action(row, action, "allowed-once") }
                        FeedMenuItem("拒绝", !feed.busy, danger = true) { menu = false; feed.action(row, action, "rejected") }
                    }
                    actions.filter { it.optString("kind") != "respond_approval" }.forEach { action -> FeedMenuItem(action.optString("label", "查看"), !feed.busy) { menu = false; feed.action(row, action) } }
                    if (unread) FeedMenuItem("标为已读", !feed.busy) { menu = false; feed.mark(row) }
                    if(row.has("memoryDigest")||row.has("weeklyInsight"))FeedMenuItem("完整操作",!feed.busy){menu=false;feed.openOriginalRow(row)}
                }
            }
        }
        report?.let { FeedInsight(row, it, feed) }
        row.optJSONObject("memoryDigest")?.let { FeedDigest(row, it, feed) }
    }
}

@Composable private fun FeedMenu(expanded: Boolean, dismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    DropdownMenu(expanded, onDismissRequest = dismiss, containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(DesignTokens.radius26.dp), tonalElevation = 0.dp, shadowElevation = DesignTokens.space8.dp) { Column(Modifier.padding(horizontal = feedGap), content = content) }
}
@Composable private fun FeedMenuItem(label: String, enabled: Boolean = true, danger: Boolean = false, action: () -> Unit) {
    DropdownMenuItem(text = { Text(label, fontSize = DesignTokens.font16.sp, color = if (!enabled) MaterialTheme.colorScheme.onSurfaceVariant else if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface) }, onClick = action, enabled = enabled,
        modifier = Modifier.heightIn(min = DesignTokens.space48.dp).clip(RoundedCornerShape(DesignTokens.radius16.dp)), contentPadding = PaddingValues(DesignTokens.space12.dp))
}
@Composable private fun FeedTextAction(label: String, enabled: Boolean = true, icon: Int? = null, action: () -> Unit) {
    TextButton(onClick = action, enabled = enabled, modifier = Modifier.heightIn(min = feedTouch), shape = feedPill, contentPadding = PaddingValues(horizontal = DesignTokens.space12.dp, vertical = feedGap)) {
        if (icon != null) { Icon(painterResource(icon), null, Modifier.size(DesignTokens.space16.dp)); Spacer(Modifier.width(feedGap)) }
        Text(label, fontSize = DesignTokens.font16.sp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun FeedInsight(row: JSONObject, report: JSONObject, feed: NativeFeedModel) {
    val sources = report.optJSONArray("sources")?.objects().orEmpty()
    val visible = sources.filter { it.stringOrEmpty("artifactId").isEmpty() } + sources.filter { it.stringOrEmpty("artifactId").isNotEmpty() }.take(3)
    val rest = sources.filter { it !in visible }
    var more by remember(row.optString("id")) { mutableStateOf(false) }
    fun open(source: JSONObject) { feed.action(row, JSONObject().put("kind", if (source.stringOrEmpty("artifactId").isNotEmpty()) "view_library" else "open_chat").put("target", if (source.stringOrEmpty("artifactId").isNotEmpty()) JSONObject().put("id", source.getString("artifactId")) else source.optJSONObject("source") ?: source)) }
    Column(Modifier.fillMaxWidth().padding(start = feedGap, end = feedGap, top = feedGap)) {
        Text(report.optString("text"), Modifier.padding(bottom = DesignTokens.space16.dp), fontSize = DesignTokens.font16.sp, lineHeight = (DesignTokens.font16 * 1.65f).sp)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(feedGap), verticalArrangement = Arrangement.spacedBy(feedGap)) {
            visible.forEach { source -> FeedTextAction(source.optString("title", "查看来源"), !feed.busy, if (source.stringOrEmpty("artifactId").isNotEmpty()) R.drawable.wm_file else R.drawable.wm_chat) { open(source) } }
            if (rest.isNotEmpty()) Box {
                FeedTextAction("更多来源（${rest.size}）", !feed.busy) { more = true }
                FeedMenu(more, { more = false }) { rest.forEach { source -> FeedMenuItem(source.optString("title", "查看来源"), !feed.busy) { more = false; open(source) } } }
            }
        }
    }
}

@Composable private fun FeedDigest(row: JSONObject, report: JSONObject, feed: NativeFeedModel) {
    Column(Modifier.fillMaxWidth().padding(start = feedGap, end = feedGap, top = DesignTokens.space16.dp)) {
        Text("${feedReportDate(report.optString("from"), report.optString("timeZone", feed.timeZone))} — ${feedReportDate(report.optString("to"), report.optString("timeZone", feed.timeZone))}", fontSize = DesignTokens.font16.sp, lineHeight = feedBodyLeading, color = MaterialTheme.colorScheme.onSurfaceVariant)
        report.optJSONArray("added")?.objects().orEmpty().groupBy { it.optString("topic") }.forEach { (topic, values) ->
            if (topic.isNotEmpty()) FeedDigestHeading(topic)
            values.forEach { FeedMemory(row, it, false, feed) }
        }
        if (report.optInt("moreCount") > 0) FeedTextAction("还有 ${report.optInt("moreCount")} 条", !feed.busy) {
            feed.action(row, JSONObject().put("kind", "view_memory").put("target", JSONObject().put("from", report.optString("from")).put("to", report.optString("to"))))
        }
        for ((key, label) in listOf("corrected" to "这一周更正过的", "review" to "这些很久没用到了，还对吗？")) {
            val values = report.optJSONArray(key)?.objects().orEmpty()
            if (values.isNotEmpty()) FeedDigestHeading(label)
            values.forEach { FeedMemory(row, it, key == "review", feed) }
        }
    }
}
@Composable private fun FeedDigestHeading(label: String) {
    Text(label, Modifier.padding(top = DesignTokens.space24.dp, bottom = feedGap), fontSize = DesignTokens.font14.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
@Composable private fun FeedMemory(row: JSONObject, value: JSONObject, review: Boolean, feed: NativeFeedModel) {
    val status = value.optString("status")
    val disabled = status in listOf("forgotten", "unavailable")
    var menu by remember(value.optString("id")) { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(vertical = feedGap), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(feedGap)) {
        Column(Modifier.weight(1f)) {
            Row(Modifier.fillMaxWidth().heightIn(min = feedTouch).clip(feedPill).clickable(enabled = !disabled && !feed.busy) { feed.openMemoryItem(row, value) }.padding(feedGap), horizontalArrangement = Arrangement.spacedBy(DesignTokens.space12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(painterResource(R.drawable.wm_memory), null, Modifier.size(DesignTokens.space16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(if (status == "forgotten") "已忘掉" else if (status == "unavailable") value.optString("statusLabel", "当前不可用") else value.optString("text"), fontSize = DesignTokens.font16.sp, lineHeight = feedBodyLeading, color = if (disabled) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
            }
            if (review || status in listOf("confirmed", "corrected")) {
                val note = when (status) { "confirmed" -> "已确认，90 天内不再询问"; "corrected" -> "已更正"; else -> value.stringOrEmpty("reviewReason") }
                if (note.isNotEmpty()) Text(note, Modifier.padding(start = DesignTokens.space32.dp), fontSize = DesignTokens.font12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (review && status in listOf("current", "corrected")) FeedTextAction("还对", !feed.busy) { feed.confirmMemory(row, value) }
        if (!disabled) Box {
            NativeIconButton(R.drawable.wm_more, "记忆操作 ${value.optString("text")}", enabled = !feed.busy, compact = true) { menu = true }
            FeedMenu(menu, { menu = false }) {
                FeedMenuItem("不对，改一下", !feed.busy && value.optString("kind") != "entity") { menu = false; feed.openMemoryItem(row, value, "correct") }
                FeedMenuItem("忘掉", !feed.busy, danger = true) { menu = false; feed.openMemoryItem(row, value, "delete") }
            }
        }
    }
}

@Composable private fun FeedSkeleton() {
    Column(Modifier.fillMaxWidth().semantics { contentDescription = "正在读取动态" }, verticalArrangement = Arrangement.spacedBy(DesignTokens.space16.dp)) {
        repeat(4) { Column(Modifier.fillMaxWidth().padding(vertical = DesignTokens.space24.dp), verticalArrangement = Arrangement.spacedBy(feedGap)) {
            Box(Modifier.fillMaxWidth(.6f).height(DesignTokens.space20.dp).background(MaterialTheme.colorScheme.surfaceVariant))
            Box(Modifier.fillMaxWidth().height(DesignTokens.space14.dp).background(MaterialTheme.colorScheme.surfaceVariant))
            Box(Modifier.fillMaxWidth(.3f).height(DesignTokens.space12.dp).background(MaterialTheme.colorScheme.surfaceVariant))
        } }
    }
}
@Composable private fun FeedEmpty(icon: Int, message: String, action: String? = null, onAction: () -> Unit = {}) {
    Column(Modifier.fillMaxWidth().padding(vertical = DesignTokens.space48.dp), verticalArrangement = Arrangement.spacedBy(DesignTokens.space16.dp)) {
        Icon(painterResource(icon), null, Modifier.size(DesignTokens.space24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(message, fontSize = DesignTokens.font16.sp, lineHeight = feedBodyLeading, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (action != null) FeedTextAction(action, action = onAction)
    }
}
