package com.memoweft.weftmate.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.border
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Same Activity window, so both menu touches and its search field keep the real keyboard alive. */
@Composable internal fun NativeModelServiceOverlay(s:NativeSettingsModel,bottom:androidx.compose.ui.unit.Dp) {
    val close={s.restoreComposer?.invoke();s.menuVisible=false}
    androidx.activity.compose.BackHandler(s.menuVisible){close()}
    BoxWithConstraints(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
        Box(Modifier.fillMaxSize().clickable(interactionSource=remember{MutableInteractionSource()},indication=null,onClick=close))
        Column(Modifier.align(Alignment.BottomStart).padding(start=DesignTokens.space16.dp,end=DesignTokens.space16.dp,bottom=bottom+DesignTokens.space8.dp)
            .widthIn(max=(DesignTokens.space150*2).dp).heightIn(max=(maxHeight-bottom-DesignTokens.space80.dp).coerceAtLeast(DesignTokens.space44.dp))
            .shadow(DesignTokens.space8.dp,RoundedCornerShape(DesignTokens.radius12.dp)).border(DesignTokens.space1.dp,MaterialTheme.colorScheme.outline,RoundedCornerShape(DesignTokens.radius12.dp))
            .nativeFrost(RoundedCornerShape(DesignTokens.radius12.dp),floating=true).padding(DesignTokens.space6.dp)) { NativeModelServiceMenu(s,close) }
    }
}

/** Menu content stays in AND-12's non-focus-stealing popup; selecting never dismisses IME. */
@Composable internal fun NativeModelServiceMenu(s:NativeSettingsModel,close:()->Unit) {
    var all by remember{mutableStateOf(false)}
    var query by remember{mutableStateOf("")}
    val chat=s.chat
    Column(Modifier.widthIn(min=DesignTokens.space220.dp,max=(DesignTokens.space150*2).dp)) {
        if(s.legacy) {
            chat.models.forEach{row->val id=row.optString("profileId",row.optString("modelId"));FeedControlMenuItem(row.optString("displayName",id),checked=id==chat.modelId){chat.selectModel(row);close()}}
            FeedControlMenuItem("管理模型"){close();s.open("models");s.original("models")}
            return@Column
        }
        if(all)SettingsInput("搜索模型",query){query=it}
        Column(Modifier.weight(1f,fill=false).verticalScroll(rememberScrollState())) {
        if(s.services.isEmpty())SettingsNote(if(s.error.isNotEmpty())s.error else if(s.menuLoading)"正在读取模型服务…" else "还没有模型服务。")
        val multiple=s.services.size>1
        val vision=serviceRequiresVision(chat.attachments,chat.rows)
        s.services.forEach{service->
            if(multiple)Text(service.optString("name"),Modifier.padding(horizontal=DesignTokens.space12.dp,vertical=DesignTokens.space8.dp),fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            serviceVisibleModels(service,all,query,s.selected.optString("modelId")).forEach{model->
                FeedControlMenuItem(model.optString("name",model.optString("modelId")),enabled=!s.busy,checked=service.optString("serviceId")==s.selected.optString("serviceId")&&model.optString("modelId")==s.selected.optString("modelId")){s.select(service,model,close)}
                if(vision&&model.optJSONObject("capabilities")?.let{it.has("vision")&&!it.optBoolean("vision")}==true)Text("不支持当前对话中的图片",Modifier.padding(horizontal=DesignTokens.space12.dp),fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if(all&&s.services.all{serviceVisibleModels(it,true,query).isEmpty()})SettingsNote("没有匹配的模型。")
        }
        if(!all&&s.services.any{it.optJSONArray("models")?.objects().orEmpty().count{row->row.optBoolean("enabled",true)}>12})FeedControlMenuItem("全部模型",icon=R.drawable.wm_search){all=true}
        if(s.currentModel()?.optJSONObject("deepThinking")?.optBoolean("supported")==true)SettingsToggle("深度思考","",s.thinking,!s.busy){s.toggleThinking(it)}
        if(s.error.isNotEmpty())SettingsNote(s.error)
        FeedControlMenuItem("添加模型服务…",icon=R.drawable.wm_plus){close();s.open("models",add=true)}
    }
}
