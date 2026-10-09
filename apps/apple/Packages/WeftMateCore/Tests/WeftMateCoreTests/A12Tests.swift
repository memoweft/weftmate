import Foundation
import Testing
@testable import WeftMateCore

private func a12Boolean(_ value: Bool) -> Bool { value }
private func snapshot(_ account: String = "synthetic", session: String = "session") -> WatchTimelineSnapshot {
    WatchTimelineSnapshot(accountKey: account, sessionID: session, taskID: "task", progress: "等待批准", running: true, assistantSummary: "", approvals: [WatchApproval(id: "approval", summary: "要运行命令：rm synthetic-draft.txt")], completedTaskIDs: [])
}
@Test func a12WatchDecisionAndDuplicateClick() {
    var state = WatchDecisionState(); state.apply(snapshot())
    #expect(a12Boolean(state.begin("approval", allowed: true, reachable: true)))
    #expect(a12Boolean(!state.begin("approval", allowed: true, reachable: true)))
    #expect(a12Boolean(!state.begin("approval", allowed: false, reachable: true)))
    state.finish("approval", registered: true)
    state.apply(snapshot()) // delayed application context cannot revive a decided card
    #expect(state.isRegistered("approval"))
    #expect(a12Boolean(!state.begin("approval", allowed: false, reachable: true)))
    state.apply(snapshot(session: "other"))
    #expect(a12Boolean(state.begin("approval", allowed: false, reachable: true)))
}
@Test func a12WatchUnreachableAndUncertainOriginalDecision() {
    var state = WatchDecisionState(); state.apply(snapshot())
    #expect(a12Boolean(!state.begin("approval", allowed: true, reachable: false)))
    #expect(state.inFlight == nil)
    #expect(a12Boolean(state.begin("approval", allowed: false, reachable: true)))
    state.finish("approval", registered: false)
    #expect(a12Boolean(!state.begin("approval", allowed: true, reachable: true)))
    #expect(a12Boolean(state.begin("approval", allowed: false, reachable: true)))
    state.apply(nil)
    state.finish("approval", registered: true)
    #expect(!state.isRegistered("approval"))
}
@Test func a12WatchCompletionFeedbackOnce() {
    var tracker = WatchFeedbackTracker()
    #expect(a12Boolean(tracker.apply(snapshot()).approval))
    let done = WatchTimelineSnapshot(accountKey: "synthetic", sessionID: "session", taskID: "task", progress: "已完成", running: false, assistantSummary: "", approvals: [], completedTaskIDs: ["task"])
    #expect(a12Boolean(tracker.apply(done).completed))
    #expect(a12Boolean(!tracker.apply(done).completed))
    #expect(a12Boolean(!tracker.apply(snapshot()).approval))
    var fresh = WatchFeedbackTracker(); #expect(a12Boolean(!fresh.apply(done).completed))
}
@MainActor private final class LoginService: LoginItemService {
    var state: LoginItemState = .notRegistered
    var nextState: LoginItemState = .enabled
    var fail = false
    var writes = 0
    func register() throws { writes += 1; state = nextState; if fail { throw NSError(domain: "SyntheticLoginItem", code: 7) } }
    func unregister() async throws { writes += 1; if fail { throw NSError(domain: "SyntheticLoginItem", code: 8) }; state = .notRegistered }
}
@Test @MainActor func a12LoginItemReadbackAndExternalChange() async {
    let service = LoginService(), control = LoginItemControl(service: LoginService())
    #expect(control.state == .notRegistered)
    let value = LoginItemControl(service: service)
    await value.setEnabled(true); #expect(value.state == .enabled); #expect(value.error == nil)
    await value.setEnabled(false); #expect(value.state == .notRegistered); #expect(service.writes == 2)
    service.state = .requiresApproval; value.refresh(); #expect(value.state.isOn)
    service.state = .notRegistered; value.refresh(); #expect(!value.state.isOn)
}
@Test @MainActor func a12LoginItemApprovalFailureAndUnconfirmed() async {
    let service = LoginService(), value = LoginItemControl(service: LoginService())
    #expect(value.error == nil)
    let control = LoginItemControl(service: service)
    service.nextState = .requiresApproval; await control.setEnabled(true)
    #expect(control.state == .requiresApproval); #expect(control.error == nil)
    service.fail = true; await control.setEnabled(false)
    #expect(control.state == .requiresApproval); #expect(control.error?.contains("SyntheticLoginItem 8") == true)
    #expect(!control.busy)
    service.fail = false; service.nextState = .notFound; await control.setEnabled(true)
    #expect(control.state == .notFound); #expect(control.error != nil)
}

@Test func a12WatchDecisionMessageUsesOnlyProjectionIDs() {
    let approve = WatchDecisionMessage(sessionID: "synthetic-session", approvalID: "synthetic-approval", allowed: true)
    #expect(approve.payload == ["action": "approval", "sessionID": "synthetic-session", "approvalID": "synthetic-approval", "outcome": "allowed-once"])
    let reject = WatchDecisionMessage(sessionID: approve.sessionID, approvalID: approve.approvalID, allowed: false)
    #expect(reject.payload["outcome"] == "rejected")
    #expect(reject.payload.keys.sorted() == ["action", "approvalID", "outcome", "sessionID"])
}
@Test @MainActor func a12WatchSDKRepliesFromBackgroundQueue() async {
    let reply: WatchMessageReply = await withCheckedContinuation { continuation in
        let handler = WatchMessageDelivery.reply { value in
            MainActor.assertIsolated()
            continuation.resume(returning: value)
        }
        Task.detached { handler(["registered": true, "snapshot": Data("synthetic".utf8)]) }
    }
    #expect(reply.registered)
    #expect(reply.snapshot == Data("synthetic".utf8))
    #expect(reply.error == nil)
    let failed: Bool = await withCheckedContinuation { continuation in
        let handler = WatchMessageDelivery.failure {
            MainActor.assertIsolated()
            continuation.resume(returning: true)
        }
        Task.detached { handler(URLError(.notConnectedToInternet)) }
    }
    #expect(failed)
}

@Test func a12RejectedAndAbortedTasksNeverBuzzSuccess() {
    let events: [TimelineEvent] = [
        .init(seq: 1, type: "task.ended", at: nil, data: .object(["taskId": .string("approved"), "reason": .string("completed")])),
        .init(seq: 2, type: "task.ended", at: nil, data: .object(["taskId": .string("rejected"), "reason": .string("aborted")])),
        .init(seq: 3, type: "task.ended", at: nil, data: .object(["taskId": .string("failed"), "reason": .string("error")])),
        .init(seq: 4, type: "task.ended", at: nil, data: .object(["taskId": .string("unknown")])),
    ]
    #expect(WatchTimelineProjection.successfulTaskIDs(in: events) == ["approved"])
    var tracker = WatchFeedbackTracker(); _ = tracker.apply(snapshot())
    let approved = WatchTimelineSnapshot(accountKey: "synthetic", sessionID: "session", taskID: "approved", progress: "已完成", running: false, assistantSummary: "", approvals: [], completedTaskIDs: WatchTimelineProjection.successfulTaskIDs(in: Array(events.prefix(1))))
    let rejected = WatchTimelineSnapshot(accountKey: "synthetic", sessionID: "session", taskID: "rejected", progress: "已停止", running: false, assistantSummary: "", approvals: [], completedTaskIDs: WatchTimelineProjection.successfulTaskIDs(in: events))
    let first = tracker.apply(approved); #expect(first.completed)
    let second = tracker.apply(rejected); #expect(!second.completed)
}
