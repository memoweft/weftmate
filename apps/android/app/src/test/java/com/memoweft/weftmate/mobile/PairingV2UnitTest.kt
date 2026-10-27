package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.util.Base64

class PairingV2UnitTest {
    private fun vector(): JSONObject {
        val root = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .first { File(it, "tests/fixtures/pairing-v2.json").isFile }
        return JSONObject(File(root, "tests/fixtures/pairing-v2.json").readText())
    }
    private fun array(vararg items: Any): JSONArray = JSONArray().apply { items.forEach { put(it) } }
    @Test fun fixedVectorMatchesDesktopCommitmentsAndSixDigitNumber() {
        val v = vector(); val transcript = v.getJSONArray("transcript")
        fun withTranscript(domain: String, vararg tail: Any): JSONArray = array(domain).apply {
            for (i in 0 until transcript.length()) put(transcript.get(i))
            tail.forEach { put(it) }
        }
        assertEquals(v.getString("hostCommitment"), cloudPairingDigest(withTranscript("wm-pair-host-v2", v.getString("hostNonce"))))
        assertEquals(v.getString("phoneCommitment"), cloudPairingDigest(array("wm-pair-phone-v2", transcript.getString(6),
            v.getString("deviceId"), v.getString("phoneJkt"), v.getString("phoneNonce"))))
        val sas = cloudPairingDigest(withTranscript("wm-pair-sas-v2", v.getString("hostNonce"), v.getString("deviceId"), v.getString("phoneJkt"), v.getString("phoneNonce")))
        val unsigned = ByteBuffer.wrap(Base64.getUrlDecoder().decode(sas)).int.toLong() and 0xffffffffL
        assertEquals(v.getString("verificationCode"), (unsigned % 1000000).toString().padStart(6, '0'))
    }
    @Test fun canonicalJsonKeepsUnicodeAndSlashesAndEscapesControlCharacters() {
        // Computed independently with Node JSON.stringify + SHA-256.
        assertEquals("JGDSbT2ILABKpXz87ve7US0HgzJSbaYBNYa1jpTvcrE", cloudPairingDigest(array("wm-pair-phone-v2", "中文😀</a>", "a\"b\\c\n\t\u0000", "手机", "nonce")))
    }
    @Test fun pairingTransportAllowsOnlyThreeExactPostRoutesOutsideBusinessBridge() {
        val host = "https://relay.example.test"
        val issuer = "https://cloud.example.test/personal/v1/cloud/oidc"
        for (action in listOf("join", "reveal", "redeem")) {
            val path = "/personal/v1/cloud/pairings/$action"
            val target = host + path
            assertTrue(cloudAppRouteAllowed(target, "POST", host, issuer)); assertFalse(validBusinessPath(path))
            for (method in listOf("GET", "PUT", "DELETE", "post")) assertFalse(cloudAppRouteAllowed(target, method, host, issuer))
            for (bad in listOf(target + "/", target + "?other=1", target + "#fragment", target.replace("relay.example.test", "evil.example.test")))
                assertFalse(cloudAppRouteAllowed(bad, "POST", host, issuer))
        }
        for (action in listOf("status", "decision")) assertFalse(cloudAppRouteAllowed("$host/personal/v1/cloud/pairings/$action", "POST", host, issuer))
    }
    @Test fun signedLoopbackOriginIsMetadataAndDoesNotWidenNetworkDestinations() {
        assertEquals("http://127.0.0.1:12345", cloudPairingMetadataOrigin("http://127.0.0.1:12345"))
        assertEquals("https://computer.example.test", cloudPairingMetadataOrigin("https://computer.example.test"))
        for (bad in listOf("http://evil.example.test", "https://user@computer.example.test", "https://computer.example.test/path", "https://computer.example.test?x=1", "https://computer.example.test#x"))
            assertThrows(IllegalArgumentException::class.java) { cloudPairingMetadataOrigin(bad) }
    }
}
