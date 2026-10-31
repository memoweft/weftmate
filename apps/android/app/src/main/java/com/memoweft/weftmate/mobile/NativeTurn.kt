package com.memoweft.weftmate.mobile

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.ScrollableState
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

private fun answerText(row: JSONObject) = row.optString("type") in setOf("assistant.delta", "assistant.message") && row.optJSONObject("data")?.optString("text").orEmpty().isNotBlank()

/** The shared mapper puts a finished turn's progress after its reply; within each turn, steps go above the first answer text (D124). */
internal fun nativeTurnRows(rows: List<JSONObject>): List<JSONObject> {
    val result = mutableListOf<JSONObject>()
    val turn = mutableListOf<JSONObject>()
    fun flush() {
        val steps = turn.filter { it.optString("type") == "native.progress" }
        val rest = turn - steps.toSet()
        val answer = rest.indexOfFirst(::answerText)
        result += if (answer < 0) turn else rest.take(answer) + steps + rest.drop(answer)
        turn.clear()
    }
    for (row in rows) { if (row.optString("type") == "user.message") flush(); turn += row }
    flush()
    return result
}

/** Progress rows whose own turn already shows answer text; the next user message starts a new turn. */
internal fun answeredProgress(rows: List<JSONObject>): Set<String> {
    val answered = mutableSetOf<String>()
    val open = mutableListOf<String>()
    for (row in rows) when (row.optString("type")) {
        "user.message" -> open.clear()
        "native.progress" -> open += row.optString("eventId")
        "assistant.delta", "assistant.message" -> if (answerText(row)) { answered += open; open.clear() }
    }
    return answered
}

internal enum class StepLayout { Flat, Folded }

/** Steps stay in view while the turn works; once text arrives or the turn ends, two or more fold into one row. */
internal fun stepLayout(steps: Int, running: Boolean, answered: Boolean) =
    if (steps >= 2 && (answered || !running)) StepLayout.Folded else StepLayout.Flat

/** A drag hands scrolling to the reader; only coming to rest at the end hands it back. */
@Stable internal class FollowBottom {
    var on by mutableStateOf(true)
    internal var pending = false
    fun pause() { on = false; pending = false }
    fun resume() { on = true; pending = false }
}

@Composable internal fun rememberFollowBottom(scroll: ScrollableState, interaction: InteractionSource, key: Any?): FollowBottom {
    val follow = remember(key) { FollowBottom() }
    val dragged by interaction.collectIsDraggedAsState()
    LaunchedEffect(follow, dragged) { if (dragged) { follow.on = false; follow.pending = true } }
    LaunchedEffect(follow, scroll) {
        snapshotFlow { scroll.isScrollInProgress }.collect { moving ->
            if (!moving && follow.pending) { follow.on = !scroll.canScrollForward; follow.pending = false }
        }
    }
    return follow
}

@Composable internal fun NativeProgress(row: JSONObject, state: NativeProgressState, answered: Boolean) {
    val data = row.getJSONObject("data")
    val key = row.getString("eventId")
    val steps = data.optJSONArray("steps")?.objects().orEmpty()
    val running = data.optBoolean("running")
    val color = if (data.optBoolean("failed")) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
    val card = RoundedCornerShape(DesignTokens.radiuscard.dp)
    var expanded by remember(key) { mutableStateOf(state.isExpanded(key)) }
    Column(Modifier.fillMaxWidth().animateContentSize(tween(DesignTokens.durationBase.toInt())), verticalArrangement = Arrangement.spacedBy(DesignTokens.space2.dp)) {
        if (steps.isEmpty()) {
            Row(Modifier.heightIn(min = DesignTokens.space44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.space8.dp)) {
                if (running) CircularProgressIndicator(Modifier.size(DesignTokens.space16.dp), color = color, strokeWidth = DesignTokens.space1.dp)
                Text(data.optString("summary"), fontSize = DesignTokens.font13.sp, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        } else if (stepLayout(steps.size, running, answered) == StepLayout.Flat) {
            steps.forEach { NativeStepRow(key, it, color) }
        } else {
            Row(Modifier.fillMaxWidth().clip(card).clickable(role = Role.Button) { state.toggle(key); expanded = state.isExpanded(key) }
                .heightIn(min = DesignTokens.space44.dp)
                .semantics { contentDescription = if (expanded) "收起回复进展" else "展开回复进展"; stateDescription = if (expanded) "已展开" else "已收起" },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.space8.dp)) {
                if (running) CircularProgressIndicator(Modifier.size(DesignTokens.space16.dp), color = color, strokeWidth = DesignTokens.space1.dp)
                else Icon(painterResource(if (data.optBoolean("failed")) R.drawable.wm_warning else R.drawable.wm_check), null, Modifier.size(DesignTokens.space16.dp), tint = color)
                Text("${steps.size} 个步骤", fontSize = DesignTokens.font13.sp, color = color)
                Text(data.optString("summary"), Modifier.weight(1f), fontSize = DesignTokens.font13.sp, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Icon(painterResource(if (expanded) R.drawable.wm_down else R.drawable.wm_right), null, Modifier.size(DesignTokens.space16.dp), tint = color)
            }
            val visible = state.visibleSteps(row)
            if (visible.isNotEmpty()) Column(Modifier.fillMaxWidth().clip(card).border(DesignTokens.space1.dp, MaterialTheme.colorScheme.outline, card)
                .padding(horizontal = DesignTokens.space12.dp, vertical = DesignTokens.space4.dp)) {
                visible.forEach { NativeStepRow(key, it, color) }
            }
        }
    }
}

@Composable private fun NativeStepRow(rowKey: String, step: JSONObject, color: androidx.compose.ui.graphics.Color) {
    val attention = step.optBoolean("attention")
    val stepRunning = step.optString("statusText") == "运行中" || step.optString("statusText") == "Running"
    var detail by remember(rowKey, step.optString("stepId")) { mutableStateOf(attention && step.optString("approvalStatus") != "pending") }
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(DesignTokens.radiuscontrol.dp)).clickable(role = Role.Button) { detail = !detail }.heightIn(min = DesignTokens.space44.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.space8.dp)) {
            val tint = if (attention) MaterialTheme.colorScheme.error else color
            if (stepRunning) CircularProgressIndicator(Modifier.size(DesignTokens.space16.dp), color = tint, strokeWidth = DesignTokens.space1.dp)
            else Icon(painterResource(if (attention) R.drawable.wm_warning else R.drawable.wm_check), null, Modifier.size(DesignTokens.space16.dp), tint = tint)
            Text(listOf(step.optString("summary"), step.optString("statusText"), step.optString("approvalText")).filter { it.isNotBlank() }.joinToString(" · "),
                Modifier.weight(1f), fontSize = DesignTokens.font13.sp, color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(painterResource(if (detail) R.drawable.wm_down else R.drawable.wm_right), if (detail) "收起步骤详情" else "展开步骤详情", Modifier.size(DesignTokens.space16.dp), tint = tint)
        }
        if (detail) NativeFollowText(step.optString("toolName") + step.opt("arguments")?.let { "\n$it" }.orEmpty(), color)
    }
}

/** Long step output scrolls inside its own box and follows new text by the same rule as the list. */
@Composable private fun NativeFollowText(text: String, color: androidx.compose.ui.graphics.Color) {
    val scroll = rememberScrollState()
    val follow = rememberFollowBottom(scroll, scroll.interactionSource, Unit)
    LaunchedEffect(text) { if (follow.on) scroll.scrollTo(scroll.maxValue) }
    Box(Modifier.fillMaxWidth().heightIn(max = DesignTokens.space220.dp).verticalScroll(scroll).padding(start = DesignTokens.space24.dp, bottom = DesignTokens.space8.dp)) {
        SelectionContainer { Text(text, fontSize = DesignTokens.font13.sp, color = color) }
    }
}
