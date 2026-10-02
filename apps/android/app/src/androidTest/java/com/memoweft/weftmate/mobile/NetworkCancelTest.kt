package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class NetworkCancelTest {
    @Test fun disconnectInterruptsResponseHeaderWaitAndClearsConnection() {
        ServerSocket(0).use { server ->
            val accepted = CountDownLatch(1)
            val stopped = CountDownLatch(1)
            val active = AtomicReference<HttpURLConnection?>()
            val listener = Thread {
                server.accept().use { socket ->
                    accepted.countDown()
                    Thread.sleep(3000) // No response headers yet.
                }
            }.apply { start() }
            val caller = Thread {
                try { JsonHttp().request("http://127.0.0.1:${server.localPort}/blocked", "GET", active = active) }
                catch (_: Exception) { }
                finally { stopped.countDown() }
            }.apply { start() }
            assertTrue(accepted.await(4, TimeUnit.SECONDS))
            active.getAndSet(null)?.disconnect()
            assertTrue(stopped.await(4, TimeUnit.SECONDS))
            assertNull(active.get())
            caller.join(1000); listener.join(4000)
        }
    }

    @Test fun uploadFailureAlsoClearsRegisteredConnection() {
        ServerSocket(0).use { server ->
            val active = AtomicReference<HttpURLConnection?>()
            val listener = Thread { server.accept().use { it.close() } }.apply { start() }
            try {
                JsonHttp().request("http://127.0.0.1:${server.localPort}/upload", "POST",
                    JSONObject().put("text", "x".repeat(50_000)), active = active)
                fail("Expected closed peer")
            } catch (_: Exception) { }
            assertNull(active.get())
            listener.join(3000)
        }
    }
}
