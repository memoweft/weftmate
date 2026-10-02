package com.memoweft.weftmate.mobile

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Opt-in synthetic profile: checks the real JobScheduler entry without sending a model request. */
@RunWith(AndroidJUnit4::class)
class HybridBackgroundSyncTest {
    @Test fun loggedInHybridStartupSchedulesJobAndClosingUiKeepsIt() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue("Explicit synthetic background-sync run only",
            InstrumentationRegistry.getArguments().getString("hybridSyncFixture") == "1")
        val context = instrumentation.targetContext
        val host = SecureSettings(context).host() ?: throw AssertionError("Synthetic account must be logged in")
        assertEquals("http://127.0.0.1:18187", host.origin)
        assertTrue("Refuse a non-synthetic account", host.username.matches(Regex("root-phone-[A-Za-z0-9_-]+")))
        val before = SyncJobService.status(context)
        assumeTrue("System JobScheduler status is unavailable", before != "unknown")
        var activity: HybridActivity? = null
        try {
            SyncJobService.cancel(context)
            assertEquals("not_scheduled", SyncJobService.status(context))
            activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
            val deadline = System.currentTimeMillis() + 8_000
            while (System.currentTimeMillis() < deadline && SyncJobService.status(context) != "scheduled")
                Thread.sleep(80)
            assertEquals("scheduled", SyncJobService.status(context))
            val current = activity ?: throw AssertionError("Hybrid activity did not start")
            instrumentation.runOnMainSync { current.finish() }
            activity = null
            assertEquals("Closing the UI must leave background sync scheduled", "scheduled", SyncJobService.status(context))
        } finally {
            activity?.let { current -> instrumentation.runOnMainSync { current.finish() } }
            if (before == "scheduled") SyncJobService.schedule(context) else SyncJobService.cancel(context)
            assertEquals("The synthetic fixture's prior JobScheduler state must be restored", before,
                SyncJobService.status(context))
        }
    }
}
