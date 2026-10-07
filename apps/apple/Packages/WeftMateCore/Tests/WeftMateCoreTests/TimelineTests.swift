import Foundation
import Testing
@testable import WeftMateCore

private func event(_ seq: Int, _ type: String, _ fields: [String: JSONValue] = [:], at: String? = nil) -> TimelineEvent {
    .init(seq: seq, type: type, at: at, data: .object(fields))
}
private func page(_ events: [TimelineEvent], next: Int, older: Bool = false) -> TimelinePage {
    .init(events: events, nextSeq: next, hasMore: false, nextBeforeSeq: events.first?.seq, hasOlder: older, latestSeq: next)
}
@Test func timelineDirectionsKeepForwardWatermarkAndDedupeSparsePages() throws {
    #expect(try TimelinePage.query(beforeSeq: nil, afterSeq: nil, limit: 100) == "limit=100")
    #expect(throws: APIFailure.invalidResponse) { try TimelinePage.query(beforeSeq: 10, afterSeq: 5, limit: 100) }
    var window = TimelineWindow()
    window.apply(page([event(22_000, "assistant.message"), event(22_005, "task.ended")], next: 22_008, older: true), replace: true)
    window.apply(page([event(21_998, "user.message")], next: 90_000, older: true), older: true)
    #expect(window.nextSeq == 22_008 && window.beforeSeq == 21_998)
    window.apply(page([event(22_010, "assistant.message")], next: 22_014))
    window.apply(page([event(22_010, "assistant.message")], next: 22_014))
    #expect(window.events.map(\.seq) == [21_998, 22_000, 22_005, 22_010])
    #expect(window.hasOlder)
    let empty = try TimelinePage.decode(Data(#"{"events":[],"nextSeq":22020,"hasMore":false}"#.utf8), afterSeq: 22_014)
    window.apply(empty)
    #expect(window.nextSeq == 22_020)
}
@Test func timelineRejectsInvalidBoundariesAndNonAdvancingPages() throws {
    for json in [#"{"events":[],"nextSeq":4,"hasMore":true}"#, #"{"events":[{"seq":4,"type":"assistant.message","data":{}}],"nextSeq":5,"hasMore":false}"#] {
        #expect(throws: APIFailure.invalidResponse) { try TimelinePage.decode(Data(json.utf8), afterSeq: 4) }
    }
    let invalidOlder = Data(#"{"events":[{"seq":10,"type":"assistant.message","data":{}}],"nextSeq":99,"hasMore":false,"hasOlder":true,"nextBeforeSeq":11}"#.utf8)
    #expect(throws: APIFailure.invalidResponse) { try TimelinePage.decode(invalidOlder, beforeSeq: 12) }
}
@Test func timelineLateCompletionDoesNotMoveStepsAndArtifactCompletesSameCall() {
    let started: [String: JSONValue] = ["taskId": .string("turn-1"), "stepId": .string("call-a"), "state": .string("running"), "summary": .string("读取文件")]
    var ended = started; ended["state"] = .string("completed")
    let events = [event(1, "step.started", started, at: "2026-10-07T00:00:00.100Z"),
                  event(2, "approval.requested", ["approvalId": .string("approval-a")]),
                  event(3, "artifact.created", ["artifactId": .string("artifact-a"), "completedStep": .object(ended)], at: "2026-10-07T00:00:10.100Z"),
                  event(4, "approval.resolved", ["approvalId": .string("approval-a"), "outcome": .string("allowed-once")])]
    let entries = TimelineProjection.entries(events)
    #expect(entries.map(\.seq) == [1, 2, 3])
    #expect(entries[0].steps.count == 1 && !entries[0].running && entries[0].elapsed == "10 秒")
    #expect(entries[1].resolved?.seq == 4)
    // Start arrives on upward pagination after completion was already displayed.
    let partial = TimelineProjection.entries(Array(events.dropFirst()))
    #expect(partial.first(where: { !$0.steps.isEmpty })?.steps.count == 1)
    #expect(partial.first(where: { !$0.steps.isEmpty })?.elapsed == "时间待确认")
}
@Test func timelineBoundariesAndTerminalTurnKeepTasksSeparate() {
    func step(_ seq: Int, task: String, id: String) -> TimelineEvent {
        event(seq, "step.started", ["taskId": .string(task), "stepId": .string(id), "state": .string("running")])
    }
    let entries = TimelineProjection.entries([step(1, task: "turn-1", id: "a"), step(2, task: "turn-1", id: "b"),
        event(3, "question.asked", ["callId": .string("q")]), step(4, task: "turn-1", id: "c"),
        step(5, task: "turn-2", id: "d"), event(6, "turn.ended", ["turn": .number(1)]),
        event(7, "question.answered", ["callId": .string("q")])])
    #expect(entries.map(\.seq) == [1, 3, 4, 5])
    #expect(entries[0].steps.count == 2 && !entries[0].running)
    #expect(entries[1].resolved?.seq == 7)
    #expect(!entries[2].running && entries[3].running)
    #expect(TimelineProjection.taskRunning([event(1, "task.started"), event(2, "step.completed")], fallback: false))
    #expect(TimelineProjection.taskRunning([event(2, "step.completed")], fallback: true))
    #expect(!TimelineProjection.taskRunning([event(1, "task.started"), event(3, "task.ended")], fallback: true))
}
@Test func offlineTimelineOpensTailThenPagesOlderAndStaysAccountScoped() async throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: folder) }
    let cache = LocalTimelineCache(directory: folder)
    let account = try LocalAccountScope(server: ServerConfiguration(input: "https://timeline.unit.example"), ownerId: "owner-fixture")
    let other = try LocalAccountScope(server: ServerConfiguration(input: "https://timeline.unit.example"), ownerId: "owner-other")
    var window = TimelineWindow()
    window.apply(page((0..<250).map { event($0, "assistant.message") }, next: 249), replace: true)
    try await cache.save(account: account, hostID: "host-fixture", sessionID: "session-fixture", window: window)
    let record = try #require(await cache.readPage(account: account, hostID: "host-fixture", sessionID: "session-fixture"))
    let tail = record.page
    let older = try #require(await cache.readPage(account: account, hostID: "host-fixture", sessionID: "session-fixture", beforeSeq: 150)).page
    #expect(tail.events.first?.seq == 150 && tail.events.last?.seq == 249 && tail.hasOlder == true)
    #expect(older.events.first?.seq == 50 && older.events.last?.seq == 149)
    #expect(try await cache.readPage(account: other, hostID: "host-fixture", sessionID: "session-fixture") == nil)
}
@Test func watchFeedbackUsesObservedCompletionsOnceAndResetsAcrossAccounts() {
    func snapshot(_ completions: [String], approvals: [WatchApproval] = [], account: String = "account-a") -> WatchTimelineSnapshot {
        .init(accountKey: account, sessionID: "session-a", taskID: "turn-1", progress: "处理文件", running: completions.isEmpty,
              assistantSummary: "", approvals: approvals, completedTaskIDs: completions)
    }
    var tracker = WatchFeedbackTracker()
    #expect(!tracker.apply(snapshot(["old-task"])).completed)
    #expect(!tracker.apply(snapshot(["old-task"])).completed)
    #expect(tracker.apply(snapshot(["old-task", "turn-1"])).completed)
    #expect(!tracker.apply(snapshot(["old-task", "turn-1"])).completed)
    #expect(tracker.apply(snapshot(["turn-1"], approvals: [.init(id: "approval-a", summary: "写入文件")])).approval)
    _ = tracker.apply(snapshot([]))
    let replay = tracker.apply(snapshot(["old-task", "turn-1"], approvals: [.init(id: "approval-a", summary: "写入文件")]))
    #expect(!replay.completed && !replay.approval)
    #expect(!tracker.apply(snapshot(["turn-1"], account: "account-b")).completed)
}
