package com.memoweft.weftmate.mobile

import org.junit.Assert.*
import org.junit.Test

class EndpointsTest {
    @Test fun productionOriginAndModelAreStrict() {
        assertEquals("https://home.weftmate.com:8443",
            Endpoints.hostOrigin("https://home.weftmate.com:8443/personal/v1/ui"))
        assertEquals("https://model.example/v1/chat/completions", Endpoints.modelUrl("https://model.example/v1"))
        assertEquals("http://127.0.0.1:18189/v1/chat/completions", Endpoints.modelUrl("http://127.0.0.1:18189/v1"))
        for (bad in listOf("http://example.com", "https://user:secret@example.com", "https://example.com/?token=x", "https://example.com/other")) {
            try { Endpoints.hostOrigin(bad); fail("Expected rejection") } catch (_: IllegalArgumentException) { }
        }
        try { Endpoints.modelUrl("http://model.example/v1"); fail("Public model must use TLS") }
        catch (_: IllegalArgumentException) { }
    }
}
