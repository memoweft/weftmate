package com.memoweft.weftmate.mobile
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ReleaseBlockersTest {
    @Test fun libraryPdfFitsTheExistingBoundedPreviewContract() {
        assertTrue(nativeBusinessResponseLimit("/personal/v1/library/synthetic-pdf/preview") >= 28*1024*1024)
        assertEquals(256*1024,nativeBusinessResponseLimit("/personal/v1/status"))
    }
    @Test fun previewContentIsNotTruncatedAndCredentialsStayFiltered() {
        val body=JSONObject().put("data","x".repeat(350000)).put("text","表格".repeat(10000)).put("password","hidden")
        val preview=nativePublicBusiness(body,preview=true) as JSONObject
        assertEquals(350000,preview.getString("data").length);assertEquals(20000,preview.getString("text").length);assertFalse(preview.has("password"))
        assertEquals(16384,(nativePublicBusiness(body) as JSONObject).getString("data").length)
    }
    @Test fun pendingCardDisappearsAsSoonAsDurableBubbleArrives() {
        val pending=JSONObject().put("requestId","synthetic-request").put("receiptId","receipt-1")
        val rows=listOf(JSONObject().put("type","user.message").put("data",JSONObject().put("receiptId","receipt-1")))
        assertFalse(nativePendingMessageVisible(pending,rows));
        assertFalse(nativePendingMessageVisible(JSONObject().put("command",JSONObject().put("receiptId","receipt-1")),rows));
        val queued=JSONObject().put("type","task.queued").put("data",JSONObject().put("requestId","synthetic-request").put("receiptId","receipt-1"))
        assertFalse(nativePendingMessageVisible(JSONObject().put("requestId","synthetic-request"),listOf(queued)+rows));assertTrue(nativePendingMessageVisible(JSONObject().put("receiptId","other"),rows))
    }
    @Test fun receiptOnlyConsumesSubmittedPrefix() {
        assertEquals("下一条🙂", remainingNativeDraft("你好下一条🙂", "你好"))
        assertEquals("替换后的下一条", remainingNativeDraft("替换后的下一条", "你好"))
        assertEquals("", remainingNativeDraft("你好", "你好"))
        assertEquals("新附件说明", remainingNativeDraft("新附件说明", ""))
    }
    @Test fun stalledPageReadBecomesRetryableFailure() = runBlocking {
        try { nativePageRead(10) { delay(100); "unreachable" }; fail("must finish") }
        catch (e: Exception) { assertTrue("timeout must be a page error, not lifecycle cancellation", e is ApiFailure); assertEquals(408, (e as ApiFailure).status) }
    }
    @Test fun parentCancellationStillCancelsPageRead() = runBlocking {
        val started=CompletableDeferred<Unit>();val job=launch { nativePageRead { started.complete(Unit);delay(1000) } };started.await();job.cancelAndJoin(); assertTrue(job.isCancelled)
    }
    @Test fun cloudIdentityDoesNotInheritLegacyLocalOwner() {
        val old=JSONObject().put("cloud",true).put("email","a***@example.invalid").put("accountLabel","只在这台电脑上用").put("profile",JSONObject().put("username","local-owner").put("displayName","local-owner"))
        val projected=nativeAccountProjection(old)
        assertEquals("a***@example.invalid",projected.getString("accountLabel"))
        assertEquals("a***@example.invalid",projected.getJSONObject("profile").getString("displayName"))
        old.put("email","");assertFalse(nativeAccountProjection(old).getString("accountLabel").contains("只在"))
    }
}
