package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PhoneReplicaOpeningUnitTest {
    private fun original() = JSONObject()
        .put("conversations", JSONArray().put(JSONObject().put("id", "synthetic-original")))
        .put("turns", JSONArray().put(JSONObject().put("id", "synthetic-pending")))
        .put("phoneMemory", JSONObject().put("items", JSONArray().put("synthetic-light-entry")))
        .put("snapshot", JSONObject().put("generation", 1))

    @Test fun computerResetRetainsPhoneOriginalsPendingHandoverAndLightEntries() {
        val state = offlineOpeningState(original(), reset = true, phoneSource = true)
        assertEquals("synthetic-original", state.getJSONArray("conversations").getJSONObject(0).getString("id"))
        assertEquals("synthetic-pending", state.getJSONArray("turns").getJSONObject(0).getString("id"))
        assertEquals("synthetic-light-entry", state.getJSONObject("phoneMemory").getJSONArray("items").getString(0))
    }

    @Test fun ordinaryComputerReplicaResetStillErasesDerivedContent() {
        val state = offlineOpeningState(original(), reset = true, phoneSource = false)
        assertEquals(0, state.getJSONArray("conversations").length())
        assertEquals(0, state.getJSONArray("turns").length())
        assertTrue(state.isNull("snapshot"))
        assertFalse(state.has("phoneMemory"))
    }

    @Test fun incrementalEnvelopePreservesExistingContainer() {
        val source = original()
        assertSame(source, offlineOpeningState(source, reset = false, phoneSource = false))
    }
}
