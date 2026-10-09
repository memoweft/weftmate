package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Only the isolated M3-A package. Credentials belong to a synthetic approved device. */
class M3aOfflineProbeTest {
    @Test fun inspectOfflineReplica() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.m3a")
        assumeTrue(InstrumentationRegistry.getArguments().getString("m3aProbe") == "1")
        val seed = File(context.filesDir, "m3a-identity.json")
        val identity = JSONObject(seed.readText()); check(seed.delete())
        val secrets = SecureSettings(context)
        secrets.saveHost(HostIdentity(identity.getString("origin"), "M3-A synthetic phone",
            identity.getString("ownerId"), identity.getString("hostId"), identity.getString("deviceId"),
            identity.getString("cookie"), identity.getString("csrf")))
        CloudAppLogin(secrets, PersonalApi()).configure(identity.getString("origin"))
        val done = File(context.filesDir, "m3a-probe.done"); done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val deadline = System.currentTimeMillis() + 20 * 60 * 1000
        while (!done.exists() && System.currentTimeMillis() < deadline) Thread.sleep(500)
        check(done.exists()) { "M3-A probe timed out" }
        instrumentation.runOnMainSync { activity.finish(); WebView.setWebContentsDebuggingEnabled(false) }
        done.delete()
    }
}
