package com.memoweft.weftmate.mobile

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class NativeApprovalModeUnitTest {
    @Test fun failedReadReturnsKnownModeAndLetsInitializationContinue() = runBlocking {
        val mode = readNativeApprovalMode("ask") { throw IOException("temporary offline") }
        assertEquals("ask", mode)
        assertEquals("auto", readNativeApprovalMode(mode) { "auto" })
    }

    @Test fun localConversationChoiceDoesNotSubmitItsIdToTheHost() = runBlocking {
        var hostCalls = 0
        val saved = saveNativeApprovalMode("ask", true) { hostCalls++; throw IOException("unknown local chat") }
        assertEquals("ask", saved)
        assertEquals(0, hostCalls)
    }

    @Test fun hostChoiceRequiresMatchingReceiptAndCanBeRetried() = runBlocking {
        assertThrows(IllegalStateException::class.java) { runBlocking { saveNativeApprovalMode("ask", false) { "auto" } } }
        assertEquals("ask", saveNativeApprovalMode("ask", false) { "ask" })
    }
}
