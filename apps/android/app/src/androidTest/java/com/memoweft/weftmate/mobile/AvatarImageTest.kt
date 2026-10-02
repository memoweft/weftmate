package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.Random
import java.util.UUID

/** Valid generated PNG through the exact URI bounds/decode path; no account upload. */
@RunWith(AndroidJUnit4::class)
class AvatarImageTest {
    @Test fun validPngBoundsProbeThenActualDecodeProducesBoundedJpeg() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val file = File(context.cacheDir, "synthetic-avatar-${UUID.randomUUID()}.png")
        val source = Bitmap.createBitmap(144, 144, Bitmap.Config.ARGB_8888)
        val random = Random(4257)
        for (y in 0 until source.height) for (x in 0 until source.width)
            source.setPixel(x, y, 0xff000000.toInt() or random.nextInt(0x1000000))
        file.outputStream().use { assertTrue(source.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        source.recycle()
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        try {
            assertTrue("Synthetic PNG should contain real encoded image data", file.length() > 30_000)
            val method = HybridActivity::class.java.getDeclaredMethod("readAvatar", Uri::class.java)
                .apply { isAccessible = true }
            val result = method.invoke(activity, Uri.fromFile(file)) as JSONObject
            assertEquals("image/jpeg", result.getString("mimeType"))
            val jpeg = Base64.decode(result.getString("dataBase64"), Base64.NO_WRAP)
            assertTrue(jpeg.isNotEmpty() && jpeg.size <= 128 * 1024)
            val decoded = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
            assertNotNull(decoded)
            assertEquals(144, decoded.width)
            assertEquals(144, decoded.height)
            decoded.recycle()
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
            assertTrue(file.delete())
        }
    }
}
