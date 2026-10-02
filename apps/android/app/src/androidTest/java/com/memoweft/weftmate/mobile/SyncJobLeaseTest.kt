package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Synthetic credentials and transport: reproduces a late old-job receipt without a real account. */
@RunWith(AndroidJUnit4::class)
class SyncJobLeaseTest {
    private fun identity(owner: String, device: String, cookie: String) = HostIdentity(
        "https://synthetic.invalid", owner, owner, "host-fixture", device, cookie, "csrf-$device")

    private fun lateResultDoesNotCancel(newIdentity: HostIdentity) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "synthetic-lease-${UUID.randomUUID()}.db"
        val store = LocalStore(context, name)
        val old = identity("owner-a", "device-a", "cookie-a")
        val oldScope = Endpoints.ownerKey(old.origin, old.ownerId)
        store.createConversation("A synthetic message", oldScope)
        val current = AtomicReference(old)
        val generation = AtomicReference("generation-a")
        val lease = SyncJobLease("generation-a", old)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val cancellations = AtomicInteger(0)
        val sawOld401 = AtomicReference(false)
        val workerError = AtomicReference<Throwable?>()
        val active = AtomicReference<HttpURLConnection?>()
        val transport = object : JsonTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
                if (url.endsWith("/auth/me")) return HttpReply(200,
                    JSONObject().put("account", JSONObject().put("ownerId", old.ownerId)))
                if (url.endsWith("/sync/events") && method == "POST") {
                    entered.countDown()
                    assertTrue("Synthetic server release timed out", release.await(6, TimeUnit.SECONDS))
                    throw ApiFailure(401, "UNAUTHORIZED")
                }
                throw AssertionError("Unexpected synthetic request")
            }
        }
        val thread = Thread {
            try {
                SyncManager(store, PersonalApi(transport)).syncOnce(old,
                    { lease.canContinue(current.get(), generation.get()) }, active)
                fail("Synthetic old credential must return 401")
            } catch (_: ApiFailure) {
                sawOld401.set(true)
                if (lease.canCancelScheduled(current.get(), generation.get())) cancellations.incrementAndGet()
            } catch (error: Throwable) { workerError.set(error) }
            finally { finished.countDown() }
        }
        try {
            thread.start()
            assertTrue("Old A request did not reach synthetic server", entered.await(6, TimeUnit.SECONDS))
            current.set(newIdentity)
            generation.set("generation-b")
            release.countDown()
            assertTrue("Old A worker did not finish", finished.await(8, TimeUnit.SECONDS))
            workerError.get()?.let { throw AssertionError("Synthetic A request failed unexpectedly", it) }
            assertTrue("Synthetic old credential must return 401", sawOld401.get())
            assertEquals("Late A failure must not cancel B's generation", 0, cancellations.get())
            assertEquals("generation-b", generation.get())
            assertTrue("A's unacknowledged event remains in its own outbox", store.pending(oldScope).isNotEmpty())
        } finally {
            release.countDown()
            thread.join(2000)
            store.close()
            context.deleteDatabase(name)
        }
    }

    @Test fun lateA401CannotCancelDifferentOwnerJob() = lateResultDoesNotCancel(
        identity("owner-b", "device-b", "cookie-b"))

    @Test fun late401CannotCancelSameOwnerNewDeviceOrCookie() {
        lateResultDoesNotCancel(identity("owner-a", "device-new", "cookie-new"))
        val original = identity("owner-a", "device-a", "cookie-a")
        val rotatedCookie = original.copy(cookie = "cookie-rotated")
        val lease = SyncJobLease("generation-a", original)
        assertFalse(lease.canCancelScheduled(rotatedCookie, "generation-b"))
        assertFalse(lease.canCancelScheduled(rotatedCookie, "generation-a"))
        assertFalse(lease.canContinue(rotatedCookie, "generation-a"))
        assertFalse(lease.canShowNotification(rotatedCookie))
        assertTrue(lease.canCancelScheduled(original, "generation-a"))
        assertFalse(lease.canContinue(original, null))
        assertFalse(lease.canContinue(original, "generation-b"))
        assertTrue(lease.canContinue(original, "generation-a"))
    }

    @Test fun oldSuccessfulReceiptStopsBeforeMarkingAEventsAfterSwitch() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "synthetic-lease-accepted-${UUID.randomUUID()}.db"
        val store = LocalStore(context, name)
        val old = identity("owner-a", "device-a", "cookie-a")
        val owner = Endpoints.ownerKey(old.origin, old.ownerId)
        store.createConversation("A synthetic accepted message", owner)
        val current = AtomicReference(old)
        val generation = AtomicReference("generation-a")
        val lease = SyncJobLease("generation-a", old)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val interrupted = AtomicReference(false)
        val workerError = AtomicReference<Throwable?>()
        val transport = object : JsonTransport {
            override fun request(url: String, method: String, body: JSONObject?, headers: Map<String, String>,
                active: AtomicReference<HttpURLConnection?>?, readTimeoutMs: Int): HttpReply {
                if (url.endsWith("/auth/me")) return HttpReply(200,
                    JSONObject().put("account", JSONObject().put("ownerId", old.ownerId)))
                if (url.endsWith("/sync/events") && method == "POST") {
                    entered.countDown()
                    assertTrue(release.await(6, TimeUnit.SECONDS))
                    val accepted = JSONArray()
                    val events = body!!.getJSONArray("events")
                    for (index in 0 until events.length()) accepted.put(JSONObject()
                        .put("eventId", events.getJSONObject(index).getString("eventId"))
                        .put("seq", index + 1))
                    return HttpReply(200, JSONObject().put("accepted", accepted))
                }
                throw AssertionError("Unexpected synthetic request")
            }
        }
        val thread = Thread {
            try { SyncManager(store, PersonalApi(transport)).syncOnce(old,
                { lease.canContinue(current.get(), generation.get()) }) }
            catch (_: SyncInterrupted) { interrupted.set(true) }
            catch (error: Throwable) { workerError.set(error) }
            finally { finished.countDown() }
        }
        try {
            thread.start()
            assertTrue(entered.await(6, TimeUnit.SECONDS))
            current.set(identity("owner-b", "device-b", "cookie-b"))
            generation.set("generation-b")
            release.countDown()
            assertTrue(finished.await(8, TimeUnit.SECONDS))
            workerError.get()?.let { throw AssertionError("Synthetic receipt failed unexpectedly", it) }
            assertTrue("New identity must stop old post-receipt writes", interrupted.get())
            assertTrue("A event stays pending for its own future duplicate reconciliation", store.pending(owner).isNotEmpty())
        } finally {
            release.countDown()
            thread.join(2000)
            store.close()
            context.deleteDatabase(name)
        }
    }
}
