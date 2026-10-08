package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.util.Base64
import java.time.Instant

/** Same sorted-key UTF-8 JSON as personal-update/manifest.mjs. Never trusts a key from the feed. */
object SignedUiManifest {
    private fun quote(value: String): String = buildString {
        append('"'); var index = 0
        while (index < value.length) {
            val char = value[index]
            when (char) {
                '"' -> append("\\\""); '\\' -> append("\\\\")
                '\b' -> append("\\b"); '\u000c' -> append("\\f"); '\n' -> append("\\n"); '\r' -> append("\\r"); '\t' -> append("\\t")
                else -> if (char.code < 32 || Character.isSurrogate(char) &&
                    !(Character.isHighSurrogate(char) && index + 1 < value.length && Character.isLowSurrogate(value[index + 1]))) {
                    append("\\u" + char.code.toString(16).padStart(4, '0'))
                } else {
                    append(char)
                    if (Character.isHighSurrogate(char)) { index++; append(value[index]) }
                }
            }
            index++
        }
        append('"')
    }
    fun canonical(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") {
            quote(it) + ":" + canonical(value.get(it))
        }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
        is String -> quote(value)
        is Boolean -> value.toString()
        is Number -> { require(value.toDouble().isFinite() && value.toDouble() == value.toLong().toDouble()); value.toLong().toString() }
        else -> throw IllegalArgumentException("Invalid signed JSON")
    }
    fun verifyBytes(bytes: ByteArray, signature: ByteArray, spki: ByteArray): Boolean {
        val prefix = byteArrayOf(0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00)
        require(spki.size == 44 && spki.copyOfRange(0, 12).contentEquals(prefix) && signature.size == 64)
        val verifier = Ed25519Signer()
        verifier.init(false, Ed25519PublicKeyParameters(spki.copyOfRange(12, 44), 0))
        verifier.update(bytes, 0, bytes.size)
        return verifier.verifySignature(signature)
    }
    private fun compare(a: String, b: String): Int {
        val pattern = Regex("\\d+\\.\\d+\\.\\d+(?:-[A-Za-z0-9.-]+)?")
        require(pattern.matches(a) && pattern.matches(b))
        val av = a.substringBefore('-').split('.').map { it.toLong() }
        val bv = b.substringBefore('-').split('.').map { it.toLong() }
        for (i in 0..2) if (av[i] != bv[i]) return av[i].compareTo(bv[i])
        if (a == b) return 0
        if (!a.contains('-') || !b.contains('-')) return if (a.contains('-')) -1 else 1
        val ap = a.substringAfter('-').split('.'); val bp = b.substringAfter('-').split('.')
        for (i in 0 until maxOf(ap.size, bp.size)) {
            if (i >= ap.size || i >= bp.size) return if (i >= ap.size) -1 else 1
            if (ap[i] == bp[i]) continue
            val an = ap[i].toLongOrNull(); val bn = bp[i].toLongOrNull()
            return if (an != null && bn != null) an.compareTo(bn) else if (an != null || bn != null) if (an != null) -1 else 1 else ap[i].compareTo(bp[i])
        }
        return 0
    }
    fun verify(manifest: JSONObject, keys: JSONObject, nativeVersion: String, nativeCode: Int, channel: String = "stable") {
        val signature = manifest.getJSONObject("signature")
        require(signature.getString("algorithm") == "Ed25519")
        val pem = keys.getString(signature.getString("keyId"))
        val spki = Base64.getDecoder().decode(pem.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").replace(Regex("\\s"), ""))
        val payload = JSONObject(manifest.toString()).apply { remove("signature") }
        require(verifyBytes(canonical(payload).toByteArray(Charsets.UTF_8), Base64.getDecoder().decode(signature.getString("value")), spki))
        require(manifest.getInt("schemaVersion") == 1 && manifest.getString("layer") == "mobile-ui")
        require(manifest.getString("channel") == channel)
        require(manifest.getInt("bridgeVersion") == 1 && manifest.getInt("minNativeVersionCode") <= nativeCode)
        require(manifest.getString("version") == manifest.getString("uiVersion"))
        require(canonical(manifest.getJSONArray("files")) == canonical(manifest.getJSONArray("assets")))
        for ((bound, predicate) in listOf("min" to { n: Int -> n >= 0 }, "max" to { n: Int -> n <= 0 })) {
            if (manifest.has("${bound}NativeVersion")) require(predicate(compare(nativeVersion, manifest.getString("${bound}NativeVersion"))))
        }
        val now = Instant.now()
        require(!Instant.parse(manifest.getString("publishedAt")).isAfter(now.plusSeconds(300)))
        if (manifest.has("expiresAt")) require(Instant.parse(manifest.getString("expiresAt")).isAfter(now))
    }
}
