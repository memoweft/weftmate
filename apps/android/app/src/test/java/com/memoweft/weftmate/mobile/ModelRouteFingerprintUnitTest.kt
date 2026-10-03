package com.memoweft.weftmate.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ModelRouteFingerprintUnitTest {
    private val official = "309411cbfe27ae5fcc8816d24c68b8fd594599c0b50b0e064207ac9c9d65aa60"

    @Test fun actualPublicMiMoRequestHasTheSameCrossPlatformFingerprint() {
        assertEquals(official, modelRouteFingerprint(
            "https://api.xiaomimimo.com/v1/chat/completions", "mimo-v2.6-flash"))
        assertEquals(official, modelRouteFingerprint(
            "https://API.XIAOMIMIMO.COM:443/v1/", "mimo-v2.6-flash"))
        assertNotEquals(official, modelRouteFingerprint(
            "https://api.xiaomimimo.com/v1", "MiMo-V2.6-Flash"))
    }

    @Test fun phoneLocalOrPrivateRoutesStayUnknownAcrossDevices() {
        for (route in listOf("http://127.0.0.1:55351/v1", "http://192.168.1.4/v1",
            "http://model.local/v1", "https://localhost/v1", "https://example.invalid/v1",
            "https://user:secret@api.xiaomimimo.com/v1")) {
            assertEquals(null, modelRouteFingerprint(route, "mimo-v2.6-flash"))
        }
    }
}
