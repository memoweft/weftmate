package com.memoweft.weftmate.mobile

import org.json.JSONObject
import java.math.BigInteger
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.security.spec.RSAPublicKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/** The existing S7 RSA-OAEP-256 + AES-256-GCM wire format; no private key crosses the bridge. */
internal fun sealOfflineTask(payload: JSONObject, publicJwk: JSONObject, identity: JSONObject): JSONObject {
    require(publicJwk.getString("kty")=="RSA" && publicJwk.getString("e")=="AQAB")
    val modulus=Base64.getUrlDecoder().decode(publicJwk.getString("n"))
    require(modulus.size==256)
    val canonical="{\"kty\":\"RSA\",\"n\":"+JSONObject.quote(publicJwk.getString("n"))+",\"e\":\"AQAB\"}"
    val keyId=MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}
    val header=JSONObject(identity.toString()).put("version",1).put("keyId",keyId)
    val aad=header.toString().toByteArray(Charsets.UTF_8)
    val random=SecureRandom();val raw=ByteArray(32).also(random::nextBytes);val iv=ByteArray(12).also(random::nextBytes)
    fun encoded(bytes:ByteArray)=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    try {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE,SecretKeySpec(raw,"AES"),GCMParameterSpec(128,iv));cipher.updateAAD(aad)
        val ciphertext=cipher.doFinal(payload.toString().toByteArray(Charsets.UTF_8))
        val rsa=Cipher.getInstance("RSA/ECB/OAEPPadding")
        val recipient=KeyFactory.getInstance("RSA").generatePublic(RSAPublicKeySpec(BigInteger(1,modulus),BigInteger.valueOf(65537)))
        rsa.init(Cipher.ENCRYPT_MODE,recipient,OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA256,PSource.PSpecified.DEFAULT))
        return JSONObject().put("version",1).put("algorithm","RSA-OAEP-256+A256GCM").put("aad",encoded(aad))
            .put("wrappedKey",encoded(rsa.doFinal(raw))).put("iv",encoded(iv)).put("ciphertext",encoded(ciphertext))
    } finally { raw.fill(0) }
}
