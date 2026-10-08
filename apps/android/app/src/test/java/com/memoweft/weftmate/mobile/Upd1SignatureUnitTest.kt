package com.memoweft.weftmate.mobile

import org.junit.Test
import org.junit.Assert.*
import java.security.KeyPairGenerator
import java.security.Signature

class Upd1SignatureUnitTest {
    @Test fun ed25519AcceptsOnlyOriginalBytesAndKey() {
        val pair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val wrong = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val bytes = "签名清单 / 😀\n".toByteArray(Charsets.UTF_8)
        val signature = Signature.getInstance("Ed25519").apply { initSign(pair.private); update(bytes) }.sign()
        assertTrue(SignedUiManifest.verifyBytes(bytes, signature, pair.public.encoded))
        assertFalse(SignedUiManifest.verifyBytes("tampered".toByteArray(), signature, pair.public.encoded))
        assertFalse(SignedUiManifest.verifyBytes(bytes, signature, wrong.public.encoded))
        signature[0] = (signature[0].toInt() xor 1).toByte()
        assertFalse(SignedUiManifest.verifyBytes(bytes, signature, pair.public.encoded))
    }
}
