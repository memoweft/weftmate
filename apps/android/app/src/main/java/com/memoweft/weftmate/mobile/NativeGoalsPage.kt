package com.memoweft.weftmate.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.LocalDate

private val goalFilters=listOf("all" to "全部","tasks" to "进行中","schedules" to "定时","goals" to "长期")
private val goalShape=RoundedCornerShape(DesignTokens.radius12.dp)
private val goalPill=RoundedCornerShape(DesignTokens.radius999.dp)
private val gap=DesignTokens.space8.dp
@Composable internal fun GoalsFilter(value:String,choose:(String)->Unit) { NativeFilterRow("筛选目标",goalFilters,value,choose=choose) }
@Composable internal fun NativeGoalsToolbar(model:NativeGoalsModel,onDrawer:()->Unit,onSettings:()->Unit) {
    val sub=model.detail!=null||model.draft!=null||model.webPayload!=null
    Row(Modifier.fillMaxWidth().height(DesignTokens.space80.dp).background(MaterialTheme.colorScheme.background).padding(DesignTokens.space12.dp),verticalAlignment=Alignment.CenterVertically){
        FeedControlIconButton(if(sub)R.drawable.wm_back else R.drawable.wm_panel,if(sub)"返回目标" else "打开侧栏",floating=true){if(model.webPayload!=null)model.closeWeb() else if(sub)model.closeDetail() else onDrawer()}
        Text(if(model.webPayload!=null)"目标" else model.draft?.let{if(it.kind=="schedule")if(it.original==null)"新建定时任务" else "编辑定时任务" else "新建长期目标"} ?: if(model.detail!=null)if(model.showRecords)"执行记录" else "目标详情" else "目标",Modifier.weight(1f),textAlign=androidx.compose.ui.text.style.TextAlign.Center,fontSize=DesignTokens.font18.sp,fontWeight=FontWeight.SemiBold)
        if(sub)Spacer(Modifier.size(DesignTokens.space44.dp)) else FeedControlIconButton(R.drawable.wm_user,"打开个人设置",floating=true,action=onSettings)
    }
}
@Composable internal fun NativeGoalsPage(model:NativeGoalsModel,modifier:Modifier=Modifier) {
    LaunchedEffect(Unit){model.refresh()}
    var confirmation by remember{mutableStateOf<Pair<String,JSONObject>?>(null)}
    val frost=LocalNativeFrost.current
    Box(modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background)) {
        when {
            model.draft!=null -> GoalForm(model,model.draft!!)
            model.detail!=null -> GoalDetail(model)
            else -> {
                val list=rememberLazyListState()
                LaunchedEffect(list.isScrollInProgress){frost?.paused=list.isScrollInProgress}
                DisposableEffect(frost){onDispose{frost?.paused=false}}
                LazyColumn(Modifier.fillMaxSize().then(if(frost!=null)Modifier.frostSource(frost) else Modifier).semantics{contentDescription="目标列表"},state=list,contentPadding=PaddingValues(DesignTokens.space20.dp),verticalArrangement=Arrangement.spacedBy(gap)) {
                    item {Row(verticalAlignment=Alignment.CenterVertically){Text("目标",Modifier.weight(1f),fontSize=DesignTokens.font28.sp,fontWeight=FontWeight.SemiBold);FeedControlIconButton(R.drawable.wm_sync,"刷新目标",enabled=!model.loading&&!model.busy){model.refresh()}}}
                    item {GoalCaption("看看正在做的事，安排之后的事，持续推进想完成的目标。")}
                    if(model.noComputer) item {GoalStateBlock(R.drawable.wm_clock,"安排之后的事","连上电脑后，可以让它按时帮你做事。",actionLabel="去聊天",action={model.returnToChat()})}
                    else {
                        item {GoalsFilter(model.filter,{model.filter=it})}
                        if(model.offline.isNotEmpty())item {GoalCaption("${model.offline.joinToString("、")} 不在线，显示最近一次的列表；连接后可继续操作。")}
                        for((key,name,kind) in listOf(Triple("tasks","进行中","task"),Triple("schedules","定时任务","schedule"),Triple("goals","长期目标","goal")))if(model.filter=="all"||model.filter==key) {
                            item(key="header-$key") {Row(Modifier.fillMaxWidth().padding(top=DesignTokens.space24.dp),verticalAlignment=Alignment.CenterVertically){Text(name,Modifier.weight(1f),fontSize=DesignTokens.font18.sp,fontWeight=FontWeight.SemiBold);if(kind!="task")FeedControlButton(if(kind=="schedule")"新建定时任务" else "新建长期目标",enabled=model.canCreate(kind,model.creationHost),icon=R.drawable.wm_plus,secondary=true){model.newDraft(kind)}}}
                            val rows=model.sections[key].orEmpty();val error=model.errors[key] ?: model.errors["all"]
                            if(rows.isEmpty())item(key="state-$key") {when{model.loading -> GoalSkeleton();error!=null -> GoalStateBlock(R.drawable.wm_warning,"暂时无法读取",error,"重试"){model.refresh()};else -> GoalStateBlock(if(kind=="schedule")R.drawable.wm_clock else if(kind=="goal")R.drawable.wm_check_circle else R.drawable.wm_check_circle,when(kind){"schedule"->"安排下一件事";"goal"->"持续推进想完成的事";else->"现在没有进行中的任务"},when(kind){"schedule"->"新建定时任务，也可以在对话里说“每天早上 8 点提醒我喝水”。";"goal"->"把想持续推进的事关联到一个对话，每次进展都留在原对话。";else->"交代助手做事后，可以在这里查看进展。"})}}
                            if(rows.isNotEmpty()&&error!=null)item{GoalCaption(error);FeedControlButton("重试",secondary=true){model.refresh()}}
                            items(rows,key={"$key:${goalRowKey(it)}"}) {row->GoalRow(model,kind,row,{action->confirmation=action to row})}
                            if(kind=="task")item {var recent by remember{mutableStateOf(false)};FeedControlButton("最近完成 · 保留 7 天",icon=R.drawable.wm_down){recent=!recent};if(recent){if(model.sections["recent"].isNullOrEmpty())GoalCaption("最近 7 天还没有完成的任务。") else Column(verticalArrangement=Arrangement.spacedBy(gap)){model.sections["recent"].orEmpty().forEach{GoalRow(model,"task",it,{})}}}}
                        }
                        item {FeedControlButton("完整目标功能",icon=R.drawable.wm_check_circle){model.openOriginal()};GoalCaption("等电脑上线的事项和完整对话操作可在这里查看。")}
                    }
                }
            }
        }
        if(model.toast.isNotBlank()) {
            val text=model.toast
            LaunchedEffect(text){delay(3000);if(model.toast==text)model.toast=""}
            Text(text,Modifier.align(Alignment.BottomCenter).padding(DesignTokens.space16.dp).background(MaterialTheme.colorScheme.inverseSurface,goalShape).padding(DesignTokens.space12.dp).semantics{liveRegion=LiveRegionMode.Polite},color=MaterialTheme.colorScheme.inverseOnSurface,fontSize=DesignTokens.font15.sp)
        }
    }
    confirmation?.let{(action,row)->Dialog(onDismissRequest={if(!model.busy)confirmation=null}) {
        Surface(shape=RoundedCornerShape(DesignTokens.radius16.dp),color=MaterialTheme.colorScheme.surface){Column(Modifier.padding(DesignTokens.space20.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)){
            Text(if(action=="delete")"删除这个定时任务？" else "归档这个目标？",fontSize=DesignTokens.font18.sp,fontWeight=FontWeight.SemiBold)
            Text(if(action=="delete")"删除后不会再按这个安排运行。已完成的对话记录会保留。" else "目标会从当前列表移出，原对话和执行记录会保留。",fontSize=DesignTokens.font15.sp)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){FeedControlButton("取消",enabled=!model.busy,secondary=true){confirmation=null};GoalPrimary(if(action=="delete")"确认删除" else "确认归档",enabled=!model.busy,danger=true){confirmation=null;model.manage(if(action=="delete")"schedule" else "goal",row,action)}}
        }}
    }}
}
@Composable private fun GoalRow(model:NativeGoalsModel,kind:String,row:JSONObject,confirm:(String)->Unit) {
    val title=row.stringOrEmpty(if(kind=="schedule")"text" else "title");var menu by remember(goalRowKey(row)){mutableStateOf(false)}
    val host=model.computers.firstOrNull{it.stringOrEmpty("hostId")==row.stringOrEmpty("hostId")};val enabled=!model.busy&&host?.optBoolean("online",true)!=false&&!row.optBoolean("computerOffline")
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(DesignTokens.radius26.dp)).background(MaterialTheme.colorScheme.surfaceVariant).clickable{model.open(kind,row)}.padding(DesignTokens.space12.dp),verticalAlignment=Alignment.Top,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)){
        Column(Modifier.weight(1f).padding(vertical=DesignTokens.space8.dp).semantics{contentDescription="打开目标 $title"},verticalArrangement=Arrangement.spacedBy(DesignTokens.space6.dp)){
            Text(title,fontSize=DesignTokens.font15.sp,fontWeight=FontWeight.SemiBold,lineHeight=DesignTokens.font24.sp,maxLines=3,overflow=TextOverflow.Ellipsis)
            if(kind=="schedule"){GoalCaption(listOf(goalFrequency(row),goalState(row),row.stringOrEmpty("nextRunAt").takeIf{it.isNotEmpty()&&row.stringOrEmpty("state")=="scheduled"}?.let{"下次 ${goalTime(it,row.stringOrEmpty("timeZone"))}"}).filterNotNull().joinToString(" · "));GoalCaption(goalResult(row))}
            else if(kind=="goal"){if(row.stringOrEmpty("description").isNotEmpty())GoalCaption(row.getString("description"));GoalCaption("${goalState(row)} · ${row.stringOrEmpty("progress")}")}
            else{GoalCaption("${goalState(row)} · ${row.stringOrEmpty("step")}");GoalCaption("${if(row.isNull("startedAt"))"已等待" else "已运行"} ${row.optLong("elapsedSeconds")/60} 分钟")}
            GoalCaption(row.stringOrEmpty("conversationTitle").ifEmpty{if(row.optBoolean("temporary"))"临时对话" else model.sessions.firstOrNull{goalSession(it)==goalSession(row)&&it.stringOrEmpty("hostId")==row.stringOrEmpty("hostId")}?.stringOrEmpty("title").orEmpty().ifEmpty{"所属对话"}})
            goalComputerLabel(row,model.computers).takeIf{it.isNotEmpty()}?.let{GoalCaption(it)}
        }
        if(kind=="schedule"&&row.stringOrEmpty("state")!="completed") GoalSwitch(row.stringOrEmpty("state")!="paused","启用 $title",enabled){model.manage(kind,row,if(it)"resume" else "pause")}
        Box {
            FeedControlIconButton(R.drawable.wm_more,"更多操作 $title"){menu=true}
            GoalMenu(menu,{menu=false}) {
                fun action(name:String,icon:Int,danger:Boolean=false,allowed:Boolean=true,work:()->Unit) {} // entries below share the standard control
                if(kind=="schedule"){
                    FeedControlMenuItem("编辑",enabled=enabled,icon=R.drawable.wm_edit){menu=false;model.newDraft(kind,row)}
                    FeedControlMenuItem("立即运行",enabled=enabled,icon=R.drawable.wm_play){menu=false;model.manage(kind,row,"run")}
                    FeedControlMenuItem("查看记录",icon=R.drawable.wm_clock){menu=false;model.open(kind,row,true)}
                }else if(kind=="goal"){
                    FeedControlMenuItem("查看目标详情",icon=R.drawable.wm_check_circle){menu=false;model.open(kind,row)}
                    if(row.stringOrEmpty("phase")!="complete")FeedControlMenuItem("完成目标",enabled=enabled,icon=R.drawable.wm_check){menu=false;model.manage(kind,row,"complete")}
                }else if(row.optBoolean("canStop"))FeedControlMenuItem("停止",enabled=enabled,icon=R.drawable.wm_stop){menu=false;model.manage(kind,row,"stop")}
                FeedControlMenuItem("打开所属对话",icon=R.drawable.wm_chat){menu=false;model.openSource(row)}
                if(kind!="task")FeedControlMenuItem(if(kind=="schedule")"删除" else "归档目标",enabled=enabled,danger=true,icon=R.drawable.wm_trash,dangerSoftColor=Color(if(model.dark)DesignTokens.nativeDarkDangerSoft else DesignTokens.nativeDangerSoft)){menu=false;confirm(if(kind=="schedule")"delete" else "archive")}
            }
        }
    }
}
@Composable private fun GoalDetail(model:NativeGoalsModel) {
    val row=model.detail ?: return;val kind=model.detailKind
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(DesignTokens.space20.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)) {
        Text(row.stringOrEmpty(if(kind=="schedule")"text" else "title"),fontSize=DesignTokens.font18.sp,fontWeight=FontWeight.SemiBold)
        GoalCaption(goalState(row));goalComputerLabel(row,model.computers).takeIf{it.isNotEmpty()}?.let{GoalCaption(it)}
        if(kind=="schedule") {GoalCaption(goalFrequency(row));GoalCaption(row.stringOrEmpty("nextRunAt").takeIf{it.isNotEmpty()}?.let{"下次 ${goalTime(it,row.stringOrEmpty("timeZone"))}"} ?: "");GoalCaption(goalResult(row));FeedControlButton("编辑",secondary=true,icon=R.drawable.wm_edit,enabled=model.offline.isEmpty()){model.newDraft(kind,row)};FeedControlButton("查看记录",secondary=true,icon=R.drawable.wm_clock){model.loadRecords()}}
        if(kind=="goal") {Text(row.stringOrEmpty("description"),fontSize=DesignTokens.font15.sp);GoalCaption(row.stringOrEmpty("progress"));GoalCaption("目标进展和检查点留在原对话中。编辑目标或调整检查点，请在所属对话中交代。");FeedControlButton("编辑目标与检查点",secondary=true,icon=R.drawable.wm_edit){model.openSource(row)}}
        if(kind=="task")GoalCaption(row.stringOrEmpty("step"))
        FeedControlButton("打开所属对话",secondary=true,icon=R.drawable.wm_chat){model.openSource(row)}
        if(model.showRecords){Text("执行记录",fontSize=DesignTokens.font18.sp,fontWeight=FontWeight.SemiBold)
            when {model.recordsLoading -> GoalSkeleton();model.recordsError.isNotEmpty() -> GoalStateBlock(R.drawable.wm_warning,"暂时无法读取",model.recordsError,"重试"){model.loadRecords()};model.records.isEmpty() -> GoalStateBlock(R.drawable.wm_clock,"还没有执行记录","到点运行后，记录会出现在这里。完整步骤可在所属对话查看。")}
            model.records.forEach{record->Column(Modifier.fillMaxWidth().clip(goalShape).background(MaterialTheme.colorScheme.surfaceVariant).clickable{model.openSource(record.put("hostId",row.stringOrEmpty("hostId")))}.padding(DesignTokens.space12.dp)){Text(record.stringOrEmpty("text"),fontSize=DesignTokens.font15.sp);GoalCaption("${goalTime(record.opt("createdAt"),row.stringOrEmpty("timeZone"))} · ${if(record.stringOrEmpty("kind")=="task")"已交给助手执行" else "已提醒"}")}}
        }
    }
}
@Composable private fun GoalForm(model:NativeGoalsModel,d:GoalDraft) {
    var revision by remember(d){mutableIntStateOf(0)};@Suppress("UNUSED_VARIABLE") val changes=revision
    val editable=!model.busy&&d.pending==null
    fun change(action:()->Unit){action();revision++}
    Column(Modifier.fillMaxSize()){
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).semantics{contentDescription="目标表单"}.padding(DesignTokens.space20.dp).background(MaterialTheme.colorScheme.surfaceVariant,goalShape).padding(DesignTokens.space12.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)){
            GoalInput(if(d.kind=="schedule")"要做什么" else "目标标题",d.title,editable,true){change{d.title=it}}
            if(model.computers.size>1)GoalChoice("在哪台电脑上做",d.hostId,model.computers.filter{it.optBoolean("online",true)}.map{it.getString("hostId") to it.stringOrEmpty("displayName").ifEmpty{it.stringOrEmpty("name")}},enabled=editable&&d.original==null){id->change{d.hostId=id;d.session=model.sessions.firstOrNull{it.stringOrEmpty("hostId")==id&&it.optBoolean("taskAvailable",true)}?.let(::goalSession).orEmpty()}}
            GoalChoice("所属对话",d.session,model.sessions.filter{it.stringOrEmpty("hostId")==d.hostId&&it.optBoolean("taskAvailable",true)}.map{goalSession(it) to if(it.optBoolean("temporary")||it.optBoolean("hasTemporaryContent"))"临时对话" else it.stringOrEmpty("title").ifEmpty{"旁聊"}},enabled=editable&&d.original==null){change{d.session=it}}
            if(d.kind=="schedule") {
                GoalChoice("到点做什么",d.mode,listOf("reminder" to "提醒我","task" to "让助手执行"),editable){change{d.mode=it}}
                GoalChoice("重复",d.repeat,listOf("once" to "一次性","daily" to "每天","weekly" to "每周","monthly" to "每月","interval" to "固定间隔"),editable){change{d.repeat=it}}
                if(d.repeat=="once") {GoalCaption("日期");val date=runCatching{LocalDate.parse(d.date)}.getOrDefault(LocalDate.now());Row(horizontalArrangement=Arrangement.spacedBy(gap)){
                    GoalChoice("年",date.year.toString(),(minOf(LocalDate.now().year,date.year)..maxOf(LocalDate.now().year+10,date.year)).map{it.toString() to "${it}年"},editable,Modifier.weight(1f)){change{d.date=LocalDate.of(it.toInt(),date.monthValue,minOf(date.dayOfMonth,java.time.YearMonth.of(it.toInt(),date.monthValue).lengthOfMonth())).toString()}}
                    GoalChoice("月",date.monthValue.toString(),(1..12).map{it.toString() to "${it}月"},editable,Modifier.weight(1f)){change{d.date=LocalDate.of(date.year,it.toInt(),minOf(date.dayOfMonth,java.time.YearMonth.of(date.year,it.toInt()).lengthOfMonth())).toString()}}
                    GoalChoice("日",date.dayOfMonth.toString(),(1..date.lengthOfMonth()).map{it.toString() to "${it}日"},editable,Modifier.weight(1f)){change{d.date=date.withDayOfMonth(it.toInt()).toString()}}
                }}
                if(d.repeat=="interval")GoalInput("间隔秒数（至少 300 秒）",d.seconds,editable){change{d.seconds=it}}
                else {GoalCaption("时间");Row(horizontalArrangement=Arrangement.spacedBy(gap)){
                    GoalChoice("小时",d.time.substringBefore(':'),(0..23).map{it.toString().padStart(2,'0').let{n->n to n}},editable,Modifier.weight(1f)){change{d.time="$it:${d.time.substringAfter(':')}"}}
                    GoalChoice("分钟",d.time.substringAfter(':'),(0..59).map{it.toString().padStart(2,'0').let{n->n to n}},editable,Modifier.weight(1f)){change{d.time="${d.time.substringBefore(':')}:$it"}}
                }}
                if(d.repeat=="weekly")GoalChoice("星期",d.weekday.toString(),(0..6).map{it.toString() to "星期${"日一二三四五六"[it]}"},editable){change{d.weekday=it.toInt()}}
                if(d.repeat=="monthly")GoalChoice("每月几日",d.monthday.toString(),(1..31).map{it.toString() to "${it} 日"},editable){change{d.monthday=it.toInt()}}
                GoalCaption("按电脑上的当地时间安排；每月不存在的日期会跳过，电脑离线时恢复后补送。")
            } else {GoalInput("目标说明与检查点",d.description,editable,true){change{d.description=it}};GoalCaption("检查点会作为目标说明保存；每个对话同时保留一个目标。执行进展与结果在原对话查看。")}
            if(model.formError.isNotEmpty())Text(model.formError,color=MaterialTheme.colorScheme.error,fontSize=DesignTokens.font15.sp,modifier=Modifier.semantics{liveRegion=LiveRegionMode.Assertive})
            if(d.pending!=null)GoalCaption("正在确认上次保存的结果，请用原内容重试。")
        }
        Row(Modifier.fillMaxWidth().padding(DesignTokens.space16.dp),horizontalArrangement=Arrangement.End,verticalAlignment=Alignment.CenterVertically){FeedControlButton("取消",enabled=!model.busy,secondary=true){model.closeDetail()};Spacer(Modifier.width(gap));GoalPrimary(if(model.busy)"正在保存" else if(d.pending!=null)"重试保存" else "保存",enabled=!model.busy){model.save()}}
    }
}
@Composable private fun GoalInput(label:String,value:String,enabled:Boolean,multiline:Boolean=false,change:(String)->Unit) {
    Column(verticalArrangement=Arrangement.spacedBy(gap)){GoalCaption(label);OutlinedTextField(value,change,enabled=enabled,modifier=Modifier.fillMaxWidth().semantics{contentDescription=label},textStyle=androidx.compose.ui.text.TextStyle(fontSize=DesignTokens.font15.sp),singleLine=!multiline,minLines=if(multiline)2 else 1,shape=goalShape,colors=OutlinedTextFieldDefaults.colors(focusedContainerColor=MaterialTheme.colorScheme.surface,unfocusedContainerColor=MaterialTheme.colorScheme.surface,disabledContainerColor=MaterialTheme.colorScheme.surface,focusedBorderColor=MaterialTheme.colorScheme.primary,unfocusedBorderColor=MaterialTheme.colorScheme.outline))}
}
@Composable internal fun GoalChoice(label:String,value:String,options:List<Pair<String,String>>,enabled:Boolean=true,modifier:Modifier=Modifier,choose:(String)->Unit) {
    var menu by remember{mutableStateOf(false)}
    Column(modifier,verticalArrangement=Arrangement.spacedBy(gap)){GoalCaption(label);Box{FeedControlButton(options.find{it.first==value}?.second ?: "选择",enabled=enabled&&options.isNotEmpty(),secondary=true,choice=true,trailingIcon=R.drawable.wm_down,contentDescription="选择$label：${options.find{it.first==value}?.second.orEmpty()}",modifier=Modifier.fillMaxWidth()){menu=true};GoalMenu(menu,{menu=false}){options.forEach{(id,name)->FeedControlMenuItem(name,checked=id==value,modifier=Modifier.semantics{contentDescription="选择$label 选项：$name"}){menu=false;choose(id)}}}}}
}
@Composable private fun GoalPrimary(label:String,enabled:Boolean=true,danger:Boolean=false,action:()->Unit) {
    // Reuse the same feedback/focus implementation as AND-5, with the one primary fill.
    FeedControlButton(label,enabled=enabled,primary=!danger,danger=danger,loading=label=="正在保存",action=action)
}
@Composable private fun GoalSwitch(checked:Boolean,label:String,enabled:Boolean,change:(Boolean)->Unit) {
    Box(Modifier.size(DesignTokens.space44.dp).semantics{contentDescription=label;stateDescription=if(checked)"已启用" else "已暂停";toggleableState=if(checked)androidx.compose.ui.state.ToggleableState.On else androidx.compose.ui.state.ToggleableState.Off}.clip(goalPill).clickable(enabled=enabled,role=Role.Switch){change(!checked)},contentAlignment=Alignment.Center){Box(Modifier.width(DesignTokens.space40.dp).height(DesignTokens.space24.dp).background(if(checked)MaterialTheme.colorScheme.primary else Color(if(LocalNativeDark.current)DesignTokens.nativeDarkMuted else DesignTokens.nativeMuted),goalPill).padding(DesignTokens.space3.dp)){Box(Modifier.size(DesignTokens.space18.dp).align(if(checked)Alignment.CenterEnd else Alignment.CenterStart).background(if(checked)MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.surface,goalPill))}}
}
@Composable private fun GoalMenu(open:Boolean,dismiss:()->Unit,content:@Composable ColumnScope.()->Unit) {FeedControlMenu(open,dismiss,dark=LocalNativeDark.current,floatColor=Color(if(LocalNativeDark.current)DesignTokens.nativeDarkSurfaceFloat else DesignTokens.nativeSurfaceFloat),fallbackColor=Color(if(LocalNativeDark.current)DesignTokens.nativeDarkFloatOpaque else DesignTokens.nativeFloatOpaque),content=content)}
@Composable private fun GoalCaption(text:String){if(text.isNotEmpty())Text(text,color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=DesignTokens.font13.sp,lineHeight=DesignTokens.font18.sp)}
@Composable private fun GoalStateBlock(icon:Int,title:String,text:String,actionLabel:String?=null,action:()->Unit={}) {
    Row(Modifier.fillMaxWidth().padding(vertical=DesignTokens.space20.dp),horizontalArrangement=Arrangement.spacedBy(DesignTokens.space12.dp)) {
        Icon(painterResource(icon),null,Modifier.size(DesignTokens.space20.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(DesignTokens.space6.dp)) {
            Text(title,fontSize=DesignTokens.font14.sp,fontWeight=FontWeight.Medium)
            GoalCaption(text)
            if(actionLabel!=null)FeedControlButton(actionLabel,secondary=true,action=action)
        }
    }
}
@Composable private fun GoalSkeleton(){Column(Modifier.fillMaxWidth().semantics{contentDescription="正在读取目标"}.background(MaterialTheme.colorScheme.surfaceVariant,goalShape).padding(DesignTokens.space20.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)){repeat(2){Column(verticalArrangement=Arrangement.spacedBy(gap)){Box(Modifier.fillMaxWidth(.7f).height(DesignTokens.space16.dp).background(MaterialTheme.colorScheme.outline,goalShape));Box(Modifier.fillMaxWidth(.5f).height(DesignTokens.space12.dp).background(MaterialTheme.colorScheme.outline,goalShape))}}}}
