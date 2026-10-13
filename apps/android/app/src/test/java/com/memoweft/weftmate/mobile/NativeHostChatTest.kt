package com.memoweft.weftmate.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeHostChatTest {
    @Test fun pinnedTrustManagerExposesTheAndroidHostnameAwareChainContract() {
        val method=PinnedTrustManager::class.java.getMethod("checkServerTrusted",Array<java.security.cert.X509Certificate>::class.java,String::class.java,String::class.java)
        assertTrue(java.util.List::class.java.isAssignableFrom(method.returnType))
        assertTrue(java.lang.reflect.Modifier.isPublic(method.modifiers))
    }
    @Test fun cloudConnectionFailuresKeepSafeActionableReasonsWithoutRawMessages() {
        val cases=listOf(org.json.JSONException("private response") to "CLOUD_RESPONSE_INVALID",IllegalArgumentException("private request") to "CLOUD_REQUEST_INVALID",javax.net.ssl.SSLException("private host") to "CLOUD_TLS_UNAVAILABLE",java.net.SocketTimeoutException("private address") to "CLOUD_TIMEOUT")
        for((error,code) in cases)assertEquals(code,cloudAppFailure(error).safeCode)
        val revoked=ApiFailure(401,"UNAUTHORIZED");assertSame(revoked,cloudAppFailure(revoked))
    }
    @Test fun mainKeepsLogicalIdentityBeforeAndAfterFirstSession() {
        for (session in listOf("", "session-one")) {
            val target = hostChatSendTarget("main","chat-main",session)
            assertEquals("chat-main",target.getString("chatId")); assertFalse(target.has("sessionId"))
        }
    }
    @Test fun sideAndLegacyChatsSendToTheirOriginalSession() {
        for (kind in listOf("side", "")) {
            val target = hostChatSendTarget(kind,"chat-side","session-old")
            assertEquals("session-old",target.getString("sessionId")); assertFalse(target.has("chatId"))
        }
    }
    @Test(expected=ApiFailure::class) fun missingSideSessionNeverFallsBackToMainOrPhone() { hostChatSendTarget("side","chat-side","") }
    @Test fun oldAndCurrentHostRejectionsAreTerminal() {
        for ((status,code) in listOf(404 to "CHAT_UNAVAILABLE",400 to "INVALID_REQUEST",422 to "MODEL_UNAVAILABLE",409 to "REQUEST_CONFLICT",403 to "FORBIDDEN"))
            assertTrue(sharedSendRejected(ApiFailure(status,code)))
        for ((status,code) in listOf(503 to "HOST_UNAVAILABLE",502 to "COMMAND_RECEIPT_INVALID",401 to "UNAUTHORIZED",409 to "SESSION_BUSY"))
            assertFalse(sharedSendRejected(ApiFailure(status,code)))
    }
    @Test fun unknownOutcomeRetainsOriginalMessageAndOffersAnExplicitCheck() {
        val row=JSONObject().put("state","uncertain").put("text","你好")
        assertTrue(hostDeliveryMessage(row).contains("点按核对"));assertFalse(hostDeliveryMessage(row).contains("自动续查"));assertEquals("你好",row.getString("text"))
        assertTrue(hostDeliveryMessage(row.put("state","rejected")).contains("没有发出"))
    }
}
