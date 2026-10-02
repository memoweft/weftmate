package com.memoweft.weftmate.mobile

import android.graphics.Bitmap
import android.net.Uri
import android.util.Base64
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicReference
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class AttachmentFlowTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun source(name: String, bytes: ByteArray): File = File(context.cacheDir,
        "synthetic-${UUID.randomUUID()}-$name").apply { writeBytes(bytes) }
    private fun png(size: Int): ByteArray {
        val file = File.createTempFile("synthetic-", ".png", context.cacheDir)
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        try {
            FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            return file.readBytes()
        } finally { bitmap.recycle(); file.delete() }
    }
    private fun variedPng(size: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        try {
            for (y in 0 until size) for (x in 0 until size) {
                val color = 0xff000000.toInt() or (((x * 73 + y * 19) and 255) shl 16) or
                    (((x * 31 + y * 47) and 255) shl 8) or ((x * 11 + y * 83) and 255)
                bitmap.setPixel(x, y, color)
            }
            val output = java.io.ByteArrayOutputStream()
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
            return output.toByteArray()
        } finally { bitmap.recycle() }
    }

    @Test fun tallScreenshotUsesBoundedDisplayAndModelCopy() {
        val owner = "synthetic-tall-${UUID.randomUUID()}"
        val bitmap = Bitmap.createBitmap(300, 9000, Bitmap.Config.ARGB_8888)
        val input = File.createTempFile("synthetic-tall-", ".png", context.cacheDir)
        val attachments = AttachmentStore(context)
        var id: String? = null
        try {
            FileOutputStream(input).use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
            val row = attachments.import(Uri.fromFile(input), owner, "", "image")
            id = row.id
            assertEquals("image/png", row.mimeType)
            val display = attachments.localImage(owner, "", row.id, false, true)!!
            assertEquals("image/jpeg", display.first)
            assertTrue(display.second.size in 1..512 * 1024)
            val model = attachments.modelAttachment(row)
            assertEquals("image/jpeg", model.mimeType)
            assertTrue(model.sizeBytes in 1..512L * 1024)
            assertEquals(row.sizeBytes, row.file.length())
        } finally {
            bitmap.recycle()
            input.delete()
            id?.let { attachments.remove(owner, it) }
        }
    }

    @Test fun boundedDraftPreviewBecomesOwnerScopedMessagePreviewAfterRetirementAndRestart() {
        val ownerA = "synthetic-preview-A-${UUID.randomUUID()}"
        val ownerB = "synthetic-preview-B-${UUID.randomUUID()}"
        val dbName = "attachment-preview-${UUID.randomUUID()}.db"
        val input = source("photo.png", variedPng(512))
        val attachments = AttachmentStore(context)
        var local = LocalStore(context, dbName)
        var attachmentId: String? = null
        try {
            val draft = attachments.import(Uri.fromFile(input), ownerA, "", "image")
            attachmentId = draft.id
            val preview = attachments.bridge(ownerA, "", draft.id).getString("thumbnailDataUrl")
            val index = context.getSharedPreferences("chat-attachment-index", android.content.Context.MODE_PRIVATE)
            val legacy = JSONObject(index.getString(draft.id, null)!!)
            legacy.remove("thumbnailSize")
            legacy.remove("thumbnailHash")
            assertTrue(index.edit().putString(draft.id, legacy.toString()).commit())
            File(context.filesDir, "chat-attachments/${draft.id}.thumb").delete()
            assertTrue(draft.file.exists())
            assertEquals(preview, AttachmentStore(context).bridge(ownerA, "", draft.id)
                .getString("thumbnailDataUrl"))
            assertEquals(draft.id, AttachmentStore(context).list(ownerA, "").single().id)
            assertTrue(preview.startsWith("data:image/jpeg;base64,"))
            assertTrue(preview.length < 20_000)
            val bytes = Base64.decode(preview.substringAfter(','), Base64.DEFAULT)
            assertTrue(bytes.size <= 12_000)
            val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            assertNotNull(decoded)
            assertTrue(decoded.width <= 192 && decoded.height <= 192)
            decoded.recycle()
            assertEquals(preview, AttachmentStore(context).bridge(ownerA, "", draft.id).getString("thumbnailDataUrl"))
            failure("ATTACHMENT_UNAVAILABLE") { attachments.bridge(ownerB, "", draft.id) }
            failure("ATTACHMENT_UNAVAILABLE") { attachments.bridge(ownerA, "", "attachment-${UUID.randomUUID()}") }
            val convoA = local.createConversation("synthetic preview", ownerA).id
            val convoB = local.createConversation("other account", ownerB).id
            attachments.claimDraft(ownerA, listOf(draft.id), convoA)
            failure("ATTACHMENT_UNAVAILABLE") { attachments.bridge(ownerA, "", draft.id) }
            assertEquals(preview, attachments.bridge(ownerA, convoA, draft.id).getString("thumbnailDataUrl"))
            val rows = attachments.get(ownerA, convoA, listOf(draft.id))
            val messageId = local.addMessage(convoA, "user", "Synthetic image",
                thumbnails = attachments.messageThumbnails(ownerA, convoA, rows))
            val turnId = local.startTurn(convoA)
            attachments.recordAttempt(ownerA, convoA, listOf(draft.id), turnId)
            local.finishTurn(turnId, "completed")
            attachments.markUsed(ownerA, convoA, listOf(draft.id), turnId, local)
            assertFalse(draft.file.exists())
            assertTrue(attachments.list(ownerA, convoA).isEmpty())
            local.close()
            local = LocalStore(context, dbName)
            val saved = local.messageThumbnails(convoA, ownerA, messageId)
            assertEquals(preview, saved.getJSONObject(0).getString("thumbnailDataUrl"))
            assertEquals(0, local.messageThumbnails(convoA, ownerB, messageId).length())
            assertEquals(0, local.messageThumbnails(convoB, ownerB, messageId).length())
            assertEquals(0, local.messageThumbnails(convoA, ownerA, "message-${UUID.randomUUID()}").length())
            assertTrue(local.pending(ownerA).none { it.body.toString().contains("data:image/") })
            assertTrue(local.messages(convoA, ownerA).any { it.id == messageId })
        } finally {
            input.delete()
            attachmentId?.let { try { attachments.remove(ownerA, it) } catch (_: Exception) { } }
            local.close()
            context.deleteDatabase(dbName)
        }
    }
    private fun failure(code: String, block: () -> Unit) {
        try { block(); fail("Expected $code") } catch (error: ApiFailure) { assertEquals(code, error.safeCode) }
    }

    @Test fun sentImageSurvivesRestartUntilReceiptAndPublishesReferenceOnlyAfterUpload() {
        val owner = "synthetic-image-${UUID.randomUUID()}"
        val dbName = "image-outbox-${UUID.randomUUID()}.db"
        val input = source("image.png", variedPng(512))
        val attachments = AttachmentStore(context)
        var local = LocalStore(context, dbName)
        var attachmentId: String? = null
        try {
            val draft = attachments.import(Uri.fromFile(input), owner, "", "image")
            attachmentId = draft.id
            val conversationId = local.createConversation("image", owner).id
            attachments.claimDraft(owner, listOf(draft.id), conversationId)
            val row = attachments.get(owner, conversationId, listOf(draft.id)).single()
            val messageId = local.addMessage(conversationId, "user", "", images = listOf(row),
                thumbnails = attachments.messageThumbnails(owner, conversationId, listOf(row)))
            val turnId = local.startTurn(conversationId)
            attachments.recordAttempt(owner, conversationId, listOf(draft.id), turnId, local)
            local.finishTurn(turnId, "completed")
            attachments.markUsed(owner, conversationId, listOf(draft.id), turnId, local)
            assertTrue(draft.file.exists())
            assertTrue(attachments.list(owner, conversationId).isEmpty())
            local.close()
            local = LocalStore(context, dbName)
            val pending = local.pendingImages(owner, messageId).single()
            assertEquals(draft.sha256, pending.sha256)
            assertEquals(draft.file, AttachmentStore(context).fileForUpload(owner, pending))
            val before = local.pending(owner).single { it.body.getString("kind") == "message.created" }
            assertFalse(before.body.getJSONObject("payload").has("attachments"))
            val receipt = JSONObject().put("attachmentId", draft.id).put("name", draft.name)
                .put("contentType", draft.mimeType).put("size", draft.sizeBytes).put("sha256", draft.sha256)
            local.markImageUploaded(owner, pending, receipt)
            val ready = local.pending(owner).single { it.body.getString("kind") == "message.created" }
            assertEquals(draft.id, ready.body.getJSONObject("payload").getJSONArray("attachments")
                .getJSONObject(0).getString("attachmentId"))
            assertFalse(ready.body.toString().contains("data:image/"))
            attachments.retireUploaded(owner, pending, local)
            assertTrue(draft.file.exists())
            assertEquals("pending", local.messageThumbnails(conversationId, owner, messageId)
                .getJSONObject(0).getString("syncStatus"))
            local.markAccepted(owner, JSONArray().put(JSONObject().put("eventId", ready.eventId).put("seq", 2)))
            attachments.retireUploaded(owner, pending, local)
            assertTrue(draft.file.exists())
            assertEquals("shared", local.messageThumbnails(conversationId, owner, messageId)
                .getJSONObject(0).getString("syncStatus"))
            assertEquals(draft.sizeBytes, attachments.localImage(owner, conversationId, draft.id, true)
                ?.second?.size?.toLong())
            assertNull(local.imageForMessage("another-owner", conversationId, messageId, draft.id))
        } finally {
            input.delete()
            attachmentId?.let { try { attachments.remove(owner, it) } catch (_: Exception) { } }
            local.close()
            context.deleteDatabase(dbName)
        }
    }

    @Test fun publishedOriginalCacheEvictsOldestAndNeverEvictsPendingImage() {
        val owner = "synthetic-cache-${UUID.randomUUID()}"
        val dbName = "image-cache-${UUID.randomUUID()}.db"
        val bytes = variedPng(512)
        val input = source("cache.png", bytes)
        val local = LocalStore(context, dbName)
        val attachments = AttachmentStore(context, local, bytes.size.toLong() * 3 / 2)
        val ids = mutableListOf<String>()
        try {
            val conversation = local.createConversation("cache", owner).id
            fun sentImage(): Pair<ChatAttachment, String> {
                val draft = attachments.import(Uri.fromFile(input), owner, "", "image")
                ids += draft.id
                attachments.claimDraft(owner, listOf(draft.id), conversation)
                val image = attachments.get(owner, conversation, listOf(draft.id)).single()
                val messageId = local.addMessage(conversation, "user", "", images = listOf(image))
                val turn = local.startTurn(conversation)
                attachments.recordAttempt(owner, conversation, listOf(draft.id), turn, local)
                local.finishTurn(turn, "completed")
                attachments.markUsed(owner, conversation, listOf(draft.id), turn, local)
                return image to messageId
            }
            val (first, firstMessage) = sentImage()
            val firstPending = local.pendingImages(owner, firstMessage).single()
            local.markImageUploaded(owner, firstPending, JSONObject().put("attachmentId", first.id)
                .put("name", first.name).put("contentType", first.mimeType)
                .put("size", first.sizeBytes).put("sha256", first.sha256))
            val firstEvent = local.pending(owner).single { it.body.getString("kind") == "message.created" }
            local.markAccepted(owner, JSONArray().put(JSONObject().put("eventId", firstEvent.eventId).put("seq", 2)))
            assertNotNull(attachments.localImage(owner, conversation, first.id, true))
            val (second, secondMessage) = sentImage()
            assertFalse(first.file.exists())
            assertNull(attachments.localImage(owner, conversation, first.id, true))
            assertTrue(second.file.exists())
            assertEquals(false, local.imageForMessage(owner, conversation, secondMessage, second.id)?.first)
            ids += attachments.import(Uri.fromFile(input), owner, "", "image").id
            assertTrue(second.file.exists())
            assertEquals("shared", local.messageThumbnails(conversation, owner, firstMessage)
                .getJSONObject(0).getString("syncStatus"))
        } finally {
            input.delete()
            ids.forEach { try { attachments.remove(owner, it) } catch (_: Exception) { } }
            local.close()
            context.deleteDatabase(dbName)
        }
    }

    @Test fun pickerResultContractRejectsLateAccountConversationAndPageResults() {
        val attempt = AttachmentPickAttempt("pick-synthetic", "owner-A", "conversation-A", 7L, 12,
            "conversation-A", "image", 3)
        assertTrue(attachmentPickCurrent(attempt, 7L, 12, "conversation-A", "owner-A"))
        assertFalse(attachmentPickCurrent(attempt, 8L, 12, "conversation-A", "owner-B"))
        assertFalse(attachmentPickCurrent(attempt, 7L, 12, "conversation-B", "owner-A"))
        assertFalse(attachmentPickCurrent(attempt, 7L, 13, "conversation-A", "owner-A"))
        val selected = attachmentResultBody(attempt, "selected", JSONObject().put("attachmentId", "attachment-synthetic")
            .put("name", "synthetic.png").put("kind", "image").put("mimeType", "image/png")
            .put("sizeBytes", 40))
        assertEquals("pick-synthetic", selected.getString("requestId"))
        assertEquals(3, selected.getInt("viewGeneration"))
        assertEquals("selected", selected.getString("status"))
        assertEquals("attachment-synthetic", selected.getJSONObject("attachment").getString("attachmentId"))
        assertFalse(selected.toString().contains("data:image/"))
        val cancelled = attachmentResultBody(attempt, "cancelled")
        assertEquals("cancelled", cancelled.getString("status"))
        assertFalse(cancelled.has("attachment"))
        assertFalse(cancelled.has("errorCode"))
        val failed = attachmentResultBody(attempt, "failed", errorCode = "ATTACHMENT_UNREADABLE")
        assertEquals("ATTACHMENT_UNREADABLE", failed.getString("errorCode"))
        assertFalse(failed.has("attachment"))
    }

    @Test fun draftSurvivesRestartAndCannotCrossAccountOrRepeatSend() {
        val ownerA = "synthetic-A-${UUID.randomUUID()}"
        val ownerB = "synthetic-B-${UUID.randomUUID()}"
        val original = source("note.txt", "完整的 UTF-8 文档\n第二行".toByteArray(Charsets.UTF_8))
        val store = AttachmentStore(context)
        val row = try { store.import(Uri.fromFile(original), ownerA, "", "file") } finally { original.delete() }
        assertEquals(1, AttachmentStore(context).list(ownerA, "").size)
        assertTrue(AttachmentStore(context).list(ownerB, "").isEmpty())
        failure("ATTACHMENT_UNAVAILABLE") { store.get(ownerB, "", listOf(row.id)) }
        store.claimDraft(ownerA, listOf(row.id), "conversation-A")
        failure("ATTACHMENT_UNAVAILABLE") { store.get(ownerA, "", listOf(row.id)) }
        assertEquals("完整的 UTF-8 文档\n第二行", store.text(store.get(ownerA, "conversation-A", listOf(row.id)).single()))
        store.recordAttempt(ownerA, "conversation-A", listOf(row.id), "synthetic-turn")
        assertEquals(1, AttachmentStore(context).list(ownerA, "conversation-A").size)
        store.remove(ownerA, row.id)
        assertFalse(row.file.exists())
    }

    @Test fun failedCancelledAndInterruptedTurnsKeepDraftButCompletedTurnRetiresIt() {
        val owner = "synthetic-${UUID.randomUUID()}"
        val databaseName = "attachment-turns-${UUID.randomUUID()}.db"
        val local = LocalStore(context, databaseName)
        try {
            val conversation = local.createConversation("synthetic", owner).id
            val source = source("retry.txt", "retry body".toByteArray())
            val attachments = AttachmentStore(context)
            val row = try { attachments.import(Uri.fromFile(source), owner, conversation, "file") }
                finally { source.delete() }
            for (status in listOf("failed", "cancelled", "interrupted")) {
                val turn = local.startTurn(conversation)
                attachments.recordAttempt(owner, conversation, listOf(row.id), turn)
                failure("ATTACHMENT_TURN_INCOMPLETE") {
                    attachments.markUsed(owner, conversation, listOf(row.id), turn, local)
                }
                local.finishTurn(turn, status)
                failure("ATTACHMENT_TURN_INCOMPLETE") {
                    attachments.markUsed(owner, conversation, listOf(row.id), turn, local)
                }
                AttachmentStore(context).reconcileTurns(local)
                assertEquals(status, local.turnStatus(turn))
                assertEquals(1, AttachmentStore(context).list(owner, conversation).size)
                assertEquals("retry body", attachments.text(attachments.get(owner, conversation, listOf(row.id)).single()))
            }
            val running = local.startTurn(conversation)
            attachments.recordAttempt(owner, conversation, listOf(row.id), running)
            local.recoverInterruptedTurns()
            AttachmentStore(context).reconcileTurns(local)
            assertEquals("interrupted", local.turnStatus(running))
            assertEquals(1, attachments.list(owner, conversation).size)
            val completed = local.startTurn(conversation)
            attachments.recordAttempt(owner, conversation, listOf(row.id), completed)
            local.finishTurn(completed, "completed")
            AttachmentStore(context).reconcileTurns(local)
            assertTrue(attachments.list(owner, conversation).isEmpty())
            assertFalse(row.file.exists())
            failure("ATTACHMENT_UNAVAILABLE") { attachments.get(owner, conversation, listOf(row.id)) }
        } finally { local.close(); context.deleteDatabase(databaseName) }
    }

    @Test fun acceptsSmallImageButRejectsInvalidUtf8AndChangedCopy() {
        val owner = "synthetic-${UUID.randomUUID()}"
        val store = AttachmentStore(context)
        val tiny = source("tiny.png", png(1))
        try {
            val image = store.import(Uri.fromFile(tiny), owner, "", "image")
            assertTrue(image.sizeBytes > 0)
            assertTrue(store.bridge(owner, "", image.id).getString("displayUrl").contains("variant=display"))
            store.remove(owner, image.id)
        }
        finally { tiny.delete() }
        val invalid = source("bad.txt", byteArrayOf(0xc3.toByte(), 0x28))
        try { failure("ATTACHMENT_NOT_UTF8") { store.import(Uri.fromFile(invalid), owner, "", "file") } }
        finally { invalid.delete() }
        val good = source("okay.txt", "verified".toByteArray())
        val row = try { store.import(Uri.fromFile(good), owner, "", "file") } finally { good.delete() }
        row.file.writeText("tampered")
        failure("ATTACHMENT_CHANGED") { store.get(owner, "", listOf(row.id)) }
        store.remove(owner, row.id)
    }

    @Test fun officialMimoRequestContainsImageBlockAndTextSource() {
        val owner = "synthetic-${UUID.randomUUID()}"
        val conversation = "synthetic-conversation"
        val store = AttachmentStore(context)
        val imageSource = source("image.png", png(256))
        val textSource = source("source.txt", "A synthetic document.".toByteArray())
        val image = try { store.import(Uri.fromFile(imageSource), owner, conversation, "image") }
            finally { imageSource.delete() }
        val document = try { store.import(Uri.fromFile(textSource), owner, conversation, "file") }
            finally { textSource.delete() }
        var requests = 0
        val server = ServerSocket(0)
        val serverFailure = AtomicReference<Throwable?>()
        val serverThread = Thread {
            try {
                server.accept().use { socket ->
                    socket.soTimeout = 10_000
                    val input = socket.getInputStream()
                    val header = StringBuilder()
                    while (!header.endsWith("\r\n\r\n")) {
                        val next = input.read()
                        if (next < 0 || header.length > 8192) throw AssertionError("Invalid HTTP request")
                        header.append(next.toChar())
                    }
                    val length = Regex("(?im)^Content-Length: (\\d+)\\r?$").find(header)
                        ?.groupValues?.get(1)?.toInt() ?: throw AssertionError("Missing length")
                    val bytes = ByteArray(length)
                    var offset = 0
                    while (offset < length) {
                        val count = input.read(bytes, offset, length - offset)
                        if (count < 0) throw AssertionError("Short HTTP body")
                        offset += count
                    }
                    val body = JSONObject(String(bytes, Charsets.UTF_8))
                    assertEquals("mimo-v2.6-flash", body.getString("model"))
                    val blocks = body.getJSONArray("messages").getJSONObject(1).getJSONArray("content")
                    assertEquals("text", blocks.getJSONObject(0).getString("type"))
                    assertTrue(blocks.getJSONObject(0).getString("text").contains("A synthetic document."))
                    assertTrue(blocks.getJSONObject(0).getString("text").contains(document.name))
                    assertEquals("image_url", blocks.getJSONObject(1).getString("type"))
                    assertTrue(blocks.getJSONObject(1).getJSONObject("image_url").getString("url")
                        .startsWith("data:image/jpeg;base64,"))
                    val response = JSONObject().put("choices", JSONArray().put(JSONObject()
                        .put("message", JSONObject().put("content", "synthetic answer")).put("finish_reason", "stop")))
                        .toString().toByteArray(Charsets.UTF_8)
                    socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" +
                        "Content-Length: ${response.size}\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII))
                    socket.getOutputStream().write(response)
                    socket.getOutputStream().flush()
                }
            } catch (error: Throwable) { serverFailure.set(error) }
        }.apply { start() }
        val transport = object : JsonTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
                requests++
                return JsonHttp().request("http://127.0.0.1:${server.localPort}/v1/chat/completions", method,
                    body, emptyMap(), active, readTimeoutMs)
            }
        }
        val tools = object : DeviceToolExecutor {
            override fun execute(name: String, arguments: JSONObject): ToolResult =
                throw AssertionError("No tool should run")
        }
        try {
            val settings = ModelSettings("https://api.xiaomimimo.com/v1", "MiMo-V2.6-Flash", "")
            assertEquals("synthetic answer", ModelClient(context, transport, tools).complete(settings,
                listOf(LocalMessage("message", "user", "Inspect these files")), receipt = { _, _, _, _ -> },
                attachments = listOf(image, document), attachmentStore = store))
            assertEquals(1, requests)
            assertTrue(supportsAttachmentImage(ModelSettings("https://other.example/v1", "custom-vision", "")))
            assertFalse(supportsAttachmentImage(ModelSettings("https://api.xiaomimimo.com/v1", "mimo-v2.5-tts", "")))
            assertEquals(1, requests)
            serverThread.join(10_000)
            serverFailure.get()?.let { throw AssertionError("Synthetic HTTP server failed", it) }
        } finally { server.close(); store.remove(owner, image.id); store.remove(owner, document.id) }
    }
}
