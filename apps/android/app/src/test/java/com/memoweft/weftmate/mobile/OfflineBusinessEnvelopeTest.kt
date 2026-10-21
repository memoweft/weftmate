package com.memoweft.weftmate.mobile

import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class OfflineBusinessEnvelopeTest {
    private fun urlBase64(bytes: ByteArray): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    private fun urlDecode(value: String): ByteArray =
        Base64.getUrlDecoder().decode(value)

    @Test fun offlineSyncEnvelopeKeepsLargeCiphertextByteExact() {
        val key = ByteArray(32).also(SecureRandom()::nextBytes)
        val iv = ByteArray(12).also(SecureRandom()::nextBytes)
        val aad = "weftmate-offline-envelope-v1".toByteArray(StandardCharsets.UTF_8)
        val payload = JSONObject()
            .put("taskRecipient", JSONObject().put("hostId", "host-synthetic"))
            .put("taskReferences", org.json.JSONArray().put("session-synthetic").put("memory-synthetic"))
            .put("recent", "最近的离线任务上下文" + "x".repeat(32_000))
            .toString().toByteArray(StandardCharsets.UTF_8)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            updateAAD(aad)
        }
        val ciphertext = cipher.doFinal(payload)
        val envelope = JSONObject()
            .put("version", 1)
            .put("algorithm", "RSA-OAEP-256+A256GCM")
            .put("aad", urlBase64(aad))
            .put("wrappedKey", urlBase64("synthetic-wrapped-key".toByteArray(StandardCharsets.UTF_8)))
            .put("iv", urlBase64(iv))
            .put("ciphertext", urlBase64(ciphertext))
            .put("apiKey", "unexpected-plaintext-must-not-cross")

        val projected = nativeBusinessResponse("/personal/v1/offline/sync", envelope)
        val projectedCiphertext = urlDecode(projected.getString("ciphertext"))
        assertTrue("the encrypted offline payload must pass through unchanged", projectedCiphertext.contentEquals(ciphertext))
        assertFalse(projected.has("apiKey"))

        val decipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            updateAAD(aad)
        }
        val restored = JSONObject(String(decipher.doFinal(projectedCiphertext), StandardCharsets.UTF_8))
        assertEquals("host-synthetic", restored.getJSONObject("taskRecipient").getString("hostId"))
        assertTrue(restored.getString("recent").length > 30_000)
    }

    @Test fun ordinaryBusinessProjectionStillTruncatesAndFiltersSecrets() {
        val projected = nativeBusinessResponse(
            "/personal/v1/status",
            JSONObject().put("text", "z".repeat(20_000)).put("apiKey", "must-not-cross")
        )
        assertEquals(16_384, projected.getString("text").length)
        assertFalse(projected.has("apiKey"))
        val nonExact = nativeBusinessResponse(
            "/personal/v1/offline",
            JSONObject().put("text", "z".repeat(20_000))
        )
        assertEquals(16_384, nonExact.getString("text").length)
    }

    @Test fun businessHttpResponseLimitKeepsExistingPreviewAndDefaultBounds() {
        assertEquals(28 * 1024 * 1024, businessHttpResponseLimit("/personal/v1/library/file-1/preview"))
        assertEquals(nativeBusinessResponseLimit("/personal/v1/offline/sync"), businessHttpResponseLimit("/personal/v1/offline/sync"))
        assertEquals(1024 * 1024, businessHttpResponseLimit("/personal/v1/offline/sync/raw"))
        assertEquals(1024 * 1024, businessHttpResponseLimit("/personal/v1/library/file-1/preview/raw"))
    }
}
