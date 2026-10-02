package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/** Synthetic owners only. No server login, model request or Intent launch. */
@RunWith(AndroidJUnit4::class)
class MultiAccountIsolationTest {
    @Test fun queuedAccountACallbackCannotReachAccountBAfterSwitch() {
        val epoch = AtomicLong(0)
        val queued = mutableListOf<() -> Unit>()
        val observed = mutableListOf<String>()
        AccountEventGate.post(0, epoch::get, { queued += it }) { observed += "A reply" }
        epoch.incrementAndGet() // B becomes current before Android delivers A's already queued callback.
        queued.removeAt(0).invoke()
        assertTrue(observed.isEmpty())
        AccountEventGate.post(1, epoch::get, { queued += it }) { observed += "B reply" }
        queued.removeAt(0).invoke()
        assertEquals(listOf("B reply"), observed)
    }

    @Test fun oldHostOwnsMigratedModelAndUnknownUnboundConversationStaysUnclaimed() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val prefsName = "synthetic-legacy-$suffix"
        val alias = "synthetic-legacy-$suffix"
        val database = "synthetic-owners-$suffix.db"
        val a = HostIdentity("https://home.example", "alice", "owner-a", "host", "device-a", "synthetic-a", "csrf-a")
        val b = HostIdentity("https://home.example", "bob", "owner-b", "host", "device-b", "synthetic-b", "csrf-b")
        val scopeA = Endpoints.ownerKey(a.origin, a.ownerId)
        val scopeB = Endpoints.ownerKey(b.origin, b.ownerId)
        val store = LocalStore(context, database)
        try {
            val settings = SecureSettings(context, prefsName, alias)
            val encrypt = SecureSettings::class.java.getDeclaredMethod("encrypt", String::class.java)
                .apply { isAccessible = true }
            val host = JSONObject().put("origin", a.origin).put("username", a.username)
                .put("ownerId", a.ownerId).put("hostId", a.hostId).put("deviceId", a.deviceId)
                .put("cookie", a.cookie).put("csrf", a.csrf)
            val oldModel = JSONObject().put("endpoint", "https://old.example/v1")
                .put("modelId", "old-model").put("apiKey", "synthetic-old-key")
            val prefs = context.getSharedPreferences(prefsName, android.content.Context.MODE_PRIVATE)
            assertTrue(prefs.edit().putString("host", encrypt.invoke(settings, host.toString()) as String)
                .putString("model", encrypt.invoke(settings, oldModel.toString()) as String).commit())
            val unbound = store.createConversation("旧未归属记录", null)
            store.addMessage(unbound.id, "user", "合成旧记录")
            val conversationA = store.createConversation("A 的记录", scopeA)
            store.addMessage(conversationA.id, "user", "合成 A 消息")
            val conversationB = store.createConversation("B 的记录", scopeB)
            store.addMessage(conversationB.id, "user", "合成 B 消息")
            assertEquals(scopeA, settings.legacyOwnerScope())
            assertEquals("old-model", settings.model(scopeA)?.modelId)
            settings.saveHost(b)
            assertNull(settings.model(scopeB))
            assertEquals(listOf(conversationB.id), store.listConversations(scopeB).map { it.id })
            assertEquals(listOf(conversationA.id), store.listConversations(scopeA).map { it.id })
            assertEquals(1, store.unboundConversationCount())
            assertTrue(store.messages(unbound.id, scopeB).isEmpty())
            settings.clearHost()
            assertEquals(1, store.unboundConversationCount())
            assertEquals(scopeA, settings.legacyOwnerScope())
        } finally {
            store.close()
            context.deleteDatabase(database)
            context.deleteSharedPreferences(prefsName)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }

    @Test fun notificationInboxAndCategoryAreScopedPerOwner() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val a = Endpoints.ownerKey("https://synthetic.example", "owner-${UUID.randomUUID()}")
        val b = Endpoints.ownerKey("https://synthetic.example", "owner-${UUID.randomUUID()}")
        val prefs = context.getSharedPreferences("mobile-notifications", android.content.Context.MODE_PRIVATE)
        try {
            val first = MobileNotifications(context, a)
            val second = MobileNotifications(context, b)
            first.setEnabled("reply", false)
            assertFalse(NotificationScopeGate.mayShow(a, b, false, false))
            assertFalse(NotificationScopeGate.mayShow(a, "local", false, false))
            assertFalse(NotificationScopeGate.mayShow(a, a, false, true))
            assertTrue(NotificationScopeGate.mayShow(a, a, false, false))
            first.record("reply", "合成 A 回执", "仅 A 可见",
                showSystem = NotificationScopeGate.mayShow(a, b, false, false))
            assertEquals(1, first.inbox().length())
            assertEquals(0, second.inbox().length())
            assertFalse(first.state().getJSONObject("categories").getBoolean("reply"))
            assertTrue(second.state().getJSONObject("categories").getBoolean("reply"))
        } finally {
            assertTrue(prefs.edit().remove("$a:enabled:reply").remove("$a:inbox")
                .remove("$b:enabled:reply").remove("$b:inbox").commit())
        }
    }
}
