package com.memoweft.weftmate.mobile

import java.security.MessageDigest
import java.util.Base64

internal fun cloudBase64(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
internal fun cloudKeyAlias(id: String): String = "weftmate-app-p256-" + cloudBase64(MessageDigest.getInstance("SHA-256").digest(id.toByteArray()))

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
        "/auth/logout", "/auth/logout/others", "/auth/account/delete", "/auth/email/change/request",
        "/auth/email/change/confirm", "/auth/devices/revoke", "/devices/rename", "/hosts/connect")
    return cloudPaths.any { target == cloud + it } || setOf("/auth/cloud-nonce", "/auth/cloud-session",
        "/cloud/pairings/redeem").any { target == "$host/personal/v1$it" }
}
