package com.memoweft.weftmate.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncJobLeaseUnitTest {
    private fun identity(owner: String, device: String, cookie: String) = HostIdentity(
        "https://synthetic.invalid", owner, owner, "host-fixture", device, cookie, "csrf-$device")

    @Test fun replacedOwnerJobCannotBeCancelledByLateOldResult() {
        val a = identity("owner-a", "device-a", "cookie-a")
        val b = identity("owner-b", "device-b", "cookie-b")
        val oldRun = SyncJobLease("generation-a", a)
        assertTrue(oldRun.canContinue(a, "generation-a"))
        assertFalse(oldRun.canContinue(b, "generation-b"))
        assertFalse(oldRun.canCancelScheduled(b, "generation-b"))
        assertFalse(oldRun.canShowNotification(b))
    }

    @Test fun sameOwnerNewCredentialAndGenerationDoNotInheritOldJob() {
        val a = identity("owner-a", "device-a", "cookie-a")
        val oldRun = SyncJobLease("generation-a", a)
        val newDevice = identity("owner-a", "device-b", "cookie-b")
        val rotatedCookie = a.copy(cookie = "cookie-new")
        for (current in listOf(newDevice, rotatedCookie)) {
            assertFalse(oldRun.canContinue(current, "generation-b"))
            assertFalse(oldRun.canCancelScheduled(current, "generation-b"))
            assertFalse(oldRun.canCancelScheduled(current, "generation-a"))
            assertFalse(oldRun.canShowNotification(current))
        }
        assertFalse(oldRun.canContinue(a, null))
        assertFalse(oldRun.canContinue(a, "generation-b"))
        assertFalse(oldRun.canCancelScheduled(a, "generation-b"))
    }
}
