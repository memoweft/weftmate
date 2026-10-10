package com.memoweft.weftmate.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BusinessRouteUnitTest {
    @Test fun notificationsUseOnlyExactAccountSettingsRoutes() {
        assertTrue(validBusinessPath("/personal/v1/settings/notifications"))
        assertTrue(validBusinessPath("/personal/v1/settings/notifications/test"))
        assertFalse(validBusinessPath("/personal/v1/settings/notifications?ownerId=other"))
        assertFalse(validBusinessPath("/personal/v1/settings/notifications/test/raw"))
    }
    @Test fun logicalChatHistoryAndCommandsUseTheirNativeAccountRoutes() {
        assertTrue(validBusinessPath("/personal/v1/chats/main"))
        assertTrue(validBusinessPath("/personal/v1/chats/chat-one/events?around=event-one&limit=200"))
        assertTrue(validBusinessPath("/personal/v1/chats/chat-one/search?q=%E7%BA%B8%E8%88%B9"))
        assertTrue(validBusinessPath("/personal/v1/chats/chat-one/search?q=%E7%BA%B8%E8%88%B9&cursor=" + "a".repeat(800)))
        assertTrue(validBusinessPath("/personal/v1/chats/chat-one/locate?date=2026-10-03"))
        assertTrue(validBusinessPath("/personal/v1/commands"))
        for(path in listOf("/personal/v1/chats/../events", "/personal/v1/chats/chat%2Fone/events", "/personal/v1/chats/chat-one/credentials"))
            assertFalse(path, validBusinessPath(path))
    }
    @Test fun personalizationUsesOnlyExactSettingsRoutes() {
        assertTrue(validBusinessPath("/personal/v1/settings/personalization"))
        assertTrue(validBusinessPath("/personal/v1/settings/personalization/style"))
        assertFalse(validBusinessPath("/personal/v1/settings/personalization?ownerId=other"))
        assertFalse(validBusinessPath("/personal/v1/settings/personalization/style/raw"))
    }
    @Test fun messageBranchesUseExactSessionAndCommandRoutes() {
        assertTrue(validBusinessPath("/personal/v1/sessions/session-one/message-branches"))
        assertTrue(validBusinessPath("/personal/v1/sessions/session-one/chat"))
        assertTrue(validBusinessPath("/personal/v1/chats/main"))
        assertTrue(validBusinessPath("/personal/v1/commands"))
        for (path in listOf("/personal/v1/sessions/../message-branches", "/personal/v1/commands?key=secret",
            "/personal/v1/sessions/session%2Fone/message-branches", "/personal/v1/commands/command/raw"))
            assertFalse(path, validBusinessPath(path))
    }
    @Test fun temporaryCreationUsesOnlyItsExactBusinessRoute() {
        assertTrue(validBusinessPath("/personal/v1/sessions/temporary"))
        assertFalse(validBusinessPath("/personal/v1/sessions/temporary?recallEnabled=false"))
        assertFalse(validBusinessPath("/personal/v1/sessions/temporary/events"))
    }
    @Test fun conversationResourcesUseAnExactRouteAndForwardCursor() {
        assertTrue(validBusinessPath("/personal/v1/sessions/session-one/resources"))
        assertTrue(validBusinessPath("/personal/v1/sessions/session-one/resources?afterSeq=-1"))
        assertTrue(validBusinessPath("/personal/v1/sessions/session-one/resources?afterSeq=120"))
        for (path in listOf("/personal/v1/sessions/../resources", "/personal/v1/sessions/session%2fone/resources",
            "/personal/v1/sessions/session-one/resources/raw", "/personal/v1/sessions/session-one/resources?afterSeq=-2",
            "/personal/v1/sessions/session-one/resources?afterSeq=1&token=secret"))
            assertFalse(path, validBusinessPath(path))
    }
    @Test fun approvalModeUsesOnlyTheAccountDefaultAndExactConversationRoutes() {
        assertTrue(validBusinessPath("/personal/v1/settings/approvals"))
        assertTrue(validBusinessPath("/personal/v1/sessions/session-one/approval-mode"))
        for (path in listOf("/personal/v1/settings/approvals/secret", "/personal/v1/settings/approvals?mode=ask",
            "/personal/v1/sessions/session-one/approval-mode?mode=ask", "/personal/v1/sessions/../approval-mode",
            "/personal/v1/sessions/session%2fone/approval-mode", "/personal/v1/sessions/session-one/events"))
            assertFalse(path, validBusinessPath(path))
    }
    @Test fun systemStatusAndRestartUseOnlyTheirExplicitRoutes() {
        assertTrue(validBusinessPath("/personal/v1/system"))
        assertTrue(validBusinessPath("/personal/v1/settings/models"))
        assertTrue(validBusinessPath("/personal/v1/system/model/restart"))
        assertTrue(validBusinessPath("/personal/v1/system/host/restart"))
        assertTrue(validBusinessPath("/personal/v1/system/memory/restart"))
        assertFalse(validBusinessPath("/personal/v1/system/shell/restart"))
        assertFalse(validBusinessPath("/personal/v1/settings/credentials"))
    }
    @Test fun encodedMemoryColonKeepsTheFixedBusinessRoute() {
        assertTrue(validBusinessPath("/personal/v1/memory/items/entity/memory%3Aa%3Acolon"))
        assertTrue(validBusinessPath("/personal/v1/memory/commands/by-request/memory-ui-abc"))
    }

    @Test fun encodedRouteSeparatorsAndDoubleEncodingStayRejected() {
        for (path in listOf(
            "/personal/v1/memory/items/entity/memory%2Fa",
            "/personal/v1/memory/items/entity/memory%253Aa",
            "/personal/v1/memory/items/entity/memory%ZZ",
            "/personal/v1/memory/%2E%2E/status",
            "/personal/v1/memory/items/entity/memory%5Ca",
        )) assertFalse(path, validBusinessPath(path))
    }
}
