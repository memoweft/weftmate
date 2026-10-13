package com.memoweft.weftmate.mobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File

/** Shared full-screen destination for composer files, sent attachments and all conversation outputs. */
@Composable internal fun NativeFileViewer(initial:JSONObject,chat:NativeChatModel,activity:NativeActivity,onClose:()->Unit) {
    var row by remember(initial.toString()){mutableStateOf(initial)}
    var file by remember(row.toString()){mutableStateOf<NativeFile?>(null)}
    var error by remember(row.toString()){mutableStateOf("")}
    var loading by remember(row.toString()){mutableStateOf(true)}
    var retry by remember{mutableIntStateOf(0)}
    var menu by remember{mutableStateOf(false)}
    var history by remember{mutableStateOf(initial.optBoolean("showHistory"))}
    val scope=rememberCoroutineScope();val pad=DesignTokens.space16.dp
    LaunchedEffect(row.toString(),retry) {
        loading=true;error=""
        try{file=activity.fileActions.load(row)}catch(e:CancellationException){throw e}catch(e:Exception){error=nativeFileFailure(e)}finally{loading=false}
    }
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)) {
        NativeDialogBars()
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).systemBarsPadding().semantics{contentDescription="文件查看"}) {
            Row(Modifier.fillMaxWidth().padding(horizontal=DesignTokens.space8.dp,vertical=DesignTokens.space8.dp),verticalAlignment=Alignment.CenterVertically) {
                NativeFileIconButton(R.drawable.wm_close,"关闭预览",Modifier.background(MaterialTheme.colorScheme.surfaceVariant,CircleShape),action=onClose)
                val name=file?.name ?: row.optString("fileName",row.optString("name","文件"))
                BoxWithConstraints(Modifier.weight(1f).padding(horizontal=DesignTokens.space12.dp)) {
                    Text(middleFileName(name,maxOf(8,(maxWidth.value/DesignTokens.font16).toInt())),Modifier.fillMaxWidth().semantics{contentDescription="文件名：$name"},fontSize=DesignTokens.font16.sp,maxLines=1,overflow=TextOverflow.Clip)
                }
                Box {NativeFileIconButton(R.drawable.wm_more,"更多文件操作",Modifier.background(MaterialTheme.colorScheme.surfaceVariant,CircleShape)){menu=true}
                    NativeFileMenu(menu,{menu=false}) {
                        NativeFileMenuAction("保存到手机",R.drawable.wm_down,enabled=file?.file!=null,onClick={menu=false;file?.let{activity.fileActions.save(it)}})
                        NativeFileMenuAction("分享",R.drawable.wm_external,enabled=file?.file!=null,onClick={menu=false;file?.let{activity.fileActions.share(it)}})
                        NativeFileMenuAction("用其它应用打开",R.drawable.wm_external,enabled=file?.file!=null,onClick={menu=false;file?.let{activity.fileActions.share(it,true)}})
                        if(row.optString("libraryId").isNotBlank())NativeFileMenuAction("在原网页中查看",R.drawable.wm_external,onClick={menu=false;activity.originalLibrary(row.getString("libraryId"))})
                        if(row.optString("libraryId").isNotBlank())NativeFileMenuAction("在对话中定位",R.drawable.wm_chat,onClick={menu=false;scope.launch{try{NativeLibraryModel(chat,activity).source(row);onClose()}catch(e:Exception){activity.fileActions.notice(nativeFileFailure(e))}}})
                        if(realFileVersions(initial).isNotEmpty())NativeFileMenuAction("查看历史版本",R.drawable.wm_history,onClick={menu=false;history=true})
                    }
                }
            }
            when {
                history -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(pad)) {
                    Text("历史版本",fontSize=DesignTokens.font18.sp)
                    realFileVersions(initial).forEach{version->ListItem(headlineContent={Text(version.optString("fileName",version.optString("name","文件")))},supportingContent={Text(nativeFileTime(version.optString("createdAt")))},modifier=Modifier.clickable{row=JSONObject(version.toString()).put("libraryId",version.optString("artifactId",version.optString("id")));history=false})}
                    OutlinedButton(onClick={history=false},shape=RoundedCornerShape(DesignTokens.radius999.dp),modifier=Modifier.heightIn(min=DesignTokens.space44.dp)){Text("返回文件")}
                }
                loading -> Box(Modifier.weight(1f).fillMaxWidth()){NativeFileLoading()}
                error.isNotBlank() -> Box(Modifier.weight(1f).fillMaxWidth()){NativeFileState(error,R.drawable.wm_warning){retry++}}
                file!=null -> NativeFileBody(file!!,Modifier.weight(1f),activity){retry++}
            }
        }
    }
}
@Composable private fun NativeFileBody(file:NativeFile,modifier:Modifier,activity:NativeActivity,onRetry:()->Unit) {
    val path=file.file
    when {
        path==null || file.kind==NativeFileKind.OTHER -> Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(DesignTokens.space24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)) {
            Icon(painterResource(R.drawable.wm_file),null,Modifier.size(DesignTokens.space48.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(file.name,fontSize=DesignTokens.font18.sp)
            Text(nativeFileSize(file.size),fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(file.unavailable ?: "这种文件可以用其它应用打开。",fontSize=DesignTokens.font16.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            listOf("用其它应用打开" to {activity.fileActions.share(file,true)},"保存到手机" to {activity.fileActions.save(file)},"分享" to {activity.fileActions.share(file)}).forEach{(label,action)->OutlinedButton(onClick=action,enabled=path!=null,shape=RoundedCornerShape(DesignTokens.radius999.dp),modifier=Modifier.heightIn(min=DesignTokens.space44.dp)){Text(label)}}
        }
        file.kind==NativeFileKind.IMAGE -> NativeImageFile(path,modifier,onRetry)
        file.kind==NativeFileKind.PDF -> NativePdfFile(path,modifier)
        else -> NativeTextFile(path,file.kind,modifier,onRetry)
    }
}
@Composable private fun NativeImageFile(file:File,modifier:Modifier,onRetry:()->Unit) {
    var bitmap by remember(file){mutableStateOf<Bitmap?>(null)}
    var failed by remember(file){mutableStateOf(false)}
    LaunchedEffect(file) {bitmap=withContext(Dispatchers.IO){val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeFile(file.path,bounds);var sample=1;while(maxOf(bounds.outWidth,bounds.outHeight)/sample>4096)sample*=2;BitmapFactory.decodeFile(file.path,BitmapFactory.Options().apply{inSampleSize=sample})};failed=bitmap==null}
    if(failed)Box(modifier){NativeFileState("这张图片无法显示，可以用其它应用打开。",R.drawable.wm_image,onRetry)}
    else if(bitmap==null)Box(modifier){NativeFileLoading()}
    else NativeZoomImage(bitmap!!,modifier,file.name)
}
/** Page changes reset zoom. Transform gestures and double tap use one implementation for images and PDF. */
@Composable internal fun NativeZoomImage(bitmap:Bitmap,modifier:Modifier,label:String) {
    var zoom by remember(bitmap){mutableFloatStateOf(1f)}
    var offset by remember(bitmap){mutableStateOf(Offset.Zero)}
    Box(modifier.fillMaxWidth().clipToBounds().pointerInput(bitmap){detectTapGestures(onDoubleTap={zoom=if(zoom>1f)1f else 2.5f;offset=Offset.Zero})}
        .pointerInput(bitmap){detectTransformGestures{_,pan,scale,_->zoom=(zoom*scale).coerceIn(1f,6f);offset=if(zoom==1f)Offset.Zero else Offset((offset.x+pan.x).coerceIn(-size.width*(zoom-1)/2,size.width*(zoom-1)/2),(offset.y+pan.y).coerceIn(-size.height*(zoom-1)/2,size.height*(zoom-1)/2))}},contentAlignment=Alignment.Center) {
        Image(bitmap.asImageBitmap(),label,Modifier.fillMaxSize().graphicsLayer{scaleX=zoom;scaleY=zoom;translationX=offset.x;translationY=offset.y},contentScale=androidx.compose.ui.layout.ContentScale.Fit)
    }
}
@Composable private fun NativePdfFile(file:File,modifier:Modifier) {
    var page by remember(file){mutableIntStateOf(0)}
    var count by remember(file){mutableIntStateOf(0)}
    var bitmap by remember(file){mutableStateOf<Bitmap?>(null)}
    var error by remember(file){mutableStateOf("")}
    var retry by remember(file){mutableIntStateOf(0)}
    LaunchedEffect(file,page,retry) {
        bitmap=null;error=""
        try {
            val rendered=withContext(Dispatchers.IO){ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY).use { fd -> PdfRenderer(fd).use { pdf ->
                pdf.openPage(page.coerceIn(0,pdf.pageCount-1)).use { p ->
                    val scale=minOf(2.0,2048.0/p.width,2048.0/p.height)
                    val width=(p.width*scale).toInt().coerceAtLeast(1);val height=(p.height*scale).toInt().coerceAtLeast(1)
                    val image=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);image.eraseColor(android.graphics.Color.WHITE)
                    p.render(image,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);image to pdf.pageCount
                }
            } } }
            bitmap=rendered.first;count=rendered.second
        }catch(e:CancellationException){throw e}catch(_:Exception){error="这份 PDF 无法显示，可以用其它应用打开。"}
    }
    Column(modifier.fillMaxWidth()) {
        when {error.isNotBlank()->Box(Modifier.weight(1f)){NativeFileState(error,R.drawable.wm_book){retry++}};bitmap==null->Box(Modifier.weight(1f)){NativeFileLoading()};else->NativeZoomImage(bitmap!!,Modifier.weight(1f),"第 ${page+1} 页")}
        Row(Modifier.fillMaxWidth().padding(DesignTokens.space8.dp),horizontalArrangement=Arrangement.Center,verticalAlignment=Alignment.CenterVertically) {
            NativeFileIconButton(R.drawable.wm_back,"上一页",enabled=page>0){page--}
            Text(if(count==0)"正在读取…" else "${page+1} / $count",Modifier.padding(horizontal=DesignTokens.space16.dp),fontSize=DesignTokens.font13.sp)
            NativeFileIconButton(R.drawable.wm_right,"下一页",enabled=page+1<count){page++}
        }
    }
}
