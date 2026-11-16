package com.memoweft.weftmate.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

@Composable internal fun NativePageToolbar(model: NativePageModel) {
    Row(Modifier.fillMaxWidth().heightIn(min=DesignTokens.space56.dp).padding(horizontal=DesignTokens.space8.dp),verticalAlignment=Alignment.CenterVertically) {
        NativeIconButton(R.drawable.wm_back,"返回",action=model::back)
        Text(model.title,Modifier.weight(1f).padding(horizontal=DesignTokens.space8.dp),fontSize=DesignTokens.font17.sp,fontWeight=FontWeight.SemiBold)
        NativeIconButton(R.drawable.wm_sync,"刷新",enabled=!model.loading&&!model.busy,action=model::refresh)
    }
}

@Composable internal fun NativePage(model: NativePageModel, modifier: Modifier = Modifier) {
    val scroll=remember(model.page,model.data.optString("identity")){ScrollState(0)}
    Box(modifier.fillMaxWidth()) {
    Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(DesignTokens.space20.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space24.dp)) {
        if(model.title.isNotBlank())Text(model.title,fontSize=DesignTokens.font24.sp,lineHeight=DesignTokens.space32.sp,fontWeight=FontWeight.SemiBold,modifier=Modifier.semantics{heading()})
        if(model.error.isNotBlank())NativePageError(model.error,model::refresh)
        model.pairing?.let { p ->
            SettingsGroup("核对电脑") {
                val code=p.optString("verificationCode")
                if(code.isNotBlank())Text(code.chunked(3).joinToString(" "),fontSize=DesignTokens.font24.sp,fontWeight=FontWeight.SemiBold)
                Text(p.optString("error").ifBlank{if(p.optString("state")=="comparing")"两边数字一致后，在电脑上确认。不一致请在电脑上取消。" else "正在核对电脑的配对信息…"},fontSize=DesignTokens.font15.sp,lineHeight=DesignTokens.space24.sp)
                FeedControlButton("停止配对",secondary=true,action=model::back)
            }
        }
        if(model.loading && model.data.length()==0) { NativeLoadingState("正在读取…",Modifier.fillMaxWidth().heightIn(min=DesignTokens.space150.dp)) }
        model.data.optJSONArray("sections")?.objects().orEmpty().forEach { section ->
            SettingsGroup(section.optString("title"),rows=true) {
                section.optJSONArray("rows")?.objects().orEmpty().forEach { row -> key(row.optString("key",row.optString("label"))) { NativePageRow(model,row) } }
            }
        }
        if(model.busy)Row(horizontalArrangement=Arrangement.spacedBy(DesignTokens.space12.dp),verticalAlignment=Alignment.CenterVertically,modifier=Modifier.semantics{liveRegion=LiveRegionMode.Polite}) {
            CircularProgressIndicator(Modifier.size(DesignTokens.space20.dp),strokeWidth=DesignTokens.space2.dp)
            Text("正在处理…",fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    model.confirmation?.let { row ->
        NativeSettingsConfirmationOverlay(SettingsConfirmation(row.optString("label"),row.getString("confirm"),row.optString("confirmLabel","确认"),{model.confirmation=null},model::confirm))
    }
    }
}

@Composable private fun NativePageRow(m: NativePageModel, row: JSONObject) {
    val label=row.optString("label");val detail=row.optString("detail");val key=row.optString("key")
    val enabled=!m.busy && row.optBoolean("enabled",true)
    when(row.optString("type")) {
        "toggle" -> SettingsToggle(label,detail,row.optBoolean("value"),enabled) {m.act(row,it)}
        "choice" -> Column(Modifier.padding(vertical=DesignTokens.space8.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)) {
            GoalChoice(label,(if(m.values.containsKey(key))m.values[key] else row.opt("value"))?.toString().orEmpty(),row.optJSONArray("options")?.objects().orEmpty().map{it.opt("value")?.toString().orEmpty() to it.getString("label")},enabled) { value ->
                val option=row.optJSONArray("options")?.objects()?.firstOrNull{it.opt("value")?.toString().orEmpty()==value}
                val selected=option?.opt("value") ?: value
                if(row.optString("action").isNotBlank())m.act(row,selected) else m.values[key]=selected
            }
            SettingsNote(detail)
        }
        "input" -> Column(Modifier.padding(vertical=DesignTokens.space8.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)) {
            val secret=row.optBoolean("secret")
            Text(label,fontSize=DesignTokens.font15.sp,fontWeight=FontWeight.Medium)
            OutlinedTextField((m.values[key] ?: row.optString("value")).toString(),{m.values[key]=it},enabled=enabled,singleLine=!row.optBoolean("multiline"),minLines=if(row.optBoolean("multiline"))3 else 1,
                modifier=Modifier.fillMaxWidth().semantics{contentDescription=label},shape=nativeFieldShape,
                textStyle=LocalTextStyle.current.copy(fontSize=DesignTokens.font15.sp,lineHeight=DesignTokens.space24.sp),
                visualTransformation=if(secret)PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions=KeyboardOptions(keyboardType=if(secret)KeyboardType.Password else if(row.optBoolean("number"))KeyboardType.Decimal else KeyboardType.Text))
            SettingsNote(detail)
        }
        "navigate" -> SettingsRow(label,detail) {m.open(row.getString("page"),row.optJSONObject("params") ?: JSONObject())}
        "action" -> Column(Modifier.fillMaxWidth().padding(vertical=DesignTokens.space8.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)) {
            FeedControlButton(label,primary=row.optBoolean("primary"),secondary=!row.optBoolean("primary")&&!row.optBoolean("danger"),danger=row.optBoolean("danger"),enabled=enabled) {m.act(row)}
            SettingsNote(detail)
        }
        "markdown" -> SelectionContainer { NativeMarkdown(row.optString("text",label)) }
        else -> Column(Modifier.fillMaxWidth().padding(vertical=DesignTokens.space12.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)) {
            if(label.isNotBlank())SelectionContainer {Text(label,fontSize=DesignTokens.font15.sp,lineHeight=DesignTokens.space24.sp,fontWeight=if(row.optBoolean("emphasis"))FontWeight.SemiBold else FontWeight.Normal)}
            if(detail.isNotBlank())SelectionContainer {SettingsNote(detail)}
        }
    }
}

@Composable internal fun NativePageError(message:String,retry:()->Unit) {
    Column(Modifier.fillMaxWidth().semantics{liveRegion=LiveRegionMode.Polite},verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)) {
        Text(message,color=MaterialTheme.colorScheme.error,fontSize=DesignTokens.font15.sp,lineHeight=DesignTokens.space24.sp)
        FeedControlButton("重试",secondary=true,action=retry)
    }
}
