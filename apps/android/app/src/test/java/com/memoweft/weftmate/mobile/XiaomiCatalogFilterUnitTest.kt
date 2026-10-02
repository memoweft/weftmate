package com.memoweft.weftmate.mobile

import org.junit.Assert.*
import org.junit.Test

class XiaomiCatalogFilterUnitTest {
    @Test fun officialEndpointExcludesOnlyKnownAudioModelFamilies() {
        val official = ModelSettings("https://api.xiaomimimo.com/v1", "custom-chat-model", "")
        assertFalse(isChatCatalogModel(official, "mimo-v2.5-asr"))
        assertFalse(isChatCatalogModel(official, "mimo-v2.5-tts"))
        assertFalse(isChatCatalogModel(official, "MiMo-V2.5-TTS-Voice"))
        assertTrue(isChatCatalogModel(official, "mimo-v2.6-flash"))
        assertTrue(isChatCatalogModel(official, "custom-chat-model"))
        assertEquals("custom-chat-model", official.modelId)

        val other = ModelSettings("https://other.example/v1", "mimo-v2.5-asr", "")
        assertTrue(isChatCatalogModel(other, "mimo-v2.5-asr"))
        val nonstandardPort = ModelSettings("https://api.xiaomimimo.com:444/v1", "mimo-v2.5-asr", "")
        assertTrue(isChatCatalogModel(nonstandardPort, "mimo-v2.5-asr"))
    }
}
