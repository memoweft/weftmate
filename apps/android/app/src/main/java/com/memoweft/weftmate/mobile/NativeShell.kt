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
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.LocalDate

private val LocalReadingSize=staticCompositionLocalOf { DesignTokens.font15 }
private val LocalCodeSize=staticCompositionLocalOf { DesignTokens.font13 }

private val gap = DesignTokens.space8.dp
private val pad = DesignTokens.space16.dp
private val touch = DesignTokens.space44.dp
private val pill = RoundedCornerShape(DesignTokens.radius26.dp)
private val card = RoundedCornerShape(DesignTokens.radius16.dp)
private val bubble = RoundedCornerShape(DesignTokens.radius26.dp)
private val tabs = listOf("chat" to ("聊天" to R.drawable.wm_chat), "activity" to ("动态" to R.drawable.wm_bell), "health" to ("健康" to R.drawable.wm_heart), "goals" to ("目标" to R.drawable.wm_check_circle), "library" to ("成果库" to R.drawable.wm_folder))

@Composable private fun NativeTheme(dark: Boolean, content: @Composable () -> Unit) {
    val accent=Color(if(dark)DesignTokens.nativeDarkAccent else DesignTokens.nativeAccent)
    val surface=Color(if(dark)DesignTokens.nativeDarkSurface else DesignTokens.nativeSurface)
    val ink=Color(if(dark)DesignTokens.nativeDarkInk else DesignTokens.nativeInk)
    val soft=Color(if(dark)DesignTokens.nativeDarkSoft else DesignTokens.nativeSoft)
    val accentSoft=Color(if(dark)DesignTokens.nativeDarkAccentSoft else DesignTokens.nativeAccentSoft)
    val secondary=Color(if(dark)DesignTokens.nativeDarkSecondary else DesignTokens.nativeSecondary)
    val line=Color(if(dark)DesignTokens.nativeDarkLine else DesignTokens.nativeLine)
    val danger=Color(if(dark)DesignTokens.nativeDarkDanger else DesignTokens.nativeDanger)
    val dangerSoft=Color(if(dark)DesignTokens.nativeDarkDangerSoft else DesignTokens.nativeDangerSoft)
    val canvas=Color(if(dark)DesignTokens.nativeDarkCanvas else DesignTokens.nativeSurface)
    val onAccent=Color(if(dark)DesignTokens.nativeDarkOnAccent else DesignTokens.nativeOnAccent)
    val c = (if(dark)darkColorScheme() else lightColorScheme()).copy(primary=accent,onPrimary=onAccent,primaryContainer=accentSoft,onPrimaryContainer=ink,
        secondary=accent,onSecondary=onAccent,secondaryContainer=accentSoft,onSecondaryContainer=ink,tertiary=accent,onTertiary=onAccent,tertiaryContainer=accentSoft,onTertiaryContainer=ink,
        background=canvas,onBackground=ink,surface=surface,onSurface=ink,surfaceVariant=soft,onSurfaceVariant=secondary,outline=line,outlineVariant=line,error=danger,onError=surface,errorContainer=dangerSoft,onErrorContainer=danger,
        surfaceTint=surface,surfaceBright=surface,surfaceDim=soft,surfaceContainer=surface,surfaceContainerLow=surface,surfaceContainerLowest=surface,surfaceContainerHigh=soft,surfaceContainerHighest=soft,
        inverseSurface=ink,inverseOnSurface=surface,inversePrimary=surface,scrim=Color(if(dark)DesignTokens.nativeDarkOverlay else DesignTokens.nativeOverlay))
    MaterialTheme(colorScheme=c,typography=Typography(labelLarge=TextStyle(fontSize=DesignTokens.font15.sp,lineHeight=DesignTokens.space20.sp,fontWeight=FontWeight.Medium))) { CompositionLocalProvider(LocalContentColor provides c.onSurface,LocalNativeDark provides dark,content=content) }
}
@Composable internal fun NativeIconButton(icon: Int, label: String, modifier: Modifier = Modifier, solid: Boolean = false, selected: Boolean = false, enabled: Boolean = true, compact: Boolean = false, action: () -> Unit) {
    val c=MaterialTheme.colorScheme
    IconButton(onClick=action,enabled=enabled,modifier=modifier.size(touch).alpha(if(enabled)1f else .45f).clip(CircleShape).background(if(solid)c.primary else if(selected)Color(if(LocalNativeDark.current)DesignTokens.nativeDarkSelectedOnSoft else DesignTokens.nativeSelectedOnSoft) else Color.Transparent)) {
        Icon(painterResource(icon),label,Modifier.size(if(compact)DesignTokens.space16.dp else DesignTokens.iconTouch.dp),tint=if(solid)c.onPrimary else if(selected)c.onSurface else c.onSurfaceVariant)
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun NativeShell(m: NativeChatModel, activity: NativeActivity) {
    NativeTheme(m.dark) {
      val contentLayer=rememberGraphicsLayer()
      val frost=remember(contentLayer) { NativeFrost(contentLayer) }
      var dockHeight by remember { mutableIntStateOf(0) }
      val density=LocalDensity.current
      LaunchedEffect(m.loggedIn,m.owner) { activity.feed.prepare() }
        if(!m.loggedIn) {
            AndroidView(factory={ activity.webPage("login", false) },onRelease={activity.parkWeb()},modifier=Modifier.fillMaxSize())
            return@NativeTheme
        }
      CompositionLocalProvider(LocalNativeFrost provides if(m.tab in listOf("chat","activity"))frost else null,LocalReadingSize provides m.textSize,LocalCodeSize provides m.codeSize) {
        val focus=LocalFocusManager.current
        var drawer by remember { mutableStateOf(false) }
        var overflow by remember { mutableStateOf(false) }
        SideEffect { activity.overlayBack=if(drawer) ({drawer=false}) else null }
        DisposableEffect(activity) { onDispose { activity.overlayBack=null } }
        var preview by remember { mutableStateOf<JSONObject?>(null) }
        val paneAlpha=remember { Animatable(1f) }
        LaunchedEffect(m.tab) { paneAlpha.snapTo(.8f);paneAlpha.animateTo(1f,tween(DesignTokens.durationFast.toInt())) }
        LaunchedEffect(m.dark) { activity.reportRenderedSystemBars(m.dark) }
        val ime=WindowInsets.ime.getBottom(androidx.compose.ui.platform.LocalDensity.current)>0
        var keyboardWasVisible by remember { mutableStateOf(false) }
        LaunchedEffect(ime) { if(keyboardWasVisible && !ime)m.focused=false;keyboardWasVisible=ime }
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).windowInsetsPadding(WindowInsets.systemBars).imePadding().then(if(drawer)Modifier.clearAndSetSemantics{} else Modifier)) {
          if(m.tab=="chat") NativeConversation(m,Modifier.fillMaxSize().frostSource(frost).alpha(paneAlpha.value),bottom=with(density){dockHeight.toDp()},onPreview={preview=it})
          Column(Modifier.fillMaxSize()) {
            if(m.tab=="activity" || m.tab=="activity-web") NativeFeedToolbar(activity.feed,
                back={if(m.tab=="activity-web")activity.feed.closeWeb() else activity.feed.closeDetail()},
                onDrawer={focus.clearFocus();activity.hideKeyboard();m.focused=false;drawer=true;m.launch{m.refreshChats()}},
                onSettings={focus.clearFocus();m.tab="settings"})
            else Row(Modifier.fillMaxWidth().height(DesignTokens.space80.dp).background(MaterialTheme.colorScheme.background).padding(DesignTokens.space12.dp),verticalAlignment=Alignment.CenterVertically) {
                NativeIconButton(if(m.tab in listOf("settings","models")) R.drawable.wm_back else R.drawable.wm_panel,if(m.tab in listOf("settings","models"))"返回聊天" else "打开侧栏",Modifier.nativeFrost(CircleShape)) { if(m.tab in listOf("settings","models"))m.returnToChat() else { focus.clearFocus();activity.hideKeyboard();m.focused=false;drawer=true;m.launch { m.refreshChats() } } }
                Column(Modifier.weight(1f),horizontalAlignment=Alignment.CenterHorizontally) {
                    Text(if(m.tab=="chat" || m.tab=="web-chat")m.title else if(m.tab=="models")"模型" else if(m.tab=="web-home")"对话" else if(m.tab=="help")"帮助" else tabs.find{it.first==m.tab}?.second?.first ?: "设置",fontSize=DesignTokens.font17.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
                    if(m.tab=="chat") Text(if(m.standalone || m.phone)"手机自己答的" else if(m.connected)"已连接" else "正在重连",fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Box {
                    NativeIconButton(R.drawable.wm_more,"更多",Modifier.nativeFrost(CircleShape)){overflow=true}
                    NativeMenu(expanded=overflow,onDismissRequest={overflow=false}) {
                        if(m.running) NativeMenuItem(text={Text("停止回复")},onClick={overflow=false;m.stop()},leadingIcon={Icon(painterResource(R.drawable.wm_stop),null)})
                        NativeMenuItem(text={Text("设置")},onClick={overflow=false;focus.clearFocus();m.tab="settings"},leadingIcon={Icon(painterResource(R.drawable.wm_settings),null)})
                        NativeMenuItem(text={Text("新对话")},onClick={overflow=false;m.newChat()},leadingIcon={Icon(painterResource(R.drawable.wm_plus),null)})
                        NativeMenuItem(text={Text("完整对话功能")},onClick={overflow=false;m.tab="web-chat"},leadingIcon={Icon(painterResource(R.drawable.wm_chat),null)})
                    }
                }
            }
            if(m.tab=="chat") {
                Spacer(Modifier.weight(1f))
            } else if(m.tab=="activity") {
                NativeFeedPage(activity.feed,Modifier.weight(1f).alpha(paneAlpha.value))
            } else if(m.tab=="activity-web") {
                NativeFeedWeb(activity.feed,activity,Modifier.weight(1f).fillMaxWidth().alpha(paneAlpha.value))
            } else {
                if(m.tab=="settings") Row(Modifier.fillMaxWidth().padding(horizontal=pad),verticalAlignment=Alignment.CenterVertically) {
                    Text("使用原生聊天界面",Modifier.weight(1f));Switch(checked=true,onCheckedChange={activity.fallback()})
                }
                key(m.tab) { AndroidView(factory={ activity.webPage(if(m.tab=="web-chat")"chat" else if(m.tab=="web-home")"home" else m.tab) },onRelease={activity.parkWeb()},modifier=Modifier.weight(1f).fillMaxWidth().alpha(paneAlpha.value)) }
            }
            Column(Modifier.onSizeChanged{dockHeight=it.height}) {
            if(m.tab=="chat")NativeComposer(m,onPreview={preview=it})
            if(!ime && m.tab!="settings") {
                Row(Modifier.fillMaxWidth().padding(start=DesignTokens.space12.dp,end=DesignTokens.space12.dp,top=DesignTokens.space4.dp,bottom=DesignTokens.space12.dp).nativeFrost(pill).padding(horizontal=DesignTokens.space12.dp,vertical=DesignTokens.space4.dp),horizontalArrangement=Arrangement.SpaceEvenly) {
                    tabs.forEach{(id,v)->Box(Modifier.weight(1f),contentAlignment=Alignment.Center){
                        val active=m.tab==id || id=="activity"&&m.tab=="activity-web"
                        NativeIconButton(v.second,v.first,Modifier.semantics{selected=active},selected=active){focus.clearFocus();m.focused=false;m.tab=id}
                        if(id=="activity" && activity.feed.unread>0)Box(Modifier.align(Alignment.TopEnd).padding(DesignTokens.space4.dp).size(DesignTokens.space8.dp).background(MaterialTheme.colorScheme.primary,CircleShape).semantics{contentDescription="${activity.feed.unread} 条动态未读"})
                    }}
                }
            }
        }
          }
        }
        // One activity window lets the panel continue through the system safe area.
        if(drawer) {
            Row(Modifier.fillMaxSize().semantics { paneTitle="对话";isTraversalGroup=true }) {
            Column(Modifier.fillMaxHeight().fillMaxWidth(0.88f).nativeFrost(RoundedCornerShape(DesignTokens.radius16.dp),floating=true).systemBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(pad),verticalAlignment=Alignment.CenterVertically) { Text("对话",Modifier.weight(1f),fontWeight=FontWeight.SemiBold,fontSize=DesignTokens.font18.sp);NativeIconButton(R.drawable.wm_close,"关闭侧栏"){drawer=false} }
            LazyColumn(Modifier.fillMaxWidth().weight(1f)) {
                if(!m.standalone) item { ListItem(headlineContent={Text("小纬")},leadingContent={Icon(painterResource(R.drawable.wm_chat),null)},modifier=Modifier.clickable{drawer=false;m.launch { m.select(m.business("/chats/main").getJSONObject("chat"));m.tab="chat" }}) }
                items(m.chats){row->ListItem(colors=ListItemDefaults.colors(containerColor=if(row.optString("id",row.optString("chatId"))==m.chatId)MaterialTheme.colorScheme.primaryContainer else Color.Transparent),headlineContent={Text(row.optString("title","新对话"),maxLines=1,overflow=TextOverflow.Ellipsis)},modifier=Modifier.clickable{drawer=false;m.launch{m.select(row);m.tab="chat"}})}
            }
            ListItem(headlineContent={Text("完整对话列表")},supportingContent={Text("搜索、项目与归档")},modifier=Modifier.clickable{drawer=false;m.tab="web-home"});ListItem(headlineContent={Text("设置")},leadingContent={Icon(painterResource(R.drawable.wm_settings),null)},modifier=Modifier.clickable{drawer=false;m.tab="settings"})
            }
            Spacer(Modifier.weight(1f).fillMaxHeight().background(MaterialTheme.colorScheme.scrim).clickable{drawer=false})
            }
        }
        preview?.let{row->if(row.optString("kind")=="file" || row.optString("contentType",row.optString("mimeType")).startsWith("text/")) {
            LaunchedEffect(row.toString()) { preview=null;m.tab="web-chat" }
        } else NativeAttachmentPreview(row,onClose={preview=null})}
    }
}

}

private fun displayRows(m: NativeChatModel): List<JSONObject> {
    val result=m.rows.filter{it.optString("type") in listOf("user.message","assistant.message","assistant.delta","tool.started","tool.completed","tool.failed","step.started","step.completed","step.failed","approval.requested","question.requested","turn.ended")}.toMutableList()
    for(a in m.approvals) if(result.none{it.optJSONObject("data")?.optString("approvalId")==a.optString("approvalId")})result.add(JSONObject().put("eventId","approval:${a.optString("approvalId")}").put("type","approval.requested").put("at",a.optString("createdAt")).put("data",a))
    for(q in m.questions) if(result.none{it.optJSONObject("data")?.optString("questionRpcId")==q.optString("questionRpcId")})result.add(JSONObject().put("eventId","question:${q.optString("questionRpcId")}").put("type","question.requested").put("at",q.optString("createdAt")).put("data",q))
    return result
}
@Composable private fun NativeConversation(m: NativeChatModel, modifier: Modifier, bottom:androidx.compose.ui.unit.Dp, onPreview:(JSONObject)->Unit) {
    val list=rememberLazyListState();val scope=rememberCoroutineScope()
    val frost=LocalNativeFrost.current
    LaunchedEffect(list.isScrollInProgress) { frost?.paused=list.isScrollInProgress }
    DisposableEffect(frost) { onDispose { frost?.paused=false } }
    val rows=displayRows(m)
    val feed=(LocalContext.current as? NativeActivity)?.feed
    val pending=rows.indexOfFirst{r->val d=r.optJSONObject("data");m.approvals.any{it.optString("approvalId")==d?.optString("approvalId")&&it.optString("status")=="pending"} || m.questions.any{it.optString("questionRpcId")==d?.optString("questionRpcId")&&it.optString("status")=="pending"}}
    val visible by remember { derivedStateOf { list.layoutInfo.visibleItemsInfo.map{it.index} } }
    val atEnd by remember { derivedStateOf { !list.canScrollForward } }
    val dragged by list.interactionSource.collectIsDraggedAsState()
    var follow by remember(m.chatId) { mutableStateOf(true) }
    var wasDragged by remember { mutableStateOf(false) }
    LaunchedEffect(dragged) { if(dragged){follow=false;wasDragged=true}else if(wasDragged){follow=atEnd;wasDragged=false} }
    LaunchedEffect(m.scrollVersion) { follow=true }
    var lastDecision by remember(m.chatId) { mutableStateOf("") }
    LaunchedEffect(rows.size,rows.lastOrNull()?.toString(),m.running,m.error) { if(follow && feed?.focusTarget==null && rows.isNotEmpty()){withFrameNanos{};list.scrollToItem((list.layoutInfo.totalItemsCount-1).coerceAtLeast(0))} }
    LaunchedEffect(bottom) { if(follow && feed?.focusTarget==null && rows.isNotEmpty()){withFrameNanos{};list.scrollToItem((list.layoutInfo.totalItemsCount-1).coerceAtLeast(0))} }
    LaunchedEffect(pending) { if(feed?.focusTarget==null && pending>=0 && rows[pending].optString("eventId")!=lastDecision){lastDecision=rows[pending].optString("eventId");list.animateScrollToItem(pending+1)} }
    LaunchedEffect(m.chatId,rows.size,feed?.focusTarget) {
        feed?.focusTarget?.let{target->
            val index=rows.indexOfFirst{feedTargetMatches(it,target)}
            if(index>=0){follow=false;withFrameNanos{};list.scrollToItem(index+1);feed.focusTarget=null}
        }
    }
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val bubbleMaxWidth=(maxWidth-DesignTokens.space20.dp*2)*.9f
        LazyColumn(state=list,modifier=Modifier.fillMaxSize().semantics{contentDescription="消息列表"},contentPadding=PaddingValues(start=DesignTokens.space20.dp,end=DesignTokens.space20.dp,top=(DesignTokens.space80+DesignTokens.space24).dp,bottom=bottom+DesignTokens.space24.dp),verticalArrangement=Arrangement.spacedBy(pad)) {
            item { if(m.hasOlder) NativeSecondary(onClick={follow=false;m.launch{m.refresh(true)}}){Text("较早的消息")} }
            if(rows.isEmpty()) item { Column(Modifier.fillMaxWidth().padding(vertical=DesignTokens.space48.dp),horizontalAlignment=Alignment.CenterHorizontally) {
                if(m.loading) CircularProgressIndicator() else { Text("今天想做什么？",fontSize=DesignTokens.font28.sp,fontWeight=FontWeight.Medium);FilledTonalButton(onClick={m.tab="help"},colors=ButtonDefaults.filledTonalButtonColors(containerColor=MaterialTheme.colorScheme.surfaceVariant,contentColor=MaterialTheme.colorScheme.onSurface)){Text("了解更多",fontWeight=FontWeight.Normal)}
                    if(m.models.none{it.optBoolean("configured",it.optString("source")=="phone")}) FilledTonalButton(onClick={m.openModels()}){Text("设置对话模型")}
                }
            } }
            itemsIndexed(rows,key={i,e->e.optString("eventId").ifBlank{"${e.optLong("seq")}:$i"}}){i,e->
                val d=e.optJSONObject("data") ?: JSONObject();val type=e.optString("type")
                val zone=runCatching{ZoneId.of(m.timeZone)}.getOrDefault(ZoneId.systemDefault())
                fun day(row:JSONObject)=runCatching{Instant.parse(row.optString("at")).atZone(zone).toLocalDate()}.getOrNull()
                val date=day(e)
                if(date!=null && (i==0 || day(rows[i-1])!=date)) Text(when(date){LocalDate.now(zone)->"今天";LocalDate.now(zone).minusDays(1)->"昨天";else->"${date.monthValue}月${date.dayOfMonth}日"},Modifier.padding(bottom=gap),fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                when(type) {
                    "user.message","assistant.message","assistant.delta" -> NativeMessage(m,e,bubbleMaxWidth,onPreview)
                    "approval.requested" -> m.approvals.find{it.optString("approvalId")==d.optString("approvalId")}?.let{ NativeApproval(it){outcome,decisionScope->m.decide(it,outcome,decisionScope)} }
                    "question.requested" -> m.questions.find{it.optString("questionRpcId")==d.optString("questionRpcId")}?.let{ NativeQuestion(it){answers->m.answer(it,answers)} }
                    else -> { var expanded by remember(e.optString("eventId")){mutableStateOf(false)}
                        Column { Row(Modifier.fillMaxWidth().clip(card).clickable{expanded=!expanded}.padding(vertical=gap),verticalAlignment=Alignment.CenterVertically){Icon(painterResource(if(type.endsWith("failed"))R.drawable.wm_warning else R.drawable.wm_check),null,Modifier.size(DesignTokens.space16.dp));Text(d.optString("summary").ifBlank{if(type=="turn.ended")"回复已结束" else "正在处理…"},Modifier.weight(1f).padding(start=gap),fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);Icon(painterResource(R.drawable.wm_right),"查看详情",Modifier.size(DesignTokens.space16.dp))}
                            if(expanded) SelectionContainer{Text(d.optString("summary",d.toString()),fontSize=DesignTokens.font13.sp)} }
                    }
                }
            }
            items(m.uncertain){row->Column { Text(row.optString("text"),fontSize=DesignTokens.font18.sp);Text(hostDeliveryMessage(row),color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=DesignTokens.font12.sp);if(row.optString("state")!="rejected") NativeSecondary(onClick={m.checkDelivery()}){Text("核对消息")} } }
            if(m.phone && !m.standalone) item { Text("这段是在手机上聊的。要用电脑的能力，请新开对话，或在电脑上继续这段对话。",fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant) }
            item { if(m.error.isNotBlank()) Column(verticalArrangement=Arrangement.spacedBy(gap)) { Text(m.error,fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);if(m.phoneArchive) { if(m.canRegenerate && m.rows.lastOrNull()?.optString("type")=="user.message") NativeSecondary(onClick={m.regenerate()},modifier=Modifier.semantics{contentDescription="重新生成回复"}){Text("重试回复")} } else NativeSecondary(onClick={m.launch{m.refresh()}}){Text("重试连接")} } else if(m.running)Text("正在回复…",fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if(pending>=0 && pending+1 !in visible) FilledTonalButton(onClick={scope.launch{list.animateScrollToItem(pending+1)}},modifier=Modifier.align(Alignment.BottomCenter).padding(bottom=bottom+gap,start=gap,end=gap)){Text("有一项等你决定")}
        else if(!atEnd) NativeIconButton(R.drawable.wm_down,"回到底部",Modifier.align(Alignment.BottomEnd).padding(bottom=bottom+gap,start=gap,end=gap).background(MaterialTheme.colorScheme.surfaceVariant,CircleShape)){follow=true;scope.launch{list.animateScrollToItem(list.layoutInfo.totalItemsCount-1)}}
    }
}
@Composable private fun NativeMessage(m: NativeChatModel,e: JSONObject,bubbleMaxWidth:androidx.compose.ui.unit.Dp,onPreview:(JSONObject)->Unit) {
    val d=e.optJSONObject("data") ?: JSONObject(); val user=e.optString("type")=="user.message";val text=d.optString("text")
    Column(Modifier.fillMaxWidth(),horizontalAlignment=if(user)Alignment.End else Alignment.Start) {
        Column(Modifier.then(if(user)Modifier.widthIn(max=bubbleMaxWidth).clip(bubble).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal=DesignTokens.space20.dp,vertical=DesignTokens.space12.dp) else Modifier.fillMaxWidth())) {
            val originals=d.optJSONArray("originalAttachments")
            val images=d.optJSONArray("images")
            val attachments=if(originals!=null && images!=null)JSONArray(originals.objects().filter{!it.optString("contentType").startsWith("image/")}+images.objects()) else originals ?: d.optJSONArray("attachments") ?: images ?: d.optJSONArray("thumbnails")
            attachments?.objects()?.takeIf{it.isNotEmpty()}?.let{refs->
                val session = e.optJSONObject("sourceRef")?.optString("sessionId") ?: m.sessionId
                NativeAttachments(refs.map { ref -> JSONObject(ref.toString()).apply {
                    if (optString("attachmentId").startsWith("sha256:") && session.isNotBlank()) {
                        put("kind","image");put("previewUrl",sharedImagePreviewUrl(session,getString("attachmentId")))
                    } else if (optString("contentType",optString("mimeType")).startsWith("image/") && !has("previewUrl") && !has("thumbnailDataUrl")) {
                        put("kind","image");put("previewUrl","weftmate-image://sent/${m.chatId}/${getString("attachmentId")}")
                    }
                } },false,onPreview,{})
            }
            SelectionContainer{NativeMarkdown(text)}
        }
        if(!user && e.optString("type")!="assistant.delta") Row {
            NativeIconButton(R.drawable.wm_copy,"复制回复",compact=true){m.copyReply(text)}
            NativeIconButton(R.drawable.wm_chat,"引用回复",compact=true){m.edit("> ${text.take(300).replace("\n","\n> ")}\n\n");m.focused=true}
            if(m.phoneArchive) { if(m.canRegenerate && e.optString("eventId")==m.rows.lastOrNull()?.optString("eventId")) NativeIconButton(R.drawable.wm_refresh,"重新生成回复",compact=true){m.regenerate()} } else NativeIconButton(R.drawable.wm_more,"消息操作",compact=true){m.tab="web-chat"}
        }
    }
}
@Composable internal fun NativeMarkdown(text:String) {
    val parts=remember(text) { text.split("```").mapIndexed { i,part ->
        if(i%2==1) listOf(AnnotatedString(part.substringAfter('\n',part)))
        else part.trim().split("\n\n").filter{it.isNotBlank()}.map{inlineMarkdown(it.replace(Regex("(?m)^[-*] "),"• "))}
    } }
    Column(verticalArrangement=Arrangement.spacedBy(gap)) { parts.forEachIndexed{i,part->
        if(i%2==1) Text(part.single(),Modifier.fillMaxWidth().clip(card).background(MaterialTheme.colorScheme.surfaceVariant).horizontalScroll(rememberScrollState()).padding(pad),fontFamily=FontFamily.Monospace,fontSize=LocalCodeSize.current.sp)
        else part.forEach{p->Text(p,fontSize=LocalReadingSize.current.sp,lineHeight=(LocalReadingSize.current * 1.65f).sp)}
    } }
}
private fun inlineMarkdown(text:String):AnnotatedString=buildAnnotatedString {
    var last=0
    Regex("\\*\\*(.+?)\\*\\*|`([^`]+)`").findAll(text).forEach{match->
        append(text.substring(last,match.range.first));withStyle(if(match.groups[1]!=null)SpanStyle(fontWeight=FontWeight.Bold) else SpanStyle(fontFamily=FontFamily.Monospace)){append(match.groups[1]?.value ?: match.groups[2]!!.value)};last=match.range.last+1
    };append(text.substring(last))
}

@Composable internal fun NativeApproval(row:JSONObject,onDecide:(String,String)->Unit) {
    val receipt=decisionReceipt(row)
    if(receipt!=null){Text(receipt,fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);return}
    row.optJSONObject("nativeDecision")?.let { request ->
        Column(Modifier.fillMaxWidth().clip(card).background(MaterialTheme.colorScheme.surface).border(1.dp,MaterialTheme.colorScheme.outline,card).padding(pad)) {
            Text(if(request.optString("outcome")=="rejected")"正在确认你的拒绝决定" else "正在确认你的批准决定",fontSize=DesignTokens.font14.sp)
            NativeSecondary(onClick={onDecide(request.getString("outcome"),request.optString("scope","once"))},shape=pill){Text("重试原决定")}
        }
        return
    }
    var expanded by remember(row.optString("approvalId")){mutableStateOf(false)}
    var choice by remember(row.optString("approvalId")){mutableStateOf(0)}
    val always=row.optBoolean("canAlwaysAllow")
    Column(Modifier.fillMaxWidth().clip(card).background(MaterialTheme.colorScheme.surface).border(1.dp,MaterialTheme.colorScheme.outline,card).padding(pad),verticalArrangement=Arrangement.spacedBy(gap)) {
        Row(verticalAlignment=Alignment.CenterVertically){Icon(painterResource(R.drawable.wm_check_circle),null,Modifier.size(DesignTokens.space24.dp));Text(row.optString("summary",row.optString("reason","需要你决定")),Modifier.padding(start=gap),fontWeight=FontWeight.SemiBold,fontSize=DesignTokens.font16.sp)}
        if (!always) Text(row.optString("reason").ifBlank{"要允许这次操作吗？"},color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=DesignTokens.font14.sp)
        Row(Modifier.fillMaxWidth().heightIn(min=touch).clickable{expanded=!expanded},verticalAlignment=Alignment.CenterVertically){Text("关键参数与详情",Modifier.weight(1f),color=MaterialTheme.colorScheme.onSurfaceVariant);Icon(painterResource(if(expanded)R.drawable.wm_down else R.drawable.wm_right),"展开详情",Modifier.size(DesignTokens.space20.dp))}
        if(expanded) SelectionContainer{Text(row.optString("details",row.optJSONObject("arguments")?.toString() ?: row.optString("reason")),fontSize=DesignTokens.font13.sp)}
        row.optJSONObject("secondOpinion")?.let{o->Text(if(o.optString("alignment")=="对得上"&&o.optString("externalInfluence")=="没有")"另一个模型看过：和你的要求一致" else "另一个模型提醒：${o.optString("reason")}",fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        if(always) {
            listOf("仅这一次","以后这类都允许","拒绝").forEachIndexed{i,label->Row(Modifier.fillMaxWidth().heightIn(min=touch).clip(RoundedCornerShape(DesignTokens.radius12.dp)).background(if(choice==i)MaterialTheme.colorScheme.surfaceVariant else Color.Transparent).selectable(choice==i,onClick={choice=i},role=Role.RadioButton),verticalAlignment=Alignment.CenterVertically){RadioButton(choice==i,onClick=null,colors=nativeRadioColors());Text(label)}}
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){NativePrimary(onClick={onDecide(if(choice==2)"rejected" else "allowed-once",if(choice==1)"global-category" else "once")},shape=pill){Text("确认")}}
        } else Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(gap,Alignment.End)) {
            NativeSecondary(onClick={onDecide("rejected","once")},shape=pill){Text("拒绝")};NativePrimary(onClick={onDecide("allowed-once","once")},shape=pill){Text("批准")}
        }
    }
}
@Composable internal fun NativeQuestion(row:JSONObject,onAnswer:(JSONArray)->Unit) {
    decisionReceipt(row,true)?.let{Text(it,fontSize=DesignTokens.font13.sp);return}
    val qs=row.optJSONArray("questions")?.objects().orEmpty()
    val selected=remember(row.optString("questionRpcId")){mutableStateMapOf<String,List<String>>()}
    val custom=remember(row.optString("questionRpcId")){mutableStateMapOf<String,String>()}
    Column(Modifier.fillMaxWidth().clip(card).background(MaterialTheme.colorScheme.surface).border(1.dp,MaterialTheme.colorScheme.outline,card).padding(pad),verticalArrangement=Arrangement.spacedBy(gap)) {
        Row(verticalAlignment=Alignment.CenterVertically){Icon(painterResource(R.drawable.wm_check_circle),null);Text("需要你选择",Modifier.padding(start=gap),fontWeight=FontWeight.SemiBold)}
        qs.forEach{q->val id=q.getString("id");Text(q.optString("question"),fontSize=DesignTokens.font16.sp);if(q.optString("detail").isNotBlank())Text(q.optString("detail"),color=MaterialTheme.colorScheme.onSurfaceVariant)
            q.optJSONArray("options")?.objects()?.forEach{o->val label=o.optString("label");val checked=selected[id]?.contains(label)==true
                Row(Modifier.fillMaxWidth().heightIn(min=touch).selectable(checked,onClick={selected[id]=if(q.optBoolean("multiSelect")){if(checked)selected[id].orEmpty()-label else selected[id].orEmpty()+label}else listOf(label);custom[id]=""},role=if(q.optBoolean("multiSelect"))Role.Checkbox else Role.RadioButton),verticalAlignment=Alignment.CenterVertically){if(q.optBoolean("multiSelect"))Checkbox(checked,null) else RadioButton(checked,null,colors=nativeRadioColors());Text(label)}
            }
            OutlinedTextField(custom[id] ?: "",onValueChange={custom[id]=it;selected[id]=emptyList()},label={Text("补充回答")},modifier=Modifier.fillMaxWidth())
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) {
            NativePrimary(onClick={
                val answers = qs.map { q ->
                    val id = q.getString("id")
                    JSONObject().put("id", id).put("selected", JSONArray(selected[id].orEmpty())).apply {
                        custom[id]?.takeIf { it.isNotBlank() }?.let { put("custom", it) }
                    }
                }
                onAnswer(JSONArray(answers))
            },enabled=qs.all{selected[it.getString("id")]?.isNotEmpty()==true||custom[it.getString("id")]?.isNotBlank()==true},shape=pill){Text("确认选择")}
        }
    }
}

@Composable private fun NativeComposer(m:NativeChatModel,onPreview:(JSONObject)->Unit) {
    var plus by remember{mutableStateOf(false)};var modelMenu by remember{mutableStateOf(false)};var modeMenu by remember{mutableStateOf(false)};var allowRisk by remember{mutableStateOf(false)}
    val expanded=m.composer.height!=ComposerHeight.Capsule
    val inputFocus=remember { FocusRequester() }
    LaunchedEffect(expanded) { if(m.focused)inputFocus.requestFocus() }
    Column(Modifier.fillMaxWidth().animateContentSize(tween(DesignTokens.durationFast.toInt())).padding(horizontal=DesignTokens.space12.dp,vertical=DesignTokens.space8.dp).nativeFrost(if(expanded)RoundedCornerShape(DesignTokens.radius24.dp) else pill).padding(if(expanded)gap else DesignTokens.space4.dp)) {
        if(m.attachments.isNotEmpty())NativeAttachments(m.attachments,true,onPreview,m::remove)
        val input:@Composable ()->Unit={BasicTextField(m.draft,onValueChange=m::edit,modifier=Modifier.fillMaxWidth().heightIn(min=if(expanded)DesignTokens.space64.dp else touch,max=DesignTokens.space150.dp).focusRequester(inputFocus).onFocusChanged{if(it.isFocused)m.focused=true}.padding(if(expanded)gap else DesignTokens.space4.dp).semantics{contentDescription="消息输入"},textStyle=TextStyle(color=MaterialTheme.colorScheme.onSurface,fontSize=LocalReadingSize.current.sp,lineHeight=(LocalReadingSize.current * 1.5f).sp),cursorBrush=SolidColor(MaterialTheme.colorScheme.primary),maxLines=5,decorationBox={inner->Box{if(m.draft.isEmpty())Text(if(m.running)"可以继续补充…" else "说说你的目标…",color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=LocalReadingSize.current.sp);inner()}})}
        if(expanded)input()
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)) {
            Box{NativeIconButton(R.drawable.wm_plus,"添加附件",enabled=!m.standalone && !m.phoneArchive){plus=true};NativeMenu(plus,onDismissRequest={plus=false}){listOf("image" to "照片","camera" to "拍照","file" to "文件").forEach{(kind,label)->NativeMenuItem(text={Text(label)},onClick={plus=false;m.pick(kind)})}}}
            if(!expanded)Box(Modifier.weight(1f)){input()}
            if(expanded) {
                Box{NativeIconButton(R.drawable.wm_filter,"审批模式：${modeName(m.mode)}",enabled=!m.standalone && !m.phoneArchive){modeMenu=true};NativeMenu(modeMenu,onDismissRequest={modeMenu=false}){listOf("auto","ask","accept-edits","plan","allow-all").forEach{id->NativeMenuItem(text={Text(modeName(id))},trailingIcon={if(m.mode==id)Icon(painterResource(R.drawable.wm_check),"当前模式")},onClick={modeMenu=false;if(id=="allow-all")allowRisk=true else m.launch{if(m.sessionId.isNotBlank())m.business("/sessions/${m.sessionId}/approval-mode","PATCH",JSONObject().put("mode",id));m.mode=id}})}}}
                Box{NativeIconButton(R.drawable.wm_model,"模型：${m.modelLabel}"){modelMenu=true};NativeMenu(modelMenu,onDismissRequest={modelMenu=false}){m.models.forEach{row->val id=row.optString("profileId",row.optString("modelId"));NativeMenuItem(text={Text(row.optString("displayName",id))},trailingIcon={if(if(m.standalone)row.optBoolean("selected") else id==m.modelId)Icon(painterResource(R.drawable.wm_check),"当前模型")},onClick={modelMenu=false;m.selectModel(row)})};NativeMenuItem(text={Text("管理模型")},onClick={modelMenu=false;m.openModels()})}}
            }
            if(expanded)Spacer(Modifier.weight(1f))
            val action=m.composer.action
            if(expanded && action==ComposerAction.Send) NativeIconButton(R.drawable.wm_mic,"语音补充草稿",enabled=!m.running){m.launch{m.call("voice.start",JSONObject().put("conversationId",m.chatId))}}
            NativeIconButton(when(action){ComposerAction.Voice->R.drawable.wm_mic;ComposerAction.Send->R.drawable.wm_arrow;ComposerAction.Stop->R.drawable.wm_stop},when(action){ComposerAction.Voice->"语音输入";ComposerAction.Send->"发送消息";ComposerAction.Stop->"停止回复"},solid=true,enabled=if(action==ComposerAction.Voice)!m.running && !m.loading else action==ComposerAction.Stop || m.sendAvailable && !m.submitting){when(action){ComposerAction.Send->m.send();ComposerAction.Stop->m.stop();ComposerAction.Voice->m.launch{m.call("voice.start",JSONObject().put("conversationId",m.chatId))}}}
        }
    }
    if(allowRisk)AlertDialog(onDismissRequest={allowRisk=false},title={Text("允许所有操作？")},text={Text("删除、覆盖、系统修改、安装、发送和付款可能直接执行，且无法撤销。")},confirmButton={NativePrimary(onClick={allowRisk=false;m.launch{if(m.sessionId.isNotBlank())m.business("/sessions/${m.sessionId}/approval-mode","PATCH",JSONObject().put("mode","allow-all"));m.mode="allow-all"}}){Text("全部允许")}},dismissButton={NativeSecondary(onClick={allowRisk=false}){Text("取消")}})
}
private fun modeName(id:String)=mapOf("auto" to "自动","ask" to "每次询问","accept-edits" to "接受文件修改","plan" to "先出计划","allow-all" to "全部允许")[id] ?: "自动"
@Composable private fun NativeAttachments(rows:List<JSONObject>,removable:Boolean,onPreview:(JSONObject)->Unit,onRemove:(JSONObject)->Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(gap)) { rows.forEach{row->Box(Modifier.size((DesignTokens.space48 * 2).dp).clip(card).border(1.dp,MaterialTheme.colorScheme.outline,card).clickable{onPreview(row)}) {
        NativeAttachmentContent(row)
        if(removable)NativeIconButton(R.drawable.wm_close,"移除附件：${row.optString("name")}",Modifier.align(Alignment.TopEnd).background(MaterialTheme.colorScheme.surface,CircleShape)){onRemove(row)}
    }} }
}
@Composable private fun NativeAttachmentContent(row:JSONObject) {
    val context=LocalContext.current
    var bitmap by remember(row.toString()){mutableStateOf<android.graphics.Bitmap?>(null)}
    val url=row.optString("displayUrl", row.optString("previewUrl",row.optString("thumbnailDataUrl",row.optString("thumbnailUrl"))))
    LaunchedEffect(url){ if(url.isNotBlank()) {
        val bytes = runCatching {
            if(url.startsWith("data:")) android.util.Base64.decode(url.substringAfter(','),0)
            else if (findNativeActivity(context) != null) kotlinx.coroutines.suspendCancellableCoroutine<ByteArray> { c ->
                findNativeActivity(context)!!.nativeRequest("native.image", JSONObject().put("url",url)) { r ->
                    if(c.isActive) r.fold({c.resume(android.util.Base64.decode(it.getString("data"),0),null)}, {c.cancel(it)})
                }
            } else context.contentResolver.openInputStream(Uri.parse(url))?.use{it.readBytes()}
        }.getOrNull()
        bitmap = bytes?.let { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { BitmapFactory.decodeByteArray(it,0,it.size) } }
    } }
    if(bitmap!=null)Image(bitmap!!.asImageBitmap(),row.optString("name"),Modifier.fillMaxSize(),contentScale=androidx.compose.ui.layout.ContentScale.Fit)
    else Column(Modifier.fillMaxSize().padding(gap),verticalArrangement=Arrangement.Center){Icon(painterResource(if(row.optString("kind")=="image")R.drawable.wm_image else R.drawable.wm_file),null);Text(row.optString("name","附件"),maxLines=2,overflow=TextOverflow.Ellipsis,fontSize=DesignTokens.font12.sp)}
}
@Composable private fun NativeAttachmentPreview(row:JSONObject,onClose:()->Unit) {
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)) {
        NativeDialogBars()
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).systemBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(gap),verticalAlignment=Alignment.CenterVertically){NativeIconButton(R.drawable.wm_close,"关闭预览",action=onClose);Text(row.optString("name","附件"),Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis)}
            Box(Modifier.weight(1f).fillMaxWidth()){NativeAttachmentContent(row)}
        }
    }
}
private fun findNativeActivity(context:android.content.Context):NativeActivity? = when(context) {
    is NativeActivity -> context
    is android.content.ContextWrapper -> if(context.baseContext!==context)findNativeActivity(context.baseContext) else null
    else -> null
}
@Composable private fun NativeDialogBars() {
        val view=LocalView.current
        val light=MaterialTheme.colorScheme.surface.red > 0.5f
        SideEffect { (view.parent as? DialogWindowProvider)?.window?.let { window ->
            window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            window.statusBarColor=android.graphics.Color.TRANSPARENT
            window.navigationBarColor=android.graphics.Color.TRANSPARENT
            androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window,false)
            if(android.os.Build.VERSION.SDK_INT>=29){window.isStatusBarContrastEnforced=false;window.isNavigationBarContrastEnforced=false}
            androidx.core.view.WindowCompat.getInsetsController(window,view).apply { isAppearanceLightStatusBars=light;isAppearanceLightNavigationBars=light }
        } }
}


@Composable private fun nativeRadioColors()=RadioButtonDefaults.colors(selectedColor=MaterialTheme.colorScheme.primary,unselectedColor=Color(if(LocalNativeDark.current)DesignTokens.nativeDarkMuted else DesignTokens.nativeMuted))
@Composable private fun NativePrimary(onClick:()->Unit,modifier:Modifier=Modifier,enabled:Boolean=true,shape:androidx.compose.ui.graphics.Shape=pill,content:@Composable RowScope.()->Unit) {
    Button(onClick,modifier.height(touch).alpha(if(enabled)1f else .45f),enabled=enabled,shape=shape,colors=ButtonDefaults.buttonColors(disabledContainerColor=MaterialTheme.colorScheme.primary,disabledContentColor=MaterialTheme.colorScheme.onPrimary),contentPadding=PaddingValues(horizontal=DesignTokens.space18.dp),content=content)
}
@Composable private fun NativeSecondary(onClick:()->Unit,modifier:Modifier=Modifier,enabled:Boolean=true,shape:androidx.compose.ui.graphics.Shape=pill,content:@Composable RowScope.()->Unit) {
    OutlinedButton(onClick,modifier.height(touch).alpha(if(enabled)1f else .45f),enabled=enabled,shape=shape,colors=ButtonDefaults.outlinedButtonColors(containerColor=MaterialTheme.colorScheme.surface,contentColor=MaterialTheme.colorScheme.onSurfaceVariant,disabledContainerColor=MaterialTheme.colorScheme.surface,disabledContentColor=MaterialTheme.colorScheme.onSurfaceVariant),contentPadding=PaddingValues(horizontal=DesignTokens.space18.dp),content=content)
}
@Composable private fun NativeMenu(expanded:Boolean,onDismissRequest:()->Unit,content:@Composable ColumnScope.()->Unit) {
    DropdownMenu(expanded,onDismissRequest,modifier=Modifier.nativeFrost(RoundedCornerShape(DesignTokens.radius12.dp),floating=true),containerColor=Color.Transparent,tonalElevation=0.dp,shape=RoundedCornerShape(DesignTokens.radius12.dp),content=content)
}

@Composable private fun NativeMenuItem(text:@Composable ()->Unit,onClick:()->Unit,leadingIcon:(@Composable ()->Unit)?=null,trailingIcon:(@Composable ()->Unit)?=null,enabled:Boolean=true) {
    DropdownMenuItem(text={ProvideTextStyle(MaterialTheme.typography.labelLarge,content=text)},onClick=onClick,modifier=Modifier.height(touch),leadingIcon=leadingIcon,trailingIcon=trailingIcon,enabled=enabled,contentPadding=PaddingValues(horizontal=DesignTokens.space18.dp))
}
