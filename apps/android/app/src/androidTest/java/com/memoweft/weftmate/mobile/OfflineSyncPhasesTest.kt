package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONArray

/** Run setup, offline, resume in separate instrumentation invocations with one syncRunId. */
@RunWith(AndroidJUnit4::class)
class OfflineSyncPhasesTest {
    @Test fun phase() {
        val args = InstrumentationRegistry.getArguments()
        val phase = args.getString("syncPhase") ?: throw AssertionError("Pass syncPhase=setup|offline|resume")
        val runId = args.getString("syncRunId") ?: throw AssertionError("Pass stable synthetic syncRunId")
        require(runId.matches(Regex("[A-Za-z0-9_-]{1,40}")))
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val settings = SecureSettings(context, "phase-host-$runId", "phase-host-key-$runId")
        val store = LocalStore(context, "phase-events-$runId.db")
        val api = PersonalApi()
        try {
            when (phase) {
                "setup" -> {
                    assertNull("Use a new syncRunId for another three-phase trial", settings.host())
                    val origin = args.getString("syncOrigin") ?: throw AssertionError("Missing syncOrigin")
                    val user = args.getString("syncUser") ?: throw AssertionError("Missing syncUser")
                    val password = args.getString("syncPassword") ?: throw AssertionError("Missing synthetic syncPassword")
                    val host = api.login(origin, user, password, "Synthetic Offline Phase")
                    settings.saveHost(host)
                    assertNotNull(settings.host())
                    assertTrue(store.listConversations(Endpoints.ownerKey(host.origin, host.ownerId)).isEmpty())
                    println("PHASE_READY=setup; stop only the isolated host before offline phase")
                }
                "offline" -> {
                    val host = settings.host() ?: throw AssertionError("Run setup first")
                    val owner = Endpoints.ownerKey(host.origin, host.ownerId)
                    assertTrue(store.listConversations(owner).isEmpty())
                    val conversation = store.createConversation("离线手机记录", owner)
                    store.addMessage(conversation.id, "user", "电脑断开时仍保留在手机")
                    val turn = store.startTurn(conversation.id)
                    store.finishTurn(turn, "interrupted")
                    val stableIds = store.pending(owner).map { it.eventId }
                    assertEquals(3, stableIds.size)
                    try { SyncManager(store, api).syncOnce(host); fail("Host must be offline in this phase") }
                    catch (_: Exception) { /* expected unreachable host; no local state is cleared */ }
                    assertEquals(stableIds, store.pending(owner).map { it.eventId })
                    println("PHASE_READY=offline; local events persisted; restart the same isolated host")
                }
                "resume" -> {
                    val host = settings.host() ?: throw AssertionError("Run setup first")
                    val owner = Endpoints.ownerKey(host.origin, host.ownerId)
                    val pending = store.pending(owner)
                    assertEquals(3, pending.size)
                    val first = SyncManager(store, api).syncOnce(host)
                    assertEquals(3, first.uploaded)
                    assertTrue(store.pending(owner).isEmpty())
                    assertEquals(0, SyncManager(store, api).syncOnce(host).uploaded)
                    val repeated = api.postEvents(host, JSONArray().put(pending[0].body)).getJSONArray("accepted")
                    assertTrue(repeated.getJSONObject(0).getBoolean("duplicate"))
                    val hostEvents = api.getEvents(host, 0, 100).getJSONArray("events")
                    for (event in pending) assertTrue((0 until hostEvents.length()).any {
                        hostEvents.getJSONObject(it).getString("eventId") == event.eventId
                    })
                    println("PHASE_READY=resume; stable IDs accepted once and duplicate receipt verified")
                }
                else -> throw AssertionError("Unknown phase")
            }
        } finally { store.close() }
    }
}
