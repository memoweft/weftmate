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

@OptIn(ExperimentalFoundationApi::class)
@Composable internal fun NativeConversation(m: NativeChatModel, modifier: Modifier, bottom:()->androidx.compose.ui.unit.Dp, onPreview:(JSONObject)->Unit) {
    val list=rememberLazyListState();val scope=rememberCoroutineScope()
    val frost=LocalNativeFrost.current
    LaunchedEffect(list.isScrollInProgress) { frost?.paused=list.isScrollInProgress }
    DisposableEffect(frost) { onDispose { frost?.paused=false } }
    val activityForTimeline=LocalContext.current as NativeActivity
    val rows by produceState(emptyList<JSONObject>(),m.chatId,m.rows,m.approvals,m.questions) {
        value=nativeTurnRows(activityForTimeline.timelinePresentation(m.rows,m.approvals,m.questions))
    }
    val progressState=remember(m.chatId) { NativeProgressState() }
    val feed=(LocalContext.current as? NativeActivity)?.feed
    val pending=rows.indexOfFirst{r->val d=r.optJSONObject("data");m.approvals.any{it.optString("approvalId")==d?.optString("approvalId")&&it.optString("status")=="pending"} || m.questions.any{it.optString("questionRpcId")==d?.optString("questionRpcId")&&it.optString("status")=="pending"}}
    val visible by remember { derivedStateOf { list.layoutInfo.visibleItemsInfo.map{it.index} } }
    val atEnd by remember { derivedStateOf { !list.canScrollForward } }
    val dragged by list.interactionSource.collectIsDraggedAsState()
    val follow=rememberFollowBottom(list,list.interactionSource,m.chatId)
    val answered=remember(rows) { answeredProgress(rows) }
    val focus=LocalFocusManager.current
    val activity=LocalContext.current as? NativeActivity
    fun dismissEditor() { focus.clearFocus();m.focused=false;activity?.hideKeyboard() }
    LaunchedEffect(dragged) { if(dragged)dismissEditor() }
    LaunchedEffect(m.scrollVersion) { follow.resume() }
    LaunchedEffect(m.fileAnchor,rows.size) { if(m.fileAnchor.isNotBlank()){val index=rows.indexOfFirst{it.optString("eventId")==m.fileAnchor};if(index>=0){follow.pause();list.scrollToItem(index+1);m.fileAnchor=""}} }
    var lastDecision by remember(m.chatId) { mutableStateOf("") }
    LaunchedEffect(rows.size,rows.lastOrNull()?.toString(),m.running,m.error) { if(follow.on && feed?.focusTarget==null && rows.isNotEmpty()){withFrameNanos{};list.scrollToItem((list.layoutInfo.totalItemsCount-1).coerceAtLeast(0))} }

    LaunchedEffect(pending) { if(follow.on && feed?.focusTarget==null && pending>=0 && rows[pending].optString("eventId")!=lastDecision){lastDecision=rows[pending].optString("eventId");list.animateScrollToItem(pending+1)} }
    LaunchedEffect(m.chatId,rows.size,feed?.focusTarget) {
        feed?.focusTarget?.let{target->
            val index=rows.indexOfFirst{feedTargetMatches(it,target)}
            if(index>=0){follow.pause();withFrameNanos{};list.scrollToItem(index+1);feed.focusTarget=null}
        }
    }
    val padding=remember(bottom) { object:PaddingValues {
        override fun calculateLeftPadding(layoutDirection:androidx.compose.ui.unit.LayoutDirection)=DesignTokens.space20.dp
        override fun calculateRightPadding(layoutDirection:androidx.compose.ui.unit.LayoutDirection)=DesignTokens.space20.dp
        override fun calculateTopPadding()=(DesignTokens.space80+DesignTokens.space24).dp
        override fun calculateBottomPadding()=bottom()+DesignTokens.space24.dp
    } }
    val previousViewport=remember { arrayOfNulls<Pair<Int,Int>>(1) }
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val bubbleMaxWidth=(maxWidth-DesignTokens.space20.dp*2)*.9f
        LazyColumn(state=list,modifier=Modifier.fillMaxSize().pointerInput(Unit){detectTapGestures(onTap={position->if(position.y>=DesignTokens.space80.dp.toPx() && position.y<size.height-bottom().toPx())dismissEditor()})}.layout { measurable,constraints ->
            val geometry=constraints.maxHeight to padding.calculateBottomPadding().roundToPx()
            if(previousViewport[0]!=geometry) {
                previousViewport[0]=geometry
                if(follow.on && feed?.focusTarget==null && list.layoutInfo.totalItemsCount>0) list.requestScrollToItem(list.layoutInfo.totalItemsCount-1)
            }
            val child=measurable.measure(constraints)
            layout(child.width,child.height){child.placeRelative(0,0)}
        }.semantics{contentDescription="消息列表"},contentPadding=padding,verticalArrangement=Arrangement.spacedBy(nativePad)) {
            item { if(m.hasOlder) NativeSecondary(onClick={follow.pause();m.launch{m.refresh(true)}}){Text("较早的消息")} }
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
                if(date!=null && (i==0 || day(rows[i-1])!=date)) Text(when(date){LocalDate.now(zone)->"今天";LocalDate.now(zone).minusDays(1)->"昨天";else->"${date.monthValue}月${date.dayOfMonth}日"},Modifier.padding(bottom=nativeGap),fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                when(type) {
                    "user.message","assistant.message","assistant.delta" -> NativeMessage(m,e,bubbleMaxWidth,onPreview)
                    "artifact.created" -> NativeArtifactFiles(e,m,onPreview)
                    "approval.requested" -> m.approvals.find{it.optString("approvalId")==d.optString("approvalId")}?.let{ if(m.workAndChat && it.stringOrEmpty("intent")=="work-switch")NativeWorkSwitch(m,it) else NativeApproval(it,d.optJSONObject("copy")){outcome,decisionScope->m.decide(it,outcome,decisionScope)} }
                    "question.requested" -> m.questions.find{it.optString("questionRpcId")==d.optString("questionRpcId")}?.let{ NativeQuestion(it){answers->m.answer(it,answers)} }
                    "native.progress" -> NativeProgress(e,progressState,e.optString("eventId") in answered)
                }
            }
            items(m.uncertain){row->Column { Text(row.optString("text"),fontSize=DesignTokens.font18.sp);Text(hostDeliveryMessage(row),color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=DesignTokens.font12.sp);if(row.optString("state")=="uncertain") NativeSecondary(onClick={m.checkDelivery()}){Text("核对消息")} } }
            if((m.phone || m.phoneHistory) && !m.standalone && m.rows.isNotEmpty()) item { Text(if(m.phoneHistory)"这段是在手机上聊的，只供查看。要用电脑的能力，请新开对话。" else "这段是在手机上聊的。要用电脑的能力，请新开对话，或在电脑上继续这段对话。",fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant) }
            item { if(m.error.isNotBlank()) Column(Modifier.fillMaxWidth().clip(nativeCard).background(MaterialTheme.colorScheme.errorContainer).padding(nativePad).semantics{contentDescription="回复出错"},verticalArrangement=Arrangement.spacedBy(nativeGap)) { Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(nativeGap)){Icon(painterResource(R.drawable.wm_warning),null,Modifier.size(DesignTokens.space16.dp),tint=MaterialTheme.colorScheme.error);Text(m.error,fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurface)};if(m.canRetryPhoneReply) NativeSecondary(onClick={m.retryPhoneReply()}){Text("重试")} else if(m.phoneArchive) { if(m.canRetryQueue) NativeSecondary(onClick={m.retryQueue()}){Text("重试排队消息")} else if(m.canRegenerate && m.rows.lastOrNull()?.optString("type")=="user.message") NativeSecondary(onClick={m.regenerate()},modifier=Modifier.semantics{contentDescription="重新生成回复"}){Text("重试回复")} } else NativeSecondary(onClick={m.launch{m.refresh()}}){Text("重试连接")} } else if(m.running)Text("正在回复…",fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if(pending>=0 && pending+1 !in visible) FilledTonalButton(onClick={scope.launch{list.animateScrollToItem(pending+1)}},modifier=Modifier.align(Alignment.BottomCenter).padding(bottom=bottom()+nativeGap,start=nativeGap,end=nativeGap)){Text("有一项等你决定")}
        else if(!atEnd) NativeIconButton(R.drawable.wm_down,"回到底部",Modifier.align(Alignment.BottomEnd).padding(bottom=bottom()+nativeGap,start=nativeGap,end=nativeGap).background(MaterialTheme.colorScheme.surfaceVariant,CircleShape)){follow.resume();scope.launch{list.animateScrollToItem(list.layoutInfo.totalItemsCount-1)}}
    }
}
@Composable internal fun NativeMessage(m: NativeChatModel,e: JSONObject,bubbleMaxWidth:androidx.compose.ui.unit.Dp,onPreview:(JSONObject)->Unit) {
    val d=e.optJSONObject("data") ?: JSONObject(); val user=e.optString("type")=="user.message";val text=d.optString("text")
    Column(Modifier.fillMaxWidth(),horizontalAlignment=if(user)Alignment.End else Alignment.Start) {
        Column(Modifier.then(if(user)Modifier.widthIn(max=bubbleMaxWidth).clip(nativeBubble).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal=DesignTokens.space20.dp,vertical=DesignTokens.space12.dp) else Modifier.fillMaxWidth())) {
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
            SelectionContainer{NativeMarkdown(text,onCopyCode=if(user)null else m::copyReply)}
            if(user && d.optBoolean("queued")) Text("排队中",fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if(!user && e.optString("type")!="assistant.delta") Row {
            NativeIconButton(R.drawable.wm_copy,"复制回复",compact=true){m.copyReply(text)}
            NativeIconButton(R.drawable.wm_chat,"引用回复",compact=true){m.edit("> ${text.take(300).replace("\n","\n> ")}\n\n");m.focused=true}
            if(m.phoneArchive) { if(m.canRegenerate && e.optString("eventId")==m.rows.lastOrNull()?.optString("eventId")) NativeIconButton(R.drawable.wm_refresh,"重新生成回复",compact=true){m.regenerate()} } else NativeIconButton(R.drawable.wm_more,"消息操作",compact=true){m.tab="web-chat"}
        }
    }
}
@Composable internal fun NativeApproval(row:JSONObject,copy:JSONObject?=null,onDecide:(String,String)->Unit) {
    val receipt=decisionReceipt(row)
    if(receipt!=null){Text(receipt,fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);return}
    row.optJSONObject("nativeDecision")?.let { request ->
        Column(Modifier.fillMaxWidth().clip(nativeCard).background(MaterialTheme.colorScheme.surface).border(1.dp,MaterialTheme.colorScheme.outline,nativeCard).padding(nativePad)) {
            Text(if(request.optString("outcome")=="rejected")"正在确认你的拒绝决定" else "正在确认你的批准决定",fontSize=DesignTokens.font14.sp)
            NativeSecondary(onClick={onDecide(request.getString("outcome"),request.optString("scope","once"))},shape=nativePill){Text("重试原决定")}
        }
        return
    }
    var expanded by remember(row.optString("approvalId")){mutableStateOf(false)}
    var choice by remember(row.optString("approvalId")){mutableStateOf(0)}
    val always=row.optBoolean("canAlwaysAllow")
    Column(Modifier.fillMaxWidth().clip(nativeCard).background(MaterialTheme.colorScheme.surface).border(1.dp,MaterialTheme.colorScheme.outline,nativeCard).padding(nativePad),verticalArrangement=Arrangement.spacedBy(nativeGap)) {
        Row(verticalAlignment=Alignment.CenterVertically){Icon(painterResource(R.drawable.wm_check_circle),null,Modifier.size(DesignTokens.space24.dp));Text("要" + (copy?.optString("summary") ?: "进行这项操作"),Modifier.padding(start=nativeGap),fontWeight=FontWeight.SemiBold,fontSize=DesignTokens.font16.sp)}
        Row(Modifier.fillMaxWidth().heightIn(min=nativeTouch).clickable{expanded=!expanded},verticalAlignment=Alignment.CenterVertically){Text("查看详情",Modifier.weight(1f),color=MaterialTheme.colorScheme.onSurfaceVariant);Icon(painterResource(if(expanded)R.drawable.wm_down else R.drawable.wm_right),"展开详情",Modifier.size(DesignTokens.space20.dp))}
        if(expanded) SelectionContainer{Text(copy?.optString("raw") ?: row.optString("reason"),fontSize=DesignTokens.font13.sp)}
        row.optJSONObject("secondOpinion")?.let{o->Text(if(o.optString("alignment")=="对得上"&&o.optString("externalInfluence")=="没有")"另一个模型看过：和你的要求一致" else "另一个模型提醒：${o.optString("reason")}",fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        if(always) {
            listOf("仅这一次","以后这类都允许","拒绝").forEachIndexed{i,label->Row(Modifier.fillMaxWidth().heightIn(min=nativeTouch).clip(RoundedCornerShape(DesignTokens.radius12.dp)).background(if(choice==i)MaterialTheme.colorScheme.surfaceVariant else Color.Transparent).selectable(choice==i,onClick={choice=i},role=Role.RadioButton),verticalAlignment=Alignment.CenterVertically){RadioButton(choice==i,onClick=null,colors=nativeRadioColors());Text(label)}}
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){NativePrimary(onClick={onDecide(if(choice==2)"rejected" else "allowed-once",if(choice==1)"global-category" else "once")},shape=nativePill){Text("确认")}}
        } else Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(nativeGap,Alignment.End)) {
            NativeSecondary(onClick={onDecide("rejected","once")},shape=nativePill){Text("拒绝")};NativePrimary(onClick={onDecide("allowed-once","once")},shape=nativePill){Text("批准")}
        }
    }
}
@Composable internal fun NativeQuestion(row:JSONObject,onAnswer:(JSONArray)->Unit) {
    decisionReceipt(row,true)?.let{Text(it,fontSize=DesignTokens.font13.sp);return}
    val qs=row.optJSONArray("questions")?.objects().orEmpty()
    val selected=remember(row.optString("questionRpcId")){mutableStateMapOf<String,List<String>>()}
    val custom=remember(row.optString("questionRpcId")){mutableStateMapOf<String,String>()}
    Column(Modifier.fillMaxWidth().clip(nativeCard).background(MaterialTheme.colorScheme.surface).border(1.dp,MaterialTheme.colorScheme.outline,nativeCard).padding(nativePad),verticalArrangement=Arrangement.spacedBy(nativeGap)) {
        Row(verticalAlignment=Alignment.CenterVertically){Icon(painterResource(R.drawable.wm_check_circle),null);Text("需要你选择",Modifier.padding(start=nativeGap),fontWeight=FontWeight.SemiBold)}
        qs.forEach{q->val id=q.getString("id");Text(q.optString("question"),fontSize=DesignTokens.font16.sp);if(q.optString("detail").isNotBlank())Text(q.optString("detail"),color=MaterialTheme.colorScheme.onSurfaceVariant)
            q.optJSONArray("options")?.objects()?.forEach{o->val label=o.optString("label");val checked=selected[id]?.contains(label)==true
                Row(Modifier.fillMaxWidth().heightIn(min=nativeTouch).selectable(checked,onClick={selected[id]=if(q.optBoolean("multiSelect")){if(checked)selected[id].orEmpty()-label else selected[id].orEmpty()+label}else listOf(label);custom[id]=""},role=if(q.optBoolean("multiSelect"))Role.Checkbox else Role.RadioButton),verticalAlignment=Alignment.CenterVertically){if(q.optBoolean("multiSelect"))Checkbox(checked,null) else RadioButton(checked,null,colors=nativeRadioColors());Text(label)}
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
            },enabled=qs.all{selected[it.getString("id")]?.isNotEmpty()==true||custom[it.getString("id")]?.isNotBlank()==true},shape=nativePill){Text("确认选择")}
        }
    }
}

@Composable internal fun NativeAttachments(rows:List<JSONObject>,removable:Boolean,onPreview:(JSONObject)->Unit,onRemove:(JSONObject)->Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(nativeGap)) { rows.forEach{row->Box(Modifier.size((DesignTokens.space48 * 2).dp).clip(nativeCard).border(1.dp,MaterialTheme.colorScheme.outline,nativeCard).clickable{onPreview(row)}) {
        NativeAttachmentContent(row)
        if(removable)NativeIconButton(R.drawable.wm_close,"移除附件：${row.optString("name")}",Modifier.align(Alignment.TopEnd).background(MaterialTheme.colorScheme.surface,CircleShape)){onRemove(row)}
    }} }
}
@Composable internal fun NativeAttachmentContent(row:JSONObject) {
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
    else Column(Modifier.fillMaxSize().padding(nativeGap),verticalArrangement=Arrangement.Center){Icon(painterResource(if(row.optString("kind")=="image")R.drawable.wm_image else R.drawable.wm_file),null);Text(row.optString("name","附件"),maxLines=2,overflow=TextOverflow.Ellipsis,fontSize=DesignTokens.font12.sp)}
}
internal fun findNativeActivity(context:android.content.Context):NativeActivity? = when(context) {
    is NativeActivity -> context
    is android.content.ContextWrapper -> if(context.baseContext!==context)findNativeActivity(context.baseContext) else null
    else -> null
}
