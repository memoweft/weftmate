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
    @Test fun sharedOriginalFileReferenceSurvivesRestartAndStaysOwnerScoped() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "test-${UUID.randomUUID()}.db"
        val attachmentId = "attachment-11111111-1111-4111-8111-111111111111"
        val sessionId = "session-22222222-2222-4222-8222-222222222222"
        val reference = JSONObject().put("attachmentId", attachmentId).put("name", "notes.csv")
            .put("contentType", "text/csv").put("size", 42).put("sha256", "a".repeat(64))
        val event = JSONObject().put("seq", 7).put("type", "user.message")
            .put("data", JSONObject().put("text", "检查文件").put("originalAttachments", JSONArray().put(reference)))
        try {
            LocalStore(context, name).use { first ->
                first.saveSharedHistoryPage("owner-a", "host-a", sessionId, JSONArray().put(event), 7)
            }
            LocalStore(context, name).use { reopened ->
                assertEquals(reference.toString(), reopened.sharedOriginalAttachment(
                    "owner-a", "host-a", sessionId, attachmentId)?.toString())
                assertNull(reopened.sharedOriginalAttachment("owner-b", "host-a", sessionId, attachmentId))
                assertNull(reopened.sharedOriginalAttachment("owner-a", "host-b", sessionId, attachmentId))
                assertNull(reopened.sharedOriginalAttachment("owner-a", "host-a", sessionId,
                    "attachment-33333333-3333-4333-8333-333333333333"))
            }
        } finally { context.deleteDatabase(name) }
    }

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
