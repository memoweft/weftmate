package com.memoweft.weftmate.mobile

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.layout.layout
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.LocalDate


/** The conversation drawer: one activity window, so the panel runs through the system safe area. */
@Composable internal fun NativeDrawer(m: NativeChatModel, settings: NativeSettingsModel, onClose: () -> Unit) {
    val work = m.workAndChat && m.sidebarMode == "work"
    Row(Modifier.fillMaxSize().semantics { paneTitle = "对话"; isTraversalGroup = true }) {
        Column(
            Modifier.fillMaxHeight().fillMaxWidth(0.88f)
                .nativeFrost(RoundedCornerShape(DesignTokens.radius16.dp), floating = true)
                .systemBarsPadding()
        ) {
            Row(Modifier.fillMaxWidth().padding(nativePad), verticalAlignment = Alignment.CenterVertically) {
                Text("对话", Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = DesignTokens.font18.sp)
                NativeIconButton(R.drawable.wm_close, "关闭侧栏") { onClose() }
            }
            if (m.workAndChat) NativeConversationModes(m)
            FeedControlButton(if (work) "新建工作" else "新建对话", icon = R.drawable.wm_plus, modifier = Modifier.padding(horizontal = DesignTokens.space20.dp)) {
                onClose(); m.newChat()
            }
            LazyColumn(
                Modifier.fillMaxWidth().weight(1f),
                contentPadding = PaddingValues(horizontal = DesignTokens.space20.dp, vertical = nativeGap),
                verticalArrangement = Arrangement.spacedBy(DesignTokens.space4.dp),
            ) {
                if (!m.workAndChat && !m.standalone) item {
                    NativeSidebarRow("小纬", selected = m.chats.none { it.optString("id", it.optString("chatId")) == m.chatId }, icon = R.drawable.wm_chat) {
                        onClose(); m.launch { m.select(m.business("/chats/main").getJSONObject("chat")); m.tab = "chat" }
                    }
                }
                val groups = if (work) m.visibleChats.groupBy {
                    it.optJSONObject("workDirectory")?.stringOrEmpty("name")?.ifEmpty { null }
                        ?: m.projects.find { p -> p.stringOrEmpty("projectId") == it.stringOrEmpty("projectId") }?.stringOrEmpty("name")?.ifEmpty { null }
                        ?: "选择项目或文件夹"
                } else linkedMapOf("" to m.visibleChats)
                for ((group, entries) in groups) {
                    if (group.isNotEmpty()) item {
                        Text(group, Modifier.padding(top = DesignTokens.space12.dp, bottom = DesignTokens.space4.dp), fontSize = DesignTokens.font12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    items(entries) { row ->
                        NativeSidebarRow(hostChatTitle(row), selected = row.optString("id", row.optString("chatId")) == m.chatId,
                            subtitle = if (row.optBoolean("computerOffline")) "电脑不在线" else null) {
                            onClose(); m.launch { m.select(row); m.tab = "chat" }
                        }
                    }
                }
                if (m.visibleChats.isEmpty()) item {
                    Text(if (m.sidebarMode == "work") "还没有工作，选好文件夹就能开始。" else "从新对话开始聊聊。", fontSize = DesignTokens.font13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                item { Spacer(Modifier.height(nativePad)) }
                item { NativeSidebarRow("全部对话", subtitle = "搜索、置顶与归档", icon = R.drawable.wm_chat) { onClose(); m.tab = "chats" } }
                item { NativeSidebarRow("设置", icon = R.drawable.wm_settings) { onClose(); settings.open() } }
            }
        }
        Spacer(Modifier.weight(1f).fillMaxHeight().background(MaterialTheme.colorScheme.scrim).clickable { onClose() })
    }
}

@Composable internal fun NativeSidebarRow(label: String, selected: Boolean = false, subtitle: String? = null, icon: Int? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .heightIn(min = if (icon == R.drawable.wm_chat && subtitle == null) DesignTokens.space56.dp else nativeTouch)
            .clip(RoundedCornerShape(DesignTokens.radius10.dp))
            .background(if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
            .semantics { this.selected = selected }
            .clickable(onClick = onClick)
            .padding(horizontal = nativeGap, vertical = DesignTokens.space10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(nativeGap),
    ) {
        icon?.let { Icon(painterResource(it), null, Modifier.size(DesignTokens.iconTouch.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
        Column(Modifier.weight(1f)) {
            Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = DesignTokens.font14.sp)
            subtitle?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = DesignTokens.font12.sp) }
        }
    }
}
