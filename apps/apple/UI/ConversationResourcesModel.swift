import SwiftUI
import WeftMateCore

enum ResourceTab: Identifiable, Equatable {
    case output(String, String), source(String, String), memory(Int, [UsedMemory])
    var id: String {
        switch self { case .output(let id, _): "output:" + id; case .source(let key, _): "source:" + key; case .memory(let seq, _): "memory:\(seq)" }
    }
    var name: String {
        switch self { case .output(_, let name), .source(_, let name): name; case .memory: "记忆来源" }
    }
    var icon: String {
        switch self { case .output: "file"; case .source: "source"; case .memory: "memory" }
    }
}
@MainActor final class ConversationResourcesModel: ObservableObject {
    @Published var window = ConversationResourcesWindow()
    @Published private(set) var useDetails: [String: TimelineDetail] = [:]
    @Published private(set) var useErrors: [String: String] = [:]
    @Published private(set) var loadingUses = Set<String>()
    func loadUse(_ use: ResourceUse) async {
        guard current, let app, !loadingUses.contains(use.id) else { return }
        loadingUses.insert(use.id); useErrors[use.id] = nil
        defer { loadingUses.remove(use.id) }
        do {
            let value = try await app.assistantClient.conversationSourceContent(use, sessionID: sessionID)
            guard current, !Task.isCancelled else { return }; useDetails[use.id] = value
        } catch { if current, !Task.isCancelled { useErrors[use.id] = "原始内容未读取，请重试。" } }
    }
    @Published var tabs: [ResourceTab] = []
    @Published var selected: String?
    @Published var visible = false
    @Published var loading = false
    @Published var error: String?
    @Published var showingList = false
    let sessionID: String
    private weak var app: AppleAppModel?
    private let epoch: UUID
    init(app: AppleAppModel, sessionID: String) { self.app = app; self.sessionID = sessionID; epoch = app.accountEpoch }
    var current: Bool { app?.accountEpoch == epoch }
    var activeTab: ResourceTab? { tabs.first { $0.id == selected } }
    func open(_ tab: ResourceTab) {
        guard current else { return }
        if !tabs.contains(where: { $0.id == tab.id }) { tabs.append(tab) }
        selected = tab.id; visible = true; showingList = false
    }
    func close(_ id: String) {
        tabs.removeAll { $0.id == id }
        if selected == id { selected = tabs.last?.id }
        if tabs.isEmpty { visible = false }
    }
    func clear() { useDetails = [:]; useErrors = [:]; loadingUses = []; tabs = []; selected = nil; visible = false; window = .init(); error = nil }
    func refresh() async {
        guard !loading, current, let app else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            var more = true
            while more && !Task.isCancelled {
                let page = try await app.assistantClient.conversationResources(sessionID: sessionID, afterSeq: window.nextSeq)
                guard current, !Task.isCancelled else { return }
                try window.apply(page); try window.includeTimelineOutputs(app.timeline.events); more = page.hasMore
            }
        } catch {
            guard current, !Task.isCancelled else { return }
            self.error = "输出与来源未读取，请重试。"
        }
    }
}

/// Content transfers and account guards shared by iPhone/Mac presentation.
@MainActor final class ResourceDetailModel: ObservableObject {
    @Published private(set) var file: URL?
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    @Published private(set) var memorySources: [String: MemorySourcesSnapshot] = [:]
    @Published private(set) var memoryErrors: [String: String] = [:]
    private weak var app: AppleAppModel?
    private let epoch: UUID
    private let sessionID: String
    private var folder: URL?
    init(app: AppleAppModel, sessionID: String) { self.app = app; epoch = app.accountEpoch; self.sessionID = sessionID }
    private var current: Bool { app?.accountEpoch == epoch }
    func loadMemory(_ memory: UsedMemory) async {
        guard current, let app else { return }; memoryErrors[memory.id] = nil
        do {
            let value = try await app.assistantClient.memorySources(kind: memory.kind, itemID: memory.id)
            guard current, !Task.isCancelled else { return }; memorySources[memory.id] = value
        } catch { if current, !Task.isCancelled { memoryErrors[memory.id] = "当前来源不可读或已被忘掉，请稍后重试。" } }
    }
    func loadOutput(_ id: String) async {
        guard !loading, current, let app else { return }
        loading = true; error = nil
        defer { loading = false }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-resource-" + UUID().uuidString)
        do {
            let value = try await app.assistantClient.timelineArtifactBytes(sessionID: sessionID, artifactID: id)
            guard current, !Task.isCancelled else { return }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(value.artifact.fileName ?? "成果.txt")
            try value.data.write(to: url); cleanup(); folder = directory; file = url
        } catch {
            try? FileManager.default.removeItem(at: directory)
            if current, !Task.isCancelled { self.error = "成果未读取，请重试。" }
        }
    }
    func cleanup() { if let folder { try? FileManager.default.removeItem(at: folder) }; folder = nil; file = nil }
}
