package com.memoweft.weftmate.mobile

import android.content.Context
import org.json.JSONObject
import android.util.Base64
import java.io.File
import java.security.MessageDigest
import java.util.UUID

internal data class NativeFile(val file: File?, val name: String, val mime: String, val size: Long,
    val kind: NativeFileKind, val owner: String, val unavailable: String? = null, val epoch: Long = -1)

/** This cache is never a business database. Only the dedicated provider directory can be shared. */
internal class NativeFileCache(private val root: File) {
    @Synchronized fun directory(owner: String): File = File(root, MessageDigest.getInstance("SHA-256")
        .digest(owner.toByteArray()).joinToString("") { "%02x".format(it) }).apply { mkdirs() }
    @Synchronized fun create(owner: String, name: String): File = File(directory(owner),UUID.randomUUID().toString()).apply {
        mkdirs()
    }.let { File(it,nativeFileName(name)) }
    @Synchronized fun clear() { root.listFiles()?.forEach { it.deleteRecursively() } }
    companion object { fun forContext(context: Context) = NativeFileCache(File(context.cacheDir,"native-file-share")) }
}

/** Called only by the native account/epoch guarded executor, never exposed to the WebView. */
internal class NativeFileAccess(private val context: Context, private val api: PersonalApi,
    private val attachments: AttachmentStore, private val store: LocalStore) {
    fun load(host: HostIdentity, row: JSONObject, current: () -> Boolean): NativeFile {
        val owner = Endpoints.ownerKey(host.origin,host.ownerId)
        var name = nativeFileName(row.optString("fileName",row.optString("name","文件")))
        var mime = row.optString("contentType",row.optString("mimeType")).substringBefore(';')
        var size = row.optLong("size",row.optLong("sizeBytes",-1))
        val target = NativeFileCache.forContext(context).create(owner,name)
        try {
            val libraryId = row.optString("libraryId")
            val artifactId = row.optString("artifactId",row.optString("id"))
            val attachmentId = row.optString("attachmentId")
            when {
                libraryId.isNotBlank() -> {
                    val preview = try { api.business(host,"/personal/v1/library/$libraryId/preview","GET",null) }
                    catch(e:ApiFailure) { if(e.status!=404 || artifactId.isBlank())throw e
                        val old=api.artifactPreview(host,artifactId)
                        JSONObject().put("kind","text").put("text",old.getString("text")).put("item",old.getJSONObject("artifact"))
                    }
                    val item = preview.optJSONObject("item")
                    if (item != null) { name = nativeFileName(item.optString("fileName",name)); size = item.optLong("size",size) }
                    when (preview.optString("kind")) {
                        "missing" -> throw ApiFailure(404,"FILE_MISSING")
                        "image","pdf" -> { mime=preview.getString("contentType"); target.writeBytes(Base64.decode(preview.getString("data"),Base64.DEFAULT)) }
                        "text","code","markdown" -> { mime=nativeFileMime(name);target.writeText(preview.getString("text"),Charsets.UTF_8) }
                        else -> {
                            // Old verified artifacts have a download endpoint; native Office/archives do not yet.
                            try { target.writeBytes(api.artifactBytes(host,libraryId)) }
                            catch (e: Exception) {
                                if (e is ApiFailure && e.status in setOf(401,403)) throw e
                                target.parentFile?.deleteRecursively()
                                return NativeFile(null,name,nativeFileMime(name,mime),size,NativeFileKind.OTHER,owner,
                                    if(preview.optString("reason")=="too_large") "文件超过电脑当前可传到手机的大小，请在电脑上打开。" else "这份文件暂时只能在电脑上打开。")
                            }
                        }
                    }
                }
                artifactId.isNotBlank() -> {
                    val record = api.artifactPreview(host,artifactId).getJSONObject("artifact")
                    name=nativeFileName(record.getString("fileName"));mime=artifactSaveMimeType(name,record.optString("contentType"));size=record.getLong("size")
                    val bytes=api.artifactBytes(host,artifactId)
                    require(bytes.size.toLong()==size && MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}==record.getString("sha256").lowercase())
                    target.writeBytes(bytes)
                }
                attachmentId.isNotBlank() -> {
                    val conversation = row.optString("conversationId")
                    val local = attachments.originalForViewing(owner,conversation,attachmentId)
                    if (local != null) { name=local.name;mime=local.mimeType;size=local.sizeBytes;local.file.inputStream().use { source -> target.outputStream().use { source.copyTo(it) } } }
                    else {
                        val ref=store.sharedOriginalAttachment(owner,host.hostId,row.getString("sessionId"),attachmentId)
                        if (ref != null) {
                            name=ref.getString("name");mime=ref.getString("contentType");size=ref.getLong("size")
                            target.outputStream().use { api.downloadOriginalAttachment(host,attachmentId,mime,size,ref.getString("sha256"),it,current) }
                        } else if (attachmentId.startsWith("sha256:")) {
                            val image=api.downloadSharedImage(host,row.getString("sessionId"),attachmentId)
                            mime=image.first;target.writeBytes(image.second)
                        } else throw ApiFailure(404,"ATTACHMENT_UNAVAILABLE")
                    }
                }
                else -> throw ApiFailure(404,"FILE_MISSING")
            }
            if (!current()) throw ApiFailure(409,"ACCOUNT_SWITCHED")
            // Preserve the actual file name for system intents without trusting path components.
            val named=File(target.parentFile,nativeFileName(name))
            if(named!=target && !target.renameTo(named)) throw java.io.IOException("File rename failed")
            return NativeFile(named,name,nativeFileMime(name,mime),named.length(),nativeFileKind(name,mime),owner)
        } catch(e:Exception) { target.parentFile?.deleteRecursively();throw e }
    }
}
internal fun nativeFileMime(name:String, mime:String=""):String {
    if(mime.contains('/')) return mime.substringBefore(';')
    return when(name.substringAfterLast('.').lowercase()) {
        "pdf" -> "application/pdf";"png" -> "image/png";"jpg","jpeg" -> "image/jpeg"
        "zip" -> "application/zip";"xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        "md" -> "text/markdown";"csv" -> "text/csv";"tsv" -> "text/tab-separated-values"
        else -> if(nativeFileKind(name) in setOf(NativeFileKind.TEXT,NativeFileKind.CODE)) "text/plain" else "application/octet-stream"
    }
}
