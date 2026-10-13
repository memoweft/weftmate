package com.memoweft.weftmate.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.interaction.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.LocalDate

private val gap=DesignTokens.space12.dp
@Composable internal fun HealthCaption(text:String,modifier:Modifier=Modifier) { Text(healthText(text),modifier,fontSize=DesignTokens.font12.sp,lineHeight=DesignTokens.space20.sp,color=Color(if(LocalNativeDark.current)DesignTokens.nativeDarkSecondary else DesignTokens.healthMutedLight)) }
@Composable private fun HealthBody(text:String) { SelectionContainer{Text(healthText(text),fontSize=DesignTokens.font15.sp,lineHeight=DesignTokens.font24.sp)} }
@Composable private fun HealthCard(title:String,modifier:Modifier=Modifier,insight:Boolean=false,contentPadding:Int=DesignTokens.space16,radius:Int=DesignTokens.radius24,hero:String?=null,heroData:JSONObject=JSONObject(),content:@Composable ColumnScope.()->Unit) {
    val dark=LocalNativeDark.current
    val backdrop=if(hero!=null&&!dark)Modifier.background(Brush.verticalGradient(0f to healthSoftColor(hero,heroData),.85f to Color(DesignTokens.healthCardLight))) else Modifier.background(if(dark)MaterialTheme.colorScheme.surface else Color(DesignTokens.healthCardLight))
    Box(modifier.fillMaxWidth().clip(RoundedCornerShape(radius.dp)).then(backdrop).then(if(title.isNotBlank())Modifier.semantics{contentDescription=title} else Modifier)) {
        CompositionLocalProvider(LocalContentColor provides Color(if(dark)DesignTokens.nativeDarkInk else DesignTokens.healthInkLight)) {
            Column(Modifier.padding(contentPadding.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)) {
                if(title.isNotBlank()) {
                    if(insight) Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)){Icon(painterResource(R.drawable.wm_heart),null,Modifier.size(DesignTokens.space18.dp),tint=healthColor("sleep",dark));Text(title,fontSize=DesignTokens.font15.sp,fontWeight=FontWeight.SemiBold,color=Color(if(dark)DesignTokens.nativeDarkSecondary else DesignTokens.healthMutedLight))}
                    else Text(title,fontSize=DesignTokens.font16.sp,fontWeight=FontWeight.SemiBold,color=if(hero!=null)healthColor(hero,dark,heroData) else LocalContentColor.current)
                }
                content()
            }
        }
        if(insight)Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(DesignTokens.space3.dp).background(Brush.horizontalGradient(listOf("recovery","load","sleep","hrvSdnnMs").map{healthColor(it,dark)})))
    }
}
@Composable internal fun NativeHealthToolbar(model:NativeHealthModel,onDrawer:()->Unit,onSettings:()->Unit) {
    val sub=model.view!="today"||model.webMetric.isNotEmpty()
    Row(Modifier.fillMaxWidth().height(DesignTokens.space80.dp).background(MaterialTheme.colorScheme.background).padding(DesignTokens.space12.dp),verticalAlignment=Alignment.CenterVertically) {
        FeedControlIconButton(if(sub)R.drawable.wm_back else R.drawable.wm_panel,if(sub)"返回健康" else "打开侧栏",floating=true){if(model.webMetric.isNotEmpty())model.closeWeb() else model.home();if(!sub)onDrawer()}
        Text("健康",Modifier.weight(1f),textAlign=TextAlign.Center,fontSize=DesignTokens.font18.sp,fontWeight=FontWeight.SemiBold)
        FeedControlIconButton(R.drawable.wm_user,"打开个人设置",floating=true,action=onSettings)
    }
}
@Composable internal fun NativeHealthPage(model:NativeHealthModel,modifier:Modifier=Modifier) {
    LaunchedEffect(model.ready){if(model.ready)model.refresh()}
    val list=rememberLazyListState();val frost=LocalNativeFrost.current
    LaunchedEffect(model.view,model.metric,model.day){list.scrollToItem(0)}
    LaunchedEffect(list.isScrollInProgress){frost?.paused=list.isScrollInProgress}
    DisposableEffect(frost){onDispose{frost?.paused=false}}
    Box(modifier.fillMaxWidth().background(Color(if(model.dark)DesignTokens.nativeDarkCanvas else DesignTokens.healthCanvasLight)).then(if(frost!=null)Modifier.frostSource(frost) else Modifier)) {
        LazyColumn(Modifier.fillMaxSize().semantics{contentDescription="健康内容"},state=list,contentPadding=PaddingValues(DesignTokens.space20.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)) {
            item("date"){HealthDateBar(model)}
            if(model.calendarOpen)item("calendar"){HealthCalendar(model)}
            if(model.error.isNotEmpty()&&model.overview!=null)item("cached-error"){HealthError(model.error){model.refresh()};HealthCaption("先显示上一次读取的记录。连接后可以刷新。")}
            when {
                model.loading&&model.overview==null -> item{HealthSkeleton("正在读取健康")}
                model.error.isNotEmpty()&&model.overview==null -> item{HealthError(model.error){model.refresh()}}
                model.overview==null -> item{HealthSkeleton("正在读取健康")}
                !model.overview!!.optBoolean("connected") -> item{HealthEmpty()}
                else -> {
                    if(model.loading)item{HealthCaption("正在读取健康",Modifier.semantics{liveRegion=LiveRegionMode.Polite})}
                    if(model.view=="today") {
                        item("insight"){HealthInsight(model)}
                        item("scores"){HealthScoreCards(model)}
                        item("sleep"){HealthSleepSummary(model)}
                        item("vitals"){HealthVitals(model)}
                        item("activity"){HealthActivity(model)}
                    } else {
                        if(model.view=="detail") {
                            item("hero"){HealthDetailHero(model)}
                            if(model.metric in listOf("recovery","sleep","load","stress","energy","fitnessAge"))item("comparison"){HealthComparison(model)}
                            if(model.metric=="sleep")item("stages"){HealthCard("睡眠分期"){HealthSleepStages(model)}}
                            if(model.metric in listOf("recovery","sleep","load")) {
                                item("detail-insight"){HealthInsight(model,collapsible=true)}
                                item("dimensions"){HealthDimensions(model)}
                            }
                        }
                        item("trend"){HealthTrend(model)}
                        item("original"){FeedControlButton("原网页详情",icon=R.drawable.wm_external,secondary=true){model.openOriginal()}}
                    }
                    item("updated"){HealthCaption(model.overview?.optString("updatedAt")?.takeIf{it.isNotEmpty()&&it!="null"}?.let{"数据更新于 ${healthClock(it,model.zone)}"} ?: "这一天还没有记录。")}
                }
            }
        }
        if(model.toast.isNotBlank()) {
            val text=model.toast
            Text(text,Modifier.align(Alignment.BottomCenter).padding(DesignTokens.space16.dp).background(MaterialTheme.colorScheme.inverseSurface,RoundedCornerShape(DesignTokens.radius12.dp)).padding(DesignTokens.space12.dp).semantics{liveRegion=LiveRegionMode.Polite},color=MaterialTheme.colorScheme.inverseOnSurface,fontSize=DesignTokens.font15.sp)
        }
    }
}
@Composable private fun HealthDateBar(m:NativeHealthModel) {
    Column(verticalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)) {
        if(m.view!="today")FeedControlButton("返回今日",icon=R.drawable.wm_back){m.home()}
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
            if(m.view=="today")FeedControlIconButton(R.drawable.wm_back,"前一天",enabled=m.day.isNotBlank()&&!m.loading&&!m.noComputer){m.shift(-1)}
            FeedControlButton(healthDay(m.day,m.today),modifier=Modifier.weight(1f).background(MaterialTheme.colorScheme.surfaceVariant,RoundedCornerShape(DesignTokens.radius999.dp)),contentDescription="选择健康日期",enabled=!m.loading&&!m.noComputer){m.calendarOpen=!m.calendarOpen;if(m.calendarOpen)m.loadCalendar()}
            if(m.view=="today")FeedControlIconButton(R.drawable.wm_right,"后一天",enabled=m.day.isNotBlank()&&m.day<m.today&&!m.loading&&!m.noComputer){m.shift(1)}
            FeedControlIconButton(R.drawable.wm_sync,"刷新健康",enabled=!m.loading){m.refresh()}
        }
        if(m.day.isNotBlank()&&m.day!=m.today)FeedControlButton("回到今天",icon=R.drawable.wm_clock){m.refresh(m.today)}
    }
}
@Composable private fun HealthCalendar(m:NativeHealthModel) {
    HealthCard("",contentPadding=DesignTokens.space6,radius=DesignTokens.radius20) {
        Row(verticalAlignment=Alignment.CenterVertically){FeedControlIconButton(R.drawable.wm_back,"上个月",enabled=!m.calendarLoading){m.monthShift(-1)};Text(m.month.replace("-","年")+"月",Modifier.weight(1f),textAlign=TextAlign.Center,fontSize=DesignTokens.font16.sp);FeedControlIconButton(R.drawable.wm_right,"下个月",enabled=!m.calendarLoading&&m.month<m.today.take(7)){m.monthShift(1)};FeedControlIconButton(R.drawable.wm_close,"收起月历"){m.calendarOpen=false}}
        when{m.calendarLoading->HealthSkeleton("正在读取月历");m.calendarError.isNotEmpty()->HealthError(m.calendarError){m.loadCalendar(m.month)};else->{
            Row(Modifier.fillMaxWidth()){listOf("一","二","三","四","五","六","日").forEach{Text(it,Modifier.weight(1f),textAlign=TextAlign.Center,fontSize=DesignTokens.font12.sp)}}
            val dates=m.calendar?.optJSONArray("days")?.objects().orEmpty();val offset=runCatching{LocalDate.parse("${m.month}-01").dayOfWeek.value-1}.getOrDefault(0)
            (List<JSONObject?>(offset){null}+dates).chunked(7).forEach { week ->
                Row(Modifier.fillMaxWidth()) {
                    (week+List<JSONObject?>(7-week.size){null}).forEach { date ->
                        Box(Modifier.weight(1f),contentAlignment=Alignment.Center) {
                            if(date==null) Spacer(Modifier.height(DesignTokens.space44.dp))
                            else {
                                val day=date.optString("day")
                                Column(horizontalAlignment=Alignment.CenterHorizontally) {
                                    HealthCalendarDate(day,day==m.day,day<=m.today,date.optBoolean("hasWorkout")){m.calendarOpen=false;m.refresh(day)}
                                    if(date.optBoolean("hasWorkout")) Box(Modifier.size(DesignTokens.space4.dp).background(healthColor("recovery",m.dark),RoundedCornerShape(DesignTokens.radius999.dp)))
                                }
                            }
                        }
                    }
                }
            }
            HealthCaption("日期下的小点表示当天有运动记录。")
        }}
    }
}
@Composable private fun HealthCalendarDate(day:String,chosen:Boolean,enabled:Boolean,hasWorkout:Boolean,action:()->Unit) {
    val interactions=remember{MutableInteractionSource()};val pressed by interactions.collectIsPressedAsState();val hovered by interactions.collectIsHoveredAsState();val focused by interactions.collectIsFocusedAsState()
    val shape=RoundedCornerShape(DesignTokens.radius12.dp)
    Box(Modifier.fillMaxWidth().height(DesignTokens.space44.dp).then(if(focused)Modifier.border(DesignTokens.space2.dp,MaterialTheme.colorScheme.primary,shape) else Modifier).clip(shape)
        .background(if(chosen)MaterialTheme.colorScheme.primaryContainer else if(pressed||hovered)MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)
        .clickable(interactionSource=interactions,indication=null,enabled=enabled,role=Role.Button,onClick=action).semantics{contentDescription="健康日期 $day";selected=chosen;stateDescription=if(hasWorkout)"当天有运动记录" else "当天没有运动记录"},contentAlignment=Alignment.Center) {
        Text(day.takeLast(2).toInt().toString(),fontSize=DesignTokens.font15.sp,color=MaterialTheme.colorScheme.onSurface.copy(alpha=if(enabled)1f else .45f),fontWeight=if(chosen)FontWeight.SemiBold else FontWeight.Normal)
    }
}
@Composable private fun HealthEmpty() {
    HealthCard("",modifier=Modifier.semantics{contentDescription="尚未接入健康数据"}) {
        Icon(painterResource(R.drawable.wm_heart),null,Modifier.size(DesignTokens.space40.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
        Text("把身体的变化放在一起看看",fontSize=DesignTokens.font16.sp,fontWeight=FontWeight.SemiBold)
        Text("从今天的身体状态，到这周的生活节奏",fontSize=DesignTokens.font24.sp,fontWeight=FontWeight.SemiBold,lineHeight=DesignTokens.space32.sp)
        HealthBody("睡眠、恢复、活动和电脑使用放在一起，每一处都有一句讲得明白的解读。")
        HealthBody("健康数据只保存在你自己的设备上。在 iPhone 上打开 WeftMate，点一下接入健康数据，就能在这里看到了。")
        Spacer(Modifier.height(DesignTokens.space8.dp));HealthCaption("示意")
        listOf("今日解读","恢复 · 睡眠 · 负荷","身体指标与趋势").forEach{name->Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant,RoundedCornerShape(DesignTokens.radius16.dp)).padding(DesignTokens.space16.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)){Text(name,fontSize=DesignTokens.font15.sp,fontWeight=FontWeight.SemiBold);HealthCaption("接上后，这里会显示你自己的记录")}}
    }
}
@Composable private fun HealthSkeleton(label:String) {Column(Modifier.fillMaxWidth().semantics{contentDescription=label},verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)){repeat(3){Box(Modifier.fillMaxWidth().height(DesignTokens.space64.dp).background(MaterialTheme.colorScheme.outline.copy(alpha=.5f),RoundedCornerShape(DesignTokens.radius16.dp)))}}}
@Composable private fun HealthError(message:String,retry:()->Unit) {HealthCard("暂时读不到健康记录"){Icon(painterResource(R.drawable.wm_heart),null,Modifier.size(DesignTokens.space32.dp));HealthCaption(message);FeedControlButton("重试",secondary=true,action=retry)}}
@Composable private fun HealthInsight(m:NativeHealthModel,collapsible:Boolean=false) {
    val insight=m.overview?.optJSONObject("insight");var expanded by remember(m.day){mutableStateOf(!collapsible)};var basis by remember(m.day){mutableStateOf(false)}
    HealthCard("今日解读",insight=true) {
        if(insight==null){Text("这一天还没有足够的记录",fontSize=DesignTokens.font18.sp);HealthCaption("有了睡眠和活动记录，就能把当天的变化讲给你听。");return@HealthCard}
        if(collapsible)FeedControlButton(healthText(insight.optString("headline")),trailingIcon=R.drawable.wm_down,modifier=Modifier.fillMaxWidth()){expanded=!expanded} else Text(healthText(insight.optString("headline")),fontSize=DesignTokens.iconTouch.sp,fontWeight=FontWeight.SemiBold)
        if(expanded){
            CompositionLocalProvider(LocalContentColor provides Color(if(m.dark)DesignTokens.nativeDarkSecondary else DesignTokens.healthMutedLight)){HealthBody(insight.optString("text"))}
            insight.optJSONArray("suggestions")?.objects()?.take(2)?.forEach{row->Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)){Text(healthText(row.optString("text")),Modifier.weight(1f),fontSize=DesignTokens.font14.sp,lineHeight=DesignTokens.iconTouch.sp);val id=row.optString("id");FeedControlButton(if(id in m.reminders)"已设提醒" else if(id in m.reminderBusy)"正在设置" else "提醒我",secondary=true,enabled=id !in m.reminders&&id !in m.reminderBusy&&row.has("reminder")&&m.day==m.today){m.remind(row)}}}
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){FeedControlButton(if(basis)"收起解读" else "展开解读",secondary=true){basis=!basis};FeedControlButton("接着问它",icon=R.drawable.wm_chat,secondary=true){m.ask()}}
            if(basis){val observations=insight.optJSONArray("observations")?.objects().orEmpty();val inputs=observations.flatMap{it.optJSONArray("inputs")?.let{a->(0 until a.length()).map(a::optString)}.orEmpty()}.distinct();HealthCaption("依据："+inputs.joinToString("、"){healthMetrics[it]?.first ?: when(it){"lateNightMinutes"->"深夜使用时长";"activeMinutes"->"电脑使用时长";else->"每日汇总"}});observations.forEach{HealthCaption(it.optString("text"))}}
        }
    }
}
@Composable private fun HealthScoreCards(m:NativeHealthModel) {
    val ids=listOf("recovery","sleep","load")+listOf("stress","energy","fitnessAge").filter{m.overview?.has(it)==true}
    Column(verticalArrangement=Arrangement.spacedBy(gap)){ids.chunked(2).forEach{row->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(gap)){row.forEach{id->val data=m.data(id);HealthCard("",Modifier.weight(1f).heightIn(min=(DesignTokens.space48*4).dp).clickable(role=Role.Button,onClickLabel="查看${healthMetrics[id]?.first}详情"){m.openMetric(id)}.semantics{contentDescription="${healthMetrics[id]?.first}，查看详情"}){
        Row(verticalAlignment=Alignment.CenterVertically){Text(healthMetrics[id]!!.first,Modifier.weight(1f),fontSize=DesignTokens.font13.sp,fontWeight=FontWeight.SemiBold,color=Color(if(m.dark)DesignTokens.nativeDarkSecondary else DesignTokens.healthMutedLight));Icon(painterResource(R.drawable.wm_right),null,Modifier.size(DesignTokens.space14.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)}
        val value=when(id){"fitnessAge"->data.number("fitnessAge");"energy"->data.number("current");else->data.number("score")}
        Row(verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)){Text(healthValue(value,id),fontSize=DesignTokens.space44.sp,fontWeight=FontWeight.Bold,color=if(id=="fitnessAge")healthColor(id,m.dark,data) else LocalContentColor.current);HealthCaption(healthMetrics[id]!!.second)}
        Text(if(value==null)if(id=="fitnessAge")"资料不足" else if(data.optString("state")=="insufficient")"记录不足" else "暂无测量" else data.optString("label","再戴几天就有对比了"),fontSize=DesignTokens.font12.sp,lineHeight=DesignTokens.space20.sp,color=if(value==null)Color(if(m.dark)DesignTokens.nativeDarkSecondary else DesignTokens.healthMutedLight) else if(data.optString("label").contains("明显"))healthColor("stress",m.dark,JSONObject().put("score",90)) else healthColor(id,m.dark,data))
        HealthGraphic(id,data,m.dark,compact=true)
        if(id=="stress")HealthCaption(data.optJSONObject("latest")?.optString("time")?.let{"最近测量 ${healthClock(it,m.zone)}"} ?: "等待下一次测量")
        if(id=="energy"&&data.optBoolean("degraded"))HealthCaption("当前记录较少")
        if(id=="fitnessAge"&&data.number("difference")!=null)HealthCaption(ageDifference(data))
    }}}}
    }
}
@Composable private fun HealthSleepSummary(m:NativeHealthModel) {
    val sleep=m.data("sleep");val usage=m.data("usage")
    HealthCard("昨晚的睡眠") {
        Text(healthDuration(sleep.number("minutes")),Modifier.semantics{contentDescription="昨晚睡眠时长"},fontSize=DesignTokens.space44.sp,fontWeight=FontWeight.SemiBold);HealthGraphic("sleep",sleep,m.dark)
        HealthCaption("${healthClock(sleep.optString("start"),m.zone)} 入睡 — ${healthClock(sleep.optString("end"),m.zone)} 起床")
        HealthCaption("深睡 ${healthDuration(m.dimension("deepMinutes"))} · 快速眼动 ${healthDuration(m.dimension("remMinutes"))}")
        if(m.dimension("deepMinutes")==null&&m.dimension("remMinutes")==null)HealthCaption(if(m.supplementLoading)"正在读取睡眠分期" else if(m.supplementError.isNotBlank())m.supplementError else "这一天还没有睡眠分期记录。")
        if(sleep.isNull("start")||sleep.isNull("end"))HealthCaption("入睡和起床的时刻还没有完整记录。")
        HorizontalDivider(color=MaterialTheme.colorScheme.outline,thickness=DesignTokens.space1.dp)
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)){Icon(painterResource(R.drawable.wm_device),null,Modifier.size(DesignTokens.iconTouch.dp));Text("昨晚的电脑使用",fontSize=DesignTokens.font13.sp,fontWeight=FontWeight.SemiBold)}
        Text(healthDuration(usage.number("lateNightMinutes")),fontSize=DesignTokens.iconTouch.sp,fontWeight=FontWeight.SemiBold)
        HealthCaption(usage.optString("lastUsedAt").takeIf{it.isNotEmpty()&&it!="null"}?.let{"用到 ${healthClock(it,m.zone)}"} ?: if(usage.number("lateNightMinutes")!=null)"凌晨 1–5 点的使用估算" else "还没有这一天的电脑使用记录。")
    }
}
@Composable private fun HealthVitals(m:NativeHealthModel) {
    HealthCard("身体指标") {healthVitals.chunked(2).forEach{row->Row(horizontalArrangement=Arrangement.spacedBy(gap)){row.forEach{id->val d=m.data(id);Column(Modifier.weight(1f).clip(RoundedCornerShape(DesignTokens.radius12.dp)).background(MaterialTheme.colorScheme.surfaceVariant).clickable(role=Role.Button){m.openMetric(id)}.padding(DesignTokens.space12.dp).semantics{contentDescription="${healthMetrics[id]!!.first}，查看详情"},verticalArrangement=Arrangement.spacedBy(DesignTokens.space6.dp)) {
        Text(healthMetrics[id]!!.first,fontSize=DesignTokens.font12.sp);Text(healthReading(d.number("value"),id),fontSize=DesignTokens.font18.sp,fontWeight=FontWeight.SemiBold,color=healthColor(id,m.dark));HealthGraphic(id,d,m.dark);HealthCaption(d.optString("label","再戴几天就有对比了"));if(d.number("value")==null)HealthCaption("当天还没有测量")
    }}}}}
}
@Composable private fun ActivityNumbers(m:NativeHealthModel) {Row(horizontalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)){listOf("steps","activeEnergyKcal","exerciseMinutes").forEach{id->val value=m.data("activity").number(id);Column(Modifier.weight(1f).clickable(role=Role.Button){m.openMetric("activity")}.padding(vertical=DesignTokens.space8.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space6.dp)){HealthCaption(healthMetrics[id]!!.first);Text(healthValue(value,id),fontSize=if(id=="exerciseMinutes")DesignTokens.font18.sp else DesignTokens.iconTouch.sp,fontWeight=FontWeight.SemiBold,color=healthColor(id,m.dark));if(!id.endsWith("Minutes"))HealthCaption(healthMetrics[id]!!.second);HealthProgress(value,m.point(id)?.number("high") ?: m.point(id)?.number("baseline"),id,m.dark);if(value==null)HealthCaption("当天还没有记录")}}}}
@Composable private fun HealthActivity(m:NativeHealthModel) {
    var more by remember(m.day){mutableStateOf(false)};val workouts=m.data("activity").optJSONArray("workouts")?.objects().orEmpty()
    HealthCard("今天的活动") {ActivityNumbers(m);HealthCaption(if(listOf("steps","activeEnergyKcal","exerciseMinutes").any{m.point(it)?.number("high")!=null})"彩条对照你平时的活动量" else "继续记录，就能对照平时的活动量");workouts.take(if(more)workouts.size else 3).forEach{row->HorizontalDivider(color=MaterialTheme.colorScheme.outline);Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(row.optString("type"),fontSize=DesignTokens.font14.sp);Text(healthDuration(row.number("minutes")),fontSize=DesignTokens.font14.sp)}};if(workouts.isEmpty())HealthCaption("今天还没有运动记录，日常走动也会显示在上面。");if(workouts.size>3)FeedControlButton(if(more)"收起运动记录" else "查看其余运动",secondary=true){more=!more};HealthActivityDots(m.calendar,m.dark);FeedControlButton("查看活动详情",icon=R.drawable.wm_right,secondary=true){m.openMetric("activity")}}
}
private fun ageDifference(d:JSONObject):String {val diff=d.number("difference")?.let{kotlin.math.round(it).toInt()} ?: return "戴着手表继续记录，看看自己的变化";return if(diff==0)"与实际年龄相同" else "比实际年龄${if(diff<0)"小" else "大"} ${kotlin.math.abs(diff)} 岁"}
private fun profileHint(d:JSONObject):String {val missing=d.optJSONArray("missing")?.let{a->(0 until a.length()).map(a::optString)}.orEmpty();val fields=listOf("birthYear" to "出生年份","sex" to "性别").filter{it.first in missing}.map{it.second};return if(fields.isNotEmpty())"在 iPhone 的健康页里补一下${fields.joinToString("和")}就能算" else "最近还没有足够的最大摄氧量记录，继续戴着手表记录活动"}
@Composable private fun HealthDetailHero(m:NativeHealthModel) {
    val id=m.metric;val d=m.data(id);val title=healthMetrics[id]!!.first
    val value=when{id in healthVitals->d.number("value");id=="energy"->d.number("current");id=="fitnessAge"->d.number("fitnessAge");else->d.number("score")}
    HealthCard(title,hero=id,heroData=d,contentPadding=DesignTokens.space20) {
        Text(if(d.optString("state")=="insufficient")if(id=="fitnessAge")"还需要一点记录" else "再戴几天就有对比了" else if(d.optString("state") in listOf("normal","balanced"))mapOf("recovery" to "恢复状态平稳","sleep" to "昨晚睡得不错","load" to "今天的负荷刚好","stress" to "今天的压力较平稳","energy" to "今天还有余力")[id] ?: d.optString("label","看看今天的变化") else d.optString("label","看看今天的变化"),fontSize=DesignTokens.font28.sp,fontWeight=FontWeight.SemiBold)
        if(id=="activity")ActivityNumbers(m) else {
            if(id=="fitnessAge"&&value==null)HealthCaption(profileHint(d)) else Row(verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)){Text(healthValue(value,id),fontSize=DesignTokens.space64.sp,fontWeight=FontWeight.Bold,color=if(id=="fitnessAge")healthColor(id,m.dark,d) else LocalContentColor.current);HealthCaption(healthMetrics[id]!!.second)}
            HealthGraphic(id,d,m.dark,hero=true)
        }
        if(id=="fitnessAge"&&value!=null)HealthCaption(ageDifference(d))
        if(id in healthVitals)HealthCaption(if(d.number("low")!=null)"你平时 ${healthValue(d.number("low"),id)}–${healthValue(d.number("high"),id)} ${healthMetrics[id]!!.second}" else "再戴几天就有对比了")
        if(id=="load"){val range=d.optJSONObject("recommendedRange");HealthCaption(if(range?.number("low")!=null)"今天 ${healthValue(d.number("daily"))} · 建议 ${healthValue(range.number("low"))}–${healthValue(range.number("high"))}（相对负荷）" else "再戴几天就有对比了")}
        FeedControlButton("问一问",icon=R.drawable.wm_chat,secondary=true){m.askMetric()}
        if(id in healthVitals||id=="activity")HealthAnalysis(m,healthScope(id))
    }
}
@Composable private fun HealthComparison(m:NativeHealthModel) {
    val id=m.metric;val d=m.data(id);var method by remember(id){mutableStateOf(false)}
    HealthCard(when(id){"stress","energy"->"今天的变化";"fitnessAge"->"与自己的年龄对照";else->"和自己比较"}) {
        if(id=="stress"||id=="energy") {
            val values=if(id=="stress")listOf("当天平均" to d.number("average"),"近 14 天平均" to m.series[id]?.number("average")) else listOf("夜间充了多少" to d.number("nightCharged"),"白天耗了多少" to d.number("dayDrained"))
            Row(horizontalArrangement=Arrangement.spacedBy(gap)){values.forEach{(name,v)->Column(Modifier.weight(1f)){HealthCaption(name);Text(healthReading(v,id),fontSize=DesignTokens.iconTouch.sp)}}}
            if(id=="energy"&&d.optBoolean("degraded"))HealthCaption("当前记录较少，暂时没有曲线。") else {
                val samples=d.optJSONArray(if(id=="stress")"samples" else "curve")?.objects().orEmpty();val intraday=JSONObject().put("id",id).put("timeZone",m.zone).put("points",org.json.JSONArray(samples))
                HealthPlot(intraday,m.dark,label=if(id=="stress")"当天各次压力测量" else "当日电能曲线",sleepPeriods=d.optJSONArray("sleepPeriods")?.objects().orEmpty())
                if(id=="stress")samples.forEach{HealthCaption("${healthClock(it.optString("time"),m.zone)} · ${healthReading(it.number("value"),id)}")}
            }
            HealthCaption(if(id=="stress")"手表每隔几小时测一次，这不是每分钟更新的数值" else "淡色区域：睡眠时段；空白表示没有测量或今天尚未到来的时段")
        } else if(id=="fitnessAge") {
            HealthCaption("实际年龄 ${healthReading(d.number("actualAge"),"fitnessAge")}");HealthCaption("最大摄氧量 ${healthReading(d.number("vo2Max"),"vo2Max")}");d.optJSONObject("referenceRange")?.let{HealthCaption("最大摄氧量参考范围 ${healthValue(it.number("low"),"vo2Max")}–${healthValue(it.number("high"),"vo2Max")} 毫升/千克/分")}
        } else {
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)) {
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)){HealthCaption("近 14 天平均");Text(healthReading(m.series[id]?.number("average"),id),fontSize=DesignTokens.iconTouch.sp,fontWeight=FontWeight.SemiBold)}
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)){HealthCaption(if(id=="sleep")"目标时长" else "你平时");Text(if(id=="sleep")healthDuration(d.number("targetMinutes")) else healthReading(d.number("baseline"),id),fontSize=DesignTokens.iconTouch.sp,fontWeight=FontWeight.SemiBold)}
            }
            d.optJSONArray("reasons")?.objects()?.forEach{HealthCaption(it.optString("text"))}
        }
        if(id in listOf("stress","energy","fitnessAge")){FeedControlButton("依据",icon=R.drawable.wm_info,secondary=true){method=!method};if(method)HealthCaption(mapOf("stress" to "Baevsky 压力指数","energy" to "充放电模型","fitnessAge" to "最大摄氧量参考值")[id]!!)}
        HealthAnalysis(m,healthScope(id))
    }
}
@Composable private fun HealthDimensions(m:NativeHealthModel) {
    val ids=when(m.metric){"recovery"->listOf("hrvSdnnMs","restingHeartRateBpm","sleepMinutes");"sleep"->listOf("sleepMinutes","deepMinutes","remMinutes","awakeMinutes");else->listOf("exerciseMinutes","activeEnergyKcal","steps")}
    HealthCard("看看各项变化") {ids.forEach{id->Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(DesignTokens.radius12.dp)).clickable(role=Role.Button){m.openMetric(id,"trend")}.padding(DesignTokens.space12.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)){Text(healthMetrics[id]!!.first,fontSize=DesignTokens.font15.sp);Text(healthReading(m.dimension(id),id),fontSize=DesignTokens.font15.sp,fontWeight=FontWeight.SemiBold);val point=healthVital(m.overview,id) ?: m.point(id);HealthCaption(point?.optString("label")?.takeIf{it.isNotEmpty()} ?: if(m.dimension(id)==null)"当天还没有测量" else "暂时没有对比");if(point?.number("low")!=null)HealthGraphic(id,point,m.dark) else HealthProgress(m.dimension(id),if(id=="sleepMinutes")m.data("sleep").number("targetMinutes") else m.dimension(id),id,m.dark)}}}
}
@Composable private fun HealthTrend(m:NativeHealthModel) {
    val id=if(m.metric=="fitnessAge")"vo2Max" else if(m.metric=="activity")"exerciseMinutes" else m.metric;val point=m.trend?.optJSONArray("points")?.objects()?.lastOrNull()
    HealthCard("趋势") {
        NativeFilterRow("健康指标",healthMetrics.filter{(key,_)->key !in listOf("stress","energy","fitnessAge")||m.overview?.has(key)==true}.map{it.key to it.value.first},m.metric){m.openMetric(it,"trend")}
        Text(healthMetrics[id]!!.first,fontSize=DesignTokens.font18.sp,fontWeight=FontWeight.SemiBold);Text(healthReading(point?.number("value"),id),fontSize=DesignTokens.space32.sp,fontWeight=FontWeight.SemiBold,color=healthColor(id,m.dark))
        HealthCaption(point?.optString("label") ?: "再戴几天就有对比了")
        HealthCaption(if(point?.number("low")!=null)"你平时：${healthValue(point.number("low"),id)}–${healthValue(point.number("high"),id)}${if(id.endsWith("Minutes"))"" else " ${healthMetrics[id]!!.second}"}" else "再戴几天就有对比了")
        when{m.trendLoading->HealthSkeleton("正在读取趋势");m.trendError.isNotEmpty()->HealthError(m.trendError){m.loadTrend()};else->HealthPlot(m.trend,m.dark,m.usageTrend,if(m.metric=="fitnessAge")m.data("fitnessAge").optJSONObject("referenceRange") else null,today=m.today)}
        NativeFilterRow("趋势天数",listOf(7,14,30,60).map{it.toString() to "${it}天"},m.days.toString()){m.loadTrend(it.toInt())}
        FeedControlButton("叠加深夜使用",icon=if(m.overlay)R.drawable.wm_check else R.drawable.wm_device,secondary=true,modifier=Modifier.semantics{selected=m.overlay;stateDescription=if(m.overlay)"已叠加" else "未叠加"}){m.toggleOverlay(!m.overlay)}
        HealthCaption(if(point?.optString("label")?.isNotBlank()==true)"${healthMetrics[id]!!.first}${if(point.optString("state")=="normal")"在你平时的范围内" else "：${point.optString("label")}"}。先看连续几天的变化，不用只盯着一天。" else "有了更多记录，再一起看看这一项怎样变化。")
        if(m.view=="trend")HealthAnalysis(m,healthScope(m.metric))
    }
}
@Composable private fun HealthAnalysis(m:NativeHealthModel,scope:String?) {
    if(scope==null||m.settings?.has("itemAnalysisEnabled")!=true)return
    val data=m.analyses[scope];var basis by remember(scope,m.day){mutableStateOf(false)};val open=scope in m.analysisOpen
    HorizontalDivider(color=MaterialTheme.colorScheme.outline)
    FeedControlButton(if(data==null)"让 AI 分析这一项" else healthText(data.optString("text").substringBefore("。"))+"。",contentDescription=if(data==null)"让 AI 分析这一项" else "展开这一项分析",trailingIcon=R.drawable.wm_down,secondary=true,modifier=Modifier.fillMaxWidth().semantics{stateDescription=if(open)"已展开" else "已收起"}){m.toggleAnalysis(scope)}
    if(!open)return
    if(scope in m.analysisBusy){HealthSkeleton("正在分析这一项");return}
    if(data!=null){HealthBody(data.optString("text"));data.optJSONArray("points")?.let{a->for(i in 0 until a.length())HealthCaption(a.optString(i))};Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){FeedControlButton("接着问它",icon=R.drawable.wm_chat,secondary=true){m.ask(scope)};FeedControlButton("依据",icon=R.drawable.wm_info,secondary=true){basis=!basis}};if(basis)HealthCaption("依据："+(data.optJSONArray("basis")?.let{a->(0 until a.length()).map(a::optString).joinToString("、")} ?: "这一项的每日汇总"))}
    else {
        m.analysisErrors[scope]?.let{HealthCaption(it)}
        if(m.settings?.optBoolean("itemAnalysisEnabled")!=true){HealthCaption("会把这一项每天的汇总数字发给你设置的模型，不发明细；随时可以在设置里关掉");FeedControlButton("打开 AI 分析",secondary=true){m.enableAnalysis(scope)}}
        else if(m.analysisErrors[scope]?.contains("次数已经用完")!=true)FeedControlButton("重新分析",secondary=true){m.generateAnalysis(scope)}
    }
}
