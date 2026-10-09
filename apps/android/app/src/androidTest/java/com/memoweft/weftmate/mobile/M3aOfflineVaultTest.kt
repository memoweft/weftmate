package com.memoweft.weftmate.mobile

import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.math.BigInteger
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.spec.RSAPublicKeySpec
import java.security.spec.MGF1ParameterSpec
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec
import javax.crypto.spec.GCMParameterSpec

class M3aOfflineVaultTest {
    @Test fun deviceEnvelopeAndCryptographicErasure() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.m3a")
        fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        fun bytes(value: String) = Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        for (fixture in listOf("keystore-wrapped")) {
            val host = HostIdentity("http://127.0.0.1:1", "fixture", "owner-native-$fixture", "host-native", "device-native", "synthetic", "synthetic")
            val vault = OfflineVault(context, host)
            val marker = "m3a-private-source-$fixture-肉桂粉"
            try {
                val jwk = vault.key()
                val public = KeyFactory.getInstance("RSA").generatePublic(RSAPublicKeySpec(BigInteger(1, bytes(jwk.getString("n"))), BigInteger.valueOf(65537)))
                val aad = JSONObject().put("version", 1).put("ownerId", host.ownerId).put("hostId", host.hostId).put("deviceId", host.deviceId)
                val payload = JSONObject().put("generation", 1).put("reset", true).put("remove", JSONArray()).put("hashes", JSONObject())
                    .put("items", JSONArray().put(JSONObject().put("id", "remembered").put("text", marker)))
                    .put("model", JSONObject().put("apiKey", "native-only-secret").put("baseUrl", "https://model.example/v1").put("modelId", "synthetic"))
                val rawKey = ByteArray(32).also { SecureRandom().nextBytes(it) }
                val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
                val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                    init(Cipher.ENCRYPT_MODE, SecretKeySpec(rawKey, "AES"), GCMParameterSpec(128, iv)); updateAAD(aad.toString().toByteArray())
                }
                val wrap = Cipher.getInstance("RSA/ECB/OAEPPadding").apply {
                    init(Cipher.ENCRYPT_MODE, public, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT))
                }
                val envelope = JSONObject().put("aad", b64(aad.toString().toByteArray())).put("iv", b64(iv))
                    .put("wrappedKey", b64(wrap.doFinal(rawKey))).put("ciphertext", b64(cipher.doFinal(payload.toString().toByteArray())))
                val opened = vault.open(envelope, aad)
                assertFalse(opened.getJSONObject("model").has("apiKey"))
                assertEquals(marker, vault.load().getJSONObject("snapshot").getJSONArray("items").getJSONObject(0).getString("text"))
                val value = vault.load().put("turns", JSONArray().put(JSONObject().put("text", marker)))
                vault.save(value)
                for (file in context.noBackupFilesDir.walkTopDown().filter { it.isFile }) {
                    assertFalse(String(file.readBytes()).contains(marker)); assertFalse(String(file.readBytes()).contains("native-only-secret"))
                }
                vault.clear()
                assertTrue(vault.load().isNull("snapshot")); assertEquals(0, vault.load().getJSONArray("turns").length())
                var rejected = false
                try { vault.open(envelope, aad) } catch (_: Exception) { rejected = true }
                assertTrue("old ciphertext cannot be opened after key deletion", rejected)
            } finally { vault.clear() }
        }
    }
}
