package com.memoweft.weftmate.mobile

import org.junit.Assert.*
import org.junit.Test

class LocalPhoneAccessTest {
    private val local = HostIdentity("https://local.weftmate.invalid", "本机使用", "local-test", "unconnected", "phone-test", "", "", "phone-local")
    @Test fun localIdentityCannotSupplyRemoteAuthority() {
        for (method in listOf("host.business", "shared.send", "sync.run", "offline.key", "cloud.pending", "auth.profile", "auth.devices", "auth.changePassword")) {
            try { requireLocalPhoneAccess(method, local); fail("Remote method accepted: $method") }
            catch (error: ApiFailure) { assertEquals(401, error.status); assertEquals("CLOUD_LOGIN_REQUIRED", error.safeCode) }
        }
        // Update availability is local metadata; the updater itself refuses to
        // contact a computer source for a phone-only identity.
        for (method in listOf("app.bootstrap", "phone.identity", "phone.models.serviceConfigure", "phone.complete", "phone.offline.save", "cloud.app.request", "settings.appearance", "updates.status", "updates.check"))
            requireLocalPhoneAccess(method, local)
        requireLocalPhoneAccess("host.business", local.copy(authSource = "cloud"))
        requireLocalPhoneAccess("auth.devices", local.copy(authSource = "local"))
    }
}
