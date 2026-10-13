package com.memoweft.weftmate.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

internal fun nativeFileIcon(row:JSONObject):Int = when(nativeFileKind(row.optString("fileName",row.optString("name")),row.optString("contentType",row.optString("mimeType")))) {
    NativeFileKind.IMAGE -> R.drawable.wm_image;NativeFileKind.CODE -> R.drawable.wm_code
    NativeFileKind.PDF -> R.drawable.wm_book;else -> R.drawable.wm_file
}
@Composable internal fun NativeLibrary(chat:NativeChatModel,activity:NativeActivity,modifier:Modifier,onPreview:(JSONObject)->Unit) {
    val model=remember(chat.owner){NativeLibraryModel(chat,activity)}
    val scope=rememberCoroutineScope()
    val pad=DesignTokens.space16.dp;val gap=DesignTokens.space8.dp
    var filter by remember{mutableStateOf(false)}
    LaunchedEffect(model.search,model.type,model.project,model.days){delay(200);model.refresh()}
    LaunchedEffect(chat.rows.lastOrNull()?.toString()){model.refresh()}
    LaunchedEffect(model){while(true){delay(5000);if(activity.nativeForeground && !model.loading)model.refresh()}}
    DisposableEffect(model){onDispose{model.close()}}
    Column(modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal=pad,vertical=gap),verticalAlignment=Alignment.CenterVertically) {
            Icon(painterResource(R.drawable.wm_search),null,Modifier.size(DesignTokens.space24.dp))
            BasicTextField(model.search,{model.search=it.take(200)},Modifier.weight(1f).padding(horizontal=gap).heightIn(min=DesignTokens.space44.dp).semantics{contentDescription="搜索文件名"},singleLine=true,
                textStyle=LocalTextStyle.current.copy(color=MaterialTheme.colorScheme.onSurface,fontSize=DesignTokens.font16.sp),cursorBrush=SolidColor(MaterialTheme.colorScheme.primary),
                decorationBox={inner->Box(Modifier.fillMaxSize(),contentAlignment=Alignment.CenterStart){if(model.search.isEmpty())Text("搜索文件名",color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=DesignTokens.font16.sp);inner()}})
            Box {
                NativeIconButton(R.drawable.wm_filter,"筛选文件",selected=model.type.isNotBlank()||model.project.isNotBlank()||model.days!=0){filter=true}
                DropdownMenu(filter,{filter=false}) {
                    Text("文件类型",Modifier.padding(pad),fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    listOf("" to "全部文件","document" to "文档","spreadsheet" to "表格","image" to "图片","code" to "代码","other" to "其它").forEach{(id,name)->
                        DropdownMenuItem(text={Text(name)},trailingIcon={if(model.type==id)Icon(painterResource(R.drawable.wm_check),"当前")},onClick={model.type=id;filter=false}) }
                    HorizontalDivider()
                    listOf(0 to "全部时间",7 to "最近 7 天",30 to "最近 30 天",90 to "最近 90 天").forEach{(id,name)->DropdownMenuItem(text={Text(name)},trailingIcon={if(model.days==id)Icon(painterResource(R.drawable.wm_check),"当前")},onClick={model.days=id;filter=false})}
                    if(model.projects.isNotEmpty()) {
                        HorizontalDivider()
                        (listOf(JSONObject().put("id","").put("name","全部项目"))+model.projects).forEach{row->DropdownMenuItem(text={Text(row.getString("name"))},trailingIcon={if(model.project==row.getString("id"))Icon(painterResource(R.drawable.wm_check),"当前")},onClick={model.project=row.getString("id");filter=false})}
                    }
                }
            }
            NativeIconButton(R.drawable.wm_sync,"刷新成果库",enabled=!model.loading){model.refresh()}
        }
        if(model.error.isNotBlank() && model.rows.isNotEmpty())Row(Modifier.padding(horizontal=pad),verticalAlignment=Alignment.CenterVertically){Text(model.error,Modifier.weight(1f),fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);NativeIconButton(R.drawable.wm_sync,"重试读取成果"){model.refresh()}}
        LazyColumn(Modifier.fillMaxWidth().weight(1f).semantics{contentDescription="成果文件"},contentPadding=PaddingValues(pad),verticalArrangement=Arrangement.spacedBy(gap)) {
            when {
                model.rows.isEmpty() && model.loading -> item{NativeFileLoading()}
                model.rows.isEmpty() && model.error.isNotBlank() -> item{NativeFileState(model.error,R.drawable.wm_warning){model.refresh()}}
                model.rows.isEmpty() -> item{NativeFileState(if(model.search.isNotBlank()||model.type.isNotBlank()||model.project.isNotBlank()||model.days!=0)"没有找到符合条件的文件，试试其它文件名或筛选。" else "让电脑上的 WeftMate 帮你做事后，产出的文件会出现在这里。",R.drawable.wm_layers)}
                else -> items(model.rows,key={it.getString("id")}) { row ->
                    var menu by remember(row.getString("id")){mutableStateOf(false)}
                    Row(Modifier.fillMaxWidth().clickable{onPreview(JSONObject(row.toString()).put("libraryId",row.getString("id")))}.padding(vertical=gap).heightIn(min=DesignTokens.space56.dp),verticalAlignment=Alignment.CenterVertically) {
                        Icon(painterResource(nativeFileIcon(row)),null,Modifier.size(DesignTokens.space24.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
                        Column(Modifier.weight(1f).padding(horizontal=DesignTokens.space12.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)) {
                            Text(row.optString("fileName","文件"),fontWeight=FontWeight.SemiBold,fontSize=DesignTokens.font16.sp,maxLines=2,overflow=TextOverflow.Ellipsis)
                            Text(nativeFileSize(row.optLong("size",-1))+" · "+if(row.optBoolean("exists",true))nativeFileTime(row.optString("createdAt")) else "已不在原位置",fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            row.optString("projectName").takeIf{it.isNotBlank()&&it!="null"}?.let{Text(it,fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis)}
                        }
                        Box {NativeIconButton(R.drawable.wm_more,"文件操作：${row.optString("fileName")}"){menu=true}
                            DropdownMenu(menu,{menu=false}) {
                                fun act(action:(NativeFile)->Unit){menu=false;scope.launch{try{action(activity.fileActions.load(JSONObject(row.toString()).put("libraryId",row.getString("id"))))}catch(e:Exception){activity.fileActions.notice(nativeFileFailure(e))}}}
                                DropdownMenuItem(text={Text("保存到手机")},onClick={act{activity.fileActions.save(it)}})
                                DropdownMenuItem(text={Text("分享")},onClick={act{activity.fileActions.share(it)}})
                                DropdownMenuItem(text={Text("在对话中定位")},onClick={menu=false;scope.launch{try{model.source(row)}catch(e:Exception){activity.fileActions.notice(nativeFileFailure(e))}}})
                                if(realFileVersions(row).isNotEmpty())DropdownMenuItem(text={Text("查看历史版本")},onClick={menu=false;onPreview(JSONObject(row.toString()).put("libraryId",row.getString("id")).put("showHistory",true))})
                            }
                        }
                    }
                    HorizontalDivider(color=MaterialTheme.colorScheme.outline)
                }
            }
            if(model.next.isNotBlank())item{OutlinedButton(onClick={model.refresh(true)},enabled=!model.loading,shape=RoundedCornerShape(DesignTokens.radius4.dp)){Text(if(model.loading)"正在读取…" else "查看更多成果")}}
        }
    }
}
@Composable internal fun NativeFileLoading() {
    Column(Modifier.fillMaxWidth().padding(DesignTokens.space16.dp).semantics{contentDescription="正在读取文件"},verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)) {
        repeat(4){Row(verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(DesignTokens.space24.dp).background(MaterialTheme.colorScheme.surfaceVariant));Spacer(Modifier.width(DesignTokens.space12.dp));Column(verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)){Box(Modifier.fillMaxWidth(0.8f).height(DesignTokens.space16.dp).background(MaterialTheme.colorScheme.surfaceVariant));Box(Modifier.fillMaxWidth(0.5f).height(DesignTokens.space8.dp).background(MaterialTheme.colorScheme.surfaceVariant))}}}
    }
}
@Composable internal fun NativeFileState(message:String,icon:Int,retry:(()->Unit)?=null) {
    Column(Modifier.fillMaxWidth().padding(DesignTokens.space24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)) {
        Icon(painterResource(icon),null,Modifier.size(DesignTokens.space32.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
        Text(message,fontSize=DesignTokens.font16.sp,lineHeight=DesignTokens.font24.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(retry!=null)OutlinedButton(onClick=retry,shape=RoundedCornerShape(DesignTokens.radius4.dp)){Text("重试")}
    }
}
