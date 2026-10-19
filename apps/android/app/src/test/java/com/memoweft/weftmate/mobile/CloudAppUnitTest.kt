package com.memoweft.weftmate.mobile

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec

class CloudAppUnitTest {
    @Test fun computerManagementUsesExactCloudRoutesAndChannelUsesTheSelectedComputer() {
        for (path in listOf("/personal/v1/cloud/hosts/rename", "/personal/v1/cloud/hosts/remove")) {
            val url = "https://cloud.example.com$path"
            assertTrue(cloudAppRouteAllowed(url, "POST", host, issuer))
            assertFalse(validBusinessPath(path))
            for (method in listOf("GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "post")) assertFalse(cloudAppRouteAllowed(url, method, host, issuer))
            for (bad in listOf(url + "/raw", url + "?other=1", url + "#fragment", url.replace("/hosts/", "/hosts%2F"), url.replace("cloud.example.com", "evil.example.com"))) assertFalse(cloudAppRouteAllowed(bad, "POST", host, issuer))
        }
        val channel = "$host/personal/v1/auth/cloud-channel"
        assertTrue(cloudAppRouteAllowed(channel, "POST", host, issuer))
        assertFalse(cloudAppRouteAllowed(channel, "GET", host, issuer))
        assertFalse(cloudAppRouteAllowed(channel.replace(host, "https://evil.example.com"), "POST", host, issuer))
    }
    private val host = "https://host.example.com"
    private val issuer = "https://cloud.example.com/personal/v1/cloud/oidc"
    @Test fun taskSubmitBodyBudgetMatchesCloudAndDoesNotWidenOtherRoutes(){
        val submit=issuer.removeSuffix("/oidc")+"/hosts/offline/tasks/submit"
        assertEquals(70*1024,cloudAppRequestBody(submit,"POST",issuer,"x".repeat(70*1024)).size)
        assertThrows(IllegalArgumentException::class.java){cloudAppRequestBody(submit,"POST",issuer,"x".repeat(70*1024+1))}
        val large="x".repeat(16385)
        for(target in listOf(submit+"/",submit+"?extra=1",submit+"#fragment",submit+"-other",
            submit.replace("/tasks/","/tasks%2F"),submit.replace("cloud.example.com","evil.example.com"),
            submit.replace("/submit","/list"),submit.replace("/submit","/cancel"),submit.replace("/submit","/clear"),
            "$issuer/token",issuer.removeSuffix("/oidc")+"/auth/login")){
            assertThrows(target,IllegalArgumentException::class.java){cloudAppRequestBody(target,"POST",issuer,large)}
        }
        for(method in listOf("GET","PUT","post"))
            assertThrows(method,IllegalArgumentException::class.java){cloudAppRequestBody(submit,method,issuer,large)}
    }
    @Test fun ordinaryCloudBodyBudgetStillCountsUtf8Bytes(){
        val target="$issuer/token"
        assertEquals(16384,cloudAppRequestBody(target,"POST",issuer,"x".repeat(16384)).size)
        assertThrows(IllegalArgumentException::class.java){cloudAppRequestBody(target,"POST",issuer,"任".repeat(5462))}
    }
    @Test fun offlinePhoneTasksUseOnlyFourExactCloudPostRoutes() {
        for (action in listOf("submit", "list", "cancel", "clear")) {
            val path = "/personal/v1/cloud/hosts/offline/tasks/$action"
            val url = "https://cloud.example.com$path"
            assertTrue(url, cloudAppRouteAllowed(url, "POST", host, issuer))
            for (method in listOf("GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "post"))
                assertFalse(method, cloudAppRouteAllowed(url, method, host, issuer))
            for (bad in listOf(url + "/raw", url + "/", url + "-other", url + "?ownerId=other", url + "#fragment",
                url.replace("/tasks/", "/task/"), url.replace("/tasks/", "/tasks%2F"),
                url.replace("/tasks/", "/tasks/../tasks/"), url.replace("cloud.example.com", "evil.example.com"),
                "$host$path"))
                assertFalse(bad, cloudAppRouteAllowed(bad, "POST", host, issuer))
            assertFalse(path, validBusinessPath(path))
        }
        for (action in listOf("claim", "ack", "result", "all"))
            assertFalse(action, cloudAppRouteAllowed("https://cloud.example.com/personal/v1/cloud/hosts/offline/tasks/$action", "POST", host, issuer))
    }
    @Test fun emailCodeLoginUsesExactPostRoutesOnTheConfiguredIssuer() {
        for (path in listOf("auth/login/code/request", "auth/login/code/confirm", "hosts/offline/status", "feedback")) {
            val url = "https://cloud.example.com/personal/v1/cloud/$path"
            assertTrue(cloudAppRouteAllowed(url, "POST", host, issuer))
            for (method in listOf("GET", "PUT", "DELETE")) assertFalse(cloudAppRouteAllowed(url, method, host, issuer))
            for (bad in listOf(url + "?owner=other", url + "/raw", url.replace("cloud.example.com", "evil.example.com")))
                assertFalse(cloudAppRouteAllowed(bad, "POST", host, issuer))
        }
    }
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
    @Test fun legacyBridgeCannotReadOrIssueRefreshAndOldBundlesAreIncompatible() {
        assertEquals("NATIVE_LOGIN_UPGRADE_REQUIRED", assertThrows(ApiFailure::class.java) {
            requireLegacyCloudRequestWithoutToken("$issuer/token", issuer)
        }.safeCode)
        requireLegacyCloudRequestWithoutToken("$issuer/jwks", issuer)
        assertThrows(ApiFailure::class.java) { requireLegacyCloudTokensClear(false, null) }
        assertThrows(ApiFailure::class.java) { requireLegacyCloudTokensClear(true, "synthetic-nonempty") }
        requireLegacyCloudTokensClear(true, "")
        assertFalse(mobileUiNativeLoginCompatible(20, 21))
        assertTrue(mobileUiNativeLoginCompatible(21, 21))
        assertFalse(mobileUiNativeLoginCompatible(22, 21))
        assertFalse(mobileUiNeedsNativeLoginUpgrade(0, 20))
        assertTrue(mobileUiNeedsNativeLoginUpgrade(0, 21))
        assertTrue(mobileUiNeedsNativeLoginUpgrade(20, 21))
        assertFalse(mobileUiNeedsNativeLoginUpgrade(21, 21))
        assertFalse(mobileUiNeedsNativeLoginUpgrade(21, 22))
    }
}
