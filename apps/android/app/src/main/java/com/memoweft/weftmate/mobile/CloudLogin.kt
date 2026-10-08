package com.memoweft.weftmate.mobile

import org.json.JSONObject
import java.net.URL
import java.net.HttpURLConnection
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import android.util.Base64

internal const val CLOUD_CALLBACK = "com.memoweft.weftmate:/oauth"
internal fun cloudCallbackMatches(value: String, expectedState: String): Boolean = try {
    val uri = java.net.URI(value)
    val query = uri.rawQuery?.split('&')?.map {
        val split = it.split('=', limit = 2)
        java.net.URLDecoder.decode(split[0], "UTF-8") to java.net.URLDecoder.decode(split.getOrElse(1) { "" }, "UTF-8")
    } ?: emptyList()
    uri.scheme == "com.memoweft.weftmate" && uri.rawAuthority == null && uri.path == "/oauth" && uri.fragment == null &&
        expectedState.isNotEmpty() && query.count { it.first == "state" } == 1 &&
        query.first { it.first == "state" }.second == expectedState &&
        (query.count { it.first == "code" } == 1 || query.count { it.first == "error" } == 1)
} catch (_: Exception) { false }

/** Pins come only from an entered, locally issued pairing code. The normal CA check runs first. */
internal object CloudPins {
    private val pins = ConcurrentHashMap<String, String>()
    fun install(origin: String, pin: String) {
        require(pin.matches(Regex("[A-Za-z0-9_-]{43}")))
        pins[origin] = pin
    }
    fun clear(origin: String) { pins.remove(origin) }
    fun has(origin: String): Boolean = pins.containsKey(origin)
    fun open(url: URL): HttpURLConnection {
        val connection = url.openConnection() as HttpURLConnection
        val pin = pins["${url.protocol}://${url.authority}"] ?: return connection
        if (url.protocol != "https") {
            require(BuildConfig.DEBUG && url.host in setOf("localhost", "127.0.0.1"))
            return connection
        }
        val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        factory.init(null as KeyStore?)
        val standard = factory.trustManagers.filterIsInstance<X509TrustManager>().single()
        val trust = object : X509TrustManager {
            override fun getAcceptedIssuers(): Array<X509Certificate> = standard.acceptedIssuers
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = standard.checkClientTrusted(chain, authType)
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                standard.checkServerTrusted(chain, authType)
                val actual = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(chain[0].publicKey.encoded),
                    Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
                if (actual != pin) throw java.security.cert.CertificateException("HOST_PIN_MISMATCH")
            }
        }
        val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), null) }
        (connection as HttpsURLConnection).sslSocketFactory = tls.socketFactory
        return connection
    }
}
internal fun URL.openPinnedConnection(): HttpURLConnection = CloudPins.open(this)

/** Small native adapter: system authentication browser, fixed cloud/host endpoints, encrypted refresh storage. */
internal class CloudLogin(private val secrets: SecureSettings, private val api: PersonalApi) {
    fun configure(originInput: String, pin: String): JSONObject {
        val origin = Endpoints.hostOrigin(originInput)
        val trusted = JSONObject(secrets.cloudValue("pins") ?: "{}")
        if (trusted.has(origin) && trusted.getString(origin) != pin) throw ApiFailure(403, "HOST_PIN_MISMATCH")
        CloudPins.install(origin, pin)
        secrets.saveCloudValue("result", null)
        val config = JsonHttp().request("$origin/personal/v1/cloud/config", "GET").body
        val issuer = config.getString("issuer")
        val url = URL(issuer)
        require(Endpoints.allowedProtocol(url) && url.path == "/personal/v1/cloud/oidc" && url.userInfo == null && url.query == null && url.ref == null)
        val login = JSONObject().put("host", origin).put("issuer", issuer).put("pin", pin)
        secrets.saveCloudValue("login", login.toString())
        return config
    }
    fun request(params: JSONObject): JSONObject {
        val login = JSONObject(secrets.cloudValue("login") ?: throw ApiFailure(401, "LOGIN_REQUIRED"))
        val target = params.getString("url")
        val host = login.getString("host")
        val issuer = login.getString("issuer")
        requireLegacyCloudRequestWithoutToken(target, issuer)
        val method = params.optString("method", "GET")
        require(method in setOf("GET", "POST"))
        val hostRoutes = setOf("/cloud/config", "/auth/cloud-nonce", "/auth/cloud-session", "/cloud/pairings/redeem")
        require(hostRoutes.any { target == "$host/personal/v1$it" } || target in setOf("$issuer/token", "$issuer/jwks"))
        val headers = params.optJSONObject("headers") ?: JSONObject()
        require(headers.keys().asSequence().all { it.lowercase() in setOf("content-type", "dpop") })
        val connection = URL(target).openPinnedConnection()
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = method
            connection.connectTimeout = 12000; connection.readTimeout = 20000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Origin", if (target.startsWith(issuer)) "${URL(issuer).protocol}://${URL(issuer).authority}" else host)
            for (name in headers.keys()) connection.setRequestProperty(name, headers.getString(name))
            if (params.has("body")) {
                val bytes = params.getString("body").toByteArray(Charsets.UTF_8)
                require(bytes.size <= 16384)
                connection.doOutput = true; connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            if (status in 300..399) throw ApiFailure(status, "REDIRECT_REFUSED")
            val source = if (status >= 400) connection.errorStream else connection.inputStream
            val text = source?.use { stream ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(4096)
                while (true) {
                    val size = stream.read(buffer)
                    if (size < 0) break
                    require(output.size() + size <= 1024 * 1024)
                    output.write(buffer, 0, size)
                }
                String(output.toByteArray(), Charsets.UTF_8)
            } ?: "{}"
            val body = JSONObject(text)
            if (status == 200 && target in setOf("$host/personal/v1/auth/cloud-session", "$host/personal/v1/cloud/pairings/redeem")) {
                val identity = api.cloudIdentity(host, HttpReply(status, body, connection.getHeaderField("Set-Cookie")))
                secrets.saveCloudValue("result", JSONObject().put("origin", identity.origin).put("username", identity.username)
                    .put("ownerId", identity.ownerId).put("hostId", identity.hostId).put("deviceId", identity.deviceId)
                    .put("cookie", identity.cookie).put("csrf", identity.csrf).toString())
            }
            return JSONObject().put("status", status).put("body", body)
                .put("nonce", connection.getHeaderField("DPoP-Nonce") ?: JSONObject.NULL)
        } finally { connection.disconnect() }
    }
    fun result(): HostIdentity {
        val value = JSONObject(secrets.cloudValue("result") ?: throw ApiFailure(401, "LOGIN_REQUIRED"))
        return HostIdentity(value.getString("origin"), value.getString("username"), value.getString("ownerId"),
            value.getString("hostId"), value.getString("deviceId"), value.getString("cookie"), value.getString("csrf"))
    }
    fun tokens(params: JSONObject): JSONObject {
        requireLegacyCloudTokensClear(params.has("value"), params.optString("value", ""))
        secrets.saveCloudValue("tokens", null)
        return JSONObject().put("value", JSONObject.NULL)
    }
}
