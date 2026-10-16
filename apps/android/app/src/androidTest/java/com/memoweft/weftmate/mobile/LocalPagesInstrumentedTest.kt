package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Actual no-account APK pages; opt in only on this package's disposable install. */
class LocalPagesInstrumentedTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun computerPagesAndUpdateAvailabilityKeepLocalChatUsable() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("localPages") == "1")
        check(instrumentation.targetContext.packageName == "com.memoweft.weftmate.mobile.g7c1qa")
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, NativeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        fun main(action: () -> Unit) = instrumentation.runOnMainSync(action)
        fun waitFor(timeout: Long = 8000, condition: () -> Boolean): Boolean {
            val end = System.currentTimeMillis() + timeout
            while (System.currentTimeMillis() < end) {
                compose.mainClock.advanceTimeByFrame()
                val ready = condition()
                if (ready) return true
                Thread.sleep(50)
            }
            return false
        }
        val theme = args.getString("pagesTheme", "light")!!
        fun shot(page: String) {
            compose.mainClock.advanceTimeByFrame()
            val image = instrumentation.uiAutomation.takeScreenshot()
            assertNotNull(image)
            File(activity.filesDir, "g7-pages-$page-$theme.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        val problems = mutableListOf<String>()
        try {
            assertTrue("Local chat did not become usable", waitFor { activity.model.loggedIn && activity.model.localOnly && !activity.model.loading })
            runBlocking(Dispatchers.Main) { activity.settings.bridge.call("appearance", JSONObject().put("theme", theme)); activity.model.dark = theme == "dark" }
            compose.mainClock.advanceTimeByFrame()
            val bootstrap = runBlocking(Dispatchers.Main) { activity.model.call("app.bootstrap") }
            if (!bootstrap.optBoolean("phoneOnly")) problems += "bootstrap did not advertise absence of a computer"
            val expected = mapOf("activity" to "连上电脑后，提醒和任务进展会出现在这里。", "goals" to "连上电脑后，可以让它按时帮你做事。", "health" to "从今天的身体状态，到这周的生活节奏", "library" to "让电脑上的 WeftMate 帮你做事后，产出的文件会出现在这里。")
            for (tab in listOf("activity", "goals", "health", "library")) {
                main { activity.model.tab = tab }
                val shown = waitFor(5000) {
                    when (tab) {
                        "activity" -> activity.feed.noComputer && !activity.feed.loading && activity.feed.error.isEmpty()
                        "goals" -> activity.goals.noComputer && !activity.goals.loading && activity.goals.errors.isEmpty()
                        "health" -> activity.health.noComputer && activity.health.error.isEmpty() && activity.health.overview?.optBoolean("connected") == false
                        else -> false
                    } || tab == "library" && compose.onAllNodesWithText(expected.getValue(tab)).fetchSemanticsNodes().isNotEmpty()
                }
                if (!shown) problems += "$tab did not show the existing no-computer state"
                expected[tab]?.let { text ->
                    compose.mainClock.advanceTimeByFrame()
                    if (compose.onAllNodesWithText(text).fetchSemanticsNodes().isEmpty()) problems += "$tab explanation not rendered"
                }
                shot(tab)
            }
            main { activity.settings.original("updates") }
            var pageText = ""
            val explained = waitFor(5000) {
                main { activity.embeddedWeb.evaluateJavascript("document.getElementById('page-content')?.textContent||''") { pageText = it } }
                pageText.contains("连上电脑后可检查界面更新")
            }
            if (!explained) problems += "updates did not explain unavailable computer source"
            shot("updates")
            try {
                val details = runBlocking(Dispatchers.Main) { activity.model.call("updates.check") }
                if (details.optBoolean("sourceAvailable", true) || details.optBoolean("checked", true)) problems += "unavailable update source was reported as checked"
            } catch (error: ApiFailure) { problems += "unavailable update source returned login/network failure: ${error.safeCode}" }
            assertEquals("phone-local", runBlocking(Dispatchers.Main) { activity.model.call("app.bootstrap") }.getString("authSource"))
            assertTrue(SecureSettings(activity).host()!!.cookie.isBlank())
            assertTrue(SecureSettings(activity).appValue("credentials").isNullOrBlank())
            assertTrue(problems.joinToString("\n"), problems.isEmpty())
        } finally { main { activity.finish() } }
    }
}
