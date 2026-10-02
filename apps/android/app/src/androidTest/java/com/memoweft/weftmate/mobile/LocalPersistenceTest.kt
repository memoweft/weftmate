package com.memoweft.weftmate.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class LocalPersistenceTest {
    @Test fun localOutboxSurvivesRestartAndRequiresExplicitOwnerBinding() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "test-${UUID.randomUUID()}.db"
        try {
            val first = LocalStore(context, name)
            val conversation = first.createConversation("离线会话", null)
            first.addMessage(conversation.id, "user", "电脑离线时留下的文字")
            val turn = first.startTurn(conversation.id)
            first.close()

            val reopened = LocalStore(context, name)
            reopened.recoverInterruptedTurns()
            reopened.toolReceipt(conversation.id, "tool-${UUID.randomUUID()}", "open_settings", "dispatched", "已向系统派发")
            assertEquals(0, reopened.pending("owner-a").size)
            assertEquals(1, reopened.messages(conversation.id, null).size)
            assertTrue(reopened.timeline(conversation.id, null).any { it.text.contains("已向系统派发") })
            assertEquals(0, reopened.messages(conversation.id, "owner-b").size)
            reopened.bindUnboundTo("owner-a")
            val pending = reopened.pending("owner-a")
            assertEquals(listOf("conversation.created", "message.created", "turn.finished", "tool.receipt"), pending.map { it.body.getString("kind") })
            assertEquals("interrupted", pending[2].body.getJSONObject("payload").getString("status"))
            assertTrue(pending.zipWithNext().all { (a, b) -> a.body.getLong("clientSeq") < b.body.getLong("clientSeq") })
            reopened.markAccepted("owner-a", JSONArray().put(JSONObject().put("eventId", pending[0].eventId).put("seq", 1)))
            assertEquals(3, reopened.pending("owner-a").size)
            reopened.applyRemotePage("owner-a", JSONArray().put(JSONObject(pending[0].body.toString())
                .put("seq", 1).put("sourceDeviceId", "device-synthetic")), 1)
            assertEquals(1L, reopened.cursor("owner-a"))
            reopened.close()

            val finalStore = LocalStore(context, name)
            assertEquals(3, finalStore.pending("owner-a").size)
            assertEquals(1L, finalStore.cursor("owner-a"))
            assertEquals(1, finalStore.remoteEvents("owner-a").size)
            assertEquals(0, finalStore.messages(conversation.id, "owner-b").size)
            finalStore.close()
        } finally { context.deleteDatabase(name) }
    }

    @Test fun keystoreEncryptsCredentialBlobAndNeverStoresPassword() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val suffix = UUID.randomUUID().toString()
        val prefsName = "test-private-$suffix"
        val alias = "test-mobile-$suffix"
        try {
            val settings = SecureSettings(context, prefsName, alias)
            settings.saveHost(HostIdentity("https://example.test", "SyntheticUser", "owner-test", "host-test",
                "device-test", "wm_personal_session=synthetic-cookie", "synthetic-csrf"))
            settings.saveModel(ModelSettings("https://model.example/v1", "test-model", "synthetic-model-key"))
            val raw = context.getSharedPreferences(prefsName, 0).all.toString()
            assertFalse(raw.contains("synthetic-cookie"))
            assertFalse(raw.contains("synthetic-model-key"))
            assertEquals("device-test", SecureSettings(context, prefsName, alias).host()?.deviceId)
            assertEquals("synthetic-model-key", SecureSettings(context, prefsName, alias).model()?.apiKey)
            settings.clearHost()
            assertNull(settings.host())
        } finally {
            context.getSharedPreferences(prefsName, 0).edit().clear().commit()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }
}
