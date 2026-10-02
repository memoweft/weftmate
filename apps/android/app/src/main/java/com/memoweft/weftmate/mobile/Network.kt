package com.memoweft.weftmate.mobile

import android.graphics.BitmapFactory
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.io.File
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicReference

class ApiFailure(val status: Int, val safeCode: String) : Exception(safeCode)
internal fun upstreamHttpStatus(error: Throwable): Int? =
    (error as? ApiFailure)?.takeIf { it.safeCode == "MODEL_UPSTREAM_ERROR" && it.status in 400..599 }?.status
class SyncInterrupted : Exception()
data class HttpReply(val status: Int, val body: JSONObject, val cookie: String? = null)

fun imagePreviewUrl(conversationId: String, messageId: String?, attachmentId: String): String =
    "https://appassets.androidplatform.net/media/image/$attachmentId?conversationId=$conversationId" +
        (messageId?.let { "&messageId=$it" } ?: "")

fun sharedImagePreviewUrl(sessionId: String, durableId: String): String =
    "https://appassets.androidplatform.net/media/session/$sessionId/$durableId"

fun validImageScopeId(value: String): Boolean = value.matches(Regex(
    "(?:[A-Za-z][A-Za-z0-9_-]{0,31}-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))

private fun requestByteLimit(url: URL): Int = if (url.path.endsWith("/chat/completions"))
    14 * 1024 * 1024 else 256 * 1024

object Endpoints {
    fun allowedProtocol(url: URL): Boolean = url.protocol == "https" ||
        (BuildConfig.DEBUG && url.protocol == "http" && url.host in setOf("localhost", "127.0.0.1"))

    fun hostOrigin(input: String): String {
        val url = URL(input.trim())
        require(allowedProtocol(url) && url.userInfo == null && url.query == null && url.ref == null)
        require(url.path in setOf("", "/", "/personal/v1/ui", "/personal/v1/ui/"))
        return "${url.protocol}://${url.authority}"
    }

    fun modelUrl(input: String): String {
        val url = URL(input.trim())
        require(allowedModelProtocol(url) && url.userInfo == null && url.query == null && url.ref == null)
        val path = url.path.trimEnd('/')
        require(path.isNotBlank() && (path.endsWith("/v1") || path.endsWith("/chat/completions")))
        return if (path.endsWith("/chat/completions")) url.toString() else "${url.protocol}://${url.authority}$path/chat/completions"
    }

    fun allowedModelProtocol(url: URL): Boolean {
        if (allowedProtocol(url)) return true
        if (url.protocol != "http") return false
        val name = url.host.lowercase()
        val ipv4 = name.split('.').mapNotNull { it.toIntOrNull()?.takeIf { value -> value in 0..255 } }
        return name == "localhost" || name.endsWith(".local") || ipv4.size == 4 &&
            (ipv4[0] == 10 || ipv4[0] == 192 && ipv4[1] == 168 || ipv4[0] == 172 && ipv4[1] in 16..31 ||
                ipv4[0] == 127)
    }

    fun modelCatalogUrl(input: String): String = modelUrl(input).removeSuffix("/chat/completions") + "/models"

    fun ownerKey(origin: String, ownerId: String): String = MessageDigest.getInstance("SHA-256")
        .digest("$origin|$ownerId".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

data class DiscoveredModel(val id: String, val displayName: String)

fun moduleProjection(status: JSONObject): JSONObject {
    val source = status.optJSONObject("backend")?.optJSONObject("modules") ?: JSONObject()
    val result = JSONObject()
    for (name in listOf("memory", "mods", "tasks", "notifications", "workspaces", "capabilities")) {
        val value = source.optString(name)
        result.put(name, if (value in setOf("connected", "disabled", "unknown")) value else "unknown")
    }
    return result
}

/** Read-only provider directory; selection and actual inference remain separate operations. */
class ModelCatalogClient(private val http: JsonTransport = JsonHttp()) {
    fun discover(profile: ModelSettings): List<DiscoveredModel> {
        val headers = if (profile.apiKey.isEmpty()) emptyMap() else mapOf("Authorization" to "Bearer ${profile.apiKey}")
        val reply = http.request(Endpoints.modelCatalogUrl(profile.endpoint), "GET", headers = headers,
            readTimeoutMs = 15_000).body
        val entries = reply.optJSONArray("data") ?: throw ApiFailure(502, "MODEL_CATALOG_INVALID")
        if (entries.length() > 200) throw ApiFailure(502, "MODEL_CATALOG_TOO_LARGE")
        val models = linkedMapOf<String, DiscoveredModel>()
        for (index in 0 until entries.length()) {
            val row = entries.optJSONObject(index) ?: continue
            val id = row.optString("id")
            if (!id.matches(Regex("[A-Za-z0-9._:/-]{1,128}"))) continue
            if (!isChatCatalogModel(profile, id)) continue
            val label = row.optString("display_name").ifBlank { row.optString("name") }.ifBlank { id }
                .replace(Regex("[\\u0000-\\u001f]"), " ").trim().take(80)
            models.putIfAbsent(id, DiscoveredModel(id, label.ifBlank { id }))
            if (models.size >= 100) break
        }
        return models.values.toList()
    }
}

/** No redirects or TLS overrides. Call only from a worker thread. */
interface JsonTransport {
    fun request(url: String, method: String, body: JSONObject? = null,
        headers: Map<String, String> = emptyMap(), active: AtomicReference<HttpURLConnection?>? = null,
        readTimeoutMs: Int = 20_000): HttpReply
}

interface SseTransport : JsonTransport {
    /** Emits complete SSE data frames; null means a stream, JSONObject means a valid JSON response. */
    fun streamRequest(url: String, body: JSONObject, headers: Map<String, String>,
        active: AtomicReference<HttpURLConnection?>, readTimeoutMs: Int,
        onData: (String) -> Unit): JSONObject?
}

class JsonHttp : SseTransport {
    override fun request(url: String, method: String, body: JSONObject?,
        headers: Map<String, String>, active: AtomicReference<HttpURLConnection?>?,
        readTimeoutMs: Int): HttpReply {
        val connection = URL(url).openConnection() as HttpURLConnection
            require(Endpoints.allowedModelProtocol(connection.url))
        active?.set(connection)
        try {
            if (active != null && (active.get() !== connection || Thread.currentThread().isInterrupted))
                throw ApiFailure(499, "CANCELLED")
            connection.instanceFollowRedirects = false
            connection.requestMethod = method
            connection.connectTimeout = 12_000
            connection.readTimeout = readTimeoutMs
            connection.setRequestProperty("Accept", "application/json")
            for ((key, value) in headers) connection.setRequestProperty(key, value)
            if (body != null) {
                if (active != null && active.get() !== connection) throw ApiFailure(499, "CANCELLED")
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                if (bytes.size > requestByteLimit(connection.url)) throw ApiFailure(413, "MODEL_CONTEXT_TOO_LARGE")
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            if (active != null && active.get() !== connection) throw ApiFailure(499, "CANCELLED")
            val status = connection.responseCode
            if (status in 300..399) throw ApiFailure(status, "REDIRECT_REFUSED")
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val bytes = stream?.use { source ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(4096)
                while (true) {
                    val n = source.read(buffer)
                    if (n < 0) break
                    if (output.size() + n > 1024 * 1024) throw ApiFailure(status, "RESPONSE_TOO_LARGE")
                    output.write(buffer, 0, n)
                }
                output.toByteArray()
            } ?: ByteArray(0)
            val json = try { JSONObject(String(bytes, Charsets.UTF_8)) } catch (_: Exception) { JSONObject() }
            val code = json.optJSONObject("error")?.optString("code")?.takeIf { it.matches(Regex("[A-Z_]{1,64}")) }
            if (status !in 200..299) throw ApiFailure(status, code ?: "HTTP_$status")
            return HttpReply(status, json, connection.getHeaderField("Set-Cookie"))
        } finally {
            active?.compareAndSet(connection, null)
            connection.disconnect()
        }
    }

    override fun streamRequest(url: String, body: JSONObject, headers: Map<String, String>,
        active: AtomicReference<HttpURLConnection?>, readTimeoutMs: Int, onData: (String) -> Unit): JSONObject? {
        val connection = URL(url).openConnection() as HttpURLConnection
        require(Endpoints.allowedModelProtocol(connection.url))
        active.set(connection)
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"
            connection.connectTimeout = 12_000
            connection.readTimeout = readTimeoutMs
            connection.doOutput = true
            connection.setRequestProperty("Accept", "text/event-stream, application/json")
            connection.setRequestProperty("Content-Type", "application/json")
            for ((key, value) in headers) connection.setRequestProperty(key, value)
            val bytes = body.toString().toByteArray(Charsets.UTF_8)
            if (bytes.size > requestByteLimit(connection.url)) throw ApiFailure(413, "MODEL_CONTEXT_TOO_LARGE")
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            val status = connection.responseCode
            if (status in 300..399) throw ApiFailure(status, "REDIRECT_REFUSED")
            if (status !in 200..299) throw ApiFailure(status, "MODEL_UPSTREAM_ERROR")
            val type = connection.contentType.orEmpty().lowercase()
            if (!type.startsWith("text/event-stream")) {
                val result = connection.inputStream.use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (output.size() + count > 1024 * 1024) throw ApiFailure(502, "RESPONSE_TOO_LARGE")
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                if (result.size > 1024 * 1024) throw ApiFailure(502, "RESPONSE_TOO_LARGE")
                return try { JSONObject(String(result, Charsets.UTF_8)) }
                catch (_: Exception) { throw ApiFailure(502, "MODEL_RESPONSE_INVALID") }
            }
            connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                val frame = StringBuilder()
                var transferred = 0
                var seen = 0
                while (true) {
                    val line = StringBuilder()
                    var ended = false
                    while (true) {
                        val ch = reader.read()
                        if (ch < 0) { ended = true; break }
                        if (ch == '\n'.code) break
                        if (ch != '\r'.code) line.append(ch.toChar())
                        if (line.length > 256 * 1024) throw ApiFailure(502, "MODEL_STREAM_LIMIT")
                    }
                    transferred += line.length
                    if (transferred > 8 * 1024 * 1024) throw ApiFailure(502, "MODEL_STREAM_LIMIT")
                    if (line.isEmpty() || ended) {
                        if (frame.isNotEmpty()) {
                            val data = frame.toString().trimEnd('\n')
                            frame.setLength(0)
                            if (data == "[DONE]") return null
                            onData(data)
                            seen++
                            if (seen > 20_000) throw ApiFailure(502, "MODEL_STREAM_LIMIT")
                        }
                    } else if (line.startsWith("data:")) frame.append(line.substring(5).trimStart()).append('\n')
                    if (ended) throw ApiFailure(502, "MODEL_STREAM_INCOMPLETE")
                    if (active.get() !== connection) throw ModelCancelled()
                }
            }
        } finally { active.compareAndSet(connection, null); connection.disconnect() }
    }
}

class PersonalApi(private val http: JsonTransport = JsonHttp()) {
    fun uploadSharedImage(host: HostIdentity, sessionId: String, requestId: String,
        row: ChatAttachment): JSONObject {
        require(sessionId.matches(Regex("session-[0-9a-f-]{36}")) &&
            requestId.matches(Regex("[A-Za-z0-9_.:-]{1,128}")) &&
            row.id.matches(Regex("attachment-[0-9a-f-]{36}")))
        if (row.kind != "image" || row.sizeBytes !in 1..5L * 1024 * 1024 ||
            row.file.length() != row.sizeBytes) throw ApiFailure(409, "ATTACHMENT_CHANGED")
        val url = "${host.origin}/personal/v1/sessions/$sessionId/attachments/${row.id}" +
            "?requestId=${URLEncoder.encode(requestId, "UTF-8")}&name=${URLEncoder.encode(row.name, "UTF-8")}" 
        val connection = URL(url).openConnection() as HttpURLConnection
        require(Endpoints.allowedProtocol(connection.url))
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "PUT"
            connection.connectTimeout = 12_000
            connection.readTimeout = 30_000
            connection.doOutput = true
            connection.setRequestProperty("Cookie", host.cookie)
            connection.setRequestProperty("Origin", host.origin)
            connection.setRequestProperty("X-WeftMate-CSRF", host.csrf)
            connection.setRequestProperty("Content-Type", row.mimeType)
            connection.setRequestProperty("x-weftmate-sha256", row.sha256)
            connection.setFixedLengthStreamingMode(row.sizeBytes)
            connection.outputStream.use { output -> row.file.inputStream().use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
            } }
            val status = connection.responseCode
            if (status in 300..399) throw ApiFailure(status, "REDIRECT_REFUSED")
            val source = if (status >= 400) connection.errorStream else connection.inputStream
            val bytes = source?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(4096)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > 64 * 1024) throw ApiFailure(502, "RESPONSE_TOO_LARGE")
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: ByteArray(0)
            val result = try { JSONObject(String(bytes, Charsets.UTF_8)) } catch (_: Exception) { JSONObject() }
            if (status !in setOf(200, 201)) throw ApiFailure(status,
                result.optJSONObject("error")?.optString("code") ?: "HTTP_$status")
            val meta = result.optJSONObject("attachment") ?: throw ApiFailure(502, "ATTACHMENT_RECEIPT_INVALID")
            if (meta.optString("attachmentId") != row.id || meta.optString("name") != row.name ||
                meta.optString("contentType") != row.mimeType || meta.optLong("size") != row.sizeBytes ||
                meta.optString("sha256") != row.sha256 || meta.length() != 5)
                throw ApiFailure(502, "ATTACHMENT_RECEIPT_INVALID")
            return meta
        } finally { connection.disconnect() }
    }

    fun downloadSharedImage(host: HostIdentity, sessionId: String, durableId: String): Pair<String, ByteArray> {
        require(sessionId.matches(Regex("session-[0-9a-f-]{36}")) &&
            durableId.matches(Regex("sha256:[a-f0-9]{64}")))
        val connection = URL("${host.origin}/personal/v1/sessions/$sessionId/attachments/$durableId")
            .openConnection() as HttpURLConnection
        require(Endpoints.allowedProtocol(connection.url))
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "GET"
            connection.connectTimeout = 12_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("Cookie", host.cookie)
            val status = connection.responseCode
            if (status !in 200..299) throw ApiFailure(status, "ATTACHMENT_UNAVAILABLE")
            val mime = connection.contentType?.substringBefore(';') ?: throw ApiFailure(502, "ATTACHMENT_INVALID")
            if (mime !in setOf("image/png", "image/jpeg", "image/webp", "image/gif"))
                throw ApiFailure(502, "ATTACHMENT_INVALID")
            val output = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > 5 * 1024 * 1024) throw ApiFailure(502, "ATTACHMENT_TOO_LARGE")
                    output.write(buffer, 0, count)
                }
            }
            return mime to output.toByteArray()
        } finally { connection.disconnect() }
    }
    private fun imageUrl(host: HostIdentity, conversationId: String, messageId: String,
        attachmentId: String, name: String = ""): String {
        require(validImageScopeId(conversationId) && validImageScopeId(messageId) &&
            validImageScopeId(attachmentId))
        val query = "conversationId=$conversationId&messageId=$messageId"
        return "${host.origin}/personal/v1/sync/attachments/$attachmentId?$query" +
            if (name.isEmpty()) "" else "&name=${URLEncoder.encode(name, "UTF-8")}" 
    }

    fun uploadImage(host: HostIdentity, row: PendingImage, file: File,
        active: AtomicReference<HttpURLConnection?>? = null): JSONObject {
        if (file.length() != row.size || row.size !in 1..AttachmentStore.MAX_IMAGE_BYTES)
            throw ApiFailure(409, "ATTACHMENT_CHANGED")
        val connection = URL(imageUrl(host, row.conversationId, row.messageId, row.attachmentId, row.name))
            .openConnection() as HttpURLConnection
        require(Endpoints.allowedProtocol(connection.url))
        active?.set(connection)
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "PUT"
            connection.connectTimeout = 30_000
            connection.readTimeout = 300_000
            connection.doOutput = true
            connection.setRequestProperty("Cookie", host.cookie)
            connection.setRequestProperty("Origin", host.origin)
            connection.setRequestProperty("X-WeftMate-CSRF", host.csrf)
            connection.setRequestProperty("Content-Type", row.contentType)
            connection.setRequestProperty("x-weftmate-sha256", row.sha256)
            connection.setFixedLengthStreamingMode(row.size)
            connection.outputStream.use { output -> file.inputStream().use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    if (Thread.currentThread().isInterrupted || active != null && active.get() !== connection)
                        throw SyncInterrupted()
                    val count = input.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
            } }
            val status = connection.responseCode
            if (status in 300..399) throw ApiFailure(status, "REDIRECT_REFUSED")
            val source = if (status >= 400) connection.errorStream else connection.inputStream
            val bytes = source?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(4096)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > 64 * 1024) throw ApiFailure(502, "RESPONSE_TOO_LARGE")
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: ByteArray(0)
            val result = try { JSONObject(String(bytes, Charsets.UTF_8)) } catch (_: Exception) { JSONObject() }
            if (status !in setOf(200, 201))
                throw ApiFailure(status, result.optJSONObject("error")?.optString("code") ?: "HTTP_$status")
            return result.optJSONObject("attachment") ?: throw ApiFailure(502, "SYNC_RECEIPT_INVALID")
        } finally { active?.compareAndSet(connection, null); connection.disconnect() }
    }

    fun uploadDisplay(host: HostIdentity, row: PendingImage, file: File,
        active: AtomicReference<HttpURLConnection?>? = null): JSONObject {
        if (file.length() !in 1..512L * 1024) throw ApiFailure(409, "IMAGE_PREVIEW_UNAVAILABLE")
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it) }
        val connection = URL(imageUrl(host, row.conversationId, row.messageId, row.attachmentId) + "&variant=display")
            .openConnection() as HttpURLConnection
        require(Endpoints.allowedProtocol(connection.url))
        active?.set(connection)
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "PUT"
            connection.connectTimeout = 12_000
            connection.readTimeout = 30_000
            connection.doOutput = true
            connection.setRequestProperty("Cookie", host.cookie)
            connection.setRequestProperty("Origin", host.origin)
            connection.setRequestProperty("X-WeftMate-CSRF", host.csrf)
            connection.setRequestProperty("Content-Type", "image/jpeg")
            connection.setRequestProperty("x-weftmate-sha256", hash)
            connection.setFixedLengthStreamingMode(file.length())
            connection.outputStream.use { output -> file.inputStream().use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    if (Thread.currentThread().isInterrupted || active != null && active.get() !== connection)
                        throw SyncInterrupted()
                    val count = input.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
            } }
            val status = connection.responseCode
            val source = if (status >= 400) connection.errorStream else connection.inputStream
            val response = ByteArrayOutputStream()
            source?.use { input ->
                val buffer = ByteArray(4096)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (response.size() + count > 64 * 1024) throw ApiFailure(502, "RESPONSE_TOO_LARGE")
                    response.write(buffer, 0, count)
                }
            }
            val result = try { JSONObject(String(response.toByteArray(), Charsets.UTF_8)) }
                catch (_: Exception) { JSONObject() }
            if (status !in setOf(200, 201)) throw ApiFailure(status,
                result.optJSONObject("error")?.optString("code") ?: "IMAGE_PREVIEW_UPLOAD_FAILED")
            val display = result.optJSONObject("display") ?: throw ApiFailure(502, "SYNC_RECEIPT_INVALID")
            if (display.optString("contentType") != "image/jpeg" || display.optLong("size") != file.length() ||
                display.optString("sha256") != hash) throw ApiFailure(502, "SYNC_RECEIPT_INVALID")
            return result
        } finally { active?.compareAndSet(connection, null); connection.disconnect() }
    }

    fun downloadImage(host: HostIdentity, conversationId: String, messageId: String,
        attachmentId: String, display: Boolean = false): Pair<String, ByteArray> {
        require(validImageScopeId(conversationId) && validImageScopeId(messageId) &&
            validImageScopeId(attachmentId))
        val connection = URL("${host.origin}/personal/v1/sync/attachments/$attachmentId" +
            if (display) "?variant=display" else "")
            .openConnection() as HttpURLConnection
        require(Endpoints.allowedProtocol(connection.url))
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "GET"
            connection.connectTimeout = 12_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("Cookie", host.cookie)
            val status = connection.responseCode
            if (status !in 200..299) throw ApiFailure(status, "ATTACHMENT_UNAVAILABLE")
            val mime = connection.contentType?.substringBefore(';') ?: throw ApiFailure(502, "ATTACHMENT_INVALID")
            if (mime !in setOf("image/png", "image/jpeg", "image/webp", "image/gif"))
                throw ApiFailure(502, "ATTACHMENT_INVALID")
            val limit = if (display) 512 * 1024 else AttachmentStore.SAFE_ORIGINAL_BYTES.toInt()
            if (!display && connection.contentLengthLong > limit)
                return downloadImage(host, conversationId, messageId, attachmentId, true)
            val output = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > limit) {
                        if (!display) return downloadImage(host, conversationId, messageId, attachmentId, true)
                        throw ApiFailure(502, "IMAGE_PREVIEW_UNAVAILABLE")
                    }
                    output.write(buffer, 0, count)
                }
            }
            val bytes = output.toByteArray()
            if (!display) {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0 ||
                    bounds.outWidth > 8192 || bounds.outHeight > 8192 ||
                    bounds.outWidth.toLong() * bounds.outHeight > 16_000_000)
                    return downloadImage(host, conversationId, messageId, attachmentId, true)
            }
            return mime to bytes
        } finally { connection.disconnect() }
    }
    fun accountState(originInput: String): JSONObject = http.request(
        "${Endpoints.hostOrigin(originInput)}/personal/v1/auth/state", "GET").body

    fun register(originInput: String, username: String, password: String, deviceName: String,
        displayName: String?): HostIdentity {
        val origin = Endpoints.hostOrigin(originInput)
        val body = JSONObject().put("username", username).put("password", password).put("deviceName", deviceName)
        if (!displayName.isNullOrBlank()) body.put("displayName", displayName)
        val response = http.request("$origin/personal/v1/auth/register", "POST", body, mapOf("Origin" to origin))
        return identityFromAuth(origin, response)
    }

    fun login(originInput: String, username: String, password: String, deviceName: String): HostIdentity {
        val origin = Endpoints.hostOrigin(originInput)
        val response = http.request("$origin/personal/v1/auth/login", "POST",
            JSONObject().put("username", username).put("password", password).put("deviceName", deviceName),
            mapOf("Origin" to origin))
        return identityFromAuth(origin, response)
    }

    private fun identityFromAuth(origin: String, response: HttpReply): HostIdentity {
        val cookie = response.cookie?.substringBefore(';') ?: throw ApiFailure(502, "COOKIE_MISSING")
        if (!cookie.matches(Regex("wm_personal_session=[A-Za-z0-9_-]{40,128}"))) throw ApiFailure(502, "COOKIE_INVALID")
        val account = response.body.getJSONObject("account")
        val device = response.body.getJSONObject("device")
        val csrf = response.body.getString("csrfToken")
        val status = http.request("$origin/personal/v1/status", "GET", headers = mapOf("Cookie" to cookie)).body
        val ownerId = account.getString("ownerId")
        if (status.getString("ownerId") != ownerId) throw ApiFailure(502, "ACCOUNT_IDENTITY_MISMATCH")
        return HostIdentity(origin, account.getString("username"), ownerId,
            status.getString("hostId"), device.getString("id"), cookie, csrf)
    }

    fun me(host: HostIdentity, active: AtomicReference<HttpURLConnection?>? = null): JSONObject {
        val result = http.request("${host.origin}/personal/v1/auth/me", "GET",
            headers = mapOf("Cookie" to host.cookie), active = active).body
        if (result.optJSONObject("account")?.optString("ownerId") != host.ownerId)
            throw ApiFailure(502, "ACCOUNT_IDENTITY_MISMATCH")
        return result
    }

    fun updateProfile(host: HostIdentity, expectedRevision: Long, displayName: String?, avatar: Any? = null,
        includeAvatar: Boolean = false): JSONObject {
        val body = JSONObject().put("expectedRevision", expectedRevision)
        if (displayName != null) body.put("displayName", displayName)
        if (includeAvatar) body.put("avatar", avatar ?: JSONObject.NULL)
        return http.request("${host.origin}/personal/v1/auth/profile", "PATCH", body,
            authWriteHeaders(host)).body
    }

    fun devices(host: HostIdentity): JSONObject = http.request("${host.origin}/personal/v1/auth/devices", "GET",
        headers = mapOf("Cookie" to host.cookie)).body

    fun renameDevice(host: HostIdentity, deviceId: String, name: String): JSONObject {
        require(deviceId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        return http.request("${host.origin}/personal/v1/auth/devices/$deviceId", "PATCH",
            JSONObject().put("name", name), authWriteHeaders(host)).body
    }

    fun revokeDevice(host: HostIdentity, deviceId: String) {
        require(deviceId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        http.request("${host.origin}/personal/v1/auth/devices/$deviceId", "DELETE", JSONObject(), authWriteHeaders(host))
    }

    fun changePassword(host: HostIdentity, currentPassword: String, newPassword: String): HostIdentity {
        val response = http.request("${host.origin}/personal/v1/auth/change-password", "POST",
            JSONObject().put("currentPassword", currentPassword).put("newPassword", newPassword),
            authWriteHeaders(host))
        val cookie = response.cookie?.substringBefore(';') ?: throw ApiFailure(502, "COOKIE_MISSING")
        if (!cookie.matches(Regex("wm_personal_session=[A-Za-z0-9_-]{40,128}")))
            throw ApiFailure(502, "COOKIE_INVALID")
        val device = response.body.getJSONObject("device")
        return host.copy(deviceId = device.getString("id"), cookie = cookie,
            csrf = response.body.getString("csrfToken"))
    }

    fun hostModels(host: HostIdentity): JSONObject = http.request("${host.origin}/personal/v1/models", "GET",
        headers = mapOf("Cookie" to host.cookie)).body

    fun verifyHostModel(host: HostIdentity, profileId: String): JSONObject {
        require(profileId.matches(Regex("[A-Za-z0-9._-]{1,128}")))
        return http.request("${host.origin}/personal/v1/models/$profileId/verify", "POST", JSONObject(),
            authWriteHeaders(host)).body
    }

    fun hostModelTransport(host: HostIdentity): SseTransport = object : SseTransport {
        override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
            active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
            val prefix = "${host.origin}/personal/v1/models/"
            require(url.startsWith(prefix) && url.endsWith("/chat/completions") && method == "POST")
            val profileId = url.removePrefix(prefix).removeSuffix("/chat/completions")
            require(profileId.matches(Regex("[A-Za-z0-9._-]{1,128}")))
            return http.request(url, method, body, authWriteHeaders(host), active, readTimeoutMs)
        }
        override fun streamRequest(url: String, body: JSONObject, headers: Map<String, String>,
            active: AtomicReference<HttpURLConnection?>, readTimeoutMs: Int,
            onData: (String) -> Unit): JSONObject? {
            val prefix = "${host.origin}/personal/v1/models/"
            require(url.startsWith(prefix) && url.endsWith("/chat/completions"))
            val profileId = url.removePrefix(prefix).removeSuffix("/chat/completions")
            require(profileId.matches(Regex("[A-Za-z0-9._-]{1,128}")))
            return JsonHttp().streamRequest(url, body, authWriteHeaders(host), active, readTimeoutMs, onData)
        }
    }

    /** Only future business routes, never auth, credentials, model configuration or arbitrary URLs. */
    fun business(host: HostIdentity, path: String, method: String, body: JSONObject?): JSONObject {
        require(method in setOf("GET", "POST", "PATCH", "DELETE"))
        val route = path.substringBefore('?')
        val query = path.substringAfter('?', "")
        require(path.length <= 512 && route.matches(Regex("/personal/v1/(memory|mods|tasks|notifications|workspaces|capabilities)(/[A-Za-z0-9._~/-]*)?")))
        require(route.split('/').none { it == "." || it == ".." } && !route.contains("//") &&
            query.matches(Regex("[A-Za-z0-9._~=&%+-]*")))
        if (body != null) require(body.toString().toByteArray(Charsets.UTF_8).size <= 64 * 1024)
        return http.request("${host.origin}$path", method, body,
            if (method == "GET") mapOf("Cookie" to host.cookie) else authWriteHeaders(host)).body
    }

    private fun authWriteHeaders(host: HostIdentity) = mapOf("Cookie" to host.cookie,
        "Origin" to host.origin, "X-WeftMate-CSRF" to host.csrf)

    fun status(host: HostIdentity): JSONObject {
        val result = http.request("${host.origin}/personal/v1/status", "GET",
            headers = mapOf("Cookie" to host.cookie)).body
        if (result.optString("ownerId") != host.ownerId) throw ApiFailure(502, "ACCOUNT_IDENTITY_MISMATCH")
        return result
    }

    fun logout(host: HostIdentity) { http.request("${host.origin}/personal/v1/auth/logout", "POST", JSONObject(),
        mapOf("Cookie" to host.cookie, "Origin" to host.origin, "X-WeftMate-CSRF" to host.csrf)) }

    fun postEvents(host: HostIdentity, events: JSONArray,
        active: AtomicReference<HttpURLConnection?>? = null): JSONObject = http.request(
        "${host.origin}/personal/v1/sync/events", "POST", JSONObject().put("events", events),
        mapOf("Cookie" to host.cookie, "Origin" to host.origin, "X-WeftMate-CSRF" to host.csrf), active).body

    fun getEvents(host: HostIdentity, after: Long, limit: Int = 100,
        active: AtomicReference<HttpURLConnection?>? = null): JSONObject = http.request(
        "${host.origin}/personal/v1/sync/events?afterSeq=$after&limit=$limit", "GET",
        headers = mapOf("Cookie" to host.cookie), active = active).body

    fun remoteSessions(host: HostIdentity): JSONObject = http.request(
        "${host.origin}/personal/v1/sessions", "GET", headers = mapOf("Cookie" to host.cookie)).body

    fun recentCommands(host: HostIdentity): JSONObject = http.request(
        "${host.origin}/personal/v1/commands?limit=50", "GET", headers = mapOf("Cookie" to host.cookie)).body

    fun remoteHistory(host: HostIdentity, sessionId: String, after: Long): JSONObject {
        require(sessionId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        require(after >= -1)
        return http.request("${host.origin}/personal/v1/sessions/$sessionId/events?afterSeq=$after&limit=100",
            "GET", headers = mapOf("Cookie" to host.cookie)).body
    }

    fun commandByRequest(host: HostIdentity, requestId: String): JSONObject {
        require(requestId.matches(Regex("[A-Za-z0-9_.:-]{1,128}")))
        return http.request("${host.origin}/personal/v1/commands/by-request/$requestId", "GET",
            headers = mapOf("Cookie" to host.cookie)).body.getJSONObject("command")
    }

    fun commandDetail(host: HostIdentity, commandId: String): JSONObject {
        require(commandId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        return http.request("${host.origin}/personal/v1/commands/$commandId", "GET",
            headers = mapOf("Cookie" to host.cookie)).body.getJSONObject("command")
    }

    fun taskDetail(host: HostIdentity, taskId: String): JSONObject {
        require(taskId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        return http.request("${host.origin}/personal/v1/tasks/$taskId", "GET",
            headers = mapOf("Cookie" to host.cookie)).body
    }

    fun taskControl(host: HostIdentity, taskId: String, action: String, requestId: String,
        text: String? = null): JSONObject {
        require(taskId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        require(action in setOf("supplements", "stop", "resume"))
        require(requestId.matches(Regex("[A-Za-z0-9_.:-]{1,128}")))
        val body = JSONObject().put("requestId", requestId)
        if (text != null) body.put("text", text)
        return http.request("${host.origin}/personal/v1/tasks/$taskId/$action", "POST", body,
            authWriteHeaders(host)).body
    }

    fun artifactPreview(host: HostIdentity, artifactId: String): JSONObject {
        require(artifactId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        return http.request("${host.origin}/personal/v1/artifacts/$artifactId/preview", "GET",
            headers = mapOf("Cookie" to host.cookie)).body
    }

    fun artifactBytes(host: HostIdentity, artifactId: String): ByteArray {
        require(artifactId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        val connection = URL("${host.origin}/personal/v1/artifacts/$artifactId/download").openConnection() as HttpURLConnection
        require(Endpoints.allowedProtocol(connection.url))
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 12_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Cookie", host.cookie)
            connection.setRequestProperty("Accept", "text/plain")
            val status = connection.responseCode
            if (status in 300..399) throw ApiFailure(status, "REDIRECT_REFUSED")
            if (status !in 200..299) {
                val error = connection.errorStream?.use { input ->
                    val buffer = ByteArray(4096)
                    val count = input.read(buffer)
                    if (count > 0) buffer.copyOf(count) else ByteArray(0)
                } ?: ByteArray(0)
                val code = try { JSONObject(String(error, Charsets.UTF_8)).optJSONObject("error")?.optString("code") }
                    catch (_: Exception) { null }
                throw ApiFailure(status, code?.takeIf { it.matches(Regex("[A-Z_]{1,64}")) } ?: "HTTP_$status")
            }
            val out = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(4096)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    if (out.size() + n > 128 * 1024) throw ApiFailure(413, "ARTIFACT_TOO_LARGE")
                    out.write(buffer, 0, n)
                }
            }
            return out.toByteArray()
        } finally { connection.disconnect() }
    }

    fun postCommand(host: HostIdentity, payload: JSONObject): JSONObject = http.request(
        "${host.origin}/personal/v1/commands", "POST", payload, authWriteHeaders(host)).body.getJSONObject("command")
}

data class SyncOutcome(val uploaded: Int, val downloaded: Int, val hasMore: Boolean)

class SyncManager(private val store: LocalStore, private val api: PersonalApi,
    private val attachments: AttachmentStore? = null) {
    fun syncOnce(host: HostIdentity, shouldContinue: () -> Boolean = { true },
        active: AtomicReference<HttpURLConnection?>? = null): SyncOutcome {
        fun checkAllowed() { if (!shouldContinue()) throw SyncInterrupted() }
        checkAllowed()
        api.me(host, active) // Revocation/expiry stops before touching the outbox.
        checkAllowed()
        val owner = Endpoints.ownerKey(host.origin, host.ownerId)
        var uploaded = 0
        for (attempt in 0 until 10) {
            checkAllowed()
            val candidates = store.pending(owner)
            if (candidates.isEmpty()) break
            val batch = JSONArray()
            for (item in candidates) {
                if (batch.length() >= 50) break
                if (item.body.getString("kind") == "message.created") {
                    val payload = item.body.getJSONObject("payload")
                    val messageId = payload.getString("messageId")
                    for (row in store.pendingImages(owner, messageId)) {
                        checkAllowed()
                        val file = attachments?.fileForUpload(owner, row)
                            ?: throw ApiFailure(409, "ATTACHMENT_UNAVAILABLE")
                        val receipt = api.uploadImage(host, row, file, active)
                        checkAllowed()
                        val display = attachments.displayFileForUpload(owner, row)
                        api.uploadDisplay(host, row, display, active)
                        checkAllowed()
                        store.markImageUploaded(owner, row, receipt)
                    }
                    val uploadedImages = store.uploadedImages(owner, messageId)
                    if (uploadedImages.length() > 0) payload.put("attachments", uploadedImages)
                }
                batch.put(item.body)
                if (JSONObject().put("events", batch).toString().toByteArray(Charsets.UTF_8).size > 256 * 1024) {
                    batch.remove(batch.length() - 1)
                    break
                }
            }
            if (batch.length() == 0) throw ApiFailure(413, "SYNC_EVENT_TOO_LARGE")
            checkAllowed()
            val result = api.postEvents(host, batch, active)
            checkAllowed()
            val accepted = result.getJSONArray("accepted")
            if (accepted.length() != batch.length()) throw ApiFailure(502, "SYNC_RECEIPT_INVALID")
            val expected = (0 until batch.length()).map { batch.getJSONObject(it).getString("eventId") }.toSet()
            val actual = (0 until accepted.length()).map { accepted.getJSONObject(it).getString("eventId") }.toSet()
            if (expected != actual || accepted.length() != actual.size) throw ApiFailure(502, "SYNC_RECEIPT_INVALID")
            checkAllowed()
            store.markAccepted(owner, accepted)
            for (row in store.publishedImages(owner)) {
                checkAllowed()
                attachments?.retireUploaded(owner, row, store)
            }
            uploaded += accepted.length()
        }
        var downloaded = 0
        var more = false
        repeat(5) {
            checkAllowed()
            val after = store.cursor(owner)
            val result = api.getEvents(host, after, active = active)
            checkAllowed()
            val events = result.getJSONArray("events")
            val next = result.getLong("nextSeq")
            more = result.getBoolean("hasMore")
            if (next < after || (more && next == after)) throw ApiFailure(502, "SYNC_CURSOR_INVALID")
            checkAllowed()
            store.applyRemotePage(owner, events, next)
            downloaded += events.length()
            if (!more) return SyncOutcome(uploaded, downloaded, false)
        }
        return SyncOutcome(uploaded, downloaded, more)
    }
}
