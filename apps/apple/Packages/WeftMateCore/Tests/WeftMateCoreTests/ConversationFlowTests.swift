import Foundation
import Testing
@testable import WeftMateCore

@Suite struct ConversationFlowTests {
    private func event(_ seq: Int, _ type: String, _ values: [String: JSONValue]) -> TimelineEvent { .init(seq: seq, type: type, data: .object(values)) }
    private func step(_ seq: Int, _ id: String, _ tool: String, _ state: String = "completed") -> TimelineEvent {
        event(seq, state == "running" ? "step.started" : "step.completed", ["taskId": .string("turn-1"), "stepId": .string(id), "toolName": .string(tool), "state": .string(state), "summary": .string("读取文件 notes.md")])
    }
    @Test func orderedGroupsSummaryAndLateUpdates() {
        let events = [step(1, "a", "read", "running"), step(2, "b", "shell"), event(3, "assistant.message", ["text": .string("已核对资料")]), step(4, "c", "search"), step(5, "a", "read")]
        let rows = TimelineProjection.entries(events)
        #expect(rows.map(\.seq) == [1, 3, 4])
        #expect(rows[0].steps.map(\.id) == ["turn-1/a", "turn-1/b"])
        #expect(ToolProgressSummary.text(rows[0]) == "读取了 1 个文件、已运行 1 个命令")
        #expect(ToolProgressSummary.text(rows[2]) == "搜索了 1 次")
        #expect(TimelineProjection.entries([event(1, "assistant.message", [:])]).allSatisfy { $0.steps.isEmpty })
    }
    @Test func runningFailureStopAndApprovalKeepStableSteps() {
        let running = TimelineProjection.entries([step(1, "a", "read", "running")])[0]
        #expect(ToolProgressSummary.text(running) == "正在读取文件 notes.md…")
        let rows = TimelineProjection.entries([step(1, "a", "read"), event(2, "approval.requested", ["approvalId": .string("approval"), "stepId": .string("a")]), event(3, "approval.resolved", ["approvalId": .string("approval"), "stepId": .string("a"), "outcome": .string("allowed-once")]), step(4, "b", "shell", "failed")])
        #expect(rows[0].steps.count == 2)
        #expect(rows[0].steps[0].decision == "已批准")
        #expect(ToolProgressSummary.text(rows[0]) == "第 2 步失败")
        let stopped = TimelineProjection.entries([step(1, "a", "read", "running"), event(2, "turn.ended", ["turn": .number(1), "reason": .string("aborted")])])[0]
        #expect(stopped.stopped && !stopped.running)
        #expect(ToolProgressSummary.text(stopped).hasPrefix("已停止"))
    }
    @Test func contextRealValuesUnknownLimitAndWarning() throws {
        let value = try JSONDecoder().decode(ConversationContextUsage.self, from: Data(#"{"usedTokens":713111,"contextWindow":828000}"#.utf8))
        #expect(value.warning && value.label == "背景信息窗口：86% 已用 / 已用 713.1k 标记，共 828.0k")
        let unknown = try JSONDecoder().decode(ConversationContextUsage.self, from: Data(#"{"usedTokens":1234,"contextWindow":null}"#.utf8))
        #expect(unknown.fraction == nil && !unknown.warning && unknown.label == "背景信息窗口：已用 1.2k 标记")
        #expect(!ConversationContextUsage(usedTokens: 799, contextWindow: 1000).warning)
        #expect(ConversationContextUsage(usedTokens: 800, contextWindow: 1000).warning)
    }
    @Test func followGrowthHistoryAndReturn() {
        var value = ConversationFollowState()
        let initiallyFollowing = value.contentChanged(); #expect(initiallyFollowing)
        value.userScrolled(distanceFromBottom: 200)
        let whileReading = value.contentChanged(); #expect(!whileReading && value.hasNewContent && !value.following)
        value.returnToBottom()
        let resumed = value.contentChanged(); #expect(resumed && !value.hasNewContent)
        value.userScrolled(distanceFromBottom: 48)
        #expect(value.following)
    }
    @Test func buttonThreeStatesIncludingWhitespaceAndAttachments() {
        #expect(ComposerAction.resolve(running: false, text: "") == .send)
        #expect(ComposerAction.resolve(running: true, text: " \n") == .stop)
        #expect(ComposerAction.resolve(running: true, text: "排队任务") == .send)
        #expect(ComposerAction.resolve(running: true, text: "", attachments: true) == .send)
    }
    @Test func waitingUsesHostPhaseAndDisappearsOnContent() {
        #expect(ConversationProcessing(phase: "loading", modelName: "Synthetic Muse").label == "正在加载模型 Synthetic Muse…")
        #expect(ConversationProcessing(phase: "reasoning").label == "正在思考…")
        #expect(ConversationProcessing.visible(events: [], running: true, phase: "loading"))
        #expect(!ConversationProcessing.visible(events: [], running: false, phase: "waiting"))
        #expect(!ConversationProcessing.visible(events: [step(1, "a", "read")], running: true, phase: "waiting"))
        #expect(!ConversationProcessing.visible(events: [event(1, "assistant.message", [:])], running: true, phase: "reasoning"))
        #expect(ConversationProcessing.visible(events: [event(1, "assistant.message", [:]), event(2, "turn.started", [:])], running: true, phase: "queued"))
    }
}
