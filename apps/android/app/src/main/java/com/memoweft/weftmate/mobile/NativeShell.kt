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

private val tabs = listOf("chat" to ("聊天" to R.drawable.wm_chat), "activity" to ("动态" to R.drawable.wm_bell), "health" to ("健康" to R.drawable.wm_heart), "goals" to ("目标" to R.drawable.wm_goal), "library" to ("成果库" to R.drawable.wm_folder))

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable internal fun NativeShell(m: NativeChatModel, activity: NativeActivity) {
    // Observe the route here; a forwarded theme lambda must also change when navigation changes.
    val selectedTab=m.tab
    val settings=activity.settings
    LaunchedEffect(m.owner,m.loggedIn) { settings.reset() }
    val signedIn=m.loggedIn
    val account=m.owner
    var overflow by remember { mutableStateOf(false) }
    var preview by remember(account,signedIn) { mutableStateOf<JSONObject?>(null) }
    val showOverflow=overflow
    val openedFile=preview
    NativeTheme(m.dark) {
      val contentLayer=rememberGraphicsLayer()
      val frost=remember(contentLayer) { NativeFrost(contentLayer) }
      val dockHeight=remember { mutableIntStateOf(0) }
      val density=LocalDensity.current
      LaunchedEffect(signedIn,account) { activity.feed.prepare() }
      LaunchedEffect(signedIn,account) { activity.goals.prepare() }
      LaunchedEffect(signedIn,account) { activity.health.prepare() }
        if(!signedIn) {
            AndroidView(factory={ activity.webPage("login", false) },onRelease={activity.parkWeb()},modifier=Modifier.fillMaxSize())
            return@NativeTheme
        }
      CompositionLocalProvider(LocalNativeFrost provides if(selectedTab in listOf("chat","library","activity","goals","health"))frost else null,LocalReadingSize provides m.textSize,LocalCodeSize provides m.codeSize) {
        if(selectedTab=="library-web") {
            AndroidView(factory={activity.originalLibraryPage()},onRelease={activity.parkWeb()},
                modifier=Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).windowInsetsPadding(WindowInsets.systemBars))
            return@CompositionLocalProvider
        }
        val focus=LocalFocusManager.current
        var drawer by remember { mutableStateOf(false) }
        androidx.activity.compose.BackHandler(showOverflow) { overflow=false }
        SideEffect { activity.overlayBack=if(drawer) ({drawer=false}) else settings.confirmation?.dismiss }
        DisposableEffect(activity) { onDispose { activity.overlayBack=null } }
        val paneAlpha=remember { Animatable(1f) }
        LaunchedEffect(selectedTab) { paneAlpha.snapTo(.8f);paneAlpha.animateTo(1f,tween(if(settings.home.optBoolean("reducedMotion"))DesignTokens.durationReduced.toInt() else DesignTokens.durationFast.toInt())) }
        LaunchedEffect(m.dark) { activity.reportRenderedSystemBars(m.dark) }
        val imeInsets=WindowInsets.ime
        val imeTarget=WindowInsets.imeAnimationTarget
        LaunchedEffect(m) {
            snapshotFlow { imeInsets.getBottom(density) to imeTarget.getBottom(density) }.collect { (current,target) ->
                frost.keyboardAnimating=current!=target
            }
        }
        LaunchedEffect(selectedTab) {if(selectedTab=="models" && settings.page!="models")settings.open("models");if(selectedTab!="chat")settings.menuVisible=false}
        LaunchedEffect(selectedTab,openedFile) { if(selectedTab!="chat" || openedFile!=null) { focus.clearFocus();m.focused=false;activity.hideKeyboard() } }
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).windowInsetsPadding(WindowInsets.systemBars).then(if(android.os.Build.VERSION.SDK_INT>=30)Modifier.imePadding() else Modifier.windowInsetsPadding(WindowInsets.imeAnimationTarget)).then(if(drawer||settings.confirmation!=null)Modifier.clearAndSetSemantics{} else Modifier)) {
          if(selectedTab=="chat") NativeConversation(m,Modifier.fillMaxSize().frostSource(frost).alpha(paneAlpha.value),bottom={with(density){dockHeight.intValue.toDp()}},onPreview={preview=it})
          Column(Modifier.fillMaxSize()) {
            if(selectedTab in listOf("settings","models")) NativeSettingsToolbar(settings)
            else if(selectedTab=="activity" || selectedTab=="activity-web") NativeFeedToolbar(activity.feed,
                back={if(selectedTab=="activity-web")activity.feed.closeWeb() else activity.feed.closeDetail()},
                onDrawer={focus.clearFocus();activity.hideKeyboard();m.focused=false;drawer=true;m.launch{m.refreshChats()}},
                onSettings={focus.clearFocus();settings.open()})
            else if(selectedTab in listOf("goals","goals-web")) NativeGoalsToolbar(activity.goals,
                onDrawer={focus.clearFocus();activity.hideKeyboard();m.focused=false;drawer=true;m.launch{m.refreshChats()}},
                onSettings={focus.clearFocus();settings.open()})
            else if(selectedTab in listOf("health","health-web")) NativeHealthToolbar(activity.health,
                onDrawer={focus.clearFocus();activity.hideKeyboard();m.focused=false;drawer=true;m.launch{m.refreshChats()}},
                onSettings={focus.clearFocus();settings.open()})
            else Row(Modifier.fillMaxWidth().height(DesignTokens.space80.dp).background(MaterialTheme.colorScheme.background).padding(DesignTokens.space12.dp),verticalAlignment=Alignment.CenterVertically) {
                NativeIconButton(if(selectedTab in listOf("settings","models","chats")) R.drawable.wm_back else R.drawable.wm_panel,if(selectedTab in listOf("settings","models","chats"))"返回聊天" else "打开侧栏",Modifier.nativeFrost(CircleShape)) { if(selectedTab in listOf("settings","models","chats"))m.returnToChat() else { focus.clearFocus();activity.hideKeyboard();m.focused=false;drawer=true;m.launch { m.refreshChats() } } }
                Column(Modifier.weight(1f),horizontalAlignment=Alignment.CenterHorizontally) {
                    Text(if(selectedTab=="chat" || selectedTab=="web-chat")m.title else if(selectedTab=="models")"模型" else if(selectedTab=="web-home")"对话" else if(selectedTab=="chats")"全部对话" else if(selectedTab=="help")"帮助" else tabs.find{it.first==selectedTab}?.second?.first ?: "设置",fontSize=DesignTokens.font17.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
                    if(selectedTab=="chat") Text(m.subtitle,fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis)
                }
                Box {
                    NativeIconButton(R.drawable.wm_more,"更多",Modifier.nativeFrost(CircleShape)){overflow=true;m.refreshOfflineWorkAvailability()}
                    NativeMenu(expanded=showOverflow,keepEditorFocus=true,onDismissRequest={overflow=false}) {
                        if(m.running && selectedTab!="library") NativeMenuItem(text={Text("停止回复")},onClick={overflow=false;m.stop()},leadingIcon={Icon(painterResource(R.drawable.wm_stop),null)})
                        NativeMenuItem(text={Text("设置")},onClick={overflow=false;focus.clearFocus();settings.open()},leadingIcon={Icon(painterResource(R.drawable.wm_settings),null)})
                        if(selectedTab=="library")NativeMenuItem(text={Text("打开原网页成果库")},onClick={overflow=false;activity.originalLibrary()},leadingIcon={Icon(painterResource(R.drawable.wm_layers),null)})
                        if(selectedTab!="library")NativeMenuItem(text={Text(if(m.workAndChat && m.sidebarMode=="work")"新建工作" else "新建对话")},onClick={overflow=false;focus.clearFocus();activity.hideKeyboard();m.focused=false;m.newChat()},leadingIcon={Icon(painterResource(R.drawable.wm_plus),null)})
                        if(selectedTab!="library")NativeMenuItem(text={Text("完整对话功能")},onClick={overflow=false;m.tab="web-chat"},leadingIcon={Icon(painterResource(R.drawable.wm_chat),null)})
                        if(selectedTab=="chat"&&!m.connected&&m.offlineWorkReady)NativeMenuItem(text={Text("交给电脑，上线后做")},onClick={overflow=false;m.openOfflineWork()},leadingIcon={Icon(painterResource(R.drawable.wm_clock),null)})
                    }
                }
            }
            if(selectedTab=="chat") {
                Spacer(Modifier.weight(1f))
            } else if(selectedTab=="chats") {
                NativeChatList(m,Modifier.weight(1f).fillMaxWidth().alpha(paneAlpha.value))
            } else if(selectedTab=="library") {
                NativeLibrary(m,activity,Modifier.weight(1f).fillMaxWidth().frostSource(frost).alpha(paneAlpha.value),onPreview={preview=it})
            } else if(selectedTab=="activity") {
                NativeFeedPage(activity.feed,Modifier.weight(1f).alpha(paneAlpha.value))
            } else if(selectedTab=="activity-web") {
                NativeFeedWeb(activity.feed,activity,Modifier.weight(1f).fillMaxWidth().alpha(paneAlpha.value))
            } else if(selectedTab=="goals") {
                NativeGoalsPage(activity.goals,Modifier.weight(1f).alpha(paneAlpha.value))
            } else if(selectedTab=="goals-web") {
                NativeGoalsWeb(activity.goals,activity,Modifier.weight(1f).fillMaxWidth())
            } else if(selectedTab in listOf("settings","models")) {
                NativeSettingsPage(settings,Modifier.weight(1f))
            } else if(selectedTab=="health") {
                NativeHealthPage(activity.health,Modifier.weight(1f).alpha(paneAlpha.value))
            } else if(selectedTab=="health-web") {
                NativeHealthWeb(activity.health,activity,Modifier.weight(1f).fillMaxWidth())
            } else {
                key(selectedTab) { AndroidView(factory={ activity.webPage(if(selectedTab=="web-chat")"chat" else if(selectedTab=="web-home")"home" else selectedTab) },onRelease={activity.parkWeb()},modifier=Modifier.weight(1f).fillMaxWidth().alpha(paneAlpha.value)) }
            }
            Column(Modifier.onSizeChanged{dockHeight.intValue=it.height}) {
            if(selectedTab=="chat") {
                if(m.workAndChat && m.conversationMode=="work")NativeWorkSelection(m)
                NativeComposer(m,settings,onPreview={preview=it})
            }
            if(selectedTab !in listOf("settings","models")) {
                Row(Modifier.fillMaxWidth().keyboardNavigation().padding(start=DesignTokens.space12.dp,end=DesignTokens.space12.dp,top=DesignTokens.space4.dp,bottom=DesignTokens.space12.dp).nativeFrost(nativePill).padding(horizontal=DesignTokens.space12.dp,vertical=DesignTokens.space4.dp),horizontalArrangement=Arrangement.SpaceEvenly) {
                    tabs.forEach{(id,v)->Box(Modifier.weight(1f),contentAlignment=Alignment.Center){
                        val active=selectedTab==id || id=="chat"&&selectedTab=="chats" || id=="activity"&&selectedTab=="activity-web" || id=="goals"&&selectedTab=="goals-web" || id=="health"&&selectedTab=="health-web"
                        NativeIconButton(v.second,v.first,Modifier.semantics{selected=active},selected=active){focus.clearFocus();m.focused=false;m.tab=id}
                        if(id=="activity" && activity.feed.unread>0)Box(Modifier.align(Alignment.TopEnd).padding(DesignTokens.space4.dp).size(DesignTokens.space8.dp).background(MaterialTheme.colorScheme.primary,CircleShape).semantics{contentDescription="${activity.feed.unread} 条动态未读"})
                    }}
                }
            }
        }
          }
        }
        LaunchedEffect(settings.confirmation){if(settings.confirmation!=null){focus.clearFocus();activity.hideKeyboard()}}
        settings.confirmation?.let{NativeSettingsConfirmationOverlay(it)}
        if(selectedTab=="chat" && settings.menuVisible) NativeModelServiceOverlay(settings,with(density){dockHeight.intValue.toDp()})
        // One activity window lets the panel continue through the system safe area.
        if(drawer) {
            Row(Modifier.fillMaxSize().semantics { paneTitle="对话";isTraversalGroup=true }) {
            Column(Modifier.fillMaxHeight().fillMaxWidth(0.88f).nativeFrost(RoundedCornerShape(DesignTokens.radius16.dp),floating=true).systemBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(nativePad),verticalAlignment=Alignment.CenterVertically) { Text("对话",Modifier.weight(1f),fontWeight=FontWeight.SemiBold,fontSize=DesignTokens.font18.sp);NativeIconButton(R.drawable.wm_close,"关闭侧栏"){drawer=false} }
            if(m.workAndChat)NativeConversationModes(m)
            FeedControlButton(if(m.workAndChat && m.sidebarMode=="work")"新建工作" else "新建对话",icon=R.drawable.wm_plus,modifier=Modifier.padding(horizontal=DesignTokens.space20.dp)){drawer=false;m.newChat()}
            LazyColumn(Modifier.fillMaxWidth().weight(1f),contentPadding=PaddingValues(horizontal=DesignTokens.space20.dp,vertical=nativeGap),verticalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)) {
                if(!m.workAndChat && !m.standalone) item { NativeSidebarRow("小纬",selected=m.chats.none{it.optString("id",it.optString("chatId"))==m.chatId},icon=R.drawable.wm_chat){drawer=false;m.launch { m.select(m.business("/chats/main").getJSONObject("chat"));m.tab="chat" }} }
                val groups=if(m.workAndChat && m.sidebarMode=="work")m.visibleChats.groupBy{it.optJSONObject("workDirectory")?.stringOrEmpty("name")?.ifEmpty{null} ?: m.projects.find{p->p.stringOrEmpty("projectId")==it.stringOrEmpty("projectId")}?.stringOrEmpty("name")?.ifEmpty{null} ?: "选择项目或文件夹"} else linkedMapOf("" to m.visibleChats)
                for((group,entries) in groups) {
                    if(group.isNotEmpty())item{Text(group,Modifier.padding(top=DesignTokens.space12.dp,bottom=DesignTokens.space4.dp),fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                    items(entries){row->NativeSidebarRow(hostChatTitle(row),selected=row.optString("id",row.optString("chatId"))==m.chatId,subtitle=if(row.optBoolean("computerOffline"))"电脑不在线" else null){drawer=false;m.launch{m.select(row);m.tab="chat"}}}
                }
                if(m.visibleChats.isEmpty())item{Text(if(m.sidebarMode=="work")"还没有工作，选好文件夹就能开始。" else "从新对话开始聊聊。",fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                item { Spacer(Modifier.height(nativePad)) }
                item { NativeSidebarRow("全部对话",subtitle="搜索、置顶与归档",icon=R.drawable.wm_chat){drawer=false;m.tab="chats"} }
                item { NativeSidebarRow("设置",icon=R.drawable.wm_settings){drawer=false;settings.open()} }
            }
            }
            Spacer(Modifier.weight(1f).fillMaxHeight().background(MaterialTheme.colorScheme.scrim).clickable{drawer=false})
            }
        }
        openedFile?.let{row->NativeFileViewer(row,m,activity,onClose={preview=null})}
    }
}

}
