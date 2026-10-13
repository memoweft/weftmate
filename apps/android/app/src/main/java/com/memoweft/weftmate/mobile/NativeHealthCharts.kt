package com.memoweft.weftmate.mobile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import kotlin.math.*

internal fun healthColor(id:String,dark:Boolean,data:JSONObject=JSONObject()):Color {
    val value=data.number(if(id=="energy")"current" else "score") ?: 0.0
    return Color(when(id){
        "sleep","sleepMinutes","deepMinutes","remMinutes","awakeMinutes","usageLateNightMinutes"->if(dark)DesignTokens.healthSleepDark else DesignTokens.healthSleepLight
        "hrvSdnnMs"->if(dark)DesignTokens.healthHrvDark else DesignTokens.healthHrvLight
        "restingHeartRateBpm"->if(dark)DesignTokens.healthRestingHeartRateDark else DesignTokens.healthRestingHeartRateLight
        "respiratoryRateBrpm","load","activity","exerciseMinutes","usageActiveMinutes"->if(dark)DesignTokens.healthLoadDark else DesignTokens.healthLoadLight
        "spo2Pct"->if(dark)DesignTokens.healthOxygenDark else DesignTokens.healthOxygenLight
        "wristTempC"->if(dark)DesignTokens.healthTemperatureDark else DesignTokens.healthTemperatureLight
        "fitnessAge","vo2Max"->if(dark)DesignTokens.healthFitnessAgeDark else DesignTokens.healthFitnessAgeLight
        "stress"->when{value<25->if(dark)DesignTokens.healthStressCalmDark else DesignTokens.healthStressCalmLight;value<50->if(dark)DesignTokens.healthStressModerateDark else DesignTokens.healthStressModerateLight;value<75->if(dark)DesignTokens.healthStressHighDark else DesignTokens.healthStressHighLight;else->if(dark)DesignTokens.healthStressExtremeDark else DesignTokens.healthStressExtremeLight}
        "energy","activeEnergyKcal"->when{value<30&&id=="energy"->if(dark)DesignTokens.healthEnergyLowDark else DesignTokens.healthEnergyLowLight;value<65&&id=="energy"->if(dark)DesignTokens.healthEnergyMidDark else DesignTokens.healthEnergyMidLight;else->if(dark)DesignTokens.healthEnergyHighDark else DesignTokens.healthEnergyHighLight}
        else->if(dark)DesignTokens.healthRecoveryDark else DesignTokens.healthRecoveryLight})
}
internal fun healthTrack(dark:Boolean)=Color(if(dark)DesignTokens.nativeDarkLine else DesignTokens.healthTrackLight)
internal fun healthSoftColor(id:String,data:JSONObject):Color {
    val score=data.number(if(id=="energy")"current" else "score") ?: 0.0
    return Color(when(id){
        "sleep"->DesignTokens.healthSleepSoftLight
        "load","activity"->DesignTokens.healthLoadSoftLight
        "stress"->when{score<25->DesignTokens.healthStressCalmSoftLight;score<50->DesignTokens.healthStressModerateSoftLight;score<75->DesignTokens.healthStressHighSoftLight;else->DesignTokens.healthStressExtremeSoftLight}
        "energy"->when{score<30->DesignTokens.healthEnergyLowSoftLight;score<65->DesignTokens.healthEnergyMidSoftLight;else->DesignTokens.healthEnergyHighSoftLight}
        "fitnessAge"->DesignTokens.healthFitnessAgeSoftLight
        "hrvSdnnMs"->DesignTokens.healthHrvSoftLight
        "restingHeartRateBpm"->DesignTokens.healthRestingHeartRateSoftLight
        "respiratoryRateBrpm"->DesignTokens.healthRespiratorySoftLight
        "spo2Pct"->DesignTokens.healthOxygenSoftLight
        "wristTempC"->DesignTokens.healthTemperatureSoftLight
        else->DesignTokens.healthRecoverySoftLight})
}
private fun DrawScope.pill(color:Color,x:Float,y:Float,w:Float,h:Float) { if(w>0)drawRoundRect(color,Offset(x,y),Size(w,h),CornerRadius(h/2)) }
private fun DrawScope.graphicFrame(height:Float,paint:DrawScope.()->Unit) {
    val factor=min(size.width/300,size.height/height)
    withTransform({translate((size.width-300*factor)/2,(size.height-height*factor)/2);scale(factor,factor,Offset.Zero)}){paint()}
}

@Composable internal fun HealthGraphic(id:String,data:JSONObject,dark:Boolean,modifier:Modifier=Modifier,compact:Boolean=false,hero:Boolean=false) {
    val color=healthColor(id,dark,data);val track=healthTrack(dark);val ink=Color(if(dark)DesignTokens.nativeDarkInk else DesignTokens.healthInkLight)
    val measurer=rememberTextMeasurer()
    val score=data.number("score");val height=when(id){"recovery"->100f;"sleep","stress"->110f;"energy"->124f;else->66f}
    Column(modifier) {
        Canvas(Modifier.fillMaxWidth().then(if(compact)Modifier.height(DesignTokens.space48.dp) else Modifier.aspectRatio(300/height)).clearAndSetSemantics{}){
            val labels=mutableListOf<HealthGraphicLabel>()
            graphicFrame(height){
            when(id) {
                "recovery"->{val zones=listOf("stress-extreme","stress-moderate","stress-calm");zones.forEachIndexed{i,z->val v=when(z){"stress-extreme"->90.0;"stress-moderate"->40.0;else->10.0};pill(if(score==null)track else healthColor("stress",dark,JSONObject().put("score",v)),2f+i*100,40f,96f,34f)};score?.let{val x=10+280*(it/100).coerceIn(0.0,1.0).toFloat();drawPath(Path().apply{moveTo(x,17f);lineTo(x-9,30f);lineTo(x+9,30f);close()},ink);drawLine(Color(if(dark)DesignTokens.nativeDarkSurface else DesignTokens.healthCardLight),Offset(x,35f),Offset(x,80f),4f)};labels.add(HealthGraphicLabel("0",2f,99f,ink,fontSize=if(hero)DesignTokens.font12 else DesignTokens.space20.toFloat()));labels.add(HealthGraphicLabel("100",298f,99f,ink,end=true,fontSize=if(hero)DesignTokens.font12 else DesignTokens.space20.toFloat()))}
                "sleep"->{val actual=data.number("minutes");val target=data.number("targetMinutes");val ceiling=maxOf(1.0,actual ?: 0.0,target ?: 0.0);listOf(actual,target).forEachIndexed{i,v->val y=8f+i*56;pill(track,2f,y,296f,23f);v?.let{pill(color.copy(alpha=if(i==0)1f else .5f),2f,y,(296*it/ceiling).toFloat(),23f)}};labels.add(HealthGraphicLabel(healthDuration(actual),2f,51f,ink,fontSize=if(hero)DesignTokens.font12 else DesignTokens.space20.toFloat()));labels.add(HealthGraphicLabel("目标 ${healthDuration(target)}",298f,109f,ink,end=true,fontSize=if(hero)DesignTokens.font12 else DesignTokens.space20.toFloat()))}
                "stress"->{val value=score ?: 0.0;val hit=if(score==null)-1 else min(3,(value/25).toInt());for(i in 0..3){val c=healthColor("stress",dark,JSONObject().put("score",i*25));drawArc(if(i==hit)c else track,188.1f+i*45,28.8f,false,Offset(18f,20f),Size(264f,164f),style=Stroke(21f,cap=StrokeCap.Round))};score?.let{val angle=PI*(1-(it/100).coerceIn(.02,.98));drawCircle(color,9f,Offset(150+132*cos(angle).toFloat(),102-82*sin(angle).toFloat()))}}
                "energy"->{val points=if(data.optBoolean("degraded"))emptyList() else data.optJSONArray("curve")?.objects().orEmpty();val g=HealthPlotGeometry(points);drawLine(track,Offset(8f,108f),Offset(292f,108f));g.lines.forEach{run->val p=Path();run.forEachIndexed{n,i->val x=if(points.size<2)150f else 8f+i*284/(points.size-1);val y=108-(points[i].number("value")!!* .88).toFloat();if(n==0)p.moveTo(x,y) else p.lineTo(x,y)};if(run.size>1){val area=Path().apply{val first=run.first();val last=run.last();fun at(i:Int)=if(points.size<2)150f else 8f+i*284/(points.size-1)
                    moveTo(at(first),108f);run.forEach{i->lineTo(at(i),108-(points[i].number("value")!!*.88).toFloat())};lineTo(at(last),108f);close()};drawPath(area,Brush.verticalGradient(listOf(color.copy(alpha=.32f),color.copy(alpha=0f)),startY=20f,endY=108f))};drawPath(p,color,style=Stroke(6f));};points.lastOrNull()?.number("value")?.let{drawCircle(color,6f,Offset(292f,108-(it*.88).toFloat()))}}
                else->{val range=data.optJSONObject("recommendedRange");val low=range?.number("low") ?: data.number("low");val high=range?.number("high") ?: data.number("high");val value=when{id=="fitnessAge"->data.number("fitnessAge");range!=null->data.number("daily");id in healthVitals->data.number("value");else->score};val span=max(1.0,(high ?: 1.0)-(low ?: 0.0));val min=if(id in healthVitals&&low!=null)low-span*.5 else 0.0;val max=when{id=="fitnessAge"->maxOf(60.0,(value ?: 0.0)*1.15,(data.number("actualAge") ?: 0.0)*1.15);range!=null->maxOf(100.0,data.number("daily") ?: 0.0,(high ?: 0.0)*1.1);id in healthVitals&&high!=null->high+span*.5;else->100.0};fun x(v:Double)=8+284*((v-min)/(max-min)).coerceIn(0.0,1.0).toFloat()
                pill(track,2f,24f,296f,18f);if(id=="fitnessAge"){value?.let{pill(color,2f,24f,x(it),18f)};data.number("actualAge")?.let{drawLine(ink,Offset(x(it),17f),Offset(x(it),48f),2f)}}else if(low!=null&&high!=null){pill(color.copy(alpha=.5f),x(low),24f,x(high)-x(low),18f);listOf(low,high).forEach{drawLine(color,Offset(x(it),20f),Offset(x(it),47f),2f)}};value?.let{drawCircle(color,6f,Offset(x(it),33f))}}
            }
            }
            labels.forEach{graphLabel(measurer,it,300f,height)}
        }
    }
}
private data class HealthGraphicLabel(val text:String,val x:Float,val y:Float,val color:Color,val end:Boolean=false,val fontSize:Float=DesignTokens.space20.toFloat())
private fun DrawScope.graphLabel(measurer:TextMeasurer,label:HealthGraphicLabel,width:Float,height:Float) {
    val factor=min(size.width/width,size.height/height)
    val origin=Offset((size.width-width*factor)/2,(size.height-height*factor)/2)
    val layout=measurer.measure(AnnotatedString(label.text),TextStyle(color=label.color,fontSize=(label.fontSize*factor/density).sp,fontWeight=FontWeight.Medium))
    val x=origin.x+label.x*factor-(if(label.end)layout.size.width.toFloat() else 0f)
    drawText(layout,topLeft=Offset(x.coerceIn(0f,(size.width-layout.size.width).coerceAtLeast(0f)),(origin.y+label.y*factor-layout.lastBaseline).coerceAtLeast(0f)))
}

@Composable internal fun HealthPlot(series:JSONObject?,dark:Boolean,usage:JSONObject?=null,reference:JSONObject?=null,label:String="趋势图",compact:Boolean=false,sleepPeriods:List<JSONObject> = emptyList(),today:String="") {
    val points=series?.optJSONArray("points")?.objects().orEmpty().map{if(reference!=null)JSONObject(it.toString()).put("low",reference.opt("low")).put("high",reference.opt("high")) else it}
    val id=series?.optString("id").orEmpty();val average=series?.number("average");val g=HealthPlotGeometry(points,average)
    val intraday=points.firstOrNull()?.has("time")==true
    val scatter=id=="stress"&&intraday
    val measurer=rememberTextMeasurer()
    val color=healthColor(id,dark);val track=healthTrack(dark);val muted=Color(if(dark)DesignTokens.nativeDarkSecondary else DesignTokens.healthMutedLight)
    val usageMap=usage?.optJSONArray("points")?.objects().orEmpty().associate{it.optString("day") to it.number("value")};val peak=max(1.0,usageMap.values.filterNotNull().maxOrNull() ?: 1.0)
    var selected by remember(series?.toString()){mutableIntStateOf(-1)}
    if(g.lines.isEmpty()){HealthCaption(if(series?.optBoolean("outsideRange")==true)"最近能读取的趋势没有覆盖这个日期，先回到今天看看。" else "这段时间还没有可显示的测量，之后的变化会显示在这里。");return}
    Canvas(Modifier.fillMaxWidth().then(if(compact)Modifier.height(DesignTokens.space48.dp) else Modifier.aspectRatio(320f/180f)).semantics {
        contentDescription="$label，断线表示当天没有测量"
        if(!compact)customActions=listOf(CustomAccessibilityAction("前一天的值"){selected=(if(selected<0)points.lastIndex else selected-1).coerceAtLeast(0);true},CustomAccessibilityAction("后一天的值"){selected=(selected+1).coerceAtMost(points.lastIndex);true})
    }.then(if(compact)Modifier else Modifier.pointerInput(points){detectTapGestures{position->selected=(((position.x/size.width*320-16)/288)*(points.size-1)).roundToInt().coerceIn(0,points.lastIndex)}})) {
        withTransform({scale(size.width/320,size.height/180,Offset.Zero)}){
            sleepPeriods.forEach{p->fun clock(t:String)=t.takeIf{it.matches(Regex("\\d{2}:\\d{2}"))}?.let{it.take(2).toFloat()*60+it.takeLast(2).toFloat()}
                val first=clock(points.first().optString("time"));val last=clock(points.last().optString("time"));val a=clock(p.optString("start"));val b=clock(p.optString("end"));if(first!=null&&last!=null&&a!=null&&b!=null){val ranges=if(b<a)listOf(0f to b,a to 1440f) else listOf(a to b);ranges.forEach{(from,to)->val start=(16+(from-first)/(last-first).coerceAtLeast(1f)*288).coerceAtLeast(16f);val end=(16+(to-first)/(last-first).coerceAtLeast(1f)*288).coerceAtMost(304f);if(end>start)drawRect(color.copy(alpha=.12f),Offset(start,16f),Size(end-start,138f))}}}
            listOf(22f,88f,154f).forEach{drawLine(muted.copy(alpha=.1f),Offset(16f,it),Offset(304f,it),1f)}
            g.bands.forEach{run->drawPath(Path().apply{run.forEachIndexed{n,i->if(n==0)moveTo(g.x(i),g.y(points[i].number("high")!!)) else lineTo(g.x(i),g.y(points[i].number("high")!!))};run.reversed().forEach{i->lineTo(g.x(i),g.y(points[i].number("low")!!))};close()},color.copy(alpha=.09f))}
            points.forEachIndexed{i,p->usageMap[p.optString("day")]?.let{n->val width=min(8f,180f/points.size);drawRect(muted.copy(alpha=.16f),Offset(g.x(i)-width/2,154-(n/peak*66).toFloat()),Size(width,(n/peak*66).toFloat()))}}
            average?.let{drawLine(color.copy(alpha=.55f),Offset(16f,g.y(it)),Offset(304f,g.y(it)),1f,pathEffect=PathEffect.dashPathEffect(floatArrayOf(4f,4f)))}
            g.lines.forEach{run->val p=Path().apply{run.forEachIndexed{n,i->if(n==0)moveTo(g.x(i),g.y(points[i].number("value")!!)) else lineTo(g.x(i),g.y(points[i].number("value")!!))}};if(run.size>1&&!scatter){val area=Path().apply{moveTo(g.x(run.first()),154f);run.forEach{i->lineTo(g.x(i),g.y(points[i].number("value")!!))};lineTo(g.x(run.last()),154f);close()};drawPath(area,Brush.verticalGradient(listOf(color.copy(alpha=.22f),color.copy(alpha=0f)),startY=22f,endY=154f))};if(!scatter)drawPath(p,color,style=Stroke(2.5f,cap=StrokeCap.Round,join=StrokeJoin.Round))}
            if(scatter)points.forEachIndexed{i,p->p.number("value")?.let{drawCircle(color,4f,Offset(g.x(i),g.y(it)))}}
            points.indexOfLast{it.number("value")!=null}.takeIf{it>=0}?.let{val value=points[it].number("value")!!;drawCircle(color,4f,Offset(g.x(it),g.y(value)))}
            if(selected>=0)points[selected].number("value")?.let{drawCircle(color,5f,Offset(g.x(selected),g.y(it)))}
        }
        points.indexOfLast{it.number("value")!=null}.takeIf{it>=0&&!scatter}?.let{val value=points[it].number("value")!!;graphLabel(measurer,HealthGraphicLabel(healthValue(value,id),g.x(it)-6,max(14f,g.y(value)-12),color,end=it>points.size/2,fontSize=DesignTokens.font13),320f,180f)}
    }
    fun pointLabel(p:JSONObject)=if(intraday)healthClock(p.optString("time"),series?.optString("timeZone","Asia/Shanghai") ?: "Asia/Shanghai") else if(p.optString("day")==today)"今天" else healthDay(p.optString("day"),"")
    if(!compact){
        if(selected>=0){val p=points[selected];HealthCaption("${pointLabel(p)} · ${healthReading(p.number("value"),id)}"+if(usage!=null)" · 深夜使用 ${healthDuration(usageMap[p.optString("day")])}" else "",Modifier.semantics{liveRegion=LiveRegionMode.Polite})}
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){HealthCaption(pointLabel(points.first()));HealthCaption(pointLabel(points.last()))}
        HealthCaption(buildList {
            add(if(scatter)"点：当天各次压力测量" else "实线：${healthMetrics[id]?.first ?: "当前指标"}")
            if(g.bands.isNotEmpty())add("色带：${if(reference!=null)"公开参考范围" else "你平时的范围"}")
            if(average!=null)add("虚线：平均")
            if(usage!=null)add("灰柱：深夜使用")
            if(intraday&&sleepPeriods.isNotEmpty())add("淡色区域：睡眠时段")
        }.joinToString(" · "))
    }
}
@Composable internal fun HealthProgress(value:Double?,peak:Double?,id:String,dark:Boolean) {val color=healthColor(id,dark);val track=healthTrack(dark);Canvas(Modifier.fillMaxWidth().height(DesignTokens.space24.dp).clearAndSetSemantics{}){val height=DesignTokens.space14.dp.toPx();pill(track,0f,(size.height-height)/2,size.width,height);if(value!=null&&peak!=null&&peak>0)pill(color,0f,(size.height-height)/2,(size.width*value/peak).toFloat().coerceIn(0f,size.width),height)}}
@Composable internal fun HealthSleepStages(model:NativeHealthModel) {
    val total=model.data("sleep").number("minutes");val deep=model.dimension("deepMinutes");val rem=model.dimension("remMinutes");val awake=model.dimension("awakeMinutes");val core=if(total!=null&&deep!=null&&rem!=null)max(0.0,total-deep-rem) else null
    val values=listOf(deep,core,rem,awake);val known=values.filterNotNull().sum();val sum=max(known,model.dimension("inBedMinutes") ?: ((total ?: 0.0)+(awake ?: 0.0)))
    val colors=if(model.dark)listOf(DesignTokens.healthSleepDeepDark,DesignTokens.healthSleepCoreDark,DesignTokens.healthSleepRemDark,DesignTokens.healthSleepAwakeDark) else listOf(DesignTokens.healthSleepDeepLight,DesignTokens.healthSleepCoreLight,DesignTokens.healthSleepRemLight,DesignTokens.healthSleepAwakeLight)
    val track=healthTrack(model.dark)
    Canvas(Modifier.fillMaxWidth().height(DesignTokens.space44.dp).clearAndSetSemantics{}){val height=DesignTokens.space24.dp.toPx();pill(track,0f,(size.height-height)/2,size.width,height);if(sum>0){var x=0f;values.forEachIndexed{i,v->if(v!=null&&v>0){val width=(v/sum*size.width).toFloat();pill(Color(colors[i]),x,(size.height-height)/2,max(0f,width-DesignTokens.space2.dp.toPx()),height);x+=width}}}}
    values.indices.chunked(2).forEach{row->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(DesignTokens.space12.dp)){row.forEach{i->Row(Modifier.weight(1f),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space6.dp)){Box(Modifier.size(DesignTokens.space6.dp).background(Color(colors[i]),androidx.compose.foundation.shape.RoundedCornerShape(DesignTokens.radius999.dp)));HealthCaption("${listOf("深睡","核心","快速眼动","清醒")[i]} ${healthDuration(values[i])}")}}}}
    HealthCaption("色带按各分期的时长比例显示")
}
@Composable internal fun HealthActivityDots(calendar:JSONObject?,dark:Boolean) {
    val days=calendar?.optJSONArray("days")?.objects().orEmpty();val color=healthColor("recovery",dark);val track=healthTrack(dark)
    if(days.isEmpty())return
    val rows=(days.size+6)/7
    Canvas(Modifier.widthIn(max=(DesignTokens.space48*5).dp).fillMaxWidth().height((rows*DesignTokens.space16-DesignTokens.space8).dp).semantics{contentDescription="本月运动记录，${days.count{it.optBoolean("hasWorkout")}} 天有运动"}){val radius=DesignTokens.space4.dp.toPx();val cell=(size.width-DesignTokens.space8.dp.toPx()*6)/7;days.forEachIndexed{i,p->drawCircle(if(p.optBoolean("hasWorkout"))color else track,radius,Offset(radius+(i%7)*(cell+DesignTokens.space8.dp.toPx()),radius+(i/7)*DesignTokens.space16.dp.toPx()))}}
}
