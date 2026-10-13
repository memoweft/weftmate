package com.memoweft.weftmate.mobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.*
import org.json.JSONObject

private val libraryTypes=listOf("" to "全部","document" to "文档","spreadsheet" to "表格","image" to "图片","code" to "代码","other" to "其它")
internal fun libraryTypeLabel(row:JSONObject):String {
    val name=row.optString("fileName").lowercase()
    return when { name.endsWith(".pdf")->"PDF";Regex("\\.(zip|7z|rar|tar|gz)$").containsMatchIn(name)->"压缩包";else->libraryTypes.find{it.first==row.optString("type")}?.second ?: "其它" }
}
/** Mirrors the existing mobile library's hierarchy, density and filters. Palette comes from AND-4 tokens. */
@Composable internal fun NativeLibraryWebLayout(chat:NativeChatModel,activity:NativeActivity,modifier:Modifier,onPreview:(JSONObject)->Unit) {
    val model=remember(chat.owner){NativeLibraryModel(chat,activity)}
    val scope=rememberCoroutineScope();val gap=DesignTokens.space8.dp;val pad=DesignTokens.space20.dp
    LaunchedEffect(model.search,model.type,model.project,model.days){delay(200);model.refresh()}
    LaunchedEffect(model){while(true){delay(5000);if(activity.nativeForeground && !model.loading)model.refresh()}}
    DisposableEffect(model){onDispose{model.close()}}
    LazyColumn(modifier.fillMaxWidth().semantics{contentDescription="成果文件"},contentPadding=PaddingValues(start=pad,top=DesignTokens.space24.dp,end=pad,bottom=DesignTokens.space32.dp)) {
        item {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("成果库",Modifier.weight(1f),fontSize=DesignTokens.font24.sp,fontWeight=FontWeight.SemiBold);NativeFileIconButton(R.drawable.wm_sync,"刷新成果库",enabled=!model.loading){model.refresh()}}
            Text("对话里做好的文件，都在这里。",Modifier.padding(top=gap,bottom=DesignTokens.space24.dp),fontSize=((DesignTokens.font14+DesignTokens.font16)/2).sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            LibrarySelect("文件类型："+(libraryTypes.find{it.first==model.type}?.second ?: "全部"),Modifier.fillMaxWidth().padding(bottom=DesignTokens.space16.dp),"按文件类型筛选") { dismiss ->
                libraryTypes.forEach{(id,label)->DropdownMenuItem(modifier=Modifier.height(DesignTokens.space44.dp),text={NativeFileLabel(label)},trailingIcon={if(model.type==id)Icon(painterResource(R.drawable.wm_check),"当前")},onClick={model.type=id;dismiss()})}
            }
            BasicTextField(model.search,{model.search=it.take(200)},Modifier.fillMaxWidth().heightIn(min=DesignTokens.space44.dp).border((DesignTokens.space2/2).dp,MaterialTheme.colorScheme.outline,RoundedCornerShape(DesignTokens.radius8.dp)).padding(horizontal=DesignTokens.space12.dp,vertical=gap).semantics{contentDescription="搜索文件名"},singleLine=true,textStyle=LocalTextStyle.current.copy(color=MaterialTheme.colorScheme.onSurface,fontSize=((DesignTokens.font14+DesignTokens.font16)/2).sp),cursorBrush=SolidColor(MaterialTheme.colorScheme.primary),decorationBox={inner->Box(Modifier.fillMaxWidth()){if(model.search.isEmpty())Text("搜索文件名",fontSize=((DesignTokens.font14+DesignTokens.font16)/2).sp,color=MaterialTheme.colorScheme.onSurfaceVariant);inner()}})
            Row(Modifier.fillMaxWidth().padding(top=gap),horizontalArrangement=Arrangement.spacedBy(gap)) {
                LibrarySelect(model.projects.firstOrNull{it.optString("id")==model.project}?.optString("name") ?: "全部项目",Modifier.weight(1f),"按项目筛选") { dismiss ->
                    (listOf(JSONObject().put("id","").put("name","全部项目"))+model.projects).forEach{row->DropdownMenuItem(modifier=Modifier.height(DesignTokens.space44.dp),text={NativeFileLabel(row.getString("name"))},trailingIcon={if(model.project==row.getString("id"))Icon(painterResource(R.drawable.wm_check),"当前")},onClick={model.project=row.getString("id");dismiss()})}
                }
                LibrarySelect(if(model.days==0)"全部时间" else "最近 ${model.days} 天",Modifier.weight(1f),"按时间筛选") { dismiss ->
                    listOf(0,7,30,90).forEach{days->DropdownMenuItem(modifier=Modifier.height(DesignTokens.space44.dp),text={NativeFileLabel(if(days==0)"全部时间" else "最近 $days 天")},trailingIcon={if(model.days==days)Icon(painterResource(R.drawable.wm_check),"当前")},onClick={model.days=days;dismiss()})}
                }
            }
            Text(if(model.loading)"正在读取成果…" else if(model.error.isNotBlank())"读取失败" else "${model.total} 个文件",Modifier.padding(top=DesignTokens.space20.dp,bottom=gap),fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(model.error.isNotBlank() && model.rows.isNotEmpty())NativeFileState(model.error,R.drawable.wm_warning){model.refresh()}
        }
        when {
            model.rows.isEmpty() && model.loading -> item{NativeFileLoading()}
            model.rows.isEmpty() && model.error.isNotBlank() -> item{NativeFileState(model.error,R.drawable.wm_warning){model.refresh()}}
            model.rows.isEmpty() -> item{NativeFileState(if(model.search.isNotBlank()||model.type.isNotBlank()||model.project.isNotBlank()||model.days!=0)"没有找到符合条件的文件。试试其他筛选或文件名。" else if(model.noComputer)"让电脑上的 WeftMate 帮你做事后，产出的文件会出现在这里。" else "还没有成果。让助手写文档、整理表格或生成图片，完成的文件会出现在这里。",R.drawable.wm_layers)}
            else -> items(model.rows,key={it.getString("id")}) { row ->
                var menu by remember(row.getString("id")){mutableStateOf(false)}
                val ref=remember(row.toString()){JSONObject(row.toString()).put("libraryId",row.getString("id"))}
                Row(Modifier.fillMaxWidth().padding(vertical=DesignTokens.space6.dp).clip(RoundedCornerShape(DesignTokens.radius26.dp)).background(if(chat.dark)MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant).clickable{onPreview(ref)}.padding(DesignTokens.space12.dp),verticalAlignment=Alignment.CenterVertically) {
                    LibraryThumbnail(row,activity)
                    Column(Modifier.weight(1f).padding(horizontal=gap),verticalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)) {
                        Text(row.optString("fileName","文件"),fontWeight=FontWeight.Medium,fontSize=((DesignTokens.font14+DesignTokens.font16)/2).sp,maxLines=2,overflow=TextOverflow.Ellipsis)
                        Text(libraryTypeLabel(row)+" · "+nativeFileSize(row.optLong("size",-1))+(row.optString("projectName").takeIf{it.isNotBlank()&&it!="null"}?.let{" · $it"} ?: ""),fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        if(!row.optBoolean("exists",true))Text("已不在原位置",fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(nativeFileTime(row.optString("modifiedAt",row.optString("createdAt"))),fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Box {NativeFileIconButton(R.drawable.wm_more,"文件操作：${row.optString("fileName")}"){menu=true}
                        NativeFileMenu(menu,{menu=false}) {
                            fun act(action:(NativeFile)->Unit){menu=false;scope.launch{try{action(activity.fileActions.load(ref))}catch(e:CancellationException){throw e}catch(e:Exception){activity.fileActions.notice(nativeFileFailure(e))}}}
                            NativeFileMenuAction("保存到手机",R.drawable.wm_down,onClick={act{activity.fileActions.save(it)}})
                            NativeFileMenuAction("分享",R.drawable.wm_external,onClick={act{activity.fileActions.share(it)}})
                            NativeFileMenuAction("在对话中定位",R.drawable.wm_chat,onClick={menu=false;scope.launch{try{model.source(row)}catch(e:CancellationException){throw e}catch(e:Exception){activity.fileActions.notice(nativeFileFailure(e))}}})
                            if(realFileVersions(row).isNotEmpty())NativeFileMenuAction("查看历史版本",R.drawable.wm_history,onClick={menu=false;onPreview(JSONObject(ref.toString()).put("showHistory",true))})
                        }
                    }
                }
            }
        }
        if(model.next.isNotBlank())item{OutlinedButton(onClick={model.refresh(true)},enabled=!model.loading,shape=RoundedCornerShape(DesignTokens.radius999.dp),modifier=Modifier.height(DesignTokens.space44.dp)){NativeFileLabel(if(model.loading)"正在读取…" else "加载更多")}}
    }
}
@Composable private fun LibrarySelect(label:String,modifier:Modifier,description:String,content:@Composable ((()->Unit))->Unit) {
    var expanded by remember{mutableStateOf(false)}
    Box(modifier) {
        Row(Modifier.fillMaxWidth().heightIn(min=DesignTokens.space44.dp).border((DesignTokens.space2/2).dp,MaterialTheme.colorScheme.outline,RoundedCornerShape(DesignTokens.radius999.dp)).clickable{expanded=true}.padding(horizontal=DesignTokens.space12.dp,vertical=DesignTokens.space8.dp).semantics{contentDescription=description},verticalAlignment=Alignment.CenterVertically) {
            Text(label,Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=((DesignTokens.font14+DesignTokens.font16)/2).sp)
            Icon(painterResource(R.drawable.wm_down),null,Modifier.size(DesignTokens.space16.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        NativeFileMenu(expanded,{expanded=false}){content{expanded=false}}
    }
}
@Composable private fun LibraryThumbnail(row:JSONObject,activity:NativeActivity) {
    var bitmap by remember(row.getString("id")){mutableStateOf<Bitmap?>(null)}
    LaunchedEffect(row.getString("id")) {
        if(row.optString("type")=="image" && row.optBoolean("exists",true))try {
            val file=activity.fileActions.load(JSONObject(row.toString()).put("libraryId",row.getString("id"))).file
            if(file!=null)bitmap=withContext(Dispatchers.IO){val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeFile(file.path,bounds);var sample=1;while(maxOf(bounds.outWidth,bounds.outHeight)/sample>128)sample*=2;BitmapFactory.decodeFile(file.path,BitmapFactory.Options().apply{inSampleSize=sample})}
        }catch(e:CancellationException){throw e}catch(_:Exception){}
    }
    Box(Modifier.size(DesignTokens.space40.dp).clip(RoundedCornerShape(DesignTokens.radius8.dp)),contentAlignment=Alignment.Center) {
        if(bitmap!=null)Image(bitmap!!.asImageBitmap(),null,Modifier.fillMaxSize(),contentScale=androidx.compose.ui.layout.ContentScale.Crop)
        else Icon(painterResource(nativeFileIcon(row)),null,Modifier.size(DesignTokens.space24.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
