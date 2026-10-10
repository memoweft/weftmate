import Foundation
import Combine
import WeftMateCore

@MainActor final class MainChatModel: ObservableObject {
    @Published var chat: LogicalChat?
    @Published var capabilities = ChatCapabilities()
    @Published var window = ChatWindow()
    // Reading coordinates are not presentation changes. Publishing every pixel would rebuild the lazy body while scrolling.
    var visibleAnchor: ChatAnchor?
    @Published var timeZone = "UTC"
    @Published var indexState = "ready"
    @Published var dayCounts: [String: Int] = [:]
    @Published var loading = false
    @Published var error: String?
    @Published var query = ""
    @Published var hits: [ChatSearchPage.Hit] = []
    @Published var hitIndex = 0
    @Published var searchCursor: String?
    @Published var target: ChatAnchor?
    @Published var draft = ""
    @Published var modelID = ""
    @Published var models: [SharedHostModel] = []
    @Published var attachments: [ConversationAttachmentDraft] = []
    @Published var command: LogicalCommand?
    @Published var pending: JSONValue?
    @Published var sending = false
    @Published var resources: [JSONValue] = []
    @Published var resourceVisible = false
    @Published var sideSource: LogicalChat?
    private weak var app: AppleAppModel?
    private var epoch = UUID()
    private var searchGeneration = UUID()
    private var resourceGeneration = UUID()
    private var pendingTemporary = false
    private var pendingEntry = ""
    private struct Asset: Codable { let metadata: OriginalAttachment; let file: URL; let original: Bool }
    private var assets: [Asset] = []
    private var transferSource: ConversationSummary?
    private var transferDraft: String?
    private var transferFiles: [ConversationAttachmentDraft] = []
    init(app: AppleAppModel) { self.app = app }
    var nativeEvents: [TimelineEvent] {
        window.events.compactMap { row in
            guard row.sessionID == chat?.activeSessionId, let seq = row.sourceRef["seq"]?.int else { return nil }
            return TimelineEvent(seq: seq, type: row.type, at: row.at, data: row.data)
        }
    }
    func clear() {
        window.reset(); visibleAnchor = nil; dayCounts = [:]; chat = nil; hits = []; query = ""; resources = []; resourceVisible = false; target = nil
        sideSource = nil; searchGeneration = UUID(); resourceGeneration = UUID(); command = nil; pending = nil
        models = []; modelID = ""; timeZone = "UTC"; indexState = "ready"; assets = []; transferSource = nil; transferDraft = nil; transferFiles = []
        draft = ""; attachments.forEach { $0.removeTemporaryFiles() }; attachments = []; error = nil; loading = false; sending = false
    }
    func configure() async {
        guard let app else { return }
        let token = app.accountEpoch
        if epoch != token { clear(); epoch = token }
        do {
            let caps = try await app.assistantClient.chatCapabilities()
            guard app.accountEpoch == token else { return }; capabilities = caps
            guard caps.timeline else { chat = nil; return }
            let value = try await app.assistantClient.logicalChat()
            guard app.accountEpoch == token else { return }
            if chat?.contentRevision != nil, chat?.contentRevision != value.contentRevision { invalidate() }
            chat = value
            if window.events.isEmpty { timeZone = value.timeZone }
            if draft.isEmpty, pending == nil { draft = app.draftText(for: value.summary, accountEpoch: token) }
            let readModels = try await app.assistantClient.hostModels()
            guard app.accountEpoch == token else { return }; models = readModels
            if let bound = value.modelProfileId, value.activeSessionId != nil { modelID = bound }
            else if modelID.isEmpty { modelID = models.first(where: \.configured)?.id ?? "" }
        } catch { if app.accountEpoch == token, !(await app.handleLogicalChatFailure(error)) { self.error = error.localizedDescription } }
    }
    /// Invalidate every content-bearing projection and old callback before requesting a fresh page.
    func invalidate() {
        window.reset(); visibleAnchor = nil; dayCounts = [:]; hits = []; searchCursor = nil; hitIndex = 0; query = ""; resources = []; resourceVisible = false
        sideSource = nil; target = nil; searchGeneration = UUID(); resourceGeneration = UUID()
    }
    private func current(_ token: UUID, _ generation: UUID) -> Bool { app?.accountEpoch == token && window.generation == generation && !Task.isCancelled }
    private func failed(_ failure: Error, token: UUID, generation: UUID) async {
        guard current(token, generation) else { return }
        if await app?.handleLogicalChatFailure(failure) == true { return }
        if case APIFailure.server(409, "CURSOR_RESET_REQUIRED") = failure {
            invalidate(); loading = false
            await configure()
            if capabilities.timeline { await read(replace: true) }
            else { await app?.refresh() }
        } else { error = failure.localizedDescription }
    }
    func read(before: String? = nil, after: String? = nil, around: String? = nil, replace: Bool = false) async {
        guard let app, let chat, !loading else { return }
        loading = true; error = nil; let token = epoch, generation = window.generation
        defer { if current(token, generation) { loading = false } }
        do {
            let page = try await app.assistantClient.chatPage(id: chat.id, before: before, after: after, around: around)
            guard current(token, generation) else { return }
            window.anchor = visibleAnchor
            try window.apply(page, older: before != nil, replace: replace); indexState = page.indexState; timeZone = page.timeZone
            if let around, let row = window.events.first(where: { $0.id == around }) {
                window.expandedDays.insert(ChatDay.key(row, timeZone: timeZone)); target = .init(eventID: around, pixelOffset: 0)
            }
            if page.deletedAnchor == true { error = "来源已删除或不可用，已回到最近记录。" }
            await readDayCounts()
        } catch { await failed(error, token: token, generation: generation) }
    }
    private func readDayCounts() async {
        guard let app, let chat else { return }
        let dates = Set(window.events.map { ChatDay.key($0, timeZone: timeZone) }.filter { $0 != "日期未记录" }).sorted()
        guard let from = dates.first, let to = dates.last else { return }
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: timeZone); formatter.dateFormat = "yyyy-MM-dd"
        guard let first = formatter.date(from: from), let last = formatter.date(from: to), last.timeIntervalSince(first) <= 31 * 86400 else { return }
        let token = epoch, generation = window.generation
        do {
            let page = try await app.assistantClient.chatDates(id: chat.id, from: from, to: to)
            guard current(token, generation) else { return }; try window.requireRevision(page.contentRevision)
            dayCounts = Dictionary(uniqueKeysWithValues: page.days.map { ($0.date, $0.count) }); indexState = page.indexState
        } catch { await failed(error, token: token, generation: generation) }
    }
    func changes() async {
        guard let app, let chat, let cursor = window.syncCursor, !loading else { return }
        let token = epoch, generation = window.generation
        do {
            let page = try await app.assistantClient.chatChanges(id: chat.id, cursor: cursor)
            let latest = try await app.assistantClient.logicalChat()
            guard current(token, generation) else { return }
            try window.requireRevision(latest.contentRevision)
            window.anchor = visibleAnchor; try window.apply(page); self.chat = latest
            if let bound = latest.modelProfileId, latest.activeSessionId != nil { modelID = bound }
            indexState = page.indexState; timeZone = page.timeZone
            if page.hasMore { await changes() }
        } catch { await failed(error, token: token, generation: generation) }
    }
    func search() async {
        guard let app, let chat, capabilities.supports("chatSearch"), !query.trimmingCharacters(in: .whitespaces).isEmpty else { hits = []; return }
        searchGeneration = UUID(); let search = searchGeneration, token = epoch, generation = window.generation, q = query
        do {
            let page = try await app.assistantClient.chatSearch(id: chat.id, query: q)
            guard current(token, generation), search == searchGeneration else { return }; try window.requireRevision(page.contentRevision)
            hits = page.hits; searchCursor = page.nextCursor; hitIndex = 0; indexState = page.indexState
            await moveHit(0)
        } catch { await failed(error, token: token, generation: generation) }
    }
    func moveHit(_ direction: Int) async {
        guard let app, let chat, !hits.isEmpty else { return }
        let next = hitIndex + direction
        if next >= hits.count, let cursor = searchCursor {
            let token = epoch, generation = window.generation, search = searchGeneration
            do {
                let page = try await app.assistantClient.chatSearch(id: chat.id, query: query, cursor: cursor)
                guard current(token, generation), search == searchGeneration else { return }; try window.requireRevision(page.contentRevision)
                let ids = Set(hits.map(\.id)); hits += page.hits.filter { !ids.contains($0.id) }; searchCursor = page.nextCursor
            } catch { await failed(error, token: token, generation: generation); return }
        }
        hitIndex = max(0, min(next, hits.count - 1)); await read(around: hits[hitIndex].id, replace: true)
    }
    func returnToLatest() async {
        visibleAnchor = nil; target = nil
        await read(replace: true)
    }
    func jump(_ date: Date) async {
        guard let app, let chat else { return }; let token = epoch, generation = window.generation
        do {
            let result = try await app.assistantClient.chatLocate(id: chat.id, date: ChatDay.key(date, timeZone: timeZone))
            guard current(token, generation) else { return }; try window.requireRevision(result.contentRevision); indexState = result.indexState
            if let id = result.eventId { await read(around: id, replace: true) }
            else { error = result.indexState == "ready" ? "这一天没有记录。" : "早期记录仍在整理，请稍后再查。" }
        } catch { await failed(error, token: token, generation: generation) }
    }
    func loadResources() async {
        guard let app, let chat, capabilities.supports("chatResources") else { return }
        resourceVisible = true; resourceGeneration = UUID(); let resource = resourceGeneration, token = epoch, generation = window.generation
        resources = []; var cursor: String?
        do {
            repeat {
                let page = try await app.assistantClient.chatResources(id: chat.id, cursor: cursor)
                guard current(token, generation), resourceGeneration == resource else { return }; try window.requireRevision(page.contentRevision)
                for row in page.outputs + page.sources { mergeResource(row) }
                cursor = page.hasMore ? page.nextCursor : nil
            } while cursor != nil
        } catch { await failed(error, token: token, generation: generation) }
    }
    private func mergeResource(_ row: JSONValue) {
        func identity(_ value: JSONValue) -> String? {
            if let artifact = value["artifactId"]?.string { return "output:" + artifact }
            if let key = value["key"]?.string, let session = value["sessionId"]?.string { return "source:" + session + "|" + key }
            return nil
        }
        guard let id = identity(row), let index = resources.firstIndex(where: { identity($0) == id }) else {
            if !resources.contains(row) { resources.append(row) }; return
        }
        guard case .object(var merged) = row else { return }
        if case .array(let previous) = resources[index]["uses"], case .array(let next) = row["uses"] {
            var uses = previous
            for use in next {
                let key = use["callId"]?.string ?? use["id"]?.string
                if let position = uses.firstIndex(where: { ($0["callId"]?.string ?? $0["id"]?.string) == key }) {
                    if !(uses[position]["path"]?.string?.hasPrefix("/tasks/") == true && use["path"]?.string?.hasPrefix("/tasks/") != true) { uses[position] = use }
                } else { uses.append(use) }
            }
            merged["uses"] = .array(uses)
        }
        resources[index] = .object(merged)
    }
    func setDraft(_ value: String) {
        draft = value
        if let app, let chat { app.setDraft(value, for: chat.summary, accountEpoch: epoch) }
    }
    func addFiles(_ files: [URL]) {
        do { attachments += try files.map { try ConversationAttachmentDraft.prepare(file: $0) } } catch { self.error = "附件未添加，请重试。" }
    }
    private var journal: URL? {
        guard let app, let session = app.session, let dir = app.assistantStateDirectory,
              let account = try? LocalAccountScope(server: session.server, ownerId: session.account.ownerId) else { return nil }
        return dir.appendingPathComponent("LogicalCommands").appendingPathComponent(account.cacheKey + ".json")
    }
    private func retain(_ body: JSONValue, temporary: Bool, entry: String) throws {
        guard let journal else { throw APIFailure.credentialStorage }
        let record: [String: JSONValue] = ["body": body, "temporary": .bool(temporary), "entry": .string(entry),
            "hostID": .string(app?.session?.hostId ?? ""),
            "transferSourceID": transferSource.map { .string($0.id) } ?? .null,
            "transferDraft": temporary ? .null : transferDraft.map(JSONValue.string) ?? .null,
            "transfersComposer": .bool(transferDraft != nil),
            "assets": try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(assets))]
        try FileManager.default.createDirectory(at: journal.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(record).write(to: journal, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: journal.path)
        pending = body; pendingTemporary = temporary; pendingEntry = entry
    }
    func restoreRequest() {
        guard pending == nil, let journal, let data = try? Data(contentsOf: journal), let row = try? JSONDecoder().decode([String: JSONValue].self, from: data), let body = row["body"], row["hostID"]?.string == app?.session?.hostId else { return }
        pending = body; pendingTemporary = row["temporary"]?.bool ?? false; pendingEntry = row["entry"]?.string ?? ""
        if let value = row["assets"], let bytes = try? JSONEncoder().encode(value) { assets = (try? JSONDecoder().decode([Asset].self, from: bytes)) ?? [] }
        if pendingEntry == "side", row["transfersComposer"]?.bool == true {
            transferSource = app?.conversations.first { $0.id == row["transferSourceID"]?.string }
            transferDraft = row["transferDraft"]?.string ?? transferSource.flatMap { source in app.map { $0.draftText(for: source, accountEpoch: epoch) } }
            transferFiles = assets.filter(\.original).compactMap { try? ConversationAttachmentDraft.prepare(file: $0.file, name: $0.metadata.name) }
        }
        if body["kind"]?.string == "chat.message", draft.isEmpty { draft = body["text"]?.string ?? "" }
    }
    func send() async {
        guard let app, let chat, pending == nil, !sending, capabilities.supports("chatSend") else { return }
        var body: [String: JSONValue] = ["requestId": .string("apple-chat-" + UUID().uuidString.lowercased()), "kind": .string("chat.message"), "targetDeviceId": .string(app.session?.hostId ?? ""), "chatId": .string(chat.id), "text": .string(draft), "mode": .string(app.runningMessageMode.rawValue)]
        if chat.activeSessionId == nil { body["modelProfileId"] = .string(modelID) }
        let originals = attachments.map(\.original)
        var staged: [StagedConversationAttachment] = [], textBytes = 0, bytes = 0
        do {
            for file in attachments {
                if let item = try file.stage(remainingTextBytes: AttachmentLimits.textBytes - textBytes, remainingBytes: AttachmentLimits.messageBytes - bytes) {
                    staged.append(item); bytes += item.metadata.size
                    if AttachmentLimits.textTypes.contains(item.metadata.contentType) { textBytes += item.metadata.size }
                }
            }
        } catch { self.error = "附件准备未完成，草稿保留。"; return }
        if !originals.isEmpty {
            let messageID = "apple-attachment-" + UUID().uuidString.lowercased()
            body["originalAttachments"] = try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(originals)); body["attachmentMessageId"] = .string(messageID)
            if !staged.isEmpty { body["attachments"] = try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(staged.map(\.metadata))) }
        }
        do {
            assets = []
            if !attachments.isEmpty {
                guard let journal, let request = body["requestId"]?.string else { throw APIFailure.credentialStorage }
                let folder = journal.deletingLastPathComponent().appendingPathComponent(request)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                for file in attachments {
                    let copy = folder.appendingPathComponent("original-" + file.id)
                    try FileManager.default.copyItem(at: file.file, to: copy); assets.append(.init(metadata: file.original, file: copy, original: true))
                }
                for file in staged {
                    let copy = folder.appendingPathComponent("staged-" + file.metadata.id)
                    try FileManager.default.copyItem(at: file.file, to: copy); assets.append(.init(metadata: file.metadata, file: copy, original: false))
                }
            }
            try retain(.object(body), temporary: false, entry: "send"); await reconcile(submit: true)
        }
        catch { self.error = "原请求尚未保存，草稿保留。" }
    }
    func editRejectedRequest() {
        guard command?.state == "rejected" else { return }
        do {
            if attachments.isEmpty { attachments = try assets.filter(\.original).map { try ConversationAttachmentDraft.prepare(file: $0.file, name: $0.metadata.name) } }
            if let folder = assets.first?.file.deletingLastPathComponent() { try FileManager.default.removeItem(at: folder) }
            if let journal, FileManager.default.fileExists(atPath: journal.path) { try FileManager.default.removeItem(at: journal) }
            assets = []; pending = nil; command = nil; error = nil
        } catch { self.error = "原草稿未能恢复，请核对附件后重试。" }
    }
    func createSide(event: ChatEvent? = nil, temporary: Bool = false, sourceConversation: ConversationSummary? = nil) async {
        guard let app, pending == nil, !sending, let chat, !modelID.isEmpty else { return }
        if temporary && !capabilities.supports("temporaryChats") { return }
        if !temporary && !capabilities.supports("sideChats") { return }
        let origin = sourceConversation ?? event.flatMap { event in app.conversations.first { $0.chatId == event.chatId } }
        if !temporary, origin?.temporaryState.cacheAllowed == false { error = "临时内容需要明确分享，当前请在临时对话中继续。"; return }
        var body: [String: JSONValue] = ["requestId": .string("apple-side-" + UUID().uuidString.lowercased()), "modelProfileId": .string(modelID)]
        if !temporary {
            body["kind"] = .string("session.side.create"); body["targetDeviceId"] = .string(app.session?.hostId ?? "")
            let source = sourceConversation ?? event.flatMap { event in app.conversations.first { $0.chatId == event.chatId } }
            if let project = source?.projectId { body["parent"] = .object(["kind": .string("project"), "id": .string(project)]) }
            else { body["parent"] = .object(["kind": .string("main"), "id": .string(chat.id)]) }
            body["entry"] = .string(event == nil ? "composer" : "message")
            if let event { body["originChatId"] = .string(event.chatId); body["originEventId"] = .string(event.id) }
        }
        transferSource = nil; transferDraft = nil; transferFiles = []; assets = []
        if event == nil {
            transferSource = sourceConversation ?? app.conversations.first { $0.isMainChat }
            transferDraft = sourceConversation.map { app.draftText(for: $0, accountEpoch: epoch) } ?? draft
            transferFiles = sourceConversation.map { app.attachmentDrafts[AppleAppModel.draftKey(for: $0)] ?? [] } ?? attachments
        }
        do {
            if !temporary, !transferFiles.isEmpty, let journal, let request = body["requestId"]?.string {
                let folder = journal.deletingLastPathComponent().appendingPathComponent(request)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                for file in transferFiles {
                    let copy = folder.appendingPathComponent("original-" + file.id)
                    try FileManager.default.copyItem(at: file.file, to: copy); assets.append(.init(metadata: file.original, file: copy, original: true))
                }
            }
            try retain(.object(body), temporary: temporary, entry: "side"); await reconcile(submit: true)
        }
        catch { self.error = "原请求尚未保存，请重试。" }
    }
    func reconcile(submit: Bool = false) async {
        guard let app, let body = pending, !sending else { return }
        sending = true; error = nil; let token = epoch
        defer { if app.accountEpoch == token { sending = false } }
        do {
            if pendingEntry == "send", let chat, let request = body["requestId"]?.string {
                for asset in assets {
                    if asset.original {
                        try await app.assistantClient.uploadOriginalAttachment(asset.metadata, file: asset.file, conversationID: chat.id, messageID: body["attachmentMessageId"]!.string!)
                    } else { try await app.assistantClient.uploadChatAttachment(asset.metadata, file: asset.file, chatID: chat.id, requestID: request) }
                }
            }
            var receipt = try await app.assistantClient.logicalCommand(request: body, temporary: pendingTemporary, submit: submit)
            guard app.accountEpoch == token else { return }; command = receipt
            for _ in 0..<100 {
                guard receipt?.state == "pending", !Task.isCancelled else { break }
                try await Task.sleep(for: .milliseconds(150))
                receipt = try await app.assistantClient.logicalCommand(request: body, temporary: pendingTemporary)
                guard app.accountEpoch == token else { return }; command = receipt
            }
            guard let receipt else { error = "尚未找到原请求。可继续同一请求。"; return }
            guard receipt.state == "accepted_by_dsh" else { error = receipt.state == "rejected" ? "请求未受理，草稿保留。" : "请求已排队，等待受理。"; return }
            if pendingEntry == "side" {
                await app.refresh()
                guard app.accountEpoch == token else { return }
                guard let row = app.conversations.first(where: { $0.sessionId == receipt.sessionId }) else { throw APIFailure.invalidResponse }
                app.openedSessionID = row.id
                // Transfer only after acceptance; message references never consume an unrelated composer draft.
                app.confirmCreatedChat(row, profileID: body["modelProfileId"]?.string ?? modelID)
                await app.open(row)
                if let transferDraft {
                    guard app.transferComposer(from: transferSource, to: row, text: transferDraft, files: transferFiles, epoch: token) else { throw APIFailure.invalidResponse }
                    if transferSource?.isMainChat == true {
                        if draft == transferDraft { draft = "" }
                        let ids = Set(transferFiles.map(\.id)); attachments.removeAll { ids.contains($0.id) }
                    }
                }
                transferSource = nil; transferDraft = nil; transferFiles = []
            } else {
                await configure(); await changes()
                if let chat, app.draftText(for: chat.summary, accountEpoch: token) == body["text"]?.string { app.setDraft("", for: chat.summary, accountEpoch: token) }
                if draft == body["text"]?.string { draft = "" }
                attachments.forEach { $0.removeTemporaryFiles() }; attachments = []
            }
            pending = nil
            if let folder = assets.first?.file.deletingLastPathComponent() { try? FileManager.default.removeItem(at: folder) }; assets = []
            if let journal { try? FileManager.default.removeItem(at: journal) }
        } catch { if app.accountEpoch == token, !(await app.handleLogicalChatFailure(error)) { self.error = "结果待核对，原请求与草稿保留。" } }
    }
    func createSideFromMessage(_ message: ChatMessage, conversation: ConversationSummary) async {
        guard let app, let id = conversation.chatId, let session = conversation.sessionId,
              let seq = Int(message.id.split(separator: "|").last ?? ""), !conversation.temporaryState.hasTemporaryContent else { return }
        let token = epoch; var before: String?
        do {
            repeat {
                let page = try await app.assistantClient.chatPage(id: id, before: before)
                guard app.accountEpoch == token else { return }
                if let row = page.items.first(where: { $0.sessionID == session && $0.sourceRef["seq"]?.int == seq && $0.type.hasSuffix(".message") }) {
                    await createSide(event: row); return
                }
                before = page.hasOlder ? page.olderCursor : nil
            } while before != nil
            error = "原消息不可用，请重新读取。"
        } catch { self.error = error.localizedDescription }
    }
    func readSideSource(_ row: ConversationSummary) async {
        guard let id = row.chatId, let app else { sideSource = nil; return }; let token = epoch, generation = window.generation
        let value = try? await app.assistantClient.logicalChat(id: id)
        guard current(token, generation) else { return }; sideSource = value
    }
    func returnToSource(_ ref: JSONValue) async {
        guard let app, let id = ref["chatId"]?.string, let event = ref["eventId"]?.string else { return }
        app.openedSessionID = id
        if id == chat?.id { target = nil; await read(around: event, replace: true) }
        else if let row = app.conversations.first(where: { $0.chatId == id }), let seq = ref["seq"]?.int {
            await app.locateNativeSource(row, sequence: seq)
        }
    }
    func temporarySetting(_ row: ConversationSummary, fields: [String: JSONValue]) async {
        guard let app, let id = row.chatId, !row.isMainChat else { return }; let token = app.accountEpoch
        do {
            let value = try await app.assistantClient.logicalChat(id: id)
            _ = try await app.assistantClient.patchChat(id: id, revision: value.revision, fields: fields, requestID: "apple-policy-" + UUID().uuidString.lowercased())
            guard app.accountEpoch == token else { return }; await app.refresh()
        } catch { if app.accountEpoch == token { self.error = error.localizedDescription } }
    }
}
