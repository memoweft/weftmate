package com.memoweft.weftmate.mobile

import java.security.MessageDigest
import java.util.Base64
import org.json.JSONArray

/** JSON.stringify's scalar array encoding: UTF-8, no whitespace or slash/non-ASCII escaping. */
internal fun cloudPairingDigest(values: JSONArray): String {
    require(values.length() in 5..16 && values.optString(0) in setOf("wm-pair-host-v2", "wm-pair-phone-v2", "wm-pair-sas-v2"))
    fun quote(value: String): String = buildString {
        append('"')
        for (c in value) when (c) {
            '"' -> append("\\\""); '\\' -> append("\\\\")
            '\b' -> append("\\b"); '\u000c' -> append("\\f"); '\n' -> append("\\n"); '\r' -> append("\\r"); '\t' -> append("\\t")
            else -> if (c < ' ') append("\\u" + c.code.toString(16).padStart(4, '0')) else append(c)
        }
        append('"')
    }
    val text = (0 until values.length()).joinToString(",", "[", "]") {
        when (val value = values.get(it)) {
            is String -> quote(value)
            is Int, is Long -> value.toString()
            else -> throw IllegalArgumentException("Invalid pairing transcript")
        }
    }
    require(text.toByteArray(Charsets.UTF_8).size <= 16384)
    return cloudBase64(MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)))
}

/** A host's own loopback origin is signed metadata, never the phone's request destination. */
internal fun cloudPairingMetadataOrigin(value: String): String {
    val url = java.net.URI(value)
    require(url.scheme == "https" || url.scheme == "http" && url.host in setOf("127.0.0.1", "localhost", "[::1]"))
    require(url.host != null && url.rawUserInfo == null && url.rawQuery == null && url.rawFragment == null && url.rawPath.isNullOrEmpty())
    return value
}

internal fun cloudBase64(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
internal fun cloudKeyAlias(id: String): String = "weftmate-app-p256-" + cloudBase64(MessageDigest.getInstance("SHA-256").digest(id.toByteArray()))

internal fun requireLegacyCloudRequestWithoutToken(target: String, issuer: String) {
    if (target == "$issuer/token") throw ApiFailure(409, "NATIVE_LOGIN_UPGRADE_REQUIRED")
}
internal fun requireLegacyCloudTokensClear(hasValue: Boolean, value: String?) {
    if (!hasValue || value != "") throw ApiFailure(409, "NATIVE_LOGIN_UPGRADE_REQUIRED")
}
internal fun mobileUiNativeLoginCompatible(minNative: Int, nativeVersion: Int): Boolean =
    minNative >= 21 && minNative <= nativeVersion
internal fun mobileUiNeedsNativeLoginUpgrade(recordedVersion: Int, nativeVersion: Int): Boolean =
    nativeVersion >= 21 && recordedVersion < 21

/** Android SHA256withECDSA emits ASN.1 DER; JOSE ES256 requires exactly 32-byte r followed by s. */
internal fun cloudJoseSignature(der: ByteArray): ByteArray {
    require(der.size in 8..72 && der[0] == 0x30.toByte() && (der[1].toInt() and 255) == der.size - 2)
    var offset = 2
    fun integer(): ByteArray {
        require(offset + 2 <= der.size && der[offset++] == 2.toByte())
        val count = der[offset++].toInt() and 255
        require(count in 1..33 && offset + count <= der.size)
        val value = der.copyOfRange(offset, offset + count); offset += count
        require(value[0].toInt() >= 0)
        val start = if (count == 33) { require(value[0] == 0.toByte()); 1 } else 0
        val output = ByteArray(32)
        value.copyInto(output, 32 - (count - start), start)
        return output
    }
    val result = integer() + integer()
    require(offset == der.size)
    return result
}

internal fun cloudAppHostTrustRoute(target: String, host: String): Boolean =
    target.startsWith(host + "/personal/v1/cloud/devices/") &&
        target.removePrefix(host).matches(Regex("/personal/v1/cloud/devices/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/trust"))

internal fun cloudAppFailure(error: Exception): ApiFailure = when(error) {
    is ApiFailure -> error
    is org.json.JSONException -> ApiFailure(502, "CLOUD_RESPONSE_INVALID")
    is IllegalArgumentException -> ApiFailure(400, "CLOUD_REQUEST_INVALID")
    is javax.net.ssl.SSLException -> ApiFailure(503, "CLOUD_TLS_UNAVAILABLE")
    is java.net.SocketTimeoutException -> ApiFailure(504, "CLOUD_TIMEOUT")
    else -> ApiFailure(503, "CLOUD_TRANSPORT_UNAVAILABLE")
}

internal fun cloudAppRequestBody(target: String, method: String, issuer: String, text: String): ByteArray {
    val bytes = text.toByteArray(Charsets.UTF_8)
    // Match the cloud's task submit budget: a 64 KiB encrypted envelope plus
    // its routing fields. Account and other task requests keep the 16 KiB cap.
    val limit = if (method == "POST" && target == issuer.removeSuffix("/oidc") + "/hosts/offline/tasks/submit")
        70 * 1024 else 16384
    require(bytes.size <= limit)
    return bytes
}

internal fun cloudAppRouteAllowed(target: String, method: String, host: String, issuer: String): Boolean {
    if (method !in setOf("GET", "POST")) return false
    val cloud = issuer.removeSuffix("/oidc")
    if (method == "GET" && target in setOf("$issuer/jwks", "$cloud/devices")) return true
    if (method == "GET" && target == "$host/personal/v1/cloud/config") return true
    if (method != "POST") return false
    if (cloudAppHostTrustRoute(target, host)) return true
    if (target in setOf("$issuer/token", "$issuer/token/revocation")) return true
    val cloudPaths = setOf("/auth/authorization", "/auth/login", "/auth/device/confirm", "/auth/authorization/resume",
        "/auth/registration/request", "/auth/registration/verify", "/auth/registration/complete",
        "/auth/recovery/request", "/auth/recovery/verify", "/auth/recovery/complete", "/auth/password/change",
        "/auth/login/code/request", "/auth/login/code/confirm", "/hosts/offline/status", "/feedback",
        "/hosts/offline/tasks/submit", "/hosts/offline/tasks/list", "/hosts/offline/tasks/cancel", "/hosts/offline/tasks/clear",
        "/auth/logout", "/auth/logout/others", "/auth/account/delete", "/auth/email/change/request",
        "/auth/email/change/confirm", "/auth/devices/revoke", "/devices/rename", "/hosts/connect", "/hosts/rename", "/hosts/remove")
    return cloudPaths.any { target == cloud + it } || setOf("/auth/cloud-nonce", "/auth/cloud-session", "/auth/cloud-channel",
        "/cloud/pairings/join", "/cloud/pairings/reveal", "/cloud/pairings/redeem").any { target == "$host/personal/v1$it" }
}
