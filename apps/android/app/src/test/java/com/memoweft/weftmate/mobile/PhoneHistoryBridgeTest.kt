package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PhoneHistoryBridgeTest {
    private fun envelope(method: String, value: JSONObject) = JSONObject().put("id", "history-save-test")
        .put("method", method).put("params", JSONObject().put("value", value)).toString()

    @Test fun twelveHundredMessagesReachPhoneSaveInsteadOfDisappearingAtTheBridge() {
        val turns = JSONArray((0 until 600).map { index -> JSONObject().put("id", "turn-$index")
            .put("conversationId", "long-chat").put("messages", JSONArray().put(JSONObject().put("role", "user").put("text", "USER-$index：" + "合成历史".repeat(30)))
                .put(JSONObject().put("role", "assistant").put("text", "ANSWER-$index：" + "合成回复".repeat(30)))) })
        val value = JSONObject().put("turns", turns).put("conversations", JSONArray().put(JSONObject().put("id", "long-chat").put("turns", turns)))
        val raw = envelope("phone.offline.save", value)
        assertTrue(raw.length > 128 * 1024)
        requireOfflineVaultSize(value)
        val accepted = readWebBridgeRequest(raw)
        assertNotNull("A valid long history must receive a result, not disappear", accepted)
        assertNull(accepted!!.errorCode)
        assertEquals(1200, accepted.value.getJSONObject("params").getJSONObject("value").getJSONArray("turns").length() * 2)
    }

    @Test fun oversizedSmallRequestReceivesAnExplicitFailureReceipt() {
        val receipt = readWebBridgeRequest(envelope("settings.appearance", JSONObject().put("padding", "x".repeat(140000))))
        assertNotNull("An identified oversized request must not wait for a timeout", receipt)
        assertEquals("BRIDGE_REQUEST_TOO_LARGE", receipt!!.errorCode)
        assertEquals("history-save-test", receipt.value.getString("id"))
    }

    @Test fun trueStorageLimitReportsItsOwnErrorRatherThanAGenericInvalidRequest() {
        val value = JSONObject().put("text", "x".repeat(8 * 1024 * 1024))
        try { requireOfflineVaultSize(value); fail("The encrypted vault still has a hard limit") }
        catch (error: Exception) {
            assertTrue(error is ApiFailure)
            assertEquals(413, (error as ApiFailure).status)
            assertEquals("OFFLINE_STORAGE_TOO_LARGE", error.safeCode)
        }
    }

    @Test fun storageLimitCountsUtf8BytesAndNormalRequestsKeepTheirExistingContract() {
        val value = JSONObject().put("text", "汉".repeat(3 * 1024 * 1024))
        assertTrue(value.toString().length < 8 * 1024 * 1024)
        try { requireOfflineVaultSize(value); fail("Chinese text uses more than one byte") }
        catch (error: ApiFailure) { assertEquals("OFFLINE_STORAGE_TOO_LARGE", error.safeCode) }
        val normal = readWebBridgeRequest(envelope("phone.offline.save", JSONObject()))!!
        assertNull(normal.errorCode)
        assertNull(readWebBridgeRequest("not-json"))
        assertNull(readWebBridgeRequest(JSONObject().put("id", "not a valid id").put("method", "phone.offline.save").toString()))
    }

    @Test fun requestBeyondTheTransportCeilingStillGetsAnIdentifiedFailure() {
        val raw = """{"id":"huge-save","method":"phone.offline.save","params":{"value":{"text":"""" +
            "x".repeat(10 * 1024 * 1024) + """ "}}}"""
        val receipt = readWebBridgeRequest(raw)!!
        assertEquals("huge-save", receipt.value.getString("id"))
        assertEquals("OFFLINE_STORAGE_TOO_LARGE", receipt.errorCode)
    }
}
