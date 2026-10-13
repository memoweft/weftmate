package com.memoweft.weftmate.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import kotlinx.coroutines.launch

@Composable internal fun NativeArtifactFiles(event:JSONObject,chat:NativeChatModel,onPreview:(JSONObject)->Unit) {
    val data=event.optJSONObject("data") ?: return
    val files=data.optJSONArray("artifacts")?.objects() ?: listOf(data.optJSONObject("artifact") ?: data)
    val activity=LocalContext.current as? NativeActivity
    val scope=rememberCoroutineScope()
    Column(Modifier.fillMaxWidth()) { files.filter{it.optString("artifactId").isNotBlank()}.forEach{file->
        val row=JSONObject(file.toString()).put("libraryId",file.getString("artifactId")).put("sessionId",event.optJSONObject("sourceRef")?.optString("sessionId") ?: chat.sessionId)
        var menu by remember(row.optString("artifactId")){mutableStateOf(false)}
        Row(Modifier.fillMaxWidth().heightIn(min=DesignTokens.space56.dp).clickable{onPreview(row)},verticalAlignment=Alignment.CenterVertically) {
            Icon(painterResource(nativeFileIcon(row)),null,Modifier.size(DesignTokens.space24.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.weight(1f).padding(horizontal=DesignTokens.space12.dp)) {
                Text(row.optString("fileName","成果文件"),maxLines=2,overflow=TextOverflow.Ellipsis,fontSize=DesignTokens.font16.sp)
                Text(nativeFileSize(row.optLong("size",-1)),fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Box {NativeIconButton(R.drawable.wm_more,"查看文件操作：${row.optString("fileName")}"){menu=true}
                DropdownMenu(menu,{menu=false}) {
                    DropdownMenuItem(text={Text("保存到手机")},onClick={menu=false;scope.launch{try{activity?.fileActions?.let{it.save(it.load(row))}}catch(e:Exception){activity?.fileActions?.notice(nativeFileFailure(e))}}})
                    DropdownMenuItem(text={Text("分享")},onClick={menu=false;scope.launch{try{activity?.fileActions?.let{it.share(it.load(row))}}catch(e:Exception){activity?.fileActions?.notice(nativeFileFailure(e))}}})
                    if(realFileVersions(row).isNotEmpty())DropdownMenuItem(text={Text("查看历史版本")},onClick={menu=false;onPreview(JSONObject(row.toString()).put("showHistory",true))})
                }
            }
        }
    } }
}
