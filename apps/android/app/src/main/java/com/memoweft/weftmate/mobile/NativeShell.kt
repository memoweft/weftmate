package com.memoweft.weftmate.mobile

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.*
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.LocalDate

private val gap = DesignTokens.space8.dp
private val pad = DesignTokens.space16.dp
private val touch = DesignTokens.space44.dp
private val pill = RoundedCornerShape(DesignTokens.radius24.dp)
private val card = RoundedCornerShape(DesignTokens.radius16.dp)
private val tabs = listOf("chat" to ("聊天" to R.drawable.wm_chat), "activity" to ("动态" to R.drawable.wm_bell), "health" to ("健康" to R.drawable.wm_heart), "goals" to ("目标" to R.drawable.wm_check_circle), "library" to ("成果库" to R.drawable.wm_layers))

@Composable private fun NativeTheme(dark: Boolean, content: @Composable () -> Unit) {
    val c = if (dark) darkColorScheme(primary=Color(DesignTokens.nativeDarkAccent),onPrimary=Color(DesignTokens.nativeDarkSurface),background=Color(DesignTokens.nativeDarkSurface),surface=Color(DesignTokens.nativeDarkSurface),onSurface=Color(DesignTokens.nativeDarkInk),onSurfaceVariant=Color(DesignTokens.nativeDarkSecondary),surfaceVariant=Color(DesignTokens.nativeDarkSoft),outline=Color(DesignTokens.nativeDarkLine),error=Color(DesignTokens.nativeDarkDanger))
    else lightColorScheme(primary=Color(DesignTokens.nativeInk),onPrimary=Color(DesignTokens.nativeSurface),background=Color(DesignTokens.nativeSurface),surface=Color(DesignTokens.nativeSurface),onSurface=Color(DesignTokens.nativeInk),onSurfaceVariant=Color(DesignTokens.nativeSecondary),surfaceVariant=Color(DesignTokens.nativeSoft),outline=Color(DesignTokens.nativeLine),error=Color(DesignTokens.nativeDanger))
    MaterialTheme(colorScheme=c) { CompositionLocalProvider(LocalContentColor provides c.onSurface, content=content) }
}
@Composable internal fun NativeIconButton(icon: Int, label: String, modifier: Modifier = Modifier, solid: Boolean = false, selected: Boolean = false, enabled: Boolean = true, compact: Boolean = false, action: () -> Unit) {
    val c=MaterialTheme.colorScheme
    IconButton(onClick=action,enabled=enabled,modifier=modifier.size(touch).clip(CircleShape).background(if(solid)c.primary else if(selected)c.surface else Color.Transparent)) {
        Icon(painterResource(icon),label,Modifier.size(if(compact)DesignTokens.space16.dp else DesignTokens.space24.dp),tint=if(solid)c.onPrimary else c.onSurfaceVariant)
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun NativeShell(m: NativeChatModel, activity: NativeActivity) {
    // Observe the route here; a forwarded theme lambda must also change when navigation changes.
    val selectedTab=m.tab
    val signedIn=m.loggedIn
    val account=m.owner
    var overflow by remember { mutableStateOf(false) }
    var preview by remember(account,signedIn) { mutableStateOf<JSONObject?>(null) }
    val showOverflow=overflow
    val openedFile=preview
    NativeTheme(m.dark) {
        val focus=LocalFocusManager.current
        var drawer by remember { mutableStateOf(false) }
        LaunchedEffect(openedFile) { if(openedFile!=null){focus.clearFocus();activity.hideKeyboard()} }
        LaunchedEffect(m.dark) { activity.reportRenderedSystemBars(m.dark) }
        if(!signedIn) {
            AndroidView(factory={ activity.webPage("login", false) },modifier=Modifier.fillMaxSize())
            return@NativeTheme
        }
        val ime=WindowInsets.ime.getBottom(androidx.compose.ui.platform.LocalDensity.current)>0
        var keyboardWasVisible by remember { mutableStateOf(false) }
        LaunchedEffect(ime) { if(keyboardWasVisible && !ime)m.focused=false;keyboardWasVisible=ime }
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).windowInsetsPadding(WindowInsets.systemBars).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal=pad,vertical=gap),verticalAlignment=Alignment.CenterVertically) {
                NativeIconButton(if(selectedTab=="settings") R.drawable.wm_back else R.drawable.wm_panel,if(selectedTab=="settings")"返回聊天" else "打开侧栏",Modifier.background(MaterialTheme.colorScheme.surfaceVariant,CircleShape)) { if(selectedTab=="settings")m.tab="chat" else { drawer=true;m.launch { m.refreshChats() } } }
                Column(Modifier.weight(1f),horizontalAlignment=Alignment.CenterHorizontally) {
                    Text(if(selectedTab=="chat" || selectedTab=="web-chat")m.title else tabs.find{it.first==selectedTab}?.second?.first ?: "设置",fontSize=DesignTokens.font18.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
                    if(selectedTab=="chat") Text(if(m.connected)"已连接" else "正在重连",fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Box {
                    NativeIconButton(R.drawable.wm_more,"更多",Modifier.background(MaterialTheme.colorScheme.surfaceVariant,CircleShape)){overflow=true}
                    DropdownMenu(expanded=showOverflow,onDismissRequest={overflow=false}) {
                        if(m.running && selectedTab!="library") DropdownMenuItem(text={Text("停止回复")},onClick={overflow=false;m.stop()},leadingIcon={Icon(painterResource(R.drawable.wm_stop),null)})
                        DropdownMenuItem(text={Text("设置")},onClick={overflow=false;focus.clearFocus();m.tab="settings"},leadingIcon={Icon(painterResource(R.drawable.wm_settings),null)})
                        if(selectedTab=="library")DropdownMenuItem(text={Text("打开原网页成果库")},onClick={overflow=false;activity.originalLibrary()},leadingIcon={Icon(painterResource(R.drawable.wm_layers),null)})
                        if(selectedTab!="library") {
                            DropdownMenuItem(text={Text("新对话")},onClick={overflow=false;m.launch{m.select(m.call("conversations.create"));m.tab="chat"}},leadingIcon={Icon(painterResource(R.drawable.wm_plus),null)})
                            DropdownMenuItem(text={Text("完整对话功能")},onClick={overflow=false;m.tab="web-chat"},leadingIcon={Icon(painterResource(R.drawable.wm_chat),null)})
                        }
                    }
                }
            }
            if(selectedTab=="chat") {
                NativeConversation(m,Modifier.weight(1f),onPreview={preview=it})
                NativeComposer(m,onPreview={preview=it})
            } else if(selectedTab=="library") {
                NativeLibrary(m,activity,Modifier.weight(1f),onPreview={preview=it})
            } else {
                if(selectedTab=="settings") Row(Modifier.fillMaxWidth().padding(horizontal=pad),verticalAlignment=Alignment.CenterVertically) {
                    Text("使用原生聊天界面",Modifier.weight(1f));Switch(checked=true,onCheckedChange={activity.fallback()})
                }
                key(selectedTab) { AndroidView(factory={ activity.webPage(if(selectedTab=="web-chat")"chat" else selectedTab) },modifier=Modifier.weight(1f).fillMaxWidth()) }
            }
            if(!ime && selectedTab!="settings") {
                Row(Modifier.fillMaxWidth().padding(horizontal=pad,vertical=gap).clip(pill).background(MaterialTheme.colorScheme.surfaceVariant).padding(DesignTokens.space4.dp),horizontalArrangement=Arrangement.SpaceEvenly) {
                    tabs.forEach{(id,v)->NativeIconButton(v.second,v.first,Modifier.weight(1f).semantics{selected=selectedTab==id},selected=selectedTab==id){focus.clearFocus();m.tab=id}}
                }
            }
        }
        if(drawer) Dialog(onDismissRequest={drawer=false},properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)) {
            NativeDialogBars()
            Row(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).systemBarsPadding()) {
            Column(Modifier.fillMaxHeight().fillMaxWidth(0.88f).background(MaterialTheme.colorScheme.surface)) {
            Row(Modifier.fillMaxWidth().padding(pad),verticalAlignment=Alignment.CenterVertically) { Text("对话",Modifier.weight(1f),fontWeight=FontWeight.SemiBold,fontSize=DesignTokens.font18.sp);NativeIconButton(R.drawable.wm_close,"关闭侧栏"){drawer=false} }
            LazyColumn(Modifier.fillMaxWidth().weight(1f)) {
                item { ListItem(headlineContent={Text("小纬")},leadingContent={Icon(painterResource(R.drawable.wm_chat),null)},modifier=Modifier.clickable{drawer=false;m.launch { m.select(m.business("/chats/main").getJSONObject("chat"));m.tab="chat" }}) }
                items(m.chats){row->ListItem(headlineContent={Text(row.optString("title","新对话"),maxLines=1,overflow=TextOverflow.Ellipsis)},modifier=Modifier.clickable{drawer=false;m.launch{m.select(row);m.tab="chat"}})}
            }
            ListItem(headlineContent={Text("设置")},leadingContent={Icon(painterResource(R.drawable.wm_settings),null)},modifier=Modifier.clickable{drawer=false;m.tab="settings"})
            }
            Spacer(Modifier.weight(1f).fillMaxHeight().background(Color(DesignTokens.nativeOverlay)).clickable{drawer=false})
            }
        }
        openedFile?.let{row->NativeFileViewer(row,m,activity,onClose={preview=null})}
    }
}

private fun displayRows(m: NativeChatModel): List<JSONObject> {
    val result=m.rows.filter{it.optString("type") in listOf("user.message","assistant.message","assistant.delta","artifact.created","tool.started","tool.completed","tool.failed","step.started","step.completed","step.failed","approval.requested","question.requested","turn.ended")}.toMutableList()
    for(a in m.approvals) if(result.none{it.optJSONObject("data")?.optString("approvalId")==a.optString("approvalId")})result.add(JSONObject().put("eventId","approval:${a.optString("approvalId")}").put("type","approval.requested").put("at",a.optString("createdAt")).put("data",a))
    for(q in m.questions) if(result.none{it.optJSONObject("data")?.optString("questionRpcId")==q.optString("questionRpcId")})result.add(JSONObject().put("eventId","question:${q.optString("questionRpcId")}").put("type","question.requested").put("at",q.optString("createdAt")).put("data",q))
    return result
}
@Composable private fun NativeConversation(m: NativeChatModel, modifier: Modifier, onPreview:(JSONObject)->Unit) {
    val list=rememberLazyListState();val scope=rememberCoroutineScope()
    val rows=displayRows(m)
    val pending=rows.indexOfFirst{r->val d=r.optJSONObject("data");m.approvals.any{it.optString("approvalId")==d?.optString("approvalId")&&it.optString("status")=="pending"} || m.questions.any{it.optString("questionRpcId")==d?.optString("questionRpcId")&&it.optString("status")=="pending"}}
    val visible by remember { derivedStateOf { list.layoutInfo.visibleItemsInfo.map{it.index} } }
    val atEnd by remember { derivedStateOf { !list.canScrollForward } }
    var lastDecision by remember(m.chatId) { mutableStateOf("") }
    LaunchedEffect(m.fileAnchor,rows.size) { if(m.fileAnchor.isNotBlank()){val index=rows.indexOfFirst{it.optString("eventId")==m.fileAnchor};if(index>=0){list.scrollToItem(index+1);m.fileAnchor=""}} }
    LaunchedEffect(rows.size,rows.lastOrNull()?.toString()) { if(atEnd && rows.isNotEmpty())list.scrollToItem(list.layoutInfo.totalItemsCount-1) }
    LaunchedEffect(pending) { if(pending>=0 && rows[pending].optString("eventId")!=lastDecision){lastDecision=rows[pending].optString("eventId");list.animateScrollToItem(pending+1)} }
    Box(modifier.fillMaxWidth()) {
        LazyColumn(state=list,modifier=Modifier.fillMaxSize().semantics{contentDescription="消息列表"},contentPadding=PaddingValues(horizontal=pad,vertical=pad),verticalArrangement=Arrangement.spacedBy(pad)) {
            item { if(m.hasOlder) OutlinedButton(onClick={m.launch{m.refresh(true)}}){Text("较早的消息")} }
            if(rows.isEmpty()) item { Column(Modifier.fillMaxWidth().padding(vertical=DesignTokens.space48.dp),horizontalAlignment=Alignment.CenterHorizontally) {
                if(m.loading) CircularProgressIndicator() else { Icon(painterResource(R.drawable.wm_chat),null,Modifier.size(DesignTokens.space32.dp));Spacer(Modifier.height(pad));Text("今天想聊些什么？",fontSize=DesignTokens.font18.sp)
                    if(m.models.none{it.optBoolean("configured",it.optString("source")=="phone")}) FilledTonalButton(onClick={m.tab="settings"}){Text("设置对话模型")}
                }
            } }
            itemsIndexed(rows,key={i,e->e.optString("eventId").ifBlank{"${e.optLong("seq")}:$i"}}){i,e->
                val d=e.optJSONObject("data") ?: JSONObject();val type=e.optString("type")
                val zone=runCatching{ZoneId.of(m.timeZone)}.getOrDefault(ZoneId.systemDefault())
                fun day(row:JSONObject)=runCatching{Instant.parse(row.optString("at")).atZone(zone).toLocalDate()}.getOrNull()
                val date=day(e)
                if(date!=null && (i==0 || day(rows[i-1])!=date)) Text(when(date){LocalDate.now(zone)->"今天";LocalDate.now(zone).minusDays(1)->"昨天";else->"${date.monthValue}月${date.dayOfMonth}日"},Modifier.padding(bottom=gap),fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                when(type) {
                    "user.message","assistant.message","assistant.delta" -> NativeMessage(m,e,onPreview)
                    "artifact.created" -> NativeArtifactFiles(e,m,onPreview)
                    "approval.requested" -> m.approvals.find{it.optString("approvalId")==d.optString("approvalId")}?.let{ NativeApproval(it){outcome,decisionScope->m.decide(it,outcome,decisionScope)} }
                    "question.requested" -> m.questions.find{it.optString("questionRpcId")==d.optString("questionRpcId")}?.let{ NativeQuestion(it){answers->m.answer(it,answers)} }
                    else -> { var expanded by remember(e.optString("eventId")){mutableStateOf(false)}
                        Column { Row(Modifier.fillMaxWidth().clip(card).clickable{expanded=!expanded}.padding(vertical=gap),verticalAlignment=Alignment.CenterVertically){Icon(painterResource(if(type.endsWith("failed"))R.drawable.wm_warning else R.drawable.wm_check),null,Modifier.size(DesignTokens.space16.dp));Text(d.optString("summary").ifBlank{if(type=="turn.ended")"回复已结束" else "正在处理…"},Modifier.weight(1f).padding(start=gap),fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);Icon(painterResource(R.drawable.wm_right),"查看详情",Modifier.size(DesignTokens.space16.dp))}
                            if(expanded) SelectionContainer{Text(d.optString("summary",d.toString()),fontSize=DesignTokens.font13.sp)} }
                    }
                }
            }
            items(m.uncertain){row->Column { Text(row.optString("text"),fontSize=DesignTokens.font16.sp);Text("消息还在确认中，正在自动续查。",color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=DesignTokens.font12.sp) } }
            item { if(m.error.isNotBlank()) OutlinedButton(onClick={m.launch{m.refresh()}}){Text(m.error)} else if(m.running)Text("正在回复…",fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if(pending>=0 && pending+1 !in visible) FilledTonalButton(onClick={scope.launch{list.animateScrollToItem(pending+1)}},modifier=Modifier.align(Alignment.BottomCenter).padding(gap)){Text("有一项等你决定")}
        else if(!atEnd) NativeIconButton(R.drawable.wm_down,"回到底部",Modifier.align(Alignment.BottomEnd).padding(gap).background(MaterialTheme.colorScheme.surfaceVariant,CircleShape)){scope.launch{list.animateScrollToItem(list.layoutInfo.totalItemsCount-1)}}
    }
}
@Composable private fun NativeMessage(m: NativeChatModel,e: JSONObject,onPreview:(JSONObject)->Unit) {
    val d=e.optJSONObject("data") ?: JSONObject(); val user=e.optString("type")=="user.message";val text=d.optString("text")
    Column(Modifier.fillMaxWidth(),horizontalAlignment=if(user)Alignment.End else Alignment.Start) {
        Column(Modifier.then(if(user)Modifier.widthIn(max=DesignTokens.space324.dp).clip(card).background(MaterialTheme.colorScheme.surfaceVariant).padding(pad) else Modifier.fillMaxWidth())) {
            val originals=d.optJSONArray("originalAttachments")
            val images=d.optJSONArray("images")
            val attachments=if(originals!=null && images!=null)JSONArray(originals.objects().filter{!it.optString("contentType").startsWith("image/")}+images.objects()) else originals ?: d.optJSONArray("attachments") ?: images ?: d.optJSONArray("thumbnails")
            attachments?.objects()?.takeIf{it.isNotEmpty()}?.let{refs->
                val session = e.optJSONObject("sourceRef")?.optString("sessionId") ?: m.sessionId
                NativeAttachments(refs.map { ref -> JSONObject(ref.toString()).apply {
                    put("conversationId",m.chatId);put("sessionId",session)
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
            NativeIconButton(R.drawable.wm_copy,"复制回复",compact=true){m.launch{m.call("clipboard.copy",JSONObject().put("text",text))}}
            NativeIconButton(R.drawable.wm_chat,"引用回复",compact=true){m.edit("> ${text.take(300).replace("\n","\n> ")}\n\n");m.focused=true}
            NativeIconButton(R.drawable.wm_more,"消息操作",compact=true){m.tab="web-chat"}
        }
    }
}
@Composable internal fun NativeMarkdown(text:String) {
    val parts=text.split("```")
    Column(verticalArrangement=Arrangement.spacedBy(gap)) { parts.forEachIndexed{i,part->
        if(i%2==1) Text(part.substringAfter('\n',part),Modifier.fillMaxWidth().clip(card).background(MaterialTheme.colorScheme.surfaceVariant).horizontalScroll(rememberScrollState()).padding(pad),fontFamily=FontFamily.Monospace,fontSize=DesignTokens.font13.sp)
        else part.trim().split("\n\n").filter{it.isNotBlank()}.forEach{p->Text(inlineMarkdown(p.replace(Regex("(?m)^[-*] "),"• ")),fontSize=DesignTokens.font16.sp,lineHeight=DesignTokens.font24.sp)}
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
        Column(Modifier.fillMaxWidth().border(1.dp,MaterialTheme.colorScheme.outline,card).padding(pad)) {
            Text(if(request.optString("outcome")=="rejected")"正在确认你的拒绝决定" else "正在确认你的批准决定",fontSize=DesignTokens.font14.sp)
            OutlinedButton(onClick={onDecide(request.getString("outcome"),request.optString("scope","once"))},shape=pill){Text("重试原决定")}
        }
        return
    }
    var expanded by remember(row.optString("approvalId")){mutableStateOf(false)}
    var choice by remember(row.optString("approvalId")){mutableStateOf(0)}
    val always=row.optBoolean("canAlwaysAllow")
    Column(Modifier.fillMaxWidth().border(1.dp,MaterialTheme.colorScheme.outline,card).padding(pad),verticalArrangement=Arrangement.spacedBy(gap)) {
        Row(verticalAlignment=Alignment.CenterVertically){Icon(painterResource(R.drawable.wm_check_circle),null,Modifier.size(DesignTokens.space24.dp));Text(row.optString("summary",row.optString("reason","需要你决定")),Modifier.padding(start=gap),fontWeight=FontWeight.SemiBold,fontSize=DesignTokens.font16.sp)}
        if (!always) Text(row.optString("reason").ifBlank{"要允许这次操作吗？"},color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=DesignTokens.font14.sp)
        Row(Modifier.fillMaxWidth().heightIn(min=touch).clickable{expanded=!expanded},verticalAlignment=Alignment.CenterVertically){Text("关键参数与详情",Modifier.weight(1f),color=MaterialTheme.colorScheme.onSurfaceVariant);Icon(painterResource(if(expanded)R.drawable.wm_down else R.drawable.wm_right),"展开详情",Modifier.size(DesignTokens.space20.dp))}
        if(expanded) SelectionContainer{Text(row.optString("details",row.optJSONObject("arguments")?.toString() ?: row.optString("reason")),fontSize=DesignTokens.font13.sp)}
        row.optJSONObject("secondOpinion")?.let{o->Text(if(o.optString("alignment")=="对得上"&&o.optString("externalInfluence")=="没有")"另一个模型看过：和你的要求一致" else "另一个模型提醒：${o.optString("reason")}",fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        if(always) {
            listOf("仅这一次","以后这类都允许","拒绝").forEachIndexed{i,label->Row(Modifier.fillMaxWidth().selectable(choice==i,onClick={choice=i},role=Role.RadioButton),verticalAlignment=Alignment.CenterVertically){RadioButton(choice==i,onClick=null);Text(label)}}
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){Button(onClick={onDecide(if(choice==2)"rejected" else "allowed-once",if(choice==1)"global-category" else "once")},shape=pill){Text("确认")}}
        } else Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(gap,Alignment.End)) {
            OutlinedButton(onClick={onDecide("rejected","once")},shape=pill){Text("拒绝")};Button(onClick={onDecide("allowed-once","once")},shape=pill){Text("批准")}
        }
    }
}
@Composable internal fun NativeQuestion(row:JSONObject,onAnswer:(JSONArray)->Unit) {
    decisionReceipt(row,true)?.let{Text(it,fontSize=DesignTokens.font13.sp);return}
    val qs=row.optJSONArray("questions")?.objects().orEmpty()
    val selected=remember(row.optString("questionRpcId")){mutableStateMapOf<String,List<String>>()}
    val custom=remember(row.optString("questionRpcId")){mutableStateMapOf<String,String>()}
    Column(Modifier.fillMaxWidth().border(1.dp,MaterialTheme.colorScheme.outline,card).padding(pad),verticalArrangement=Arrangement.spacedBy(gap)) {
        Row(verticalAlignment=Alignment.CenterVertically){Icon(painterResource(R.drawable.wm_check_circle),null);Text("需要你选择",Modifier.padding(start=gap),fontWeight=FontWeight.SemiBold)}
        qs.forEach{q->val id=q.getString("id");Text(q.optString("question"),fontSize=DesignTokens.font16.sp);if(q.optString("detail").isNotBlank())Text(q.optString("detail"),color=MaterialTheme.colorScheme.onSurfaceVariant)
            q.optJSONArray("options")?.objects()?.forEach{o->val label=o.optString("label");val checked=selected[id]?.contains(label)==true
                Row(Modifier.fillMaxWidth().selectable(checked,onClick={selected[id]=if(q.optBoolean("multiSelect")){if(checked)selected[id].orEmpty()-label else selected[id].orEmpty()+label}else listOf(label);custom[id]=""},role=if(q.optBoolean("multiSelect"))Role.Checkbox else Role.RadioButton),verticalAlignment=Alignment.CenterVertically){if(q.optBoolean("multiSelect"))Checkbox(checked,null) else RadioButton(checked,null);Text(label)}
            }
            OutlinedTextField(custom[id] ?: "",onValueChange={custom[id]=it;selected[id]=emptyList()},label={Text("补充回答")},modifier=Modifier.fillMaxWidth())
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) {
            Button(onClick={
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
    Column(Modifier.fillMaxWidth().padding(horizontal=pad,vertical=gap).clip(if(expanded)card else pill).background(MaterialTheme.colorScheme.surfaceVariant).padding(gap)) {
        if(m.attachments.isNotEmpty())NativeAttachments(m.attachments,true,{onPreview(JSONObject(it.toString()).put("conversationId",m.chatId).put("sessionId",m.sessionId))},m::remove)
        val input:@Composable ()->Unit={BasicTextField(m.draft,onValueChange=m::edit,modifier=Modifier.fillMaxWidth().heightIn(min=if(expanded)DesignTokens.space56.dp else touch,max=DesignTokens.space220.dp).focusRequester(inputFocus).onFocusChanged{if(it.isFocused)m.focused=true}.padding(gap).semantics{contentDescription="消息输入"},textStyle=TextStyle(color=MaterialTheme.colorScheme.onSurface,fontSize=DesignTokens.font16.sp),cursorBrush=SolidColor(MaterialTheme.colorScheme.primary),maxLines=5,decorationBox={inner->Box{if(m.draft.isEmpty())Text("和 WeftMate 聊聊",color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=DesignTokens.font16.sp);inner()}})}
        if(expanded)input()
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)) {
            Box{NativeIconButton(R.drawable.wm_plus,"添加附件"){plus=true};DropdownMenu(plus,onDismissRequest={plus=false}){listOf("image" to "照片","camera" to "拍照","file" to "文件").forEach{(kind,label)->DropdownMenuItem(text={Text(label)},onClick={plus=false;m.pick(kind)})}}}
            if(!expanded)Box(Modifier.weight(1f)){input()} else Spacer(Modifier.weight(1f))
            if(expanded) {
                Box{NativeIconButton(R.drawable.wm_filter,"审批模式：${modeName(m.mode)}"){modeMenu=true};DropdownMenu(modeMenu,onDismissRequest={modeMenu=false}){listOf("auto","ask","accept-edits","plan","allow-all").forEach{id->DropdownMenuItem(text={Text(modeName(id))},trailingIcon={if(m.mode==id)Icon(painterResource(R.drawable.wm_check),"当前模式")},onClick={modeMenu=false;if(id=="allow-all")allowRisk=true else m.launch{if(m.sessionId.isNotBlank())m.business("/sessions/${m.sessionId}/approval-mode","PATCH",JSONObject().put("mode",id));m.mode=id}})}}}
                Box{NativeIconButton(R.drawable.wm_model,"模型：${m.modelLabel}"){modelMenu=true};DropdownMenu(modelMenu,onDismissRequest={modelMenu=false}){m.models.forEach{row->val id=row.optString("profileId",row.optString("modelId"));DropdownMenuItem(text={Text(row.optString("displayName",id))},trailingIcon={if(id==m.modelId)Icon(painterResource(R.drawable.wm_check),"当前模型")},onClick={modelMenu=false;m.launch{if(id==m.modelId)return@launch;if(row.optString("source")=="phone"){m.call("models.select",JSONObject().put("endpoint",row.getString("endpoint")).put("modelId",row.getString("modelId")))}else {m.call("models.selectHost",JSONObject().put("profileId",id))};m.modelId=id;m.modelLabel=row.optString("displayName",id)}})};DropdownMenuItem(text={Text("管理模型")},onClick={modelMenu=false;m.tab="settings"})}}
            }
            val action=m.composer.action
            if(expanded && action==ComposerAction.Send) NativeIconButton(R.drawable.wm_mic,"语音补充草稿",enabled=!m.running){m.launch{m.call("voice.start",JSONObject().put("conversationId",m.chatId))}}
            NativeIconButton(when(action){ComposerAction.Voice->R.drawable.wm_mic;ComposerAction.Send->R.drawable.wm_arrow;ComposerAction.Stop->R.drawable.wm_stop},when(action){ComposerAction.Voice->"语音输入";ComposerAction.Send->"发送消息";ComposerAction.Stop->"停止回复"},solid=true,enabled=m.sendAvailable || action==ComposerAction.Stop){when(action){ComposerAction.Send->m.send();ComposerAction.Stop->m.stop();ComposerAction.Voice->m.launch{m.call("voice.start",JSONObject().put("conversationId",m.chatId))}}}
        }
    }
    if(allowRisk)AlertDialog(onDismissRequest={allowRisk=false},title={Text("允许所有操作？")},text={Text("删除、覆盖、系统修改、安装、发送和付款可能直接执行，且无法撤销。")},confirmButton={Button(onClick={allowRisk=false;m.launch{if(m.sessionId.isNotBlank())m.business("/sessions/${m.sessionId}/approval-mode","PATCH",JSONObject().put("mode","allow-all"));m.mode="allow-all"}}){Text("全部允许")}},dismissButton={OutlinedButton(onClick={allowRisk=false}){Text("取消")}})
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
private fun findNativeActivity(context:android.content.Context):NativeActivity? = when(context) {
    is NativeActivity -> context
    is android.content.ContextWrapper -> if(context.baseContext!==context)findNativeActivity(context.baseContext) else null
    else -> null
}
@Composable internal fun NativeDialogBars() {
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

