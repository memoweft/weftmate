package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File

// 保护：首次本机启动等待资料时仍可导航，无电脑和模型也能进入配置。
class NativeStartupInstrumentedTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun firstLocalLaunchCanOpenSettingsWithoutAComputerOrModel() {
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.startupqa")
        assumeTrue(InstrumentationRegistry.getArguments().getString("startupQa") == "1")
        val started = SystemClock.elapsedRealtime()
        val activity = instrumentation.startActivitySync(Intent(context, NativeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        val result = JSONObject().put("activityCreatedMs", SystemClock.elapsedRealtime() - started)
        fun onMain(action: () -> Unit) = instrumentation.runOnMainSync(action)
        fun waitFor(condition: () -> Boolean) {
            compose.waitUntil(30_000) {
                var ready = false
                onMain { ready = condition() }
                ready
            }
        }
        fun shot(name: String) {
            val image = instrumentation.uiAutomation.takeScreenshot()
            assertNotNull(image)
            File(activity.filesDir, name + ".png").outputStream().use {
                image.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        try {
            waitFor { activity.model.loggedIn && activity.model.localOnly }
            result.put("accountReadyMs", SystemClock.elapsedRealtime() - started)
            shot("startup-preparing")
            compose.onNodeWithContentDescription("打开侧栏").performClick()
            compose.onNodeWithText("设置").performClick()
            waitFor { activity.model.tab == "settings" }
            result.put("settingsNavigationMs", SystemClock.elapsedRealtime() - started)
            compose.onNodeWithContentDescription("返回").performClick()
            waitFor { activity.model.tab == "chat" && !activity.model.loading }
            result.put("localChatReadyMs", SystemClock.elapsedRealtime() - started)
            onMain {
                assertTrue(activity.model.localOnly)
                assertTrue(activity.model.standalone)
                assertTrue(activity.model.phoneArchive)
                assertFalse(activity.model.canSend)
            }
            compose.waitUntil(5_000) {
                runCatching { compose.onNodeWithText("设置对话模型").assertIsDisplayed() }.isSuccess
            }
            compose.onNodeWithText("设置对话模型").performClick()
            compose.waitUntil(15_000) {
                compose.onAllNodesWithText("添加模型服务…").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("添加模型服务…").assertIsDisplayed()
            result.put("modelSettingsReadyMs", SystemClock.elapsedRealtime() - started).put("passed", true)
            shot("startup-model-settings")
        } catch (error: Throwable) {
            result.put("passed", false).put("error", error.javaClass.simpleName)
            onMain {
                result.put("activityClass", activity.javaClass.name)
                    .put("foreground", activity.nativeForeground)
                    .put("tab", activity.model.tab)
                    .put("webVisibility", activity.embeddedWeb.visibility)
                    .put("webParent", activity.embeddedWeb.parent?.javaClass?.name)
                val children = org.json.JSONArray()
                for (index in 0 until activity.presentationContainer.childCount) {
                    val view = activity.presentationContainer.getChildAt(index)
                    children.put(JSONObject().put("class", view.javaClass.name).put("visibility", view.visibility)
                        .put("width", view.width).put("height", view.height))
                }
                result.put("children", children)
            }
            File(activity.filesDir, "startup-semantics.txt").writeText(compose.onRoot().printToString())
            shot("startup-failure")
            throw error
        } finally {
            File(activity.filesDir, "startup-result.json").writeText(result.toString())
            instrumentation.sendStatus(0, android.os.Bundle().apply {
                putString("nativeStartupResult", result.toString())
            })
            onMain { activity.finish() }
        }
    }
}
