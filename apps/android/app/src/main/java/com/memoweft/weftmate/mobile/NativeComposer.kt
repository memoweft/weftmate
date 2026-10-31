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

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun NativeComposer(m:NativeChatModel,settings:NativeSettingsModel,onPreview:(JSONObject)->Unit) {
    var plus by remember{mutableStateOf(false)};var modeMenu by remember{mutableStateOf(false)};var allowRisk by remember{mutableStateOf(false)}
    androidx.activity.compose.BackHandler(plus || modeMenu || allowRisk) { plus=false;modeMenu=false;allowRisk=false }
    var editorFocused by remember { mutableStateOf(false) }
    // Visibility drives the shape; only explicit navigation/list actions blur.
    // A language/voice panel transition must keep the composing session alive.
    val expanded=m.composer.copy(focused=editorFocused && WindowInsets.isImeVisible).height!=ComposerHeight.Capsule
    val inputFocus=remember { FocusRequester() }
    SideEffect {settings.restoreComposer={inputFocus.requestFocus()}}
    DisposableEffect(settings){onDispose{settings.restoreComposer=null}}
    val keyboard=LocalSoftwareKeyboardController.current
    val context=LocalContext.current
    fun voice() {
        inputFocus.requestFocus();keyboard?.show()
        android.widget.Toast.makeText(context,"请使用键盘上的语音输入",android.widget.Toast.LENGTH_SHORT).show()
    }
    Column(Modifier.fillMaxWidth().semantics{contentDescription="聊天输入区"}.padding(horizontal=DesignTokens.space12.dp,vertical=DesignTokens.space8.dp).nativeFrost(if(expanded)RoundedCornerShape(DesignTokens.radius24.dp) else nativePill).animateContentSize(tween(if(settings.home.optBoolean("reducedMotion"))DesignTokens.durationReduced.toInt() else DesignTokens.durationFast.toInt()),alignment=Alignment.BottomStart).padding(if(expanded)nativeGap else DesignTokens.space4.dp)) {
        if(m.attachments.isNotEmpty())NativeAttachments(m.attachments,true,{onPreview(JSONObject(it.toString()).put("conversationId",m.chatId).put("sessionId",m.sessionId))},m::remove)
        val input:@Composable ()->Unit={BasicTextField(m.draft,onValueChange=m::edit,enabled=!m.workComputerBusy,modifier=Modifier.fillMaxWidth().heightIn(min=if(expanded)DesignTokens.space64.dp else nativeTouch,max=DesignTokens.space150.dp).focusRequester(inputFocus).onFocusChanged{editorFocused=it.isFocused;m.focused=it.isFocused}.padding(if(expanded)nativeGap else DesignTokens.space4.dp).semantics{contentDescription="消息输入"},textStyle=TextStyle(color=MaterialTheme.colorScheme.onSurface,fontSize=LocalReadingSize.current.sp,lineHeight=(LocalReadingSize.current * 1.5f).sp),cursorBrush=SolidColor(MaterialTheme.colorScheme.primary),maxLines=5,decorationBox={inner->Box{if(m.draft.isEmpty())Text(if(m.running)"可以继续补充…" else "说说你的目标…",color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=LocalReadingSize.current.sp);inner()}})}
        NativeComposerLayout(expanded,input,leading={
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)) {
            Box{NativeIconButton(R.drawable.wm_plus,"添加附件",enabled=!m.standalone && !m.phoneArchive && !m.newWork){plus=true};NativeMenu(plus,keepEditorFocus=true,onDismissRequest={plus=false}){listOf("image" to "照片","camera" to "拍照","file" to "文件").forEach{(kind,label)->NativeMenuItem(text={Text(label)},leadingIcon={Icon(painterResource(when(kind){"image"->R.drawable.wm_image;"camera"->R.drawable.wm_camera;else->R.drawable.wm_file}),null,Modifier.size(DesignTokens.iconTouch.dp))},onClick={plus=false;m.pick(kind)})}}}
            if(expanded) {
                Box{NativeIconButton(R.drawable.wm_approval,"审批方式：${modeName(m.mode)}",enabled=!m.standalone && !m.phoneArchive && !m.approvalModeBusy){modeMenu=true};NativeMenu(modeMenu || allowRisk,keepEditorFocus=true,onDismissRequest={modeMenu=false;allowRisk=false}){if(allowRisk){Text("删除、覆盖、系统修改、安装、发送和付款可能直接执行，且无法撤销。",Modifier.widthIn(max=DesignTokens.space150.dp*2).padding(nativePad));NativeMenuItem(text={Text("全部允许")},onClick={allowRisk=false;m.setApprovalMode("allow-all")});NativeMenuItem(text={Text("取消")},onClick={allowRisk=false})}else listOf("auto","ask","accept-edits","plan","allow-all").forEach{id->NativeMenuItem(text={Text(modeName(id))},trailingIcon={if(m.mode==id)Icon(painterResource(R.drawable.wm_check),"当前模式",Modifier.size(DesignTokens.iconTouch.dp))},onClick={modeMenu=false;if(id=="allow-all")allowRisk=true else m.setApprovalMode(id)})}}}
                NativeIconButton(R.drawable.wm_model,"模型：${m.modelLabel}"){settings.menuVisible=true;settings.menuOpened()}
            }
        }
        },trailing={
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)) {
            val action=m.composer.action
            if(expanded && action==ComposerAction.Send) NativeIconButton(R.drawable.wm_mic,"语音补充草稿",enabled=!m.running){voice()}
            NativeIconButton(when(action){ComposerAction.Voice->R.drawable.wm_mic;ComposerAction.Send->R.drawable.wm_arrow;ComposerAction.Stop->R.drawable.wm_stop},when(action){ComposerAction.Voice->"语音输入";ComposerAction.Send->"发送消息";ComposerAction.Stop->"停止回复"},solid=true,enabled=if(action==ComposerAction.Voice)!m.running && !m.loading else action==ComposerAction.Stop || m.canSend && !m.submitting && !m.workBusy){when(action){ComposerAction.Send->m.send();ComposerAction.Stop->m.stop();ComposerAction.Voice->voice()}}
        }
        })
    }
}
internal fun modeName(id:String)=mapOf("auto" to "自动","ask" to "每次询问","accept-edits" to "接受文件修改","plan" to "先出计划","allow-all" to "全部允许")[id] ?: "自动"
