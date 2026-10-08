import Foundation
import Testing
@testable import WeftMateCore

private func value<T: Decodable>(_ type: T.Type, _ json: String) throws -> T { try JSONDecoder().decode(type, from: Data(json.utf8)) }
private func event(_ seq: Int, _ type: String, _ data: String) throws -> TimelineEvent {
    try value(TimelineEvent.self, "{\"seq\":\(seq),\"type\":\"\(type)\",\"data\":\(data)}")
}
@Test func a5IntentDefaultsToSteerAndPreservesLegacyQueueBytes() throws {
    let message = try SharedCommandPayload(requestId: "send", kind: .message, targetDeviceId: "host", sessionId: "session", text: "合成补充")
    #expect(message.intent == .steer)
    let json = try JSONSerialization.jsonObject(with: message.encoded()) as! [String: Any]
    #expect(json["intent"] as? String == "steer"); #expect(json["mode"] == nil)
    let queue = try SharedCommandPayload(requestId: "queue", kind: .message, targetDeviceId: "host", sessionId: "session", text: "第二件事", intent: .queue)
    #expect(queue.intent == .queue)
    let old = Data(#"{"requestId":"old","kind":"session.message","targetDeviceId":"host","sessionId":"session","text":"old goal","mode":"queue"}"#.utf8)
    #expect(try SharedCommandPayload.decode(old).mode == "queue")
}
@Test func a5QueueUsesReceiptIdentityAndDoesNotClearOnUnrelatedStop() throws {
    let commands = [SharedCommandReceipt(commandId: "command-b", requestId: "request-b", kind: .message, targetDeviceId: "host", state: .acceptedByDSH, sessionId: "session", conversationId: nil, sourceSyncEventId: nil, receiptId: "receipt-b", errorCode: nil)]
    let events = try [event(0,"task.queued",#"{"taskId":"receipt-b","receiptId":"receipt-b","text":"B"}"#),
                     event(1,"task.queued",#"{"taskId":"command-c","receiptId":"receipt-c","text":"C"}"#),
                     event(2,"task.ended",#"{"taskId":"command-a","receiptId":"receipt-a","reason":"aborted"}"#)]
    #expect(TaskQueueProjection.queued(events: events, commands: commands).map(\.id) == ["command-b", "command-c"])
    let started = try event(3,"task.started",#"{"taskId":"turn-2","receiptId":"receipt-b"}"#)
    #expect(TaskQueueProjection.queued(events: events + [started], commands: commands).map(\.id) == ["command-c"])
    let canceled = try event(4,"task.ended",#"{"taskId":"command-c","receiptId":"receipt-c","reason":"canceled"}"#)
    #expect(TaskQueueProjection.queued(events: events + [started, canceled], commands: commands).isEmpty)
}
@Test func a5BatchedQueueKeepsNativeOrder() throws {
    let batch = try event(1,"task.queued",#"{"tasks":[{"taskId":"z","receiptId":"rb","text":"B"},{"taskId":"a","receiptId":"rc","text":"C"}]}"#)
    #expect(TaskQueueProjection.queued(events: [batch]).map(\.text) == ["B", "C"])
}
@Test func a5ReadableSummariesKeepRawArgumentsOutOfHeadline() throws {
    #expect(ReadableToolSummary.text(tool: "read_file", raw: #"{"path":"/synthetic/project/notes.md"}"#) == "读取文件 notes.md")
    #expect(ReadableToolSummary.text(tool: "shell", raw: #"{"command":"rm synthetic.txt","description":"删除合成临时文件"}"#) == "删除合成临时文件")
    #expect(ReadableToolSummary.text(tool: "web_fetch", raw: #"{"url":"https://example.com/synthetic"}"#) == "打开网页 example.com")
    #expect(ReadableToolSummary.text(tool: "shell", raw: "{broken") == "调用工具 shell")
}
@Test func a5OutputsRetainAlreadyReadOlderVersions() throws {
    var window = ConversationResourcesWindow()
    let older = try value(ConversationResourcesPage.self, #"{"outputs":[{"artifactId":"a","fileName":"notes.md","createdAt":"2026-10-08T00:00:00Z"}],"sources":[],"nextSeq":1,"hasMore":false}"#)
    let latest = try value(ConversationResourcesPage.self, #"{"outputs":[{"artifactId":"b","fileName":"notes.md","createdAt":"2026-10-08T01:00:00Z"}],"sources":[],"nextSeq":2,"hasMore":false}"#)
    try window.apply(older); try window.apply(latest)
    #expect(window.outputs.map(\.id) == ["b"]); #expect(window.olderVersions(of: window.outputs[0]).map(\.id) == ["a"])
}
@Test func a5UsageTotalsNeverDoubleCountCacheAndBudgetUsesAccountState() throws {
    let stats = #"{"requests":2,"unknownRequests":1,"unpricedRequests":0,"inputTokens":1000,"cachedInputTokens":700,"outputTokens":50,"cost":0.000364}"#
    let totals = try value(UsageTotals.self, stats)
    #expect(totals.tokenCount == 1050); #expect(totals.uncertaintyNotice != nil)
    let summary = try value(UsageSummary.self, "{\"month\":\"2026-10\",\"timeZone\":\"UTC\",\"sessionId\":\"s\",\"total\":\(stats),\"days\":[{\"day\":\"2026-10-08\",\(stats.dropFirst().dropLast())}],\"sessions\":[],\"models\":[],\"budget\":{\"monthlyLimit\":1,\"effectiveLimit\":1,\"temporaryLimit\":null,\"state\":\"blocked\"}}")
    #expect(summary.days.first?.totals.cost == totals.cost)
    #expect(summary.budget.notice?.contains("云端模型请求已暂停") == true)
    #expect(try value(UsageBudget.self,#"{"state":"warning","monthlyLimit":1,"effectiveLimit":1}"#).notice?.contains("80%") == true)
    #expect(try value(UsageBudget.self,#"{"state":"unlimited"}"#).notice == nil)
}

private actor ParityTransport: HTTPTransport {
    var writes: [URLRequest] = []
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        let json: String
        if path.hasSuffix("/auth/login") || path.hasSuffix("/auth/me") { json = #"{"account":{"ownerId":"owner","username":"synthetic","displayName":"合成","profileRevision":0},"device":{"id":"device","name":"iPhone","expiresAt":"2027-01-01T00:00:00Z"},"csrfToken":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}"# }
        else if path.hasSuffix("/status") { json = #"{"ownerId":"owner","hostId":"host"}"# }
        else if path.hasSuffix("/sessions") { writes.append(request); json = #"{"sessions":[{"sessionId":"session","title":"合成任务","running":true,"sendAvailable":true,"modelProfileId":"mimo"},{"sessionId":"archived","title":"归档中的任务","running":true,"sendAvailable":false,"archived":true,"modelProfileId":"mimo"}]}"# }
        else if path.hasSuffix("/archive") || path.hasSuffix("/unarchive") { writes.append(request); json = "{\"sessionId\":\"session\",\"archived\":\(path.hasSuffix("/unarchive") ? "false" : "true")}" }
        else if request.httpMethod == "DELETE" { writes.append(request); json = #"{"sessionId":"session","deleted":true,"forgetMemories":false,"forgottenEvidenceCount":0}"# }
        else if path.hasSuffix("/cancel") { writes.append(request); return .init(status:409,headers:[:],body:Data(#"{"error":{"code":"TASK_NOT_READY"}}"#.utf8)) }
        else if path.hasSuffix("/usage"), !path.hasSuffix("/settings/usage") {
            writes.append(request)
            json = #"{"month":"2026-10","timeZone":"Asia/Shanghai","sessionId":"session","total":{"requests":0,"unknownRequests":0,"unpricedRequests":0,"inputTokens":0,"cachedInputTokens":0,"outputTokens":0,"cost":0},"days":[],"sessions":[],"models":[],"budget":{"state":"unlimited"}}"#
        }
        else if path.hasSuffix("/settings/usage") { writes.append(request); json = #"{"monthlyLimit":1,"temporaryLimit":2,"temporaryMonth":"2026-10","canManage":true,"models":[]}"# }
        else { throw APIFailure.invalidResponse }
        return .init(status:200, headers:["set-cookie":"wm_personal_session=" + String(repeating:"a",count:43)], body:Data(json.utf8))
    }
    func recorded() -> [URLRequest] { writes }
}
@Test func a5LifecycleAndLimitRequestsUseAuthenticatedContract() async throws {
    let transport = ParityTransport(), client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
    _ = try await client.login(server: ServerConfiguration(input:"https://parity.example.com"), username:"synthetic", password:"synthetic-password-long", deviceName:"iPhone")
    #expect(try await client.setSessionArchived(true,sessionID:"session").archived)
    #expect(try await !client.setSessionArchived(false,sessionID:"session").archived)
    _ = try await client.deleteSession(sessionID:"session")
    _ = try await client.deleteSession(sessionID:"session", forgetMemories:true)
    _ = try await client.setUsageLimit(2, temporary:true)
    _ = try await client.setUsageLimit(nil, temporary:false)
    let writes = await transport.recorded()
    let bodies = try writes.compactMap(\.httpBody).map { try JSONSerialization.jsonObject(with:$0) as! [String:Any] }
    #expect(bodies[2]["forgetMemories"] as? Bool == false); #expect(bodies[3]["forgetMemories"] as? Bool == true)
    #expect(bodies[4]["temporaryLimit"] as? Double == 2); #expect(bodies[5]["monthlyLimit"] is NSNull)
    #expect(writes.allSatisfy { $0.value(forHTTPHeaderField:"X-WeftMate-CSRF") != nil && $0.value(forHTTPHeaderField:"Cookie") != nil })
}

@Test func a5CancelQueuedDoesNotHideCurrentStopOrSteer() throws {
    let events = try [event(0,"task.started",#"{"taskId":"a","receiptId":"ra"}"#), event(1,"task.ended",#"{"taskId":"b","receiptId":"rb","reason":"canceled"}"#)]
    #expect(TimelineProjection.taskRunning(events, fallback:false))
}

@Test func a5UsageReportsClientTimeZoneAndCancelRaceNeverStopsAutomatically() async throws {
    let transport = ParityTransport(), client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
    _ = try await client.login(server: ServerConfiguration(input:"https://parity.example.com"), username:"synthetic", password:"synthetic-password-long", deviceName:"iPhone")
    _ = try await client.setUsageTimeZone("Asia/Shanghai")
    let summary = try await client.usage(month:"2026-10",sessionID:"session",timeZone:"Asia/Shanghai")
    #expect(summary.timeZone == "Asia/Shanghai")
    do { _ = try await client.cancelQueuedTask(taskID:"root", requestID:"cancel-race"); Issue.record("Expected already-started conflict") }
    catch { #expect(error as? APIFailure == .server(status:409,code:"TASK_NOT_READY")) }
    let requests = await transport.recorded()
    #expect(requests.count == 3)
    #expect(URLComponents(url:requests[1].url!,resolvingAgainstBaseURL:false)?.queryItems?.first(where: { $0.name == "timeZone" })?.value == "Asia/Shanghai")
    #expect(requests.last?.url?.path.hasSuffix("/cancel") == true)
    #expect(!requests.contains { $0.url?.path.hasSuffix("/stop") == true })
    #expect(APIFailure.server(status:402,code:"USAGE_LIMIT_REACHED").errorDescription?.contains("云端模型请求已暂停") == true)
}

@Test func a5TaskControlsDoNotRequireDesktopOpenAppAndIncludeArchivedRunningSessions() async throws {
    let transport = ParityTransport(), client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
    _ = try await client.login(server: ServerConfiguration(input:"https://parity.example.com"), username:"synthetic", password:"synthetic-password-long", deviceName:"iPhone")
    #expect(try await client.taskControlSessionIDs(includeArchived:true) == Set(["session","archived"]))
    let requests = await transport.recorded()
    #expect(requests.first?.url?.query == "archived=all")
}

@Test func a5CommandTrackerFollowsNativeLifecycleIncludingBatchedCancellation() throws {
    let root = SharedCommandReceipt(commandId:"root",requestId:"r",kind:.message,targetDeviceId:"host",state:.acceptedByDSH,sessionId:"session",conversationId:nil,sourceSyncEventId:nil,receiptId:"receipt-root",errorCode:nil)
    let queued = SharedCommandReceipt(commandId:"queued",requestId:"q",kind:.message,targetDeviceId:"host",state:.acceptedByDSH,sessionId:"session",conversationId:nil,sourceSyncEventId:nil,receiptId:"receipt-queue",errorCode:nil)
    var tracker = try SharedTurnTracker(sessionID:"session")
    func page(_ json: String, _ after: Int) throws -> SharedHistoryPage { try .decode(Data(json.utf8),sessionID:"session",afterSeq:after) }
    try tracker.apply(page(#"{"events":[{"seq":0,"type":"user.message","data":{"receiptId":"receipt-root","turn":1,"text":"original"}},{"seq":1,"type":"task.started","data":{"receiptId":"receipt-root","turn":1}},{"seq":2,"type":"task.queued","data":{"receiptId":"receipt-queue","text":"queued"}}],"nextSeq":2,"hasMore":false}"#,-1))
    #expect(tracker.progress(for:root) == .running); #expect(tracker.progress(for:queued) == .pending)
    try tracker.apply(page(#"{"events":[{"seq":3,"type":"task.ended","data":{"reason":"canceled","tasks":[{"receiptId":"receipt-queue"},{"receiptId":"other"}]}}],"nextSeq":3,"hasMore":false}"#,2))
    #expect(tracker.progress(for:queued) == .aborted); #expect(tracker.progress(for:root) == .running)
    try tracker.apply(page(#"{"events":[{"seq":4,"type":"task.ended","data":{"receiptId":"receipt-root","turn":1,"reason":"completed"}}],"nextSeq":4,"hasMore":false}"#,3))
    #expect(tracker.progress(for:root) == .completed)
}

@Test func a5NativeStepStartDoesNotMakeTheCurrentSupplementAmbiguous() throws {
    let supplement = SharedCommandReceipt(commandId:"supplement",requestId:"s",kind:.message,targetDeviceId:"host",state:.acceptedByDSH,sessionId:"session",conversationId:nil,sourceSyncEventId:nil,receiptId:"steer",errorCode:nil,rootTaskId:"root",taskAction:"supplement")
    let json = #"{"events":[{"seq":0,"type":"turn.started","data":{"turn":1}},{"seq":1,"type":"user.message","data":{"receiptId":"original","text":"original"}},{"seq":2,"type":"task.started","data":{"turn":1,"receiptId":"original"}},{"seq":3,"type":"user.message","data":{"receiptId":"steer","text":"supplement"}},{"seq":4,"type":"task.ended","data":{"turn":1,"receiptId":"original","reason":"completed"}},{"seq":5,"type":"turn.ended","data":{"turn":1,"reason":"completed"}}],"nextSeq":5,"hasMore":false}"#
    var tracker = try SharedTurnTracker(sessionID:"session")
    try tracker.apply(.decode(Data(json.utf8),sessionID:"session",afterSeq:-1))
    #expect(tracker.progress(for:supplement) == .completed)
}

@Test func a5RemoteSupplementMetadataAnnotatesMessageWithoutBecomingRootControl() async throws {
    let transport = ParityTransport(), client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
    let session = try await client.login(server: ServerConfiguration(input:"https://parity.example.com"), username:"synthetic", password:"synthetic-password-long", deviceName:"iPhone")
    let wire = #"{"commands":[{"commandId":"child","requestId":"child-request","kind":"session.message","targetDeviceId":"host","sessionId":"session","state":"accepted_by_dsh","createdAt":"2026-10-08T01:00:00Z","updatedAt":"2026-10-08T01:00:00Z","rootTaskId":"root","taskAction":"supplement","receiptId":"steer"},{"commandId":"root","requestId":"root-request","kind":"session.message","targetDeviceId":"host","sessionId":"session","state":"accepted_by_dsh","createdAt":"2026-10-08T00:00:00Z","updatedAt":"2026-10-08T00:00:00Z","receiptId":"original"}],"hasMore":false}"#
    let page = try TaskCommandPage.decode(Data(wire.utf8),scope:TaskReadScope(session),sessionID:"session",limit:50,previous:nil)
    #expect(page.supplementReceiptIDs == Set(["steer"]))
    #expect(page.rootCommands.map(\.id) == ["root"])
}
