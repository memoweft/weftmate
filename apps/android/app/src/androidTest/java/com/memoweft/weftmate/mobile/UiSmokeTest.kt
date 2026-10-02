package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

@RunWith(AndroidJUnit4::class)
class UiSmokeTest {
    @Test fun nativeScreenOpensAndWritesScreenshotForManualReview() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            Thread.sleep(700)
            val screenshot: Bitmap = instrumentation.uiAutomation.takeScreenshot()
            assertTrue(screenshot.width > 300 && screenshot.height > 300)
            val target = File(context.getExternalFilesDir(null), "weftmate-ui-smoke.png")
            FileOutputStream(target).use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
            println("SCREENSHOT_PATH=${target.absolutePath}")
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
