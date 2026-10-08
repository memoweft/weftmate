package com.memoweft.weftmate.mobile

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.UUID

internal class CloudAppKeys(private val secrets: SecureSettings) {
    private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    @Synchronized fun get(id: String, clear: Boolean = false): JSONObject {
        require(id.isNotBlank() && id.length <= 2048)
        val alias = cloudKeyAlias(id)
        val metadata = "key:$alias"
        val store = store()
        if (clear) {
            if (store.containsAlias(alias)) store.deleteEntry(alias)
            secrets.saveAppValue(metadata, null)
            return JSONObject().put("cleared", true)
        }
        if (!store.containsAlias(alias)) {
            fun generate(strongBox: Boolean) {
                val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                if (strongBox && Build.VERSION.SDK_INT >= 28) builder.setIsStrongBoxBacked(true)
                KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                    initialize(builder.build()); generateKeyPair()
                }
            }
            if (Build.VERSION.SDK_INT >= 28) try { generate(true) } catch (_: java.security.ProviderException) { generate(false) }
            else generate(false)
        }
        val public = store.getCertificate(alias).publicKey as ECPublicKey
        fun coordinate(value: java.math.BigInteger): String {
            val bytes = value.toByteArray()
            val raw = if (bytes.size > 32) bytes.copyOfRange(bytes.size - 32, bytes.size) else ByteArray(32 - bytes.size) + bytes
            return cloudBase64(raw)
        }
        val deviceId = secrets.appValue(metadata) ?: ("android-" + UUID.randomUUID()).also { secrets.saveAppValue(metadata, it) }
        return JSONObject().put("deviceId", deviceId).put("publicJwk", JSONObject().put("kty", "EC").put("crv", "P-256")
            .put("x", coordinate(public.w.affineX)).put("y", coordinate(public.w.affineY)))
    }
    @Synchronized fun sign(id: String, input: String): JSONObject {
        require(input.length in 1..16384)
        get(id)
        val private = store().getKey(cloudKeyAlias(id), null) as java.security.PrivateKey
        val signature = Signature.getInstance("SHA256withECDSA").apply {
            initSign(private); update(input.toByteArray(Charsets.UTF_8))
        }.sign()
        return JSONObject().put("signature", cloudBase64(cloudJoseSignature(signature)))
    }
}
