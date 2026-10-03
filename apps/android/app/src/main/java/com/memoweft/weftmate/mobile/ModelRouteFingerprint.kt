package com.memoweft.weftmate.mobile

import java.net.URI
import java.security.MessageDigest
import java.util.Locale

/** Non-secret identity of an actual public model request route and exact model ID. */
internal fun modelRouteFingerprint(endpoint: String, modelId: String): String? {
    if (!modelId.matches(Regex("[A-Za-z0-9._:/-]{1,128}"))) return null
    val uri = try { URI(endpoint) } catch (_: Exception) { return null }
    val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
    if (scheme !in setOf("https", "http") || uri.userInfo != null ||
        uri.rawQuery != null || uri.rawFragment != null) return null
    val host = uri.host?.lowercase(Locale.ROOT)?.removePrefix("[")?.removeSuffix("]") ?: return null
    if (!host.contains('.') || !host.matches(Regex("[a-z0-9.-]+")) ||
        host.split('.').any { it.isEmpty() || it.startsWith('-') || it.endsWith('-') } ||
        host.matches(Regex("[0-9.]+")) ||
        Regex("(?:^|\\.)(?:localhost|local|internal|lan|home|test|invalid|example|arpa)$")
            .containsMatchIn(host)) return null
    val port = uri.port
    if (port < -1 || port > 65535) return null
    val canonicalPort = if (port == -1 || scheme == "https" && port == 443 ||
        scheme == "http" && port == 80) "" else ":$port"
    var path = (uri.rawPath ?: "").trimEnd('/')
    if (path.endsWith("/v1")) path += "/chat/completions"
    if (!path.endsWith("/chat/completions") || !path.matches(Regex("/[A-Za-z0-9._/-]+"))) return null
    val canonical = "$scheme://$host$canonicalPort$path"
    val payload = "weftmate-model-route/v1\n$canonical\n$modelId"
    return MessageDigest.getInstance("SHA-256").digest(payload.toByteArray(Charsets.UTF_8))
        .joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
}
