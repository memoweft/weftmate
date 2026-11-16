package com.memoweft.weftmate.mobile

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.coroutines.resume

/** The system camera/photo picker owns image capture; decoding uses the shipped shared QR decoder. */
internal class NativeQrPicker(private val activity:NativeActivity) {
    private val request=9072
    private var result:kotlinx.coroutines.CancellableContinuation<android.net.Uri?>?=null
    private var camera:File?=null
    @Suppress("DEPRECATION") suspend fun pick():String {
        check(result==null){"已有二维码读取正在进行。"}
        val uri=suspendCancellableCoroutine<android.net.Uri?> { continuation ->
            result=continuation
            continuation.invokeOnCancellation {result=null;camera?.delete();camera=null}
            val image=Intent(Intent.ACTION_GET_CONTENT).apply {type="image/*";addCategory(Intent.CATEGORY_OPENABLE)}
            camera=File(File(activity.cacheDir,"composer-camera").apply{mkdirs()},"pairing-${java.util.UUID.randomUUID()}.jpg")
            val cameraUri=FileProvider.getUriForFile(activity,"${activity.packageName}.composer-camera",camera!!)
            val capture=Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply{putExtra(MediaStore.EXTRA_OUTPUT,cameraUri);addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)}
            val chooser=Intent.createChooser(image,"读取电脑二维码").apply {putExtra(Intent.EXTRA_INITIAL_INTENTS,arrayOf(capture))}
            try{activity.startActivityForResult(chooser,request)}catch(_:Exception){result=null;continuation.resume(null)}
        }
        if(uri==null){camera?.delete();camera=null;throw IllegalStateException("已取消读取二维码，可以直接输入配对码。")}
        try {
            val encoded=withContext(Dispatchers.IO) {
                val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true}
                activity.contentResolver.openInputStream(uri).use{BitmapFactory.decodeStream(it,null,bounds)}
                var sample=1;while(maxOf(bounds.outWidth,bounds.outHeight)/sample>2048)sample*=2
                val bitmap=activity.contentResolver.openInputStream(uri).use{BitmapFactory.decodeStream(it,null,BitmapFactory.Options().apply{inSampleSize=sample})} ?: throw IllegalStateException("图片无法读取，请重新选择。")
                val bytes=ByteArrayOutputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it);it.toByteArray()};bitmap.recycle()
                Base64.encodeToString(bytes,Base64.NO_WRAP)
            }
            return activity.core.call("""
                const image=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('图片无法读取'));i.src='data:image/png;base64,'+${JSONObject.quote(encoded)}});
                const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
                const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
                const code=WeftFormat.decodeQR(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height)?.data;
                if(!code)throw Error('没有识别到二维码，请重新拍摄或直接输入配对码。');return {value:code};
            """.trimIndent()).getString("value")
        } finally {camera?.delete();camera=null}
    }
    fun result(code:Int,status:Int,data:Intent?) {
        if(code!=request)return
        val pending=result ?: return;result=null
        val captured=camera?.takeIf{it.length()>0}?.let{FileProvider.getUriForFile(activity,"${activity.packageName}.composer-camera",it)}
        if(pending.isActive)pending.resume(if(status==Activity.RESULT_OK)data?.data ?: captured else null)
    }
}
