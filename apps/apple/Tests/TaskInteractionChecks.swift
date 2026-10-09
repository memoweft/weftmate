// Targeted checks for the UI response journal and receipt projection. Synthetic HTTP only.
import Foundation
import WeftMateCore

private struct InteractionCheckFailure: Error { let message: String }
private func require(_ value: Bool, _ message: String) throws {
    if !value { throw InteractionCheckFailure(message: message) }
}
private final class InteractionCredentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock(); private var values: [String: Data] = [:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ data: Data, key: String) { lock.withLock { values[key] = data } }
    func delete(key: String) { lock.withLock { values[key] = nil } }
}
private actor InteractionHTTP: HTTPTransport {
    var lostQuestion = false, lostApproval = false, denyQuestions = false, withholdACK = false, oldSnapshot = false
    private var pause = false
    private var paused: CheckedContinuation<Void, Never>?
    func pauseRead() { pause = true }
    func waitForRead() async { while paused == nil { await Task.yield() } }
    func releaseRead() { pause = false; paused?.resume(); paused = nil }
    private var decision: [String: String]?
    private var answer: [String: Any]?
    private var answerRequest: String?
    private var questionBodies: [Data] = [], approvalBodies: [Data] = []
    private let time = "2026-10-06T00:00:00Z"
    func configure(lostQuestion: Bool = false, lostApproval: Bool = false, denyQuestions: Bool = false,
                   withholdACK: Bool = false, oldSnapshot: Bool = false) {
        self.lostQuestion = lostQuestion; self.lostApproval = lostApproval; self.denyQuestions = denyQuestions
        self.withholdACK = withholdACK; self.oldSnapshot = oldSnapshot
    }
    private var denyApprovals = false
    private var includeSecondApproval = false
    func denyApprovalReads(_ value: Bool) { denyApprovals = value }
    func addSecondApproval() { includeSecondApproval = true }
    func submissions() -> ([Data], [Data]) { (approvalBodies, questionBodies) }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path, method = request.httpMethod ?? "GET"
        if path == "/personal/v1/auth/login" {
            return try json(auth(), headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)])
        }
        if path == "/personal/v1/auth/me" { return try json(auth()) }
        if path == "/personal/v1/status" { return try json(["ownerId": "owner-check", "hostId": "host-check"]) }
        if path == "/personal/v1/tasks/task-check" { return try json(task()) }
        if path.hasSuffix("/approvals/approval-check"), method == "POST" {
            approvalBodies.append(request.httpBody!)
            if lostApproval { lostApproval = false; throw URLError(.networkConnectionLost) }
            decision = try JSONSerialization.jsonObject(with: request.httpBody!) as? [String: String]
            return try json(["approval": approval(resolved: false), "requestId": decision!["requestId"]!])
        }
        if path.hasSuffix("/questions/fbfe3e79-8276-4900-bc75-1f78cb7bb844"), method == "POST" {
            questionBodies.append(request.httpBody!)
            if lostQuestion { lostQuestion = false; throw URLError(.networkConnectionLost) }
            let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            answer = body["answer"] as? [String: Any]; answerRequest = body["requestId"] as? String
            return try json(["question": question(resolved: false), "requestId": answerRequest!])
        }
        if path.hasSuffix("/approvals") {
            if denyApprovals { throw APIFailure.transport(.timeout) }
            if pause { await withCheckedContinuation { paused = $0 } }
            return try json(["approvals": [approval(resolved: !oldSnapshot)] + (includeSecondApproval ? [secondApproval()] : []), "hasMore": false]) }
        if path.hasSuffix("/questions") {
            if denyQuestions { return try json(["error": ["code": "SOURCE_UNCONFIRMED"]], status: 403) }
            return try json(["questions": [question(resolved: !oldSnapshot && !withholdACK)], "hasMore": false])
        }
        throw InteractionCheckFailure(message: "Unexpected route: " + path)
    }
    private func auth() -> [String: Any] {
        ["account": ["ownerId": "owner-check", "username": "fixture", "displayName": "Fixture"],
         "device": ["id": "device-check", "name": "Synthetic"], "csrfToken": String(repeating: "b", count: 43)]
    }
    private func identity(_ id: String, field: String) -> [String: Any] {
        [field: id, "sessionId": "session-check", "taskId": "task-check", "sourceCommandId": "task-check",
         "sourceReceiptId": "receipt-task-check", "turn": 1, "createdAt": time, "status": "pending"]
    }
    private func approval(resolved: Bool) -> [String: Any] {
        var row = identity("approval-check", field: "approvalId")
        row["riskCategories"] = ["execute"]; row["callId"] = "call-check"; row["toolName"] = "Synthetic"; row["reason"] = "Synthetic approval"
        if let decision {
            row["status"] = resolved ? "resolved" : "answered"; row["decisionOutcome"] = decision["outcome"]
            row["decisionScope"] = decision["scope"] ?? "once"; row["decisionRequestId"] = decision["requestId"]; row["answeredAt"] = time
            if resolved { row["outcome"] = decision["outcome"]; row["resolvedAt"] = time }
        }
        return row
    }
    private func secondApproval() -> [String: Any] {
        var row = identity("approval-second", field: "approvalId")
        row["riskCategories"] = ["execute"]; row["callId"] = "call-second"; row["toolName"] = "Synthetic"; row["reason"] = "[weftmate:execute] 合成检查。\n{\"command\":\"npm run verify\"}"
        return row
    }
    private func question(resolved: Bool) -> [String: Any] {
        var row = identity("fbfe3e79-8276-4900-bc75-1f78cb7bb844", field: "questionRpcId")
        row["questions"] = [["id": "information", "question": "What information should be added?"]]
        if let answer, let answerRequest {
            row["status"] = resolved ? "resolved" : "answered"; row["answer"] = answer
            row["answerRequestId"] = answerRequest; row["answeredAt"] = time
            if resolved { row["answerAcceptedAt"] = time; row["outcome"] = "answered"; row["resolvedAt"] = time }
        }
        return row
    }
    private func task() -> [String: Any] {
        ["taskId": "task-check", "sessionId": "session-check", "sourceText": "Original synthetic task",
         "source": ["commandId": "task-check", "requestId": "request-check", "kind": "session.message",
             "targetDeviceId": "host-check", "sessionId": "session-check", "receiptId": "receipt-task-check",
             "state": "accepted_by_dsh", "createdAt": time, "updatedAt": time],
         "steps": [], "sources": [], "artifacts": [], "supplements": [], "resumes": [],
         "control": ["state": "active", "updatedAt": time, "canStop": true, "canSupplement": true, "canResume": false],
         "replyEvidence": ["status": "blocked", "assistantChunks": 0, "textChunks": 0,
             "reasoningChunks": 0, "assistantMessages": 0, "toolSaveObserved": false]]
    }
    private func json(_ object: [String: Any], status: Int = 200, headers: [String: String] = [:]) throws -> HTTPResponse {
        .init(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: object))
    }
}
@MainActor private final class InteractionContext {
    var epoch = UUID()
    var session: AccountSession?
}
@main struct TaskInteractionChecks {
    @MainActor static func main() async throws {
        let transport = InteractionHTTP()
        let client = PersonalClient(credentialStore: InteractionCredentials(), transport: transport)
        let context = InteractionContext()
        context.session = try await client.login(server: ServerConfiguration(input: "https://interaction.unit.example:8443"),
            username: "fixture", password: "synthetic-only", deviceName: "Synthetic")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-interaction-check-" + UUID().uuidString)
        func makeModel() -> TaskInteractionModel {
            TaskInteractionModel(client: client, account: context.session, epoch: context.epoch, stateDirectory: directory,
                currentEpoch: { context.epoch }, currentSession: { context.session })
        }
        let snapshot = try await client.taskDetail(taskID: "task-check")
        let model = makeModel()
        await model.refresh(snapshot)
        try require(model.approvals.count == 1 && model.questions.count == 1, "Prompt projection failed")
        try require(model.pendingApprovals.count == 1, "Verified pending approval missing from composer queue")
        print("PASS 1 same task and source receipt")

        await transport.pauseRead()
        let reading = Task { await model.refresh(snapshot) }
        await transport.waitForRead()
        try require(model.loading && model.canRespond("question:" + model.questions[0].id),
                    "A background read erased an already verified response action")
        await transport.releaseRead(); await reading.value
        print("PASS 9 background polling retains verified response actions")

        let key = "question:" + model.questions[0].id
        await transport.configure(lostQuestion: true)
        await model.answer(model.questions[0], answers: [.init(id: "information", selected: [], custom: "同意")])
        try require(model.hasSaved(key) && model.questions[0].canAnswer && model.responseNeedsReadback(key), "Lost submission was not retained")
        try require(model.approvals[0].canDecide, "Information answer granted permission")
        print("PASS 2 lost answer retained and affirmative text is information only")

        let reopened = makeModel()
        await reopened.refresh(snapshot)
        try require(reopened.hasSaved(key) && !reopened.canRespond(key), "Reopen minted a fresh answer")
        await transport.configure(withholdACK: true)
        await reopened.continueOriginal(key)
        let (_, questionBodies) = await transport.submissions()
        try require(questionBodies.count == 2 && questionBodies[0] == questionBodies[1], "Retry changed request or payload")
        try require(reopened.questions[0].status == .answered && reopened.notices[key] != "执行端已接收这次回答。", "200 was mistaken for native acceptance")
        print("PASS 3 reopened retry uses exact bytes and 200 does not imply native acceptance")

        await transport.configure()
        await reopened.refresh(snapshot)
        try require(reopened.questions[0].status == .resolved && reopened.notices[key] == "执行端已接收这次回答。", "Own entry ACK did not register")
        print("PASS 4 own answer ACK required")

        await reopened.decide(reopened.approvals[0], outcome: .allowedOnce)
        try require(reopened.approvals[0].status == .resolved && snapshot.replyEvidence.status == .blocked, "Decision was confused with task completion")
        try require(reopened.pendingApprovals.isEmpty, "Registered approval did not disappear")
        print("PASS 5 decision confirmation remains separate from task completion")

        await transport.configure(oldSnapshot: true)
        await reopened.refresh(snapshot)
        try require(reopened.approvals[0].status == .resolved && reopened.questions[0].status == .resolved, "Old answered snapshot regressed a terminal record")
        let countsBefore = await transport.submissions()
        await reopened.continueOriginal(key)
        let countsAfter = await transport.submissions()
        try require(countsBefore.1.count == countsAfter.1.count, "Terminal response was resubmitted")
        print("PASS 6 terminal records survive stale snapshots without resubmission")

        await transport.configure(denyQuestions: true)
        await reopened.refresh(snapshot)
        try require(reopened.questionError != nil && reopened.questions[0].status == .resolved &&
            context.session?.verification == .verified, "Temporary 403 cleared answer/account")
        print("PASS 7 temporary source denial preserves answer and account")

        context.epoch = UUID()
        await reopened.decide(reopened.approvals[0], outcome: .rejected)
        try require(!reopened.isCurrent && !reopened.canRespond(key), "Old account epoch remained actionable")
        let finalCounts = await transport.submissions()
        try require(finalCounts.0.count == 1 && finalCounts.1.count == 2, "Unexpected duplicate or account-stale mutation")
        print("PASS 8 account epoch retires actions; provider=0 externalHTTP=0")
        let categoryHTTP = InteractionHTTP()
        let categoryClient = PersonalClient(credentialStore: InteractionCredentials(), transport: categoryHTTP)
        let categoryAccount = try await categoryClient.login(server: ServerConfiguration(input: "https://interaction.unit.example:8443"),
            username: "fixture", password: "synthetic-only", deviceName: "Synthetic")
        let categoryEpoch = UUID()
        func categoryModel() -> TaskInteractionModel {
            TaskInteractionModel(client: categoryClient, account: categoryAccount, epoch: categoryEpoch,
                stateDirectory: directory.appendingPathComponent("category"), currentEpoch: { categoryEpoch }, currentSession: { categoryAccount })
        }
        let categorySnapshot = try await categoryClient.taskDetail(taskID: "task-check")
        let firstCategory = categoryModel()
        await firstCategory.refresh(categorySnapshot)
        await categoryHTTP.configure(lostApproval: true)
        await firstCategory.decide(firstCategory.approvals[0], outcome: .allowedOnce, decisionScope: .conversationCategory)
        try require(firstCategory.pendingApprovals.count == 1, "Uncertain approval disappeared before matched receipt")
        let categoryKey = "approval:approval-check"
        await categoryHTTP.denyApprovalReads(true)
        await firstCategory.refresh(snapshot)
        try require(firstCategory.pendingApprovals.count == 1 && !firstCategory.canRespond(categoryKey), "Uncertain original disappeared or approval became enabled after read failure")
        await categoryHTTP.denyApprovalReads(false)
        try require(firstCategory.responseNeedsReadback(categoryKey), "Lost category POST was not retained")
        let reloadedCategory = categoryModel()
        await reloadedCategory.refresh(categorySnapshot)
        try require(reloadedCategory.savedApprovalScope(reloadedCategory.approvals[0]) == .conversationCategory, "Journal lost category scope")
        await reloadedCategory.continueOriginal(categoryKey)
        let categoryPosts = await categoryHTTP.submissions().0
        try require(categoryPosts.count == 2 && categoryPosts[0] == categoryPosts[1], "Category retry changed request/outcome/scope bytes")
        try require(reloadedCategory.approvals[0].decisionSummary == "已允许 · 运行脚本 · 本对话总是允许此类", "Resolved category summary is incorrect")
        print("PASS 10 category scope survives lost response and journal reopen with exact retry bytes")
        let queueHTTP = InteractionHTTP()
        await queueHTTP.addSecondApproval()
        let queueClient = PersonalClient(credentialStore: InteractionCredentials(), transport: queueHTTP)
        let queueSession = try await queueClient.login(server: ServerConfiguration(input: "https://interaction.unit.example:8443"), username: "fixture", password: "synthetic-only", deviceName: "Synthetic")
        let queueModel = TaskInteractionModel(client: queueClient, account: queueSession, epoch: context.epoch,
            stateDirectory: directory.appendingPathComponent("queue"), currentEpoch: { context.epoch }, currentSession: { queueSession })
        await queueModel.refreshTimeline(sessionID: "session-check")
        try require(queueModel.pendingApprovals.count == 2 && queueModel.pendingApprovals.first?.id == "approval-check", "Approval queue ordering incorrect")
        await queueModel.decide(queueModel.pendingApprovals[0], outcome: .allowedOnce)
        try require(queueModel.pendingApprovals.count == 1 && queueModel.pendingApprovals.first?.id == "approval-second", "Next approval did not replace registered first item")
        try require(queueModel.approvalHeadline(queueModel.pendingApprovals[0]) == "要运行命令：npm run verify", "Approval target missing before asynchronous detail read")
        print("PASS 11 two-item queue advances after matched receipt; immediate target and uncertain read failure retained")
        print("TaskInteractionChecks: 11/11 passed; journal=" + directory.path)
    }
}
