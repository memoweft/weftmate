package com.memoweft.weftmate.mobile

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import kotlinx.coroutines.*
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal fun nativeDocumentIntent(file: NativeFile) = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
    addCategory(Intent.CATEGORY_OPENABLE); type=file.mime; putExtra(Intent.EXTRA_TITLE,nativeFileName(file.name))
}
internal fun nativeShareIntent(file: NativeFile, uri: Uri, open: Boolean = false) = Intent(if(open) Intent.ACTION_VIEW else Intent.ACTION_SEND).apply {
    if(open) setDataAndType(uri,file.mime) else { type=file.mime;putExtra(Intent.EXTRA_STREAM,uri) }
    clipData=ClipData.newRawUri(file.name,uri)
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
}
/** SAF callbacks stay bound to the exact login epoch. No storage permission. */
internal class NativeFileActions(private val activity: NativeActivity) {
    private var pending: NativeFile? = null
    internal var systemIntent: ((Intent)->Unit)? = null
    private val save=activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val file=pending;pending=null
        if(result.resultCode==android.app.Activity.RESULT_OK && file!=null) result.data?.data?.let { write(file,it) }
    }
    suspend fun load(row: org.json.JSONObject):NativeFile = suspendCancellableCoroutine { c ->
        activity.nativeFileLoad(row) { r -> if(c.isActive) r.fold({c.resume(it)},{c.resumeWithException(it)}) }
    }
    fun save(file:NativeFile) {
        if(!usable(file))return
        if(pending!=null){notice("请先完成上一次保存。");return}
        val intent=nativeDocumentIntent(file)
        systemIntent?.let { it(intent);return }
        pending=file
        try{save.launch(intent)}catch(_:Exception){pending=null;notice("暂时无法选择保存位置，请重试。")}
    }
    internal fun write(file:NativeFile, uri:Uri) {
        activity.model.scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    if(!activity.nativeFileCurrent(file))throw ApiFailure(409,"ACCOUNT_SWITCHED")
                    activity.contentResolver.openOutputStream(uri,"w")?.use { out -> file.file!!.inputStream().use { input ->
                        val buffer=ByteArray(64*1024)
                        while(true){if(!activity.nativeFileCurrent(file))throw ApiFailure(409,"ACCOUNT_SWITCHED");val n=input.read(buffer);if(n<0)break;out.write(buffer,0,n)}
                    } } ?: throw java.io.IOException("Cannot write document")
                }
                if(activity.nativeFileCurrent(file))notice("已保存")
            }catch(_:Exception){if(activity.nativeFileCurrent(file))notice("保存没能完成，请重试。")}
        }
    }
    fun share(file:NativeFile, open:Boolean=false) {
        if(!usable(file))return
        try {
            val uri=FileProvider.getUriForFile(activity,"${activity.packageName}.native-files",file.file!!)
            val intent=nativeShareIntent(file,uri,open)
            val chooser=Intent.createChooser(intent,if(open)"用其它应用打开" else "分享文件")
            systemIntent?.let { it(chooser);return }
            activity.startActivity(chooser)
        }catch(_:Exception){notice(if(open)"没有找到能打开这份文件的应用。" else "暂时无法分享，请重试。")}
    }
    private fun usable(file:NativeFile):Boolean {
        if(!activity.nativeFileCurrent(file)){notice("请重新打开文件。");return false}
        if(file.file?.isFile!=true){notice(file.unavailable ?: "文件已不在原位置。");return false}
        return true
    }
    fun notice(text:String)=Toast.makeText(activity,text,Toast.LENGTH_SHORT).show()
}
