package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HostModuleProjectionTest {
    @Test fun readsNestedBackendModulesWithoutClaimingUnknownAsConnected() {
        val status = JSONObject().put("backend", JSONObject().put("modules", JSONObject()
            .put("memory", "connected").put("mods", "disabled").put("tasks", "invalid")))
        val projected = moduleProjection(status)
        assertEquals("connected", projected.getString("memory"))
        assertEquals("disabled", projected.getString("mods"))
        assertEquals("unknown", projected.getString("tasks"))
        assertEquals("unknown", projected.getString("notifications"))
    }
}
