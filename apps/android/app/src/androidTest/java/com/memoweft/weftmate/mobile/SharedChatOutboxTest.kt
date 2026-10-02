package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import android.graphics.Bitmap
import android.net.Uri
import java.io.File
import java.net.ServerSocket
import java.net.HttpURLConnection
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class SharedChatOutboxTest {
    private class HostFixture(private val sessionId: String = "session-one") : JsonTransport {
        val commands = mutableMapOf<String, JSONObject>()
        val calls = mutableListOf<String>()
        val postedPayloads = mutableListOf<JSONObject>()
        var posts = 0
        var loseNextReply = false
        var offline = false
        var revokedOwner: String? = null
        var writable = true
        var commandState = "accepted_by_dsh"

        override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
            active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
            val owner = headers["Cookie"]?.removePrefix("cookie=") ?: ""
            calls += "$method $url"
            if (offline) throw ApiFailure(503, "HOST_UNAVAILABLE")
            if (owner == revokedOwner) throw ApiFailure(401, "UNAUTHORIZED")
            return when {
                url.endsWith("/auth/me") -> HttpReply(200, JSONObject().put("account", JSONObject().put("ownerId", owner)))
                url.endsWith("/sessions") -> HttpReply(200, JSONObject().put("sessions", JSONArray().put(
                    JSONObject().put("sessionId", sessionId).put("title", "Synthetic")
                        .put("sendAvailable", writable))))
                url.contains("/commands/by-request/") -> {
                    val id = url.substringAfterLast('/')
                    val command = commands["$owner|$id"] ?: throw ApiFailure(404, "NOT_FOUND")
                    HttpReply(200, JSONObject().put("command", command))
                }
                url.endsWith("/commands") && method == "POST" -> {
                    posts++
                    val payload = body!!
                    postedPayloads += JSONObject(payload.toString())
                    if (!writable) throw ApiFailure(409, "SESSION_READ_ONLY")
                    val id = payload.getString("requestId")
                    val key = "$owner|$id"
                    val prior = commands[key]
                    if (prior != null && prior.optString("text") != payload.optString("text"))
                        throw ApiFailure(409, "REQUEST_CONFLICT")
                    val command = prior ?: JSONObject().put("commandId", "cmd-$id")
                        .put("requestId", id).put("sessionId", payload.getString("sessionId"))
                        .put("kind", payload.getString("kind")).put("state", commandState)
                        .put("text", payload.optString("text"))
                    if (commandState == "rejected") command.put("errorCode", "IMAGE_REJECTED")
                    commands[key] = command
                    if (loseNextReply) { loseNextReply = false; throw ApiFailure(503, "SERVICE_UNAVAILABLE") }
                    HttpReply(202, JSONObject().put("command", command))
                }
                else -> throw ApiFailure(404, "NOT_FOUND")
            }
        }
    }

    @Test fun accountRestartLostReplyAndReadOnlyStayIsolated() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "shared-${UUID.randomUUID()}.db"
        val fixture = HostFixture()
        val api = PersonalApi(fixture)
        val a = HostIdentity("https://example.test", "a", "owner-a", "host-one", "device-a", "cookie=owner-a", "csrf")
        val b = HostIdentity("https://example.test", "b", "owner-b", "host-one", "device-b", "cookie=owner-b", "csrf")
        var store = LocalStore(context, name)
        try {
            var shared = SharedChat(store, api)
            fixture.loseNextReply = true
            val lost = shared.submit(a, "session-one", "synthetic", "session.message", "request-one") { true }
            assertEquals("uncertain", lost.getString("state"))
            assertEquals("SERVICE_UNAVAILABLE", lost.getString("errorCode"))
            assertEquals("uncertain", store.sharedCommand(Endpoints.ownerKey(a.origin, a.ownerId), a.hostId,
                "session-one", "request-one")!!.state)
            assertEquals(0, shared.outbox(b).getJSONArray("commands").length())
            store.close()
            store = LocalStore(context, name)
            shared = SharedChat(store, api)
            assertEquals(1, shared.reconcileOutbox(a) { true }.getJSONArray("commands").length())
            assertEquals(1, fixture.posts)
            assertEquals("accepted", shared.outbox(a).getJSONArray("commands").getJSONObject(0).getString("state"))
            shared.submit(b, "session-one", "other owner", "session.message", "request-one") { true }
            assertEquals(2, fixture.posts)
            fixture.writable = false
            shared.sessions(a)
            try { shared.submit(a, "session-one", "blocked", "session.message", "request-two") { true }; fail("Read-only") }
            catch (error: ApiFailure) { assertEquals("SESSION_READ_ONLY", error.safeCode) }
            assertNull(store.sharedCommand(Endpoints.ownerKey(a.origin, a.ownerId), a.hostId, "session-one", "request-two"))
            fixture.revokedOwner = "owner-a"
            try { shared.submit(a, "session-one", "revoked", "session.message", "request-three") { true }; fail("Revoked") }
            catch (error: ApiFailure) { assertEquals(401, error.status) }
            assertNull(store.sharedCommand(Endpoints.ownerKey(a.origin, a.ownerId), a.hostId, "session-one", "request-three"))
        } finally { store.close(); context.deleteDatabase(name) }
    }

    @Test fun rejectedHostCommandReturnsSafeTopLevelErrorCodeForToast() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "shared-rejected-${UUID.randomUUID()}.db"
        val fixture = HostFixture().apply { commandState = "rejected" }
        val host = HostIdentity("https://example.test", "a", "owner-a", "host-one", "device-a",
            "cookie=owner-a", "csrf")
        val store = LocalStore(context, name)
        try {
            val result = SharedChat(store, PersonalApi(fixture)).submit(host, "session-one", "synthetic",
                "session.message", "rejected-image") { true }
            assertEquals("rejected", result.getString("state"))
            assertEquals("IMAGE_REJECTED", result.getString("errorCode"))
            assertEquals("IMAGE_REJECTED", result.getJSONObject("command").getString("errorCode"))
        } finally { store.close(); context.deleteDatabase(name) }
    }

    @Test fun restartQueriesBeforeSendingOriginalPayloadAndRejectsChangedBody() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "shared-${UUID.randomUUID()}.db"
        val host = HostIdentity("https://example.test", "a", "owner-a", "host-one", "device-a", "cookie=owner-a", "csrf")
        val fixture = HostFixture()
        var store = LocalStore(context, name)
        try {
            val owner = Endpoints.ownerKey(host.origin, host.ownerId)
            val payload = JSONObject().put("requestId", "request-restart").put("kind", "session.message")
                .put("targetDeviceId", host.hostId).put("sessionId", "session-one")
                .put("text", "original").put("mode", "queue")
            store.queueSharedCommand(owner, host.hostId, "session-one", "request-restart", payload)
            store.close()
            store = LocalStore(context, name)
            val shared = SharedChat(store, PersonalApi(fixture))
            val results = shared.reconcileOutbox(host) { true }.getJSONArray("commands")
            assertEquals("accepted", results.getJSONObject(0).getString("state"))
            assertEquals(1, fixture.posts)
            assertEquals("original", fixture.commands["owner-a|request-restart"]!!.getString("text"))
            assertTrue(fixture.calls.indexOfFirst { it.contains("/commands/by-request/request-restart") } <
                fixture.calls.indexOfFirst { it.endsWith("/commands") && it.startsWith("POST") })
            assertEquals(0, shared.reconcileOutbox(host) { true }.getJSONArray("commands").length())
            try { store.queueSharedCommand(owner, host.hostId, "session-one", "request-restart",
                JSONObject(payload.toString()).put("text", "altered")); fail("Expected conflict") }
            catch (error: ApiFailure) { assertEquals("REQUEST_CONFLICT", error.safeCode) }
        } finally { store.close(); context.deleteDatabase(name) }
    }

    @Test fun verifiedSessionQueuesOfflineAndReconcilesAfterReconnect() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "shared-${UUID.randomUUID()}.db"
        val host = HostIdentity("https://example.test", "a", "owner-a", "host-one", "device-a", "cookie=owner-a", "csrf")
        val fixture = HostFixture()
        var store = LocalStore(context, name)
        try {
            var shared = SharedChat(store, PersonalApi(fixture))
            assertTrue(shared.sessions(host).getBoolean("hostAvailable"))
            fixture.offline = true
            val queued = shared.submit(host, "session-one", "offline synthetic", "session.message", "offline-one") { true }
            assertEquals("uncertain", queued.getString("state"))
            assertEquals(0, fixture.posts)
            store.close()
            store = LocalStore(context, name)
            shared = SharedChat(store, PersonalApi(fixture))
            fixture.offline = false
            assertEquals("accepted", shared.reconcileOutbox(host) { true }.getJSONArray("commands")
                .getJSONObject(0).getString("state"))
            assertEquals(1, fixture.posts)
        } finally { store.close(); context.deleteDatabase(name) }
    }

    @Test fun sharedImageUploadsBeforeCommandAndDraftRetiresOnlyAfterDshReceipt() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val database = "shared-image-${UUID.randomUUID()}.db"
        val sessionId = "session-${UUID.randomUUID()}"
        val socket = ServerSocket(0)
        val host = HostIdentity("http://127.0.0.1:${socket.localPort}", "synthetic", "owner-image",
            "host-image", "device-image", "cookie=owner-image", "csrf")
        val owner = Endpoints.ownerKey(host.origin, host.ownerId)
        val bitmap = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
        val source = File.createTempFile("synthetic-shared-", ".png", context.cacheDir)
        val local = LocalStore(context, database)
        val attachments = AttachmentStore(context, local)
        var attachmentId: String? = null
        val failure = AtomicReference<Throwable?>()
        val uploadBytes = AtomicReference<ByteArray?>()
        val uploadMeta = AtomicReference<JSONObject?>()
        try {
            source.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            val imported = attachments.import(Uri.fromFile(source), owner, "", "image")
            attachmentId = imported.id
            attachments.claimDraft(owner, listOf(imported.id), sessionId)
            val fixture = HostFixture(sessionId).apply { commandState = "pending" }
            val server = Thread {
                try { socket.accept().use { connection ->
                    val input = connection.getInputStream().buffered()
                    fun line(): String {
                        val bytes = java.io.ByteArrayOutputStream()
                        while (true) {
                            val ch = input.read()
                            if (ch < 0 || ch == '\n'.code) break
                            if (ch != '\r'.code) bytes.write(ch)
                        }
                        return bytes.toString("UTF-8")
                    }
                    val requestLine = line()
                    if (!requestLine.startsWith("PUT /personal/v1/sessions/$sessionId/attachments/${imported.id}?"))
                        throw AssertionError("Unexpected upload path")
                    var length = 0
                    var mime = ""
                    var declaredHash = ""
                    while (true) {
                        val header = line()
                        if (header.isEmpty()) break
                        if (header.startsWith("Content-Length:", true)) length = header.substringAfter(':').trim().toInt()
                        if (header.startsWith("Content-Type:", true)) mime = header.substringAfter(':').trim()
                        if (header.startsWith("x-weftmate-sha256:", true))
                            declaredHash = header.substringAfter(':').trim()
                    }
                    if (length !in 1..512 * 1024) throw AssertionError("Derived upload length")
                    if (mime != "image/jpeg") throw AssertionError("Derived upload MIME")
                    val uploaded = input.readNBytes(length)
                    if (uploaded.size != length || uploaded.size < 4 ||
                        uploaded[0] != 0xff.toByte() || uploaded[1] != 0xd8.toByte() ||
                        uploaded[2] != 0xff.toByte() || uploaded[uploaded.size - 2] != 0xff.toByte() ||
                        uploaded.last() != 0xd9.toByte()) throw AssertionError("Derived JPEG body")
                    val actualHash = MessageDigest.getInstance("SHA-256").digest(uploaded)
                        .joinToString("") { "%02x".format(it) }
                    if (declaredHash != actualHash) throw AssertionError("Derived upload hash")
                    uploadBytes.set(uploaded)
                    val meta = JSONObject().put("attachmentId", imported.id)
                        .put("name", imported.name).put("contentType", mime)
                        .put("size", uploaded.size).put("sha256", actualHash)
                    uploadMeta.set(meta)
                    val body = JSONObject().put("attachment", meta)
                        .put("duplicate", false).toString().toByteArray()
                    val head = "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\n" +
                        "Content-Length: ${body.size}\r\nConnection: close\r\n\r\n"
                    connection.getOutputStream().write(head.toByteArray() + body)
                    connection.getOutputStream().flush()
                } } catch (error: Throwable) { failure.set(error) }
            }
            server.start()
            val shared = SharedChat(local, PersonalApi(fixture), attachments)
            val submitted = shared.submit(host, sessionId, "", "session.message", "shared-image-request",
                listOf(imported.id)) { true }
            server.join(5_000)
            failure.get()?.let { throw it }
            val transmitted = uploadBytes.get() ?: throw AssertionError("No derived upload")
            val transmittedMeta = uploadMeta.get() ?: throw AssertionError("No upload metadata")
            assertFalse("Original PNG is kept separately from model JPEG",
                imported.file.readBytes().contentEquals(transmitted))
            assertEquals("image/png", imported.mimeType)
            assertEquals(imported.sha256, MessageDigest.getInstance("SHA-256").digest(imported.file.readBytes())
                .joinToString("") { "%02x".format(it) })
            assertEquals(1, fixture.posts)
            val sentRef = fixture.postedPayloads.single().getJSONArray("attachments").getJSONObject(0)
            for (key in listOf("attachmentId", "name", "contentType", "size", "sha256"))
                assertEquals("Command reference $key", transmittedMeta.get(key), sentRef.get(key))
            assertEquals("uncertain", submitted.getString("state"))
            assertTrue(imported.file.exists())
            assertEquals(imported.id, attachments.list(owner, sessionId).single().id)
            fixture.commands["owner-image|shared-image-request"]!!.put("state", "accepted_by_dsh")
            val settled = shared.reconcileOutbox(host) { true }.getJSONArray("commands").getJSONObject(0)
            assertEquals("accepted", settled.getString("state"))
            assertFalse(imported.file.exists())
            assertTrue(attachments.list(owner, sessionId).isEmpty())
        } finally {
            socket.close()
            bitmap.recycle()
            source.delete()
            attachmentId?.let { try { attachments.remove(owner, it) } catch (_: Exception) { } }
            local.close()
            context.deleteDatabase(database)
        }
    }
}
