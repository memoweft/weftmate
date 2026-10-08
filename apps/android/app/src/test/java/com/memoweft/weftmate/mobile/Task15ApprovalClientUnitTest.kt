package com.memoweft.weftmate.mobile

import org.junit.Assert.*
import org.junit.Test

class Task15ApprovalClientUnitTest {
    private val approvalId = "12345678-1234-4234-8234-123456789abc"

    @Test fun categoryPermissionKeepsTheSameDecisionRouteAndRejectsScopeOnRejection() {
        for (scope in listOf("once", "conversation-category"))
            assertEquals("/personal/v1/sessions/session-one/approvals/$approvalId",
                approvalDecisionPath("session-one", approvalId, "ui:original.1", "allowed-once", scope))
        for (scope in listOf("once", "conversation-category", "account", ""))
            rejected { approvalDecisionPath("session-one", approvalId, "ui:original.1", "rejected", scope) }
        rejected { approvalDecisionPath("session-one", approvalId, "ui:original.1", "allowed-once", "account") }
    }

    @Test fun listUsesOnlyTheExactSessionRouteAndOptionalCursor() {
        assertEquals("/personal/v1/sessions/session-one/approvals?limit=50", approvalListPath("session-one"))
        assertEquals("/personal/v1/sessions/session-one/approvals?limit=100&before=$approvalId",
            approvalListPath("session-one", approvalId, 100))
        assertEquals("/personal/v1/sessions/session-one/approvals?limit=1", approvalListPath("session-one", limit = 1))
    }

    @Test fun anEmptyOrForeignCursorAndOutOfRangeLimitsAreRejected() {
        for (cursor in listOf("", "other", "$approvalId/decide", "$approvalId?limit=1"))
            rejected { approvalListPath("session-one", cursor) }
        for (limit in listOf(0, 101)) rejected { approvalListPath("session-one", limit = limit) }
    }

    @Test fun decisionsAcceptOnlyOnceOrRejectionWithTheOriginalRequestId() {
        for (outcome in listOf("allowed-once", "rejected"))
            assertEquals("/personal/v1/sessions/session-one/approvals/$approvalId",
                approvalDecisionPath("session-one", approvalId, "ui:original.1", outcome))
        for (outcome in listOf("allowed", "allowed-always", "cancelled", "unavailable", ""))
            rejected { approvalDecisionPath("session-one", approvalId, "ui:original.1", outcome) }
        for (request in listOf("", "request/other", "x".repeat(129)))
            rejected { approvalDecisionPath("session-one", approvalId, request, "allowed-once") }
    }

    @Test fun exactApprovalRoutesDoNotExpandTheGenericBusinessAllowlist() {
        assertFalse(validBusinessPath("/personal/v1/sessions/session-one/approvals"))
        assertFalse(validBusinessPath("/personal/v1/auth/devices"))
        assertFalse(validBusinessPath("/personal/v1/models"))
        for (session in listOf("../auth", "session%2fone", "session-one?limit=1", "session/other", "")) {
            rejected { approvalListPath(session) }
            rejected { approvalDecisionPath(session, approvalId, "ui-original", "rejected") }
        }
    }

    @Test fun questionListKeepsTheBatchCursorSeparateFromTaskAndPerQuestionIds() {
        assertEquals("/personal/v1/sessions/session-one/questions?limit=50", questionListPath("session-one"))
        assertEquals("/personal/v1/sessions/session-one/questions?limit=100&before=$approvalId",
            questionListPath("session-one", approvalId, 100))
        assertFalse(validBusinessPath("/personal/v1/sessions/session-one/questions"))
        for (cursor in listOf("", "per-question-id", "$approvalId/answers"))
            rejected { questionListPath("session-one", cursor) }
        for (limit in listOf(0, 101)) rejected { questionListPath("session-one", limit = limit) }
    }

    @Test fun questionAnswerRouteUsesTheRpcBatchIdAndOriginalRequestIdOnly() {
        assertEquals("/personal/v1/sessions/session-one/questions/$approvalId",
            questionAnswerPath("session-one", approvalId, "ui:answer.original.1"))
        for (rpc in listOf("", "single-question", "$approvalId?outcome=allowed-once"))
            rejected { questionAnswerPath("session-one", rpc, "ui-original") }
        for (session in listOf("../auth", "session%2fone", "session/other"))
            rejected { questionAnswerPath(session, approvalId, "ui-original") }
        for (request in listOf("", "request/other", "x".repeat(129)))
            rejected { questionAnswerPath("session-one", approvalId, request) }
    }

    private fun rejected(action: () -> Unit) {
        try { action(); fail("Expected invalid approval route or decision to be rejected") }
        catch (_: IllegalArgumentException) { }
    }
}
