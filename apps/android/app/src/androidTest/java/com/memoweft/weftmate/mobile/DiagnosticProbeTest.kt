package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Opt-in for the isolated diagnostics package only. Product builds have no injection route. */
class DiagnosticProbeTest {
    @Test fun seedLocalLogin() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.diag2qa" && args.getString("host") != null)
        SecureSettings(context).saveHost(PersonalApi().login(args.getString("host")!!,
            args.getString("username")!!, args.getString("password")!!, "DIAG-2 synthetic"))
    }
    @Test fun inspectShell() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.diag2qa" && args.getString("diag2Probe") == "1")
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        if (args.getString("diag2Crash") == "1") {
            Thread.sleep(2500)
            // Separate ordinary app thread: Android's original handler ends the process.
            Thread({ throw IllegalStateException("synthetic private content must not reach the journal") }, "diag2-crash").start()
        }
        val done = File(context.filesDir, "diag2-probe.done"); done.delete()
        val deadline = System.currentTimeMillis() + 10 * 60 * 1000
        while (!done.exists() && System.currentTimeMillis() < deadline) Thread.sleep(200)
        check(done.exists()) { "Diagnostic probe timed out" }
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false); activity.finish() }
        done.delete()
    }
    @Test fun journalAndSummaryOnDevice() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.diag2qa")
        val directory = File(context.cacheDir, "diag2-journal-test")
        try {
            val journal = DiagnosticJournal(directory, "test", "test")
            journal.begin(7); journal.setForeground(true)
            journal.write("app.failure", org.json.JSONObject().put("name", "TypeError").put("message", "synthetic-private"))
            val second = DiagnosticJournal(directory, "test", "test"); second.begin(8) { ProcessExit(System.currentTimeMillis(), 4, 100) }
            check(second.status().getJSONObject("previous").getString("reason") == "crash")
            check(!second.status().getString("summary").contains("synthetic-private"))
        } finally { directory.deleteRecursively() }
    }
}
