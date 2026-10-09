import Foundation
import Testing
@testable import WeftMateCore

private func usage(_ budget: String = "100", month: String = "2026-11", zone: String = "Asia/Shanghai") throws -> UsageSummary {
    try JSONDecoder().decode(UsageSummary.self, from: Data("""
    {"month":"\(month)","timeZone":"\(zone)","total":{"requests":7,"unknownRequests":1,"unpricedRequests":2,"inputTokens":100,"cachedInputTokens":0,"outputTokens":5,"cost":25},"days":[],"sessions":[],"models":[],"budget":{"effectiveLimit":\(budget),"monthlyLimit":50,"state":"ok"}}
    """.utf8))
}
@Test func a15UsageUsesAccountMonthAndEffectiveLimit() throws {
    let instant = ISO8601DateFormatter().date(from: "2026-10-31T16:30:00Z")!
    #expect(AccountUsagePresentation.month(at: instant, timeZone: "Asia/Shanghai") == "2026-11")
    #expect(AccountUsagePresentation.month(at: instant, timeZone: "America/Los_Angeles") == "2026-10")
    let value = try usage()
    #expect(AccountUsagePresentation.matches(value, month: "2026-11", timeZone: "Asia/Shanghai"))
    #expect(!AccountUsagePresentation.matches(value, month: "2026-10", timeZone: "Asia/Shanghai"))
    #expect(!AccountUsagePresentation.matches(value, month: "2026-11", timeZone: "UTC"))
    #expect(AccountUsagePresentation.text(value).contains("75%"))
    #expect(try AccountUsagePresentation.text(usage("null")).contains("7 次请求"))
    #expect(value.total.uncertaintyNotice?.contains("2 次未定价") == true)
    #expect(try AccountUsagePresentation.text(usage("0")).contains("0%"))
}
@Test func a15ProjectExpansionIsLocalAndAccountProjectIsolated() throws {
    let suite = "a15-" + UUID().uuidString, defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    #expect(!ProjectRecentRows.expanded(account: "synthetic-A", project: "P", defaults: defaults))
    ProjectRecentRows.save(true, account: "synthetic-A", project: "P", defaults: defaults)
    #expect(ProjectRecentRows.expanded(account: "synthetic-A", project: "P", defaults: UserDefaults(suiteName: suite)!))
    #expect(!ProjectRecentRows.expanded(account: "synthetic-B", project: "P", defaults: defaults))
    #expect(!ProjectRecentRows.expanded(account: "synthetic-A", project: "Q", defaults: defaults))
    ProjectRecentRows.save(false, account: "synthetic-A", project: "P", defaults: defaults)
    #expect(!ProjectRecentRows.expanded(account: "synthetic-A", project: "P", defaults: defaults))
}
@Test func a15ProjectRecentSortNeverInventsDatesOrMovesPinnedRows() {
    let rows = (0..<7).map { i in ConversationSummary(id: "s\(i)", title: "合成", conversationId: nil, sessionId: "s\(i)", running: false, sendAvailable: true, originalModelLabel: nil, pinned: i == 0, projectId: "P", updatedAt: i == 0 ? nil : "2026-10-09T00:00:0\(i)Z") }
    #expect(ProjectRecentRows.sorted(rows).prefix(5).map(\.id) == ["s6","s5","s4","s3","s2"])
    #expect(SessionSidebar.sections(rows: rows, groups: []).isEmpty)
    #expect(rows[0].updatedAt == nil)
}
@Test func a15ThinkingOnlyConfirmsNewestCurrentIdentityAndConversation() {
    let scope = AppleUXScope(epoch: UUID(), host: "host", device: "device", conversation: "session")
    var state = ThinkingState()
    let old = state.begin(scope: scope), newest = state.begin(scope: scope)
    #expect(state.confirmed == nil && state.pending)
    let oldAccepted = state.accept(.init(supported: true, enabled: true), token: old, scope: scope, current: scope); #expect(!oldAccepted)
    for different in [AppleUXScope(epoch: UUID(), host: "host", device: "device", conversation: "session"), AppleUXScope(epoch: scope.epoch, host: "other", device: "device", conversation: "session"), AppleUXScope(epoch: scope.epoch, host: "host", device: "other", conversation: "session"), AppleUXScope(epoch: scope.epoch, host: "host", device: "device", conversation: "other")] {
        let accepted = state.accept(.init(supported: true, enabled: true), token: newest, scope: scope, current: different); #expect(!accepted)
    }
    let accepted = state.accept(.init(supported: true, enabled: true), token: newest, scope: scope, current: scope); #expect(accepted)
    #expect(state.confirmed?.enabled == true && !state.pending)
    let failed = state.begin(scope: scope); state.fail(token: failed)
    #expect(state.confirmed?.enabled == true && !state.pending)
    _ = state.begin(scope: .init(epoch: scope.epoch, host: "host", device: "device", conversation: "other"))
    #expect(state.confirmed == nil)
}
@Test func a15UnspecifiedModelCapabilityIsUnsupported() throws {
    let old = try JSONDecoder().decode(SharedHostModel.self, from: Data(#"{"id":"model","name":"合成模型","model":"synthetic","configured":true}"#.utf8))
    #expect(old.deepThinking?.supported != true)
    let model = try JSONDecoder().decode(SharedHostModel.self, from: Data(#"{"id":"model","name":"合成模型","model":"synthetic","configured":true,"deepThinking":{"supported":true,"effort":"high"}}"#.utf8))
    #expect(model.deepThinking?.supported == true)
}
private func subtask(_ seq: Int, _ type: String, _ json: String, at: String? = nil) throws -> TimelineEvent {
    .init(seq: seq, type: type, at: at, data: try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)))
}
@Test func a15BackgroundSubtaskRequiresNativeTerminalEventAndPreservesStep() throws {
    let started = try subtask(1,"step.started",#"{"stepId":"launch","subtask":{"name":"合成后台","id":"job","background":true}}"#,at:"2026-10-09T00:00:00Z")
    let completed = try subtask(2,"step.completed",#"{"stepId":"launch","subtask":{"name":"合成后台","id":"job","background":true}}"#,at:"2026-10-09T00:00:01Z")
    var rows = ComposerSubtasks.merge([started,completed])
    #expect(rows.count == 1 && rows[0].stateLabel == "进行中")
    #expect(rows[0].duration(at: ISO8601DateFormatter().date(from:"2026-10-09T00:00:02Z")!) == "已用 2.0 秒")
    let end = try subtask(4,"subtask.updated",#"{"id":"job","state":"failed"}"#,at:"2026-10-09T00:00:03.500Z")
    rows = ComposerSubtasks.merge([end,completed,started,started])
    #expect(rows.count == 1 && rows[0].stateLabel == "失败")
    #expect(rows[0].duration == "3.5 秒" && rows[0].stepSeq == 1)
    #expect(!rows.contains { $0.state == "running" })
}
@Test func a15SubtasksMissingIDMergeByStepAndUnknownTimeIsExplicit() throws {
    let a = try subtask(1,"step.started",#"{"stepId":"call","subtask":{"name":"合成子任务"}}"#)
    let b = try subtask(2,"step.completed",#"{"stepId":"call","state":"failed","subtask":{"name":"合成子任务"}}"#)
    let rows = ComposerSubtasks.merge([a,b])
    #expect(rows.count == 1 && rows[0].stateLabel == "失败" && rows[0].duration == "未记录")
}
@Test func a15SubtaskResultAddsBackgroundIdentityWithoutDuplicatingLaunch() throws {
    let start = try subtask(1,"step.started",#"{"stepId":"launch","subtask":{"name":"合成任务"}}"#,at:"2026-10-09T00:00:00Z")
    let result = try subtask(2,"step.completed",#"{"stepId":"launch","subtask":{"name":"合成任务","id":"job","background":true}}"#)
    let rows = ComposerSubtasks.merge([start,result])
    #expect(rows.count == 1 && rows[0].id == "job" && rows[0].stepSeq == 1 && rows[0].state == "running")
}
@Test func a15CachedRowsKeepTrueActivityAndExecutingHost() throws {
    let row = ConversationSummary(id:"session",title:"合成",conversationId:nil,sessionId:"session",running:false,sendAvailable:true,originalModelLabel:nil,projectId:"P",hostId:"host",updatedAt:"2026-10-09T00:00:00Z")
    let cache = try LocalCachedConversationSummary(conversation: row,hostId:"host")
    let decoded = try JSONDecoder().decode(LocalCachedConversationSummary.self,from:JSONEncoder().encode(cache))
    #expect(decoded.conversation.hostId == "host" && decoded.conversation.updatedAt == row.updatedAt)
}
