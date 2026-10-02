package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Explicit synthetic account only. No model inference or device action. */
@RunWith(AndroidJUnit4::class)
class PersonalSyncInstrumentedTest {
    @Test fun authenticatedPhoneEventsReachHostAndDuplicateDoesNotAppend() {
        val args = InstrumentationRegistry.getArguments()
        val origin = args.getString("syncOrigin")
        val username = args.getString("syncUser")
        val password = args.getString("syncPassword")
        assumeTrue("Set syncOrigin/syncUser/syncPassword for isolated-host integration", !origin.isNullOrBlank() && !username.isNullOrBlank() && !password.isNullOrBlank())
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "sync-test-${UUID.randomUUID()}.db"
        val store = LocalStore(context, name)
        val api = PersonalApi()
        var host: HostIdentity? = null
        try {
            host = api.login(origin!!, username!!, password!!, "Synthetic Android Test")
            val owner = Endpoints.ownerKey(host.origin, host.ownerId)
            val conversation = store.createConversation("合成同步测试", owner)
            store.addMessage(conversation.id, "user", "合成安卓记录")
            val turnId = store.startTurn(conversation.id)
            store.finishTurn(turnId, "completed")
            val original = store.pending(owner)
            assertEquals(3, original.size)
            val first = SyncManager(store, api).syncOnce(host)
            assertEquals(3, first.uploaded)
            assertTrue(store.pending(owner).isEmpty())
            val duplicate = api.postEvents(host, JSONArray().put(original[0].body)).getJSONArray("accepted")
            assertTrue(duplicate.getJSONObject(0).getBoolean("duplicate"))
            val conflict = JSONObject(original[0].body.toString()).put("payload", JSONObject().put("title", "altered"))
            try { api.postEvents(host, JSONArray().put(conflict)); fail("Expected conflict") }
            catch (error: ApiFailure) { assertEquals(409, error.status) }
            val visible = api.getEvents(host, 0, 100).getJSONArray("events")
            assertTrue((0 until visible.length()).any { visible.getJSONObject(it).getString("eventId") == original[0].eventId })
            assertEquals(0, SyncManager(store, api).syncOnce(host).uploaded)
        } finally {
            host?.let { try { api.logout(it) } catch (_: Exception) { } }
            store.close()
            context.deleteDatabase(name)
        }
    }
}
