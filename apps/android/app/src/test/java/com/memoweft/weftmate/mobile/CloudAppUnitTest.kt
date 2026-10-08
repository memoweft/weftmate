package com.memoweft.weftmate.mobile

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec

class CloudAppUnitTest {
    private val host = "https://host.example.com"
    private val issuer = "https://cloud.example.com/personal/v1/cloud/oidc"
    @Test fun fixedOriginsAndExactCloudAccountRoutes() {
        for (path in listOf("auth/authorization", "auth/registration/request", "auth/recovery/complete",
            "auth/account/delete", "auth/email/change/confirm", "auth/logout/others", "devices/rename", "hosts/connect"))
            assertTrue(path, cloudAppRouteAllowed("https://cloud.example.com/personal/v1/cloud/$path", "POST", host, issuer))
        assertTrue(cloudAppRouteAllowed("$issuer/token", "POST", host, issuer))
        assertTrue(cloudAppRouteAllowed("$issuer/jwks", "GET", host, issuer))
        assertTrue(cloudAppRouteAllowed("$host/personal/v1/auth/cloud-session", "POST", host, issuer))
        val trustPath = "$host/personal/v1/cloud/devices/00000000-0000-4000-8000-000000000000/trust"
        assertTrue(cloudAppRouteAllowed(trustPath, "POST", host, issuer))
        assertFalse(cloudAppRouteAllowed(trustPath, "GET", host, issuer))
        assertFalse(cloudAppRouteAllowed(trustPath + "?extra=1", "POST", host, issuer))
        assertFalse(cloudAppRouteAllowed(trustPath.replace(host, "https://evil.example.com"), "POST", host, issuer))
        assertFalse(cloudAppRouteAllowed(trustPath.replace("00000000-0000-4000-8000-000000000000", "invalid"), "POST", host, issuer))
        for (bad in listOf("https://evil.example.com/personal/v1/cloud/auth/login", "$issuer/token?extra=1",
            "$host/personal/v1/sessions", "https://cloud.example.com/personal/v1/cloud/auth/login#fragment",
            "https://cloud.example.com/personal/v1/cloud/auth/../auth/login"))
            assertFalse(bad, cloudAppRouteAllowed(bad, "POST", host, issuer))
        assertFalse(cloudAppRouteAllowed("$issuer/token", "DELETE", host, issuer))
        assertFalse(cloudAppRouteAllowed("$issuer/token", "GET", host, issuer))
    }
    @Test fun nativeEcdsaSignatureIsVerifiableJoseRaw64() {
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val message = "synthetic-header.synthetic-payload".toByteArray()
        repeat(40) {
            val der = Signature.getInstance("SHA256withECDSA").apply { initSign(pair.private); update(message) }.sign()
            val raw = cloudJoseSignature(der)
            assertEquals(64, raw.size)
            assertEquals(86, cloudBase64(raw).length)
            // Independent Java P1363 verifier consumes the same wire bytes as JOSE.
            assertTrue(Signature.getInstance("SHA256withECDSAinP1363Format").apply {
                initVerify(pair.public); update(message)
            }.verify(raw))
        }
    }
    @Test fun malformedSignaturesFailAndAliasesDoNotExposeAccountOrIssuer() {
        for (bad in listOf(byteArrayOf(), byteArrayOf(48, 6, 2, 1, -1, 2, 1, 1), byteArrayOf(48, 6, 2, 2, 1, 2, 1, 1)))
            assertThrows(IllegalArgumentException::class.java) { cloudJoseSignature(bad) }
        assertEquals(cloudKeyAlias(issuer), cloudKeyAlias(issuer))
        assertNotEquals(cloudKeyAlias(issuer), cloudKeyAlias(issuer + "different"))
        assertFalse(cloudKeyAlias(issuer).contains("example.com"))
    }
}
