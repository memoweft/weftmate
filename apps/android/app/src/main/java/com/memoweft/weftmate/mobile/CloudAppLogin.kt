package com.memoweft.weftmate.mobile

import org.json.JSONObject
import java.net.CookieManager
import java.net.CookiePolicy
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.UUID

/** App-only fixed-origin transport. HttpOnly cookies and actual refresh tokens stay in native storage. */
internal class CloudAppLogin(private val secrets: SecureSettings, private val api: PersonalApi) {
    companion object { private val cookies = CookieManager(null, CookiePolicy.ACCEPT_ORIGINAL_SERVER) }
    fun configure(originInput: String): JSONObject {
        val host = Endpoints.hostOrigin(originInput)
        val response = try { JsonHttp().request("$host/personal/v1/cloud/config", "GET") }
            catch (error: ApiFailure) { if (error.status == 404) HttpReply(404, JSONObject()) else throw error }
        val config = if (response.status == 404) JSONObject().put("issuer", "$host/personal/v1/cloud/oidc")
            .put("hostId", "unconnected") else response.body
        if (response.status !in setOf(200, 404)) throw ApiFailure(response.status, config.optJSONObject("error")?.optString("code") ?: "REQUEST_FAILED")
        val issuer = config.getString("issuer")
        val url = URL(issuer)
        require(Endpoints.allowedProtocol(url) && url.path == "/personal/v1/cloud/oidc" && url.userInfo == null && url.query == null && url.ref == null)
        config.put("clientId", "weftmate-android")
        secrets.saveAppValue("login", JSONObject().put("host", host).put("issuer", issuer).put("config", config).toString())
        return config
    }
    private fun login() = JSONObject(secrets.appValue("login") ?: throw ApiFailure(401, "LOGIN_REQUIRED"))
    fun hostOrigin(): String? = secrets.appValue("login")?.let { JSONObject(it).getString("host") }
    private fun refreshes() = JSONObject(secrets.appValue("refreshes") ?: "{}")
    private fun values() = JSONObject(secrets.appValue("credentials") ?: "{}")
    @Synchronized fun credentials(params: JSONObject): JSONObject {
        val key = params.getString("key")
        require(key == "offline-account" || listOf("app-tokens:", "trusted-host:", "draft:").any { key.startsWith(it) })
        require(key.length <= 2048)
        val entries = values()
        if (params.optBoolean("remove")) {
            if (key.startsWith("app-tokens:")) {
                // A rotated but not yet committed handle must also disappear on sign-out.
                secrets.saveAppValue("refreshes", null)
                cookies.cookieStore.removeAll()
                secrets.saveAppValue("result", null)
            }
            entries.remove(key)
        } else if (params.has("value") && !params.isNull("value")) {
            val value = params.get("value")
            require(value.toString().length <= 256 * 1024)
            if (key.startsWith("app-tokens:")) {
                require(value is JSONObject && value.optString("refreshToken").startsWith("wm-refresh:"))
                require(refreshes().has(value.getString("refreshToken")))
                // One active account per installation, including configurations for another cloud.
                for (old in entries.keys().asSequence().filter { it.startsWith("app-tokens:") && it != key }.toList()) entries.remove(old)
                val current = entries.optJSONObject(key)
                if (current != null && current.optString("refreshToken") != value.getString("refreshToken")) {
                    val handles = refreshes(); handles.remove(current.optString("refreshToken"))
                    secrets.saveAppValue("refreshes", handles.toString())
                }
            }
            if (key.startsWith("trusted-host:")) {
                require(value is JSONObject)
                val host = Endpoints.hostOrigin(value.optString("origin").ifBlank { hostOrigin() ?: throw ApiFailure(400, "HOST_TRUST_INVALID") })
                val pin = value.getString("tlsSpki")
                val pins = JSONObject(secrets.cloudValue("pins") ?: "{}")
                if (pins.has(host) && pins.getString(host) != pin) throw ApiFailure(403, "HOST_PIN_MISMATCH")
                CloudPins.install(host, pin); pins.put(host, pin); secrets.saveCloudValue("pins", pins.toString())
                val relay = value.optJSONObject("relay")
                if (relay != null && !relay.isNull("baseUrl") && relay.optString("baseUrl").isNotBlank()) {
                    val relayOrigin = Endpoints.hostOrigin(relay.getString("baseUrl"))
                    CloudPins.install(relayOrigin, pin); pins.put(relayOrigin, pin); secrets.saveCloudValue("pins", pins.toString())
                }
            }
            entries.put(key, value)
        }
        secrets.saveAppValue("credentials", entries.toString())
        return JSONObject().put("value", entries.opt(key) ?: JSONObject.NULL)
    }
    fun status(): JSONObject {
        val entries = values()
        return JSONObject().put("credentialPresent", entries.keys().asSequence().any { it.startsWith("app-tokens:") })
            .put("refreshCount", refreshes().length())
    }
    @Synchronized fun request(params: JSONObject): JSONObject {
        val login = login(); val host = login.getString("host"); val issuer = login.getString("issuer")
        val target = params.getString("url"); val method = params.optString("method", "GET")
        require(cloudAppRouteAllowed(target, method, host, issuer))
        if (target == "$host/personal/v1/cloud/config" && method == "GET")
            return JSONObject().put("status", 200).put("body", login.getJSONObject("config"))
        val targetUrl = URL(target)
        val hostTrust = cloudAppHostTrustRoute(target, host)
        val hostContent = hostTrust || target in setOf("$host/personal/v1/auth/cloud-session", "$host/personal/v1/cloud/pairings/redeem")
        if (hostContent && !CloudPins.has(host) && !(BuildConfig.DEBUG && targetUrl.protocol == "http" && targetUrl.host in setOf("localhost", "127.0.0.1")))
            throw ApiFailure(403, "PAIRING_REQUIRED")
        val headers = params.optJSONObject("headers") ?: JSONObject()
        require(headers.keys().asSequence().all { it.lowercase() in setOf("content-type", "dpop", "authorization") ||
            hostTrust && it.equals("x-weftmate-csrf", true) })
        val nativeHost = if (hostTrust) secrets.host()?.takeIf { it.origin == host }
            ?: throw ApiFailure(401, "LOGIN_REQUIRED") else null
        val connection = targetUrl.openPinnedConnection()
        var previousHandle: String? = null
        try {
            connection.instanceFollowRedirects = false; connection.requestMethod = method
            connection.connectTimeout = 12000; connection.readTimeout = 20000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Origin", if (target.startsWith(issuer.removeSuffix("/oidc"))) "${URL(issuer).protocol}://${URL(issuer).authority}" else host)
            for (name in headers.keys()) if (!name.equals("x-weftmate-csrf", true)) connection.setRequestProperty(name, headers.getString(name))
            for ((name, value) in cookies.get(URI(target), emptyMap())) connection.setRequestProperty(name, value.joinToString("; "))
            if (nativeHost != null) {
                // Never use the page's sentinel or a JavaScript-supplied host credential.
                connection.setRequestProperty("Cookie", nativeHost.cookie)
                connection.setRequestProperty("X-WeftMate-CSRF", nativeHost.csrf)
                connection.setRequestProperty("Origin", nativeHost.origin)
            }
            if (params.has("body")) {
                var text = params.getString("body")
                if (target == "$issuer/token") {
                    val fields = text.split('&').map { field -> field.split('=', limit = 2).let {
                        URLDecoder.decode(it[0], "UTF-8") to URLDecoder.decode(it.getOrElse(1) { "" }, "UTF-8") } }
                    if (fields.any { it.first == "grant_type" && it.second == "refresh_token" }) {
                        require(fields.count { it.first == "refresh_token" } == 1)
                        previousHandle = fields.single { it.first == "refresh_token" }.second
                        val real = refreshes().optString(previousHandle!!).takeIf { it.isNotBlank() } ?: throw ApiFailure(401, "CLOUD_TOKEN_INVALID")
                        text = fields.joinToString("&") { (name, value) -> URLEncoder.encode(name, "UTF-8") + "=" + URLEncoder.encode(if (name == "refresh_token") real else value, "UTF-8") }
                    }
                }
                val bytes = text.toByteArray(Charsets.UTF_8); require(bytes.size <= 16384)
                connection.doOutput = true; connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            if (status in 300..399) throw ApiFailure(status, "REDIRECT_REFUSED")
            cookies.put(URI(target), connection.headerFields.filterKeys { it != null })
            val source = if (status >= 400) connection.errorStream else connection.inputStream
            val text = source?.use { input ->
                val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096)
                while (true) { val count = input.read(buffer); if (count < 0) break
                    require(output.size() + count <= 1024 * 1024); output.write(buffer, 0, count) }
                output.toString("UTF-8")
            } ?: "{}"
            val body = JSONObject(text)
            if (status == 200 && target == "$issuer/token" && body.has("refresh_token")) {
                val handle = "wm-refresh:" + UUID.randomUUID(); val handles = refreshes()
                handles.put(handle, body.getString("refresh_token")); previousHandle?.let { handles.remove(it) }
                secrets.saveAppValue("refreshes", handles.toString()); body.put("refresh_token", handle)
            }
            if (status == 200 && target in setOf("$host/personal/v1/auth/cloud-session", "$host/personal/v1/cloud/pairings/redeem") && body.has("account")) {
                val sessionCookie = connection.headerFields.entries.filter { it.key?.equals("Set-Cookie", true) == true }
                    .flatMap { it.value }.firstOrNull { it.startsWith("wm_personal_session=") }
                val identity = api.cloudIdentity(host, HttpReply(status, body, sessionCookie))
                secrets.saveAppValue("result", JSONObject().put("origin", identity.origin).put("username", identity.username)
                    .put("ownerId", identity.ownerId).put("hostId", identity.hostId).put("deviceId", identity.deviceId)
                    .put("cookie", identity.cookie).put("csrf", identity.csrf).toString())
                body.put("csrfToken", "native")
            }
            return JSONObject().put("status", status).put("body", body)
                .put("nonce", connection.getHeaderField("DPoP-Nonce") ?: JSONObject.NULL)
                .put("retryAfter", connection.getHeaderField("Retry-After") ?: JSONObject.NULL)
        } finally { connection.disconnect() }
    }
    fun hasResult() = secrets.appValue("result") != null
    fun result(): HostIdentity {
        val value = JSONObject(secrets.appValue("result") ?: throw ApiFailure(401, "LOGIN_REQUIRED"))
        return HostIdentity(value.getString("origin"), value.getString("username"), value.getString("ownerId"),
            value.getString("hostId"), value.getString("deviceId"), value.getString("cookie"), value.getString("csrf"))
    }
}
