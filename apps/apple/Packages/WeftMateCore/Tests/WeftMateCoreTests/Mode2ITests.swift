import Foundation
import Testing
@testable import WeftMateCore

private func modeClient(version: Int? = 1, host: String = "host-fixture") async throws -> (PersonalClient, Mode2ITransport, AccountSession) {
    let transport = Mode2ITransport(version: version, host: host)
    let client = PersonalClient(credentialStore: Mode2IKeys(), transport: transport)
    let account = try await client.login(server: ServerConfiguration(input: "https://a2-ui.unit.example"), username: "synthetic", password: "synthetic-only", deviceName: "Synthetic")
    return (client, transport, account)
}

@Test func mode2iExactCapabilityKeepsLegacyBehavior() async throws {
    for version in [nil, 0, 2] as [Int?] {
        let (client, transport, account) = try await modeClient(version: version)
        let caps = try await client.chatCapabilities()
        #expect(!caps.supports("workAndChat"))
        let approval = try await client.approvals(sessionID: "session-main").approvals[0]
        let scope = try SessionInteractionScope(session: account, sessionID: "session-main")
        let project = try await client.projects().projects[0]
        #expect(throws: APIFailure.platformCapabilityUnavailable) {
            try WorkAndChat.switchDecision(scope: scope, approval: approval, capabilities: caps, project: project, accept: true, requestID: "request-old")
        }
        #expect(!(await transport.recorded()).contains { $0.httpMethod == "POST" && $0.url!.path.contains("/approvals/") })
        let rows = try await client.conversations()
        #expect(WorkAndChat.mode(rows.first { $0.id == "work" }!) == .work)
        #expect(WorkAndChat.mode(rows.first { $0.id == "main" }!) == .chat)
    }
    #expect(ChatCapabilities(["workAndChat": .number(1)]).supports("workAndChat"))
    #expect(!ChatCapabilities(["workAndChat": .bool(true)]).supports("workAndChat"))
}

@Test func mode2iNewWorkKeepsSelectedComputerAndProjectInRequest() async throws {
    for host in ["host-fixture", "second-computer"] {
        let (client, transport, account) = try await modeClient(host: host)
        let project = try await client.projects().projects[1]
        let intent = try SharedCommandIntent(session: account, command: SharedCommandPayload(requestId: "work-create-" + host,
            kind: .create, targetDeviceId: host, modelProfileId: "fixture", projectId: project.id))
        let result = try await client.reconcileCommand(intent, allowSubmission: true)
        guard case .found(let receipt) = result else { Issue.record("Expected creation receipt"); return }
        #expect(receipt.targetDeviceId == host && receipt.sessionId != nil)
        let request = (await transport.recorded()).first { $0.httpMethod == "POST" && $0.url!.path.hasSuffix("/projects/project-b/sessions") }!
        let body = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)
        #expect(intent.parsedPayload.targetDeviceId == host && intent.parsedPayload.projectId == project.id)
        #expect(body["targetDeviceId"] == nil)
        #expect(body["requestId"]?.string == intent.requestId)
        let rows = try await client.conversations()
        let work = rows.first { $0.sessionId == receipt.sessionId }!
        #expect(work.projectId == project.id && work.workHostId == host && WorkAndChat.mode(work) == .work)
    }
}

@Test func mode2iAcceptSwitchCreatesWorkAndLeavesOriginalChatAndHistory() async throws {
    let (client, transport, account) = try await modeClient()
    let before = try await client.logicalChat()
    let page = try await client.chatPage(id: before.id)
    let approval = try await client.approvals(sessionID: "session-main").approvals[0]
    let project = try await client.projects().projects[0]
    let caps = try await client.chatCapabilities()
    let task = try await client.taskDetail(taskID: approval.sourceCommandId)
    let intent = try WorkAndChat.switchDecision(scope: SessionInteractionScope(session: account, sessionID: "session-main"),
        approval: approval, capabilities: caps, project: project, accept: true, requestID: "switch-accept", proposalTask: task)
    let restored = try JSONDecoder().decode(ApprovalDecisionIntent.self, from: JSONEncoder().encode(intent))
    #expect(restored.payload == intent.payload && restored.workProjectId == project.id)
    let receipt = try await client.submitApproval(restored)
    #expect(receipt.approval.workSessionId == "session-proposal-work")
    #expect(receipt.approval.workSessionId != before.activeSessionId)
    let created = try await client.workCreation(approval: receipt.approval)
    #expect(created.state == .acceptedByDSH && created.sessionId == receipt.approval.workSessionId)
    let after = try await client.logicalChat()
    let afterPage = try await client.chatPage(id: after.id)
    #expect(before.id == after.id && before.activeSessionId == after.activeSessionId && before.kind == after.kind)
    #expect(page.items == afterPage.items && after.logicalHistory == true)
    let rows = try await client.conversations()
    #expect(WorkAndChat.sections(rows: rows, groups: [], mode: .chat).flatMap(\.rows).contains { $0.id == before.id })
    #expect(WorkAndChat.sections(rows: rows, groups: [], mode: .work).flatMap(\.rows).contains { $0.sessionId == receipt.approval.workSessionId })
    #expect(!WorkAndChat.sections(rows: rows, groups: [], mode: .work).flatMap(\.rows).contains { $0.id == before.id })
    let posts = (await transport.recorded()).filter { $0.httpMethod == "POST" && $0.url!.path.contains("/approvals/") }
    #expect(posts.count == 1)
    let body = try JSONDecoder().decode(JSONValue.self, from: posts[0].httpBody!)
    #expect(body["workProjectId"]?.string == project.id && body["outcome"]?.string == "allowed-once" && body["scope"] == nil)
}

@Test func mode2iPreview19CannotResumeTheOldToolThroughAnApproval() async throws {
    let transport = Mode2ITransport(proposalEndsTurn: false)
    let client = PersonalClient(credentialStore: Mode2IKeys(), transport: transport)
    let account = try await client.login(server: ServerConfiguration(input: "https://a2-ui.unit.example"), username: "synthetic", password: "synthetic-only", deviceName: "Synthetic")
    let approval = try await client.approvals(sessionID: "session-main").approvals[0]
    let project = try await client.projects().projects[0], caps = try await client.chatCapabilities()
    let task = try await client.taskDetail(taskID: approval.sourceCommandId)
    #expect(throws: APIFailure.platformCapabilityUnavailable) {
        try WorkAndChat.switchDecision(scope: SessionInteractionScope(session: account, sessionID: approval.sessionId),
            approval: approval, capabilities: caps, project: project, accept: true, requestID: "blocked-old-switch", proposalTask: task)
    }
    // A journal made by an older client must be blocked at the network boundary too.
    let old = try ApprovalDecisionIntent(scope: SessionInteractionScope(session: account, sessionID: approval.sessionId),
        approval: approval, outcome: .allowedOnce, requestID: "old-journal", workProjectId: project.id)
    await #expect(throws: APIFailure.platformCapabilityUnavailable) { try await client.submitApproval(old) }
    #expect(!(await transport.recorded()).contains { $0.httpMethod == "POST" && $0.url!.path.contains("/approvals/") })
}

@Test func mode2iRejectSwitchLeavesChatAndSendsNoProject() async throws {
    let (client, transport, account) = try await modeClient()
    let approval = try await client.approvals(sessionID: "session-main").approvals[0]
    let caps = try await client.chatCapabilities()
    let intent = try WorkAndChat.switchDecision(scope: SessionInteractionScope(session: account, sessionID: "session-main"),
        approval: approval, capabilities: caps, project: nil, accept: false, requestID: "switch-reject")
    _ = try await client.submitApproval(intent)
    #expect(try await client.logicalChat().mode == .chat)
    let post = (await transport.recorded()).last { $0.httpMethod == "POST" && $0.url!.path.contains("/approvals/") }!
    let body = try JSONDecoder().decode(JSONValue.self, from: post.httpBody!)
    #expect(body["outcome"]?.string == "rejected" && body["workProjectId"] == nil)
}

@Test func mode2iSelectionRequiredAndRemovedProjectStaysWorkAfterCache() async throws {
    let (client, _, account) = try await modeClient()
    let approval = try await client.approvals(sessionID: "session-main").approvals[0]
    let caps = try await client.chatCapabilities()
    let task = try await client.taskDetail(taskID: approval.sourceCommandId)
    #expect(throws: APIFailure.server(status: 409, code: "PROJECT_NOT_SELECTED")) {
        try WorkAndChat.switchDecision(scope: SessionInteractionScope(session: account, sessionID: "session-main"),
            approval: approval, capabilities: caps, project: nil, accept: true, requestID: "switch-missing", proposalTask: task)
    }
    let removed = ConversationSummary(id: "work-removed", title: "原工作", conversationId: nil, sessionId: "session-removed",
        running: false, sendAvailable: true, originalModelLabel: nil, chatId: "work-removed", chatKind: "side", mode: .work, workHostId: "host-fixture", logicalHistory: true)
    let cache = try LocalCachedConversationSummary(conversation: removed, hostId: "host-fixture")
    let restored = try JSONDecoder().decode(LocalCachedConversationSummary.self, from: JSONEncoder().encode(cache)).conversation
    #expect(WorkAndChat.mode(restored) == .work && restored.workHostId == "host-fixture" && restored.logicalHistory == true)
    #expect(WorkAndChat.subtitle(restored, computer: "合成电脑") == "合成电脑 · 请选择项目或文件夹")
}

@Test func mode2iStandaloneAndReadOnlyPhoneHistoryHaveNoWorkAction() {
    #expect(!WorkAndChat.canCreateWork(connected: false, taskAvailable: nil))
    #expect(!WorkAndChat.canCreateWork(connected: true, taskAvailable: false))
    #expect(WorkAndChat.canCreateWork(connected: true, taskAvailable: nil))
    let phone = ConversationSummary(id: "phone-history", title: "手机记录", conversationId: "phone-history", sessionId: nil,
        running: false, sendAvailable: false, originalModelLabel: nil, mode: .work)
    #expect(WorkAndChat.mode(phone) == .chat)
    #expect(WorkAndChat.sections(rows: [phone], groups: [], mode: .work).isEmpty)
}
