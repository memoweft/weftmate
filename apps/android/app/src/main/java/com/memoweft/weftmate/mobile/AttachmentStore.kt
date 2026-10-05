package com.memoweft.weftmate.mobile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.UUID

data class ChatAttachment(val id: String, val name: String, val kind: String, val mimeType: String,
    val sizeBytes: Long, val sha256: String, val owner: String, val conversationId: String, val file: File,
    val used: Boolean = false, val attemptTurnId: String? = null,
    val thumbnailSize: Int = 0, val thumbnailHash: String? = null) {
    fun bridge(): JSONObject = JSONObject().put("attachmentId", id).put("name", name).put("kind", kind)
        .put("mimeType", mimeType).put("sizeBytes", sizeBytes)
}

/** App-private draft copies. The index contains metadata only; no content enters the sync ledger. */
class AttachmentStore(private val context: Context, private val localStore: LocalStore? = null,
    private val sentCacheOwnerBytes: Long = 30L * 1024 * 1024) {
    private val root = File(context.filesDir, "chat-attachments").apply { mkdirs() }
    private val index = context.getSharedPreferences("chat-attachment-index", Context.MODE_PRIVATE)
    private val maxImage = MAX_IMAGE_BYTES
    private val maxFile = MAX_IMAGE_BYTES
    private val maxThumbnail = 12_000
    private val maxDisplay = 512 * 1024

    private fun thumbnailFile(id: String) = File(root, "$id.thumb")
    private fun displayFile(id: String) = File(root, "$id.display")
    private fun modelFile(id: String) = File(root, "$id.model")

    companion object {
        const val MAX_IMAGE_BYTES = 1024L * 1024 * 1024
        const val MAX_MODEL_TEXT_BYTES = 16 * 1024
        const val SAFE_ORIGINAL_BYTES = 20L * 1024 * 1024
        private fun sampleFor(width: Int, height: Int, edge: Int): Int {
            val needed = maxOf(1, (maxOf(width, height).toLong() + edge - 1) / edge)
            var sample = 1
            while (sample < needed && sample <= Int.MAX_VALUE / 2) sample *= 2
            return sample
        }
        fun renderDisplay(source: File, maxBytes: Int = 512 * 1024): ByteArray {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(source.path, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0)
                throw ApiFailure(415, "ATTACHMENT_UNSUPPORTED")
            val sample = sampleFor(bounds.outWidth, bounds.outHeight, 2048)
            val decoded = BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sample })
                ?: throw ApiFailure(415, "ATTACHMENT_UNSUPPORTED")
            try {
                for (edge in listOf(1280, 1024, 768, 512)) {
                    val scale = minOf(1.0, edge.toDouble() / maxOf(decoded.width, decoded.height))
                    val scaled = Bitmap.createScaledBitmap(decoded,
                        maxOf(1, (decoded.width * scale).toInt()), maxOf(1, (decoded.height * scale).toInt()), true)
                    try {
                        for (quality in listOf(85, 70, 55, 40)) {
                            val bytes = ByteArrayOutputStream().use { output ->
                                if (!scaled.compress(Bitmap.CompressFormat.JPEG, quality, output))
                                    throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
                                output.toByteArray()
                            }
                            if (bytes.size <= maxBytes) return bytes
                        }
                    } finally { if (scaled !== decoded) scaled.recycle() }
                }
            } finally { decoded.recycle() }
            throw ApiFailure(413, "IMAGE_PREVIEW_UNAVAILABLE")
        }
    }

    private fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }

    /** A preview is always a fresh, bounded JPEG; the original file never crosses the UI bridge. */
    private fun makeThumbnail(source: File): ByteArray {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.path, bounds)
        val sample = sampleFor(bounds.outWidth, bounds.outHeight, 256)
        val decoded = BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw ApiFailure(415, "ATTACHMENT_UNSUPPORTED")
        try {
            for (edge in listOf(192, 144, 112, 80)) {
                val scale = minOf(1.0, edge.toDouble() / maxOf(decoded.width, decoded.height))
                val width = maxOf(1, (decoded.width * scale).toInt())
                val height = maxOf(1, (decoded.height * scale).toInt())
                val scaled = Bitmap.createScaledBitmap(decoded, width, height, true)
                try {
                    for (quality in listOf(70, 50, 30, 15)) {
                        val bytes = ByteArrayOutputStream().use { output ->
                            if (!scaled.compress(Bitmap.CompressFormat.JPEG, quality, output))
                                throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
                            output.toByteArray()
                        }
                        if (bytes.size <= maxThumbnail) return bytes
                    }
                } finally { if (scaled !== decoded) scaled.recycle() }
            }
        } finally { decoded.recycle() }
        throw ApiFailure(413, "ATTACHMENT_TOO_LARGE")
    }

    private fun thumbnailBytes(row: ChatAttachment): ByteArray? {
        if (row.kind != "image" || row.thumbnailSize == 0 || row.thumbnailHash == null) return null
        val file = thumbnailFile(row.id)
        if (row.thumbnailSize !in 1..maxThumbnail || !file.isFile || file.length() != row.thumbnailSize.toLong())
            throw ApiFailure(409, "ATTACHMENT_CHANGED")
        val bytes = file.readBytes()
        if (digest(bytes) != row.thumbnailHash) throw ApiFailure(409, "ATTACHMENT_CHANGED")
        return bytes
    }

    /** Upgraded drafts may predate thumbnails. Preview failures leave the valid original usable. */
    private fun availableThumbnail(row: ChatAttachment): ByteArray? {
        if (row.kind != "image") return null
        try { thumbnailBytes(row)?.let { return it } } catch (_: Exception) { }
        return try {
            verify(row)
            val bytes = makeThumbnail(row.file)
            val target = thumbnailFile(row.id)
            FileOutputStream(target).use { output -> output.write(bytes); output.fd.sync() }
            val updated = row.copy(thumbnailSize = bytes.size, thumbnailHash = digest(bytes))
            if (!index.edit().putString(row.id, encode(updated, row.conversationId).toString()).commit()) {
                target.delete()
                return null
            }
            bytes
        } catch (_: Exception) { thumbnailFile(row.id).delete(); null }
    }

    private fun displayBytes(row: ChatAttachment): ByteArray {
        val target = displayFile(row.id)
        if (target.isFile && target.length() in 1..maxDisplay.toLong()) return target.readBytes()
        val bytes = renderDisplay(row.file, maxDisplay)
        val pending = File(root, "${row.id}.display.tmp")
        try {
            FileOutputStream(pending).use { output -> output.write(bytes); output.fd.sync() }
            if (target.exists() && !target.delete()) throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
            if (!pending.renameTo(target)) throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
        } finally { pending.delete() }
        return bytes
    }

    private fun safeOriginal(file: File, size: Long): Boolean {
        if (size > SAFE_ORIGINAL_BYTES) return false
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        return bounds.outWidth > 0 && bounds.outHeight > 0 &&
            bounds.outWidth <= 8192 && bounds.outHeight <= 8192 &&
            bounds.outWidth.toLong() * bounds.outHeight <= 16_000_000
    }

    @Synchronized fun displayFileForUpload(owner: String, row: PendingImage): File {
        val saved = load(row.attachmentId)?.takeIf { it.owner == owner &&
            it.conversationId == row.conversationId && it.sha256 == row.sha256 }
            ?: throw ApiFailure(409, "ATTACHMENT_CHANGED")
        verify(saved)
        displayBytes(saved)
        return displayFile(saved.id)
    }

    @Synchronized fun modelAttachment(row: ChatAttachment, textBudget: Int = MAX_MODEL_TEXT_BYTES): ChatAttachment {
        val source = load(row.id)?.takeIf { it.owner == row.owner &&
            it.conversationId == row.conversationId && it.sha256 == row.sha256 }
            ?: throw ApiFailure(409, "ATTACHMENT_CHANGED")
        verify(source)
        val target = modelFile(row.id)
        if (source.kind == "file") {
            if (!modelTextType(source.mimeType)) throw ApiFailure(415, "ATTACHMENT_MODEL_UNSUPPORTED")
            if (textBudget !in 1..MAX_MODEL_TEXT_BYTES) throw ApiFailure(413, "ATTACHMENT_MODEL_BUDGET")
            val excerpt = strictText(source.file, textBudget)
            FileOutputStream(target).use { output -> output.write(excerpt.toByteArray(Charsets.UTF_8)); output.fd.sync() }
            val modelBytes = target.readBytes()
            return row.copy(sizeBytes = modelBytes.size.toLong(), sha256 = digest(modelBytes), file = target)
        }
        if (source.kind != "image") throw ApiFailure(400, "ATTACHMENT_INVALID")
        if (!target.isFile || target.length() !in 1..(5L * 1024 * 1024)) {
            val bytes = displayBytes(source)
            FileOutputStream(target).use { output -> output.write(bytes); output.fd.sync() }
        }
        val hash = MessageDigest.getInstance("SHA-256")
        target.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) { val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) }
        }
        return row.copy(mimeType = "image/jpeg", sizeBytes = target.length(),
            sha256 = hash.digest().joinToString("") { "%02x".format(it) }, file = target)
    }

    @Synchronized fun modelReadable(row: ChatAttachment): Boolean =
        row.kind == "image" || row.kind == "file" && modelTextType(row.mimeType)

    @Synchronized fun bridge(owner: String, conversationId: String, id: String): JSONObject {
        val row = load(id)?.takeIf { it.owner == owner && it.conversationId == conversationId && !it.used }
            ?: throw ApiFailure(404, "ATTACHMENT_UNAVAILABLE")
        val view = row.bridge()
        if (row.kind == "image") {
            val url = imagePreviewUrl(conversationId, null, id)
            view.put("previewUrl", url).put("displayUrl", "$url&variant=display")
        }
        availableThumbnail(row)?.let { bytes -> view.put("thumbnailDataUrl",
            "data:image/jpeg;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}") }
        return view
    }

    @Synchronized fun localImage(owner: String, conversationId: String, id: String,
        allowUsed: Boolean, display: Boolean = false): Pair<String, ByteArray>? {
        val row = load(id)?.takeIf { it.owner == owner && it.conversationId == conversationId &&
            it.kind == "image" && (allowUsed || !it.used) } ?: return null
        verify(row)
        return if (display || !safeOriginal(row.file, row.sizeBytes))
            "image/jpeg" to displayBytes(row)
        else row.mimeType to row.file.readBytes()
    }

    @Synchronized fun messageThumbnails(owner: String, conversationId: String,
        rows: List<ChatAttachment>): List<MessageThumbnail> = rows.filter { it.kind == "image" }.mapNotNull { row ->
        if (row.owner != owner || row.conversationId != conversationId || load(row.id)?.owner != owner)
            throw ApiFailure(404, "ATTACHMENT_UNAVAILABLE")
        availableThumbnail(row)?.let { MessageThumbnail(row.id, row.name, it) }
    }

    init { discardOrphanFiles() }

    @Synchronized fun list(owner: String, conversationId: String): List<ChatAttachment> =
        index.all.keys.mapNotNull { load(it) }.filter { it.owner == owner && it.conversationId == conversationId && !it.used }

    @Synchronized fun get(owner: String, conversationId: String, ids: List<String>): List<ChatAttachment> {
        if (ids.size > 4 || ids.distinct().size != ids.size) throw ApiFailure(400, "ATTACHMENT_INVALID")
        val rows = ids.map { id -> load(id)?.takeIf { it.owner == owner && it.conversationId == conversationId && !it.used }
            ?: throw ApiFailure(404, "ATTACHMENT_UNAVAILABLE") }
        if (rows.sumOf { it.sizeBytes } > 4L * MAX_IMAGE_BYTES) throw ApiFailure(413, "ATTACHMENT_TOO_LARGE")
        rows.forEach { verify(it) }
        return rows
    }

    @Synchronized fun fileForUpload(owner: String, row: PendingImage): File {
        val saved = load(row.attachmentId)?.takeIf { it.owner == owner &&
            it.conversationId == row.conversationId &&
            it.name == row.name && it.mimeType == row.contentType &&
            it.sizeBytes == row.size && it.sha256 == row.sha256 }
            ?: throw ApiFailure(409, "ATTACHMENT_CHANGED")
        verify(saved)
        return saved.file
    }

    /** A published original stays in the bounded private cache for offline full-size preview. */
    @Synchronized fun retireUploaded(owner: String, row: PendingImage, store: LocalStore) {
        if (store.imagePublished(owner, row.conversationId, row.attachmentId) != true) return
        val saved = load(row.attachmentId) ?: return
        if (saved.owner != owner || saved.conversationId != row.conversationId) return
        if (saved.attemptTurnId?.let(store::turnStatus) == "running") return
        if (!index.edit().putString(saved.id,
            encode(saved.copy(used = true, attemptTurnId = null), saved.conversationId).toString()).commit())
            throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
    }

    @Synchronized fun remove(owner: String, id: String) {
        val row = load(id) ?: throw ApiFailure(404, "ATTACHMENT_UNAVAILABLE")
        if (row.owner != owner) throw ApiFailure(404, "ATTACHMENT_UNAVAILABLE")
        if (!index.edit().remove(id).commit()) throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
        row.file.delete()
        thumbnailFile(id).delete()
        displayFile(id).delete()
        modelFile(id).delete()
    }

    @Synchronized fun removeDraft(owner: String, conversationId: String?, id: String, store: LocalStore) {
        val row = load(id)?.takeIf { it.owner == owner && !it.used &&
            (if (conversationId == null) !it.conversationId.startsWith("session-")
                else it.conversationId == conversationId) }
            ?: throw ApiFailure(404, "ATTACHMENT_UNAVAILABLE")
        if (store.sharedAttachmentPending(owner, row.conversationId, id))
            throw ApiFailure(409, "ATTACHMENT_IN_USE")
        remove(owner, id)
    }

    @Synchronized fun bindSharedAttempt(owner: String, sessionId: String, ids: List<String>, requestId: String) {
        if (!sessionId.matches(Regex("session-[0-9a-f-]{36}")) ||
            !requestId.matches(Regex("[A-Za-z0-9_.:-]{1,128}"))) throw ApiFailure(400, "ATTACHMENT_INVALID")
        val rows = get(owner, sessionId, ids)
        if (rows.any { it.attemptTurnId != null && it.attemptTurnId != requestId })
            throw ApiFailure(409, "ATTACHMENT_IN_USE")
        val edit = index.edit()
        rows.forEach { row -> edit.putString(row.id,
            encode(row.copy(attemptTurnId = requestId), sessionId).toString()) }
        if (!edit.commit()) throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
    }

    @Synchronized fun consumeShared(owner: String, sessionId: String, ids: List<String>, requestId: String) {
        val rows = ids.mapNotNull { load(it) }
        if (rows.any { it.owner != owner || it.conversationId != sessionId ||
            it.attemptTurnId != requestId })
            throw ApiFailure(409, "ATTACHMENT_STATE_CHANGED")
        val edit = index.edit()
        rows.forEach { edit.remove(it.id) }
        if (!edit.commit()) throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
        rows.forEach { it.file.delete(); thumbnailFile(it.id).delete(); displayFile(it.id).delete(); modelFile(it.id).delete() }
    }

    @Synchronized fun claimDraft(owner: String, ids: List<String>, conversationId: String) {
        ids.forEach { id ->
            val row = load(id) ?: throw ApiFailure(404, "ATTACHMENT_UNAVAILABLE")
            if (row.owner != owner || row.conversationId.isNotEmpty()) throw ApiFailure(404, "ATTACHMENT_UNAVAILABLE")
        }
        val edit = index.edit()
        ids.forEach { id ->
            val row = load(id)!!
            edit.putString(id, encode(row, conversationId).toString())
        }
        if (!edit.commit()) throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
    }

    @Synchronized fun recordAttempt(owner: String, conversationId: String, ids: List<String>, turnId: String,
        store: LocalStore? = null) {
        val rows = get(owner, conversationId, ids)
        if (turnId.isBlank()) throw ApiFailure(400, "ATTACHMENT_INVALID")
        val edit = index.edit()
        rows.forEach { row -> edit.putString(row.id, encode(row.copy(attemptTurnId = turnId,
            used = row.used || store?.imageUploadState(owner, conversationId, row.id) != null),
            conversationId).toString()) }
        if (!edit.commit()) throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
    }

    /** Call after the turn is durably completed. Remove metadata first, then reclaim the copy. */
    @Synchronized fun markUsed(owner: String, conversationId: String, ids: List<String>, turnId: String,
        store: LocalStore) {
        if (store.turnStatus(turnId) != "completed") throw ApiFailure(409, "ATTACHMENT_TURN_INCOMPLETE")
        val rows = ids.mapNotNull { load(it) }.filter { it.owner == owner && it.conversationId == conversationId &&
            it.attemptTurnId == turnId }
        if (rows.size != ids.size) throw ApiFailure(409, "ATTACHMENT_STATE_CHANGED")
        val edit = index.edit()
        rows.forEach { row ->
            if (store.imageUploadState(owner, conversationId, row.id) != null)
                edit.putString(row.id, encode(row.copy(used = true, attemptTurnId = null), conversationId).toString())
            else edit.remove(row.id)
        }
        if (!edit.commit()) throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
        rows.filter { store.imageUploadState(owner, conversationId, it.id) == null }
            .forEach { it.file.delete(); thumbnailFile(it.id).delete(); displayFile(it.id).delete(); modelFile(it.id).delete() }
    }

    /** Repairs the small gap between committing the turn and retiring its copied files. */
    @Synchronized fun reconcileTurns(store: LocalStore) {
        val rows = index.all.keys.mapNotNull { load(it) }
        for (row in rows) {
            if (store.imagePublished(row.owner, row.conversationId, row.id) == true) {
                store.publishedImages(row.owner).firstOrNull { it.attachmentId == row.id }
                    ?.let { retireUploaded(row.owner, it, store) }
                if (load(row.id) == null) continue
            }
            val turnId = row.attemptTurnId
            if (turnId == null) {
                if (!row.used && store.imageUploadState(row.owner, row.conversationId, row.id) != null &&
                    !index.edit().putString(row.id, encode(row.copy(used = true), row.conversationId).toString()).commit())
                    throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
                continue
            }
            when (store.turnStatus(turnId)) {
                "completed" -> markUsed(row.owner, row.conversationId, listOf(row.id), turnId, store)
                "failed", "cancelled", "interrupted", null -> {
                    val sentImage = store.imageUploadState(row.owner, row.conversationId, row.id) != null
                    if (!index.edit().putString(row.id, encode(row.copy(used = sentImage, attemptTurnId = null), row.conversationId).toString()).commit())
                        throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
                }
            }
        }
        discardOrphanFiles()
    }

    @Synchronized fun import(uri: Uri, owner: String, conversationId: String, kind: String): ChatAttachment {
        if (kind !in setOf("image", "file") || owner.isBlank()) throw ApiFailure(400, "ATTACHMENT_INVALID")
        val existing = list(owner, conversationId)
        if (existing.size >= 4) throw ApiFailure(413, "ATTACHMENT_LIMIT")
        val id = "attachment-${UUID.randomUUID()}"
        val file = File(root, id)
        val thumbnail = thumbnailFile(id)
        val limit = if (kind == "image") maxImage else maxFile
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        try {
            val input = context.contentResolver.openInputStream(uri) ?: throw ApiFailure(400, "ATTACHMENT_UNREADABLE")
            input.use { stream -> FileOutputStream(file).use { output ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    size += count
                    if (size > limit || existing.sumOf { it.sizeBytes } + size > 4L * MAX_IMAGE_BYTES)
                        throw ApiFailure(413, "ATTACHMENT_TOO_LARGE")
                    digest.update(buffer, 0, count)
                    output.write(buffer, 0, count)
                }
                output.fd.sync()
            } }
            if (size == 0L) throw ApiFailure(400, "ATTACHMENT_EMPTY")
            ensureCapacity(owner, size)
            val name = safeName(uri, kind)
            val mime = if (kind == "image") imageMime(file) else fileMime(uri, name)
            val declared = context.contentResolver.getType(uri)?.lowercase()
            if (declared != null && declared != "application/octet-stream" && declared != "*/*" &&
                declared != mime && !(kind == "file" && modelTextType(declared) && modelTextType(mime)))
                throw ApiFailure(415, "ATTACHMENT_TYPE_MISMATCH")
            val thumbBytes = if (kind == "image") try {
                makeThumbnail(file).also { bytes ->
                    FileOutputStream(thumbnail).use { output -> output.write(bytes); output.fd.sync() }
                }
            } catch (_: Exception) { thumbnail.delete(); null } else null
            val row = ChatAttachment(id, name, kind, mime, size, digest.digest().joinToString("") { "%02x".format(it) },
                owner, conversationId, file, thumbnailSize = thumbBytes?.size ?: 0,
                thumbnailHash = thumbBytes?.let(::digest))
            if (!index.edit().putString(id, encode(row, conversationId).toString()).commit())
                throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
            return row
        } catch (error: Exception) {
            file.delete()
            thumbnail.delete()
            displayFile(id).delete()
            modelFile(id).delete()
            throw if (error is IOException) ApiFailure(507, "ATTACHMENT_STORAGE_ERROR") else error
        }
    }

    /** Evict only acknowledged originals, oldest first. Drafts and pending uploads are never candidates. */
    private fun ensureCapacity(owner: String, incoming: Long) {
        val rows = index.all.keys.mapNotNull { load(it) }.toMutableList()
        fun ownerOverLimit(): Boolean {
            val owned = rows.filter { it.owner == owner }
            val published = owned.filter { localStore?.imagePublished(it.owner, it.conversationId, it.id) == true }
            return owned.size + 1 > 40 ||
                owned.sumOf { it.sizeBytes } + incoming > 4L * MAX_IMAGE_BYTES ||
                published.size + 1 > 20 || published.sumOf { it.sizeBytes } +
                    (if (incoming <= sentCacheOwnerBytes) incoming else 0) > sentCacheOwnerBytes
        }
        fun appOverLimit() = rows.size + 1 > 80 ||
            rows.sumOf { it.sizeBytes } + incoming > 8L * MAX_IMAGE_BYTES
        while (ownerOverLimit() || appOverLimit()) {
            val targetOwner = if (ownerOverLimit()) owner else null
            val victim = rows.filter { row -> (targetOwner == null || row.owner == targetOwner) &&
                localStore?.imagePublished(row.owner, row.conversationId, row.id) == true &&
                row.attemptTurnId?.let(localStore::turnStatus) != "running" }
                .minByOrNull { it.file.lastModified() } ?: throw ApiFailure(413, "ATTACHMENT_STORAGE_LIMIT")
            if (!index.edit().remove(victim.id).commit()) throw ApiFailure(500, "ATTACHMENT_STORAGE_ERROR")
            victim.file.delete()
            thumbnailFile(victim.id).delete()
            displayFile(victim.id).delete()
            modelFile(victim.id).delete()
            rows.remove(victim)
        }
    }

    fun text(row: ChatAttachment): String {
        verify(row)
        if (row.kind != "file" || !modelTextType(row.mimeType)) throw ApiFailure(415, "ATTACHMENT_MODEL_UNSUPPORTED")
        return strictText(row.file, MAX_MODEL_TEXT_BYTES)
    }
    fun dataUri(row: ChatAttachment): String {
        verify(row)
        if (row.kind != "image") throw ApiFailure(400, "ATTACHMENT_INVALID")
        return "data:image/jpeg;base64,${Base64.encodeToString(displayBytes(row), Base64.NO_WRAP)}"
    }

    private fun verify(row: ChatAttachment) {
        if (!row.file.canonicalPath.startsWith(root.canonicalPath + File.separator) || !row.file.isFile ||
            row.file.length() != row.sizeBytes || row.sizeBytes > (if (row.kind == "image") maxImage else maxFile))
            throw ApiFailure(409, "ATTACHMENT_CHANGED")
        val digest = MessageDigest.getInstance("SHA-256")
        row.file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it) }
        if (hash != row.sha256) throw ApiFailure(409, "ATTACHMENT_CHANGED")
        if (row.kind == "image" && imageMime(row.file) != row.mimeType) throw ApiFailure(409, "ATTACHMENT_CHANGED")
    }

    private fun imageMime(file: File): String {
        val bytes = file.inputStream().use { stream -> ByteArray(16).let { buffer ->
            val count = stream.read(buffer)
            if (count < 0) ByteArray(0) else buffer.copyOf(count)
        } }
        val mime = when {
            bytes.size >= 8 && bytes.take(8) == listOf(137,80,78,71,13,10,26,10).map { it.toByte() } -> "image/png"
            bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte() -> "image/jpeg"
            bytes.size >= 12 && String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF" && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP" -> "image/webp"
            bytes.size >= 6 && String(bytes, 0, 6, Charsets.US_ASCII) in setOf("GIF87a", "GIF89a") -> "image/gif"
            else -> throw ApiFailure(415, "ATTACHMENT_UNSUPPORTED")
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0)
            throw ApiFailure(415, "IMAGE_DIMENSIONS_UNSUPPORTED")
        val sample = sampleFor(bounds.outWidth, bounds.outHeight, 1024)
        val decoded = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw ApiFailure(415, "ATTACHMENT_UNSUPPORTED")
        decoded.recycle()
        return mime
    }

    private fun strictText(file: File, maxBytes: Int = Int.MAX_VALUE): String {
        val bytes = file.inputStream().use { input -> input.readNBytes(maxBytes) }
        for (end in bytes.size downTo maxOf(0, bytes.size - 3)) try {
            val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            val text = decoder.decode(ByteBuffer.wrap(bytes, 0, end)).toString()
            if (text.any { it == '\u0000' }) throw ApiFailure(415, "ATTACHMENT_UNSUPPORTED")
            return text
        } catch (_: java.nio.charset.CharacterCodingException) { /* A bounded excerpt may end mid-codepoint. */ }
        throw ApiFailure(415, "ATTACHMENT_NOT_UTF8")
    }

    private fun modelTextType(mime: String) = mime in setOf("text/plain", "text/markdown", "text/csv",
        "application/json", "application/x-ndjson")

    private fun fileMime(uri: Uri, name: String): String {
        val declared = context.contentResolver.getType(uri)?.lowercase()?.substringBefore(';')
        if (declared != null && declared.matches(Regex("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+"))) return declared
        return when (name.substringAfterLast('.', "").lowercase()) {
            "txt" -> "text/plain"
            "md", "markdown" -> "text/markdown"
            "csv" -> "text/csv"
            "json" -> "application/json"
            "ndjson", "jsonl" -> "application/x-ndjson"
            "pdf" -> "application/pdf"
            "zip" -> "application/zip"
            "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            else -> "application/octet-stream"
        }
    }

    private fun safeName(uri: Uri, kind: String): String {
        val raw = try { context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        } } catch (_: Exception) { null }
        return (raw ?: if (kind == "image") "图片" else "文本文档")
            .replace(Regex("[\\p{Cntrl}/\\\\]"), "_").trim().take(120)
            .let { if (it == "." || it == "..") "附件" else it.ifBlank { "附件" } }
    }

    private fun encode(row: ChatAttachment, conversationId: String) = JSONObject().put("name", row.name)
        .put("kind", row.kind).put("mime", row.mimeType).put("size", row.sizeBytes)
        .put("hash", row.sha256).put("owner", row.owner).put("conversationId", conversationId)
        .put("used", row.used).put("attemptTurnId", row.attemptTurnId ?: JSONObject.NULL)
        .put("thumbnailSize", row.thumbnailSize).put("thumbnailHash", row.thumbnailHash ?: JSONObject.NULL)

    private fun load(id: String): ChatAttachment? {
        if (!id.matches(Regex("attachment-[0-9a-f-]{36}"))) return null
        val raw = index.getString(id, null) ?: return null
        return try { JSONObject(raw).let { j -> ChatAttachment(id, j.getString("name"), j.getString("kind"),
            j.getString("mime"), j.getLong("size"), j.getString("hash"), j.getString("owner"),
            j.getString("conversationId"), File(root, id), j.optBoolean("used"),
            j.optString("attemptTurnId").takeIf { it.isNotEmpty() && it != "null" },
            j.optInt("thumbnailSize"), j.optString("thumbnailHash").takeIf { it.isNotEmpty() && it != "null" }) } }
        catch (_: Exception) { null }
    }

    private fun discardOrphanFiles() {
        val known = index.all.keys
        val oldEnough = System.currentTimeMillis() - 10 * 60 * 1000
        root.listFiles()?.forEach { file -> if (file.isFile && file.name.startsWith("attachment-") &&
            file.name.removeSuffix(".thumb").removeSuffix(".display").removeSuffix(".model") !in known &&
            file.lastModified() < oldEnough) file.delete() }
    }
}
