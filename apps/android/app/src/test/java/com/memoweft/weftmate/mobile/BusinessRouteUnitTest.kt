package com.memoweft.weftmate.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BusinessRouteUnitTest {
    @Test fun workspaceReviewAndFilesUseConversationScopedRoutes() {
        for (suffix in listOf("review/status", "review/diff", "files/list", "files/search", "files/read", "files/save"))
            assertTrue(validBusinessPath("/personal/v1/workspaces/session-one/$suffix"))
        for (route in listOf("/personal/v1/workspaces/session-one/files/delete", "/personal/v1/workspaces/browser-session/files/delete", "/personal/v1/workspaces/session-one/files/read?path=../outside", "/personal/v1/workspaces/../files/read", "/personal/v1/workspaces/session-one/review/raw", "/personal/v1/workspaces/session-one/files%2Fread"))
            assertFalse(route, validBusinessPath(route))
        assertTrue(businessHttpResponseLimit("/personal/v1/workspaces/session-one/files/read") >= 12 * 1024 * 1024)
    }

    @Test fun terminalRoutesKeepExactIdentities() {
        assertTrue(validBusinessPath("/personal/v1/terminals"))
        assertTrue(validBusinessPath("/personal/v1/terminals/terminal-00000000-0000-4000-8000-000000000001"))
        assertTrue(validBusinessPath("/personal/v1/terminals/terminal-00000000-0000-4000-8000-000000000001/release"))
        assertFalse(validBusinessPath("/personal/v1/terminals?ownerId=other"))
        assertFalse(validBusinessPath("/personal/v1/terminals/../auth/desktop"))
        assertFalse(validBusinessPath("/personal/v1/terminals/raw/connect"))
    }
    @Test fun projectFolderChangeKeepsExactProjectPath() {
        assertTrue(validBusinessPath("/personal/v1/projects/project-folder"))
        assertTrue(validBusinessMethod("/personal/v1/projects/project-folder", "PATCH"))
        assertFalse(validBusinessPath("/personal/v1/projects/project-folder/relocate"))
        assertFalse(validBusinessPath("/personal/v1/projects/project-folder?rootPath=another"))
    }

    @Test fun commandOutputUsesBoundedDetailPages() {
        val detail="/personal/v1/sessions/session-one/events/12/detail"
        assertTrue(validBusinessPath(detail))
        assertTrue(validBusinessPath("$detail?outputOffset=64000"))
        for (query in listOf("outputOffset=-1", "outputOffset=1&ownerId=other", "outputOffset=x", "outputOffset=9999999999999999")) assertFalse(validBusinessPath("$detail?$query"))
    }
    @Test fun slashCommandsUseExactSessionRoute() {
        assertEquals(125_000, businessReadTimeout("/personal/v1/sessions/session-one/slash-commands", "POST"))
        assertEquals(20_000, businessReadTimeout("/personal/v1/sessions/session-one/slash-commands", "GET"))
        assertTrue(validBusinessPath("/personal/v1/sessions/session-one/slash-commands"))
        assertFalse(validBusinessPath("/personal/v1/sessions/session-one/slash-commands?ownerId=other"))
        assertFalse(validBusinessPath("/personal/v1/sessions/session-one/slash-commands/raw"))
    }
    @Test fun workModeUsesExistingExactSessionProjectAndApprovalRoutes() {
        for (route in listOf("/personal/v1/sessions?archived=all", "/personal/v1/projects", "/personal/v1/projects/project-mode/sessions", "/personal/v1/chats/chat-mode/events?limit=200")) assertTrue(route, validBusinessPath(route))
        assertEquals("/personal/v1/sessions/session-mode/approvals?limit=50", approvalListPath("session-mode"))
        val approvalId = "00000000-0000-4000-8000-000000000001"
        assertEquals("/personal/v1/sessions/session-mode/approvals/$approvalId", approvalDecisionPath("session-mode", approvalId, "mode-request", "allowed-once"))
        for (route in listOf("/personal/v1/work-mode", "/personal/v1/sessions/session-mode/approvals/approval-mode/raw", "/personal/v1/sessions/../approvals", "/personal/v1/projects?ownerId=other")) assertFalse(route, validBusinessPath(route))
    }
    @Test fun nativeWorkSelectionAndMetadataStayOnExistingRoutes() {
        for(route in listOf("/personal/v1/projects/project-mode/sessions","/personal/v1/sessions/session-mode/metadata","/personal/v1/chats/chat-mode","/personal/v1/chats?limit=200"))assertTrue(route,validBusinessPath(route))
        for(route in listOf("/personal/v1/projects/project-mode/sessions/raw","/personal/v1/projects/../sessions","/personal/v1/sessions/session-mode/metadata?hostId=other"))assertFalse(route,validBusinessPath(route))
    }
    @Test fun modelServicesUseOnlyExactServiceDirectoryAndSelectionRoutes() {
        val service = "/personal/v1/model-services/model-service-00000000-0000-4000-8000-000000000001"
        for (route in listOf("/personal/v1/model-services", "/personal/v1/model-services/check", service, "$service/refresh", "$service/select")) assertTrue(route, validBusinessPath(route))
        for (route in listOf("/personal/v1/model-services?ownerId=other", "/personal/v1/model-services/check/raw", "/personal/v1/model-services/model-one/select", "$service/secret", "$service/select?modelId=other", "/personal/v1/model-services%2Fcheck", "/personal/v1/model-services/../select")) assertFalse(route, validBusinessPath(route))
    }
    @Test fun phoneMemoryHandoverAndErasureKeepTheExistingExactRoutes() {
        for (route in listOf("/personal/v1/offline/sync", "/personal/v1/offline/turns", "/personal/v1/memory/status", "/personal/v1/memory/backfill")) assertTrue(route, validBusinessPath(route))
        for (route in listOf("/personal/v1/offline/forget", "/personal/v1/offline/turns?ownerId=other", "/personal/v1/offline/turns/raw", "/personal/v1/offline%2Fturns")) assertFalse(route, validBusinessPath(route))
    }
    @Test fun computerCloudRoutesAreNotComputerBusinessRoutes() {
        for (path in listOf("/personal/v1/cloud/hosts/rename", "/personal/v1/cloud/hosts/remove", "/personal/v1/auth/cloud-channel")) assertFalse(path, validBusinessPath(path))
    }
    @Test fun replyChangeWaitOutlivesTheServerBudgetWithoutChangingOtherReads() {
        assertEquals(30_000, businessReadTimeout("/personal/v1/chats/main/changes?afterSeq=1&waitMs=25000", "GET"))
        assertEquals(30_000, businessReadTimeout("/personal/v1/chats/chat-one/events?waitMs=25000", "GET"))
        assertEquals(35_000, businessReadTimeout("/personal/v1/chats/chat-one/changes?waitMs=30000", "GET"))
        for (path in listOf("/personal/v1/system", "/personal/v1/chats/main/changes?waitMs=0", "/personal/v1/chats/main/changes?waitMs=invalid", "/personal/v1/system?waitMs=25000")) assertEquals(20_000, businessReadTimeout(path, "GET"))
        assertEquals(20_000, businessReadTimeout("/personal/v1/chats/main/changes?waitMs=25000", "POST"))
        assertEquals(360_000, businessReadTimeout("/personal/v1/system/host/restart", "POST"))
        assertEquals(120_000, businessReadTimeout("/personal/v1/sessions/session-one/message-branches", "POST"))
    }
    @Test fun catchupAccountRecordsAndForgetPreviewsKeepExactPaths() {
        for (path in listOf("/personal/v1/execution-records?type=write&projectId=none&limit=100", "/personal/v1/account/models", "/personal/v1/account/models/check", "/personal/v1/account/models/model-one/test", "/personal/v1/chats/chat-one/forget-preview", "/personal/v1/sessions/session-one/forget-preview", "/personal/v1/usage?timeZone=Asia%2FShanghai&month=2026-10")) assertTrue(path, validBusinessPath(path))
        for (path in listOf("/personal/v1/execution-records/raw", "/personal/v1/execution-records?type=<script>", "/personal/v1/account/models/model-one/secret", "/personal/v1/account/models%2Fcheck", "/personal/v1/auth/desktop", "/personal/v1/sessions/../forget-preview", "/personal/v1/chats/chat-one/forget-preview/raw")) assertFalse(path, validBusinessPath(path))
        assertEquals("/personal/v1/sessions/session-one/approvals/00000000-0000-4000-8000-000000000001", approvalDecisionPath("session-one", "00000000-0000-4000-8000-000000000001", "request-one", "allowed-once", "global-category"))
        assertThrows(IllegalArgumentException::class.java) { approvalDecisionPath("session-one", "00000000-0000-4000-8000-000000000001", "request-one", "rejected", "global-category") }
    }
    @Test fun healthV3RoutesAllowOnlyExactAggregatePathsAndQueries() {
        assertTrue(validBusinessMethod("/personal/v1/health/profile", "PUT"))
        for (route in listOf("/personal/v1/health/profile", "/personal/v1/health/analysis", "/personal/v1/health/analysis?day=2026-10-12", "/personal/v1/health/weekly", "/personal/v1/health/weekly?to=2026-10-12", "/personal/v1/health/metrics/stress?days=7&to=2026-10-12", "/personal/v1/health/metrics/energy?to=2026-10-12&days=30", "/personal/v1/health/metrics/fitnessAge?to=2026-10-12", "/personal/v1/health/metrics/vo2Max")) assertTrue(route, validBusinessPath(route))
        for (route in listOf("/personal/v1/health/profile?ownerId=other", "/personal/v1/health/profile/raw", "/personal/v1/health/analysis?scope=stress", "/personal/v1/health/analysis?day=2026-10-12&day=2026-10-11", "/personal/v1/health/analysis?day=2026-10-12&ownerId=other", "/personal/v1/health/weekly?to=2026-99-01", "/personal/v1/health/metrics/stress?days=7&to=2026-10-12&to=2026-10-11", "/personal/v1/health/metrics/stress?days=7&ownerId=other", "/personal/v1/health/metrics/bodyAge", "/personal/v1/health%2Fanalysis")) assertFalse(route, validBusinessPath(route))
        assertFalse(validBusinessMethod("/personal/v1/health/profile/raw", "PUT"))
    }
    @Test fun healthAggregateRoutesRejectRawDataOwnersUnknownMetricsAndEncodedPaths() {
        assertTrue(validBusinessMethod("/personal/v1/health/records/batch", "PUT"))
        assertTrue(validBusinessMethod("/personal/v1/daily-summaries/2026-10-12/health", "PUT"))
        for (path in listOf("/personal/v1/settings/health", "/personal/v1/chats/main", "/personal/v1/health/records/batch?ownerId=other", "/personal/v1/daily-summaries/2026-10-12/health/raw")) assertFalse(validBusinessMethod(path, "PUT"))
        assertFalse(validBusinessMethod("/personal/v1/health/records/batch", "TRACE"))
        for (route in listOf("/personal/v1/health/overview", "/personal/v1/health/overview?day=2026-10-12", "/personal/v1/health/calendar?month=2026-10", "/personal/v1/health/metrics/hrvSdnnMs?days=30", "/personal/v1/health/metrics/recovery?days=90", "/personal/v1/health/metrics/usageLateNightMinutes?days=7", "/personal/v1/settings/health", "/personal/v1/health/records/batch", "/personal/v1/daily-summaries", "/personal/v1/daily-summaries/2026-10-12/health", "/personal/v1/health/suggestions/health-" + "a".repeat(32) + "/remind")) assertTrue(route, validBusinessPath(route))
        for (route in listOf("/personal/v1/health/raw", "/personal/v1/health/overview?ownerId=other", "/personal/v1/health/overview?day=2026-10-12&day=2026-10-11", "/personal/v1/health/metrics/unknown?days=7", "/personal/v1/health/metrics/sleep?days=365", "/personal/v1/health/metrics/sleep?days=7&ownerId=other", "/personal/v1/health/metrics%2Fsleep", "/personal/v1/health/calendar?month=2026-99", "/personal/v1/settings/health?raw=1", "/personal/v1/health/records/batch/all", "/personal/v1/health/suggestions/../remind", "/personal/v1/daily-summaries/2026-10-12/health/raw")) assertFalse(route, validBusinessPath(route))
    }
    @Test fun accountDataControlsUseOnlyExactRoutesWithoutQueries() {
        for (suffix in listOf("", "/operations", "/scan", "/clean", "/export", "/delete", "/close-account", "/cancel", "/confirm")) assertTrue(validBusinessPath("/personal/v1/data$suffix"))
        for (route in listOf("/personal/v1/data/all", "/personal/v1/data/../delete", "/personal/v1/data?ownerId=other", "/personal/v1/data/export?destination=C%3A%2F", "/personal/v1/data%2Fdelete")) assertFalse(route, validBusinessPath(route))
    }
    @Test fun accountSearchReusesTheExactChatListRoute() {
        assertTrue(validBusinessPath("/personal/v1/chats?scope=search&q=%E7%BA%B8%E8%88%B9&limit=200"))
        assertTrue(validBusinessPath("/personal/v1/chats?scope=search&cursor=chat-search-next&limit=200"))
        assertFalse(validBusinessPath("/personal/v1/search"))
        assertFalse(validBusinessPath("/personal/v1/chats?scope=search&q=<script>"))
        assertFalse(validBusinessPath("/personal/v1/chats/../search"))
    }
    @Test fun nextSuggestionsUseOnlyTheirExactSessionRouteAndCancellationId() {
        assertTrue(validBusinessPath("/personal/v1/sessions/session-one/suggestions"))
        assertTrue(validBusinessPath("/personal/v1/sessions/session-one/suggestions?requestId=ux7-request:1"))
        assertTrue(validBusinessPath("/personal/v1/sessions/session-one/suggestions?requestId=ux7-request%3A1"))
        assertTrue(validBusinessPath("/personal/v1/sessions/session-one/suggestions?requestId=ux7-request%3a1"))
        assertTrue(validBusinessPath("/personal/v1/sessions/" + "s".repeat(128) + "/suggestions?requestId=" + "%3A".repeat(128)))
        for (path in listOf("/personal/v1/suggestions", "/personal/v1/sessions/../suggestions",
            "/personal/v1/sessions/session%2Fone/suggestions", "/personal/v1/sessions/session-one/suggestions/raw",
            "/personal/v1/sessions/session-one/suggestions?requestId=", "/personal/v1/sessions/session-one/suggestions?ownerId=other",
            "/personal/v1/sessions/session-one/suggestions?requestId=one&ownerId=other",
            "/personal/v1/sessions/session-one/suggestions?requestId=%2F", "/personal/v1/sessions/session-one/suggestions?requestId=ux7%253A1",
            "/personal/v1/sessions/session-one/suggestions?requestId=%5C", "/personal/v1/sessions/session-one/suggestions?requestId=" + "a".repeat(129)))
            assertFalse(path, validBusinessPath(path))
    }
    @Test fun sessionPagingAndEncodedSearchUseTheExistingBusinessTransport() {
        assertTrue(validBusinessPath("/personal/v1/sessions?archived=all&limit=100&cursor=session-next&q=%E7%BA%B8"))
        assertTrue(validBusinessPath("/personal/v1/sessions?q=" + "%E7%BA%B8".repeat(256)))
        assertFalse(validBusinessPath("/personal/v1/sessions/session-next"))
        assertFalse(validBusinessPath("/personal/v1/sessions?q=<script>"))
    }
    @Test fun goalsPageSchedulesAndLongTermGoalsUseExactAccountRoutes() {
        for (path in listOf("/personal/v1/schedules", "/personal/v1/schedules/session-one/schedule-1",
            "/personal/v1/schedules/session-one/schedule-1/pause", "/personal/v1/schedules/session-one/schedule-1/resume",
            "/personal/v1/schedules/session-one/schedule-1/run", "/personal/v1/goals",
            "/personal/v1/goals/session-one/complete", "/personal/v1/goals/session-one/archive"))
            assertTrue(path, validBusinessPath(path))
        for (path in listOf("/personal/v1/schedules?ownerId=other", "/personal/v1/schedules/session-one",
            "/personal/v1/schedules/session-one/schedule-1/delete", "/personal/v1/schedules/../goals",
            "/personal/v1/goals/session-one", "/personal/v1/goals/session-one/clear", "/personal/v1/goals/session%2Fone/archive"))
            assertFalse(path, validBusinessPath(path))
    }
    @Test fun libraryOnlyReadsIndexedOutputRoutes() {
        assertTrue(validBusinessPath("/personal/v1/library?type=image&search=%E5%9B%BE&cursor=" + "a".repeat(800)))
        assertTrue(validBusinessPath("/personal/v1/library/artifact-one"))
        assertTrue(validBusinessPath("/personal/v1/library/artifact-one/preview"))
        for (path in listOf("/personal/v1/library/artifact-one/open", "/personal/v1/library/artifact-one/show",
            "/personal/v1/library/../preview", "/personal/v1/library/artifact%2Fone/preview", "/personal/v1/library/file/raw"))
            assertFalse(path, validBusinessPath(path))
    }

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
        assertTrue("Approval mode can be saved before the first native session exists", validBusinessPath("/personal/v1/chats/chat-one"))
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
