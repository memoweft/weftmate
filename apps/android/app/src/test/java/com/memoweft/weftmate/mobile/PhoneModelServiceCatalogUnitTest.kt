package com.memoweft.weftmate.mobile

import org.junit.Assert.*
import org.junit.Test

class PhoneModelServiceCatalogUnitTest {
    @Test fun allChatModelsUseReadableNamesAndNonChatModelsAreFiltered() {
        assertTrue(isServiceChatModel("mimo-v2.6-flash"))
        assertTrue(isServiceChatModel("mimo-v2.6-pro"))
        assertFalse(isServiceChatModel("mimo-v2.5-asr"))
        assertFalse(isServiceChatModel("mimo-v2.5-tts"))
        assertFalse(isServiceChatModel("text-embedding-3-small"))
        assertFalse(isServiceChatModel("custom", "image"))
        assertEquals("MiMo v2.6 Flash", phoneModelDisplayName("mimo-v2.6-flash"))
        assertEquals("服务显示名", phoneModelDisplayName("custom", "服务显示名"))
        assertEquals("MiMo", phoneServiceDisplayName("https://api.xiaomimimo.com/v1"))
        assertEquals("https://model.example/custom/chat/completions", phoneServiceEndpoint("https://model.example/custom/messages"))
    }

    @Test fun authenticationFailureIsDifferentFromUnsupportedDirectory() {
        assertEquals("authentication_failed", phoneCatalogFailureStatus(ApiFailure(401, "AUTH_REJECTED")))
        assertEquals("authentication_failed", phoneCatalogFailureStatus(ApiFailure(403, "ACCESS_DENIED")))
        assertEquals("unsupported", phoneCatalogFailureStatus(ApiFailure(404, "NOT_FOUND")))
        assertEquals("unsupported", phoneCatalogFailureStatus(ApiFailure(405, "METHOD_NOT_ALLOWED")))
        assertEquals("offline", phoneCatalogFailureStatus(java.io.IOException()))
    }
}
