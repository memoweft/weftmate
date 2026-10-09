import Combine
import Foundation
import WeftMateCore

private enum TaskInteractionJournalFailure: LocalizedError {
    case originalExists
    var errorDescription: String? { "这项回应已有原提交记录，请重新核对后继续。" }
}

private struct SavedTaskResponse: Codable {
    let approval: ApprovalDecisionIntent?
    let question: QuestionAnswerIntent?
    var attempted = false
    var registered = false
    var scope: SessionInteractionScope { approval?.scope ?? question!.scope }
    var key: String { approval.map { "approval:" + $0.approvalId } ?? "question:" + question!.questionRpcId }
    var requestId: String { approval?.requestId ?? question!.requestId }

    init(approval: ApprovalDecisionIntent?, question: QuestionAnswerIntent?) {
        self.approval = approval; self.question = question
    }
    enum CodingKeys: String, CodingKey { case approval, question, attempted, registered }
    init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        approval = try box.decodeIfPresent(ApprovalDecisionIntent.self, forKey: .approval)
        question = try box.decodeIfPresent(QuestionAnswerIntent.self, forKey: .question)
        guard (approval != nil) != (question != nil) else { throw APIFailure.invalidResponse }
        attempted = try box.decode(Bool.self, forKey: .attempted)
        registered = try box.decode(Bool.self, forKey: .registered)
    }
}

/// Permission decisions and information answers share task identity, never their outcome semantics.
@MainActor final class TaskInteractionModel: ObservableObject {
    @Published private(set) var readableApprovals: [String: String] = [:]
    @Published private(set) var approvalDetails: [String: String] = [:]
    @Published private(set) var approvals: [SessionApproval] = []
    @Published private(set) var questions: [SessionQuestionBatch] = []
    @Published private(set) var loading = false
    @Published private(set) var busy = Set<String>()
    @Published private(set) var notices: [String: String] = [:]
    @Published private(set) var errors: [String: String] = [:]
    @Published private(set) var approvalError: String?
    @Published private(set) var questionError: String?
    @Published private(set) var hasMoreApprovals = false
    @Published private(set) var hasMoreQuestions = false
    @Published private(set) var currentApprovals = Set<String>()
    @Published private(set) var currentQuestions = Set<String>()
    var persistenceError: String? { journalError }
    private let client: PersonalClient
    private let account: AccountSession?
    private let epoch: UUID
    private let currentEpoch: @MainActor () -> UUID
    private let currentSession: @MainActor () -> AccountSession?
    private let journalURL: URL?
    private var saved: [SavedTaskResponse] = []
    private var journalError: String?
    private var active = true
    private var generation = UUID()
    private var task: TaskSnapshot?
    private var timelineSessionID: String?
    private var sessionID: String? { timelineSessionID ?? task?.sessionId }
    private var approvalCursor: ApprovalPageCursor?
    private var questionCursor: QuestionPageCursor?
    private var approvalDepth = 1
    private var questionDepth = 1

    init(client: PersonalClient, account: AccountSession?, epoch: UUID, stateDirectory: URL?,
         currentEpoch: @escaping @MainActor () -> UUID, currentSession: @escaping @MainActor () -> AccountSession?) {
        self.client = client; self.account = account; self.epoch = epoch
        self.currentEpoch = currentEpoch; self.currentSession = currentSession
        let directory = stateDirectory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?.appendingPathComponent("WeftMate/LocalState", isDirectory: true)
        journalURL = directory?.appendingPathComponent("task-responses-v1.json")
    }
    var isCurrent: Bool {
        guard active, currentEpoch() == epoch, let account, let current = currentSession(),
              current.verification == .verified, account.verification == .verified else { return false }
        return account.server == current.server && account.account.ownerId == current.account.ownerId && account.hostId == current.hostId
    }
    func activate() { active = true }
    func suspend() {
        active = false; generation = UUID(); busy = []; loading = false
        currentApprovals = []; currentQuestions = []
    }
    func cancel() {
        suspend(); task = nil; approvals = []; questions = []
        loading = false; notices = [:]; errors = [:]; approvalError = nil; questionError = nil
        currentApprovals = []; currentQuestions = []
    }
    func refresh(_ snapshot: TaskSnapshot) async {
        guard isCurrent, !loading, matches(snapshot.scope) else { return }
        task = snapshot; timelineSessionID = nil
        await refreshSession(snapshot.sessionId)
    }
    func readApprovalPresentation(_ approval: SessionApproval, events: [TimelineEvent]) async {
        guard isCurrent, readableApprovals[approval.id] == nil,
              let event = events.first(where: { $0.data["callId"]?.string == approval.callId && $0.data["detailRef"]?["seq"]?.int != nil }),
              let seq = event.data["detailRef"]?["seq"]?.int else { return }
        do {
            let detail = try await client.timelineDetail(sessionID: approval.sessionId, seq: seq)
            guard isCurrent, !Task.isCancelled else { return }
            readableApprovals[approval.id] = "要" + ToolProgressSummary.readable(tool: approval.toolName, raw: detail.text)
            approvalDetails[approval.id] = detail.text
        } catch { /* The authorized human reason remains available if detail cannot be read. */ }
    }

    func refreshTimeline(sessionID: String) async {
        guard isCurrent, !loading else { return }
        task = nil; timelineSessionID = sessionID
        await refreshSession(sessionID)
    }
    private func refreshSession(_ sessionID: String) async {
        loadJournal()
        loading = true; let token = generation
        defer { if token == generation { loading = false } }
        do {
            var page = try await client.approvals(sessionID: sessionID)
            guard isCurrent, token == generation, matches(page.scope) else { return }
            var readDepth = 0
            var observed = Set<String>()
            while true {
                let rows = page.approvals.filter { belongs($0.taskId, command: $0.sourceCommandId, receipt: $0.sourceReceiptId) }
                observed.formUnion(rows.map(\.id)); mergeApprovals(rows); readDepth += 1
                guard readDepth < approvalDepth, let cursor = page.nextCursor else { break }
                page = try await client.approvals(sessionID: sessionID, before: cursor)
                guard isCurrent, token == generation, matches(page.scope) else { return }
            }
            currentApprovals = observed
            approvalDepth = readDepth
            approvalCursor = page.nextCursor; hasMoreApprovals = page.hasMore; approvalError = nil
            updateResponseNotices()
        } catch { if isCurrent && token == generation { approvalError = message(error); currentApprovals = [] } }
        do {
            var page = try await client.questions(sessionID: sessionID)
            guard isCurrent, token == generation, matches(page.scope) else { return }
            var readDepth = 0
            var observed = Set<String>()
            while true {
                let rows = page.questions.filter { belongs($0.taskId, command: $0.sourceCommandId, receipt: $0.sourceReceiptId) }
                observed.formUnion(rows.map(\.id)); mergeQuestions(rows); readDepth += 1
                guard readDepth < questionDepth, let cursor = page.nextCursor else { break }
                page = try await client.questions(sessionID: sessionID, before: cursor)
                guard isCurrent, token == generation, matches(page.scope) else { return }
            }
            currentQuestions = observed
            questionDepth = readDepth
            questionCursor = page.nextCursor; hasMoreQuestions = page.hasMore; questionError = nil
            updateResponseNotices()
        } catch { if isCurrent && token == generation { questionError = message(error); currentQuestions = [] } }
    }
    func loadMoreApprovals() async {
        guard isCurrent, !loading, let sessionID, let cursor = approvalCursor else { return }
        loading = true; let token = generation
        defer { if token == generation { loading = false } }
        do {
            let page = try await client.approvals(sessionID: sessionID, before: cursor)
            guard isCurrent, token == generation, matches(page.scope) else { return }
            let rows = page.approvals.filter { belongs($0.taskId, command: $0.sourceCommandId, receipt: $0.sourceReceiptId) }
            currentApprovals.formUnion(rows.map(\.id)); mergeApprovals(rows)
            approvalDepth += 1
            approvalCursor = page.nextCursor; hasMoreApprovals = page.hasMore; approvalError = nil
            updateResponseNotices()
        } catch { if isCurrent && token == generation { approvalError = message(error); currentApprovals = [] } }
    }
    func loadMoreQuestions() async {
        guard isCurrent, !loading, let sessionID, let cursor = questionCursor else { return }
        loading = true; let token = generation
        defer { if token == generation { loading = false } }
        do {
            let page = try await client.questions(sessionID: sessionID, before: cursor)
            guard isCurrent, token == generation, matches(page.scope) else { return }
            let rows = page.questions.filter { belongs($0.taskId, command: $0.sourceCommandId, receipt: $0.sourceReceiptId) }
            currentQuestions.formUnion(rows.map(\.id)); mergeQuestions(rows)
            questionDepth += 1
            questionCursor = page.nextCursor; hasMoreQuestions = page.hasMore; questionError = nil
            updateResponseNotices()
        } catch { if isCurrent && token == generation { questionError = message(error); currentQuestions = [] } }
    }
    func hasSaved(_ key: String) -> Bool { response(key) != nil }
    func isRegistered(_ key: String) -> Bool { response(key)?.registered == true }
    func canRespond(_ key: String) -> Bool {
        guard isCurrent, journalError == nil, !busy.contains(key), response(key) == nil else { return false }
        if key.hasPrefix("approval:") { return approvalError == nil && currentApprovals.contains(String(key.dropFirst(9))) }
        return questionError == nil && currentQuestions.contains(String(key.dropFirst(9)))
    }
    func savedApprovalOutcome(_ approval: SessionApproval) -> ApprovalDecisionOutcome? {
        response("approval:" + approval.id)?.approval?.outcome
    }
    func savedApprovalScope(_ approval: SessionApproval) -> ApprovalDecisionScope? {
        response("approval:" + approval.id)?.approval?.decisionScope
    }
    func savedAnswers(_ batch: SessionQuestionBatch) -> [QuestionAnswerItem]? {
        response("question:" + batch.id)?.question?.answer.answers ?? batch.answer?.answers
    }
    func responseNeedsReadback(_ key: String) -> Bool { response(key)?.registered == false }
    func approvalHeadline(_ approval: SessionApproval) -> String {
        if let known = readableApprovals[approval.id] { return known }
        return approval.actionHeadline
    }
    var pendingApprovals: [SessionApproval] {
        approvals.filter { $0.canDecide && (currentApprovals.contains($0.id) || hasSaved("approval:" + $0.id)) && response("approval:" + $0.id)?.registered != true }
            .sorted { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }
    }
    func decisionLabel(for step: TimelineStep) -> String? {
        guard let row = approvals.first(where: { $0.callId == step.data["callId"]?.string || $0.callId == step.data["stepId"]?.string }) else { return step.decision }
        let record = response("approval:" + row.id)
        let outcome = row.outcome?.rawValue ?? row.decisionOutcome?.rawValue ?? (record?.registered == true ? record?.approval?.outcome.rawValue : nil)
        return outcome == "allowed-once" ? "已批准" : outcome == "rejected" ? "已拒绝" : step.decision
    }
    var needsObservation: Bool {
        approvals.contains { !$0.status.isTerminal } || questions.contains { !$0.status.isTerminal }
    }
    func decide(_ approval: SessionApproval, outcome: ApprovalDecisionOutcome, decisionScope: ApprovalDecisionScope? = nil) async {
        let key = "approval:" + approval.id
        guard canRespond(key), approval.canDecide, approvals.contains(approval), let scope = try? scope() else { return }
        do {
            let intent = try ApprovalDecisionIntent(scope: scope, approval: approval, outcome: outcome, requestID: UUID().uuidString, decisionScope: decisionScope)
            try save(SavedTaskResponse(approval: intent, question: nil))
            await submit(key)
        } catch { errors[key] = message(error) }
    }
    func answer(_ batch: SessionQuestionBatch, answers: [QuestionAnswerItem]) async {
        let key = "question:" + batch.id
        guard canRespond(key), batch.canAnswer, questions.contains(batch), let scope = try? scope() else { return }
        do {
            let intent = try QuestionAnswerIntent(scope: scope, question: batch, answers: answers, requestID: UUID().uuidString)
            try save(SavedTaskResponse(approval: nil, question: intent))
            await submit(key)
        } catch { errors[key] = message(error) }
    }
    /// A lost response is first read back. Only an explicit retry can reuse the same persisted payload.
    func continueOriginal(_ key: String) async {
        guard isCurrent, !busy.contains(key) else { return }
        await refreshCurrent()
        guard isCurrent, let record = response(key) else { return }
        if let intent = record.approval {
            guard approvalError == nil, currentApprovals.contains(intent.approvalId),
                  approvals.first(where: { $0.id == intent.approvalId })?.canDecide == true else { return }
        }
        if let intent = record.question {
            guard questionError == nil, currentQuestions.contains(intent.questionRpcId),
                  questions.first(where: { $0.id == intent.questionRpcId })?.canAnswer == true else { return }
        }
        if record.registered { return }
        await submit(key)
    }
    private func submit(_ key: String) async {
        guard isCurrent, var record = response(key), !busy.contains(key) else { return }
        busy.insert(key); errors[key] = nil; let token = generation
        defer { if token == generation { busy.remove(key) } }
        do {
            record.attempted = true; try save(record)
            if let intent = record.approval {
                _ = try await client.submitApproval(intent)
                guard isCurrent, token == generation else { return }
            } else if let intent = record.question {
                _ = try await client.submitQuestionAnswer(intent)
                guard isCurrent, token == generation else { return }
            }
            record.registered = true; try save(record)
            notices[key] = record.approval != nil ? "决定已登记，等待执行端确认。" : "回答已登记，等待原生接收确认。"
            await refreshCurrent()
        } catch {
            guard isCurrent, token == generation else { return }
            notices[key] = "提交结果待核对，原请求已保留。"; errors[key] = message(error)
            await refreshCurrent()
        }
    }
    private func refreshCurrent() async {
        if let timelineSessionID { await refreshTimeline(sessionID: timelineSessionID) }
        else if let task { await refresh(task) }
    }
    private func scope() throws -> SessionInteractionScope {
        guard let account, let sessionID else { throw APIFailure.notAuthenticated }
        return try SessionInteractionScope(session: account, sessionID: sessionID)
    }
    private func matches(_ value: TaskReadScope) -> Bool {
        account.map { $0.server == value.server && $0.account.ownerId == value.ownerId && $0.hostId == value.hostId } ?? false
    }
    private func matches(_ value: SessionInteractionScope) -> Bool {
        account.map { $0.server == value.server && $0.account.ownerId == value.ownerId && $0.hostId == value.hostId && sessionID == value.sessionId } ?? false
    }
    private func belongs(_ root: String, command: String, receipt: String) -> Bool {
        if timelineSessionID != nil { return true }
        guard let task, root == task.taskId else { return false }
        return ([task.source] + task.supplements + task.resumes).contains { $0.commandId == command && $0.receiptId == receipt }
    }
    private func mergeApprovals(_ rows: [SessionApproval]) {
        for row in rows {
            if let index = approvals.firstIndex(where: { $0.id == row.id }) {
                if approvals[index].status.isTerminal && !row.status.isTerminal { continue }
                approvals[index] = row
            } else { approvals.append(row) }
        }
    }
    private func mergeQuestions(_ rows: [SessionQuestionBatch]) {
        for row in rows {
            if let index = questions.firstIndex(where: { $0.id == row.id }) {
                if questions[index].status.isTerminal && !row.status.isTerminal { continue }
                questions[index] = row
            } else { questions.append(row) }
        }
    }
    private func updateResponseNotices() {
        for row in approvals {
            let key = "approval:" + row.id
            if row.status == .resolved {
                if row.outcome == .allowedOnce { notices[key] = "执行端已确认本次允许决定；任务进度另行显示。" }
                else if row.outcome == .rejected { notices[key] = "执行端已确认本次拒绝决定；任务进度另行显示。" }
                else { notices[key] = "执行端已返回决定状态，具体结果待核对。" }
            }
            else if row.status == .unavailable { notices[key] = row.outcome == .cancelled ? "任务已取消，这项决定已失效。" : "这项决定当前不可用。" }
            else if row.status == .answered { notices[key] = "决定已登记，等待执行端确认。" }
            else if let record = response(key) { notices[key] = record.registered ? "决定已登记，当前接收状态待核对。" : "提交结果待核对，原请求已保留。" }
        }
        for row in questions {
            let key = "question:" + row.id
            if row.status == .unavailable || row.outcome == .cancelled { notices[key] = "这个问题当前已失效，未取消其他任务。" }
            else if let request = response(key)?.requestId, row.acceptedAnswer(requestID: request) { notices[key] = "执行端已接收这次回答。" }
            else if row.status == .answered || row.status == .resolved { notices[key] = "已记录回答状态，这次提交是否被采用仍待核对。" }
            else if let record = response(key) { notices[key] = record.registered ? "回答已登记，当前接收状态待核对。" : "提交结果待核对，原请求已保留。" }
        }
    }
    private func response(_ key: String) -> SavedTaskResponse? {
        guard let scope = try? scope() else { return nil }
        return saved.first { $0.scope == scope && $0.key == key }
    }
    private func loadJournal() {
        guard let journalURL else { journalError = "本机回答记录暂不可用，请稍后重试。"; return }
        do {
            if FileManager.default.fileExists(atPath: journalURL.path) { saved = try JSONDecoder().decode([SavedTaskResponse].self, from: Data(contentsOf: journalURL)) }
        } catch { journalError = "原回答记录未能读取，文件保留。" }
    }
    private func save(_ value: SavedTaskResponse) throws {
        guard journalError == nil, let journalURL else { throw APIFailure.invalidResponse }
        try FileManager.default.createDirectory(at: journalURL.deletingLastPathComponent(),
            withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        // A detail and an inline card can reopen the same journal. Preserve other saved responses.
        var next = FileManager.default.fileExists(atPath: journalURL.path)
            ? try JSONDecoder().decode([SavedTaskResponse].self, from: Data(contentsOf: journalURL)) : saved
        if let index = next.firstIndex(where: { $0.scope == value.scope && $0.key == value.key }) {
            let original = next[index]
            guard original.requestId == value.requestId, original.approval == value.approval,
                  original.question == value.question else { throw TaskInteractionJournalFailure.originalExists }
            var merged = value
            merged.attempted = original.attempted || value.attempted
            merged.registered = original.registered || value.registered
            next[index] = merged
        }
        else { next.append(value) }
        let data = try JSONEncoder().encode(next)
        try data.write(to: journalURL, options: .atomic)
        saved = next
    }
    private func message(_ error: Error) -> String {
        if case APIFailure.server(404, _) = error { return "当前连接尚未提供这项能力。" }
        return (error as? LocalizedError)?.errorDescription ?? "读取未完成，请重新核对。"
    }
}
