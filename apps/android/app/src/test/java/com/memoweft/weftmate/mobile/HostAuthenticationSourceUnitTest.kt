package com.memoweft.weftmate.mobile

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class HostAuthenticationSourceUnitTest {
    @Test fun localLoginDoesNotReuseAnEarlierCloudRefreshFamily() {
        assertEquals("local", hostAuthenticationSource(JSONObject().put("authSource", "local"), true))
    }
    @Test fun cloudLoginStillRequiresCloudRecoveryWhenCredentialsExpire() {
        assertEquals("cloud", hostAuthenticationSource(JSONObject().put("authSource", "cloud"), false))
    }
    @Test fun oldProfilesUseTheirExistingCredentialFamilyWithoutChangingOwnership() {
        val legacy = JSONObject().put("ownerId", "synthetic-owner").put("deviceId", "synthetic-device")
        assertEquals("local", hostAuthenticationSource(legacy, false))
        assertEquals("cloud", hostAuthenticationSource(legacy, true))
        assertEquals("synthetic-owner", legacy.getString("ownerId"))
        assertEquals("synthetic-device", legacy.getString("deviceId"))
    }
}
