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
        switch self { case .output: "doc"; case .source: "link"; case .memory: "brain" }
    }
}
@MainActor final class ConversationResourcesModel: ObservableObject {
    @Published var window = ConversationResourcesWindow()
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
    func clear() { tabs = []; selected = nil; visible = false; window = .init(); error = nil }
    func refresh() async {
        guard !loading, current, let app else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            var more = true
            while more && !Task.isCancelled {
                let page = try await app.assistantClient.conversationResources(sessionID: sessionID, afterSeq: window.nextSeq)
                guard current, !Task.isCancelled else { return }
                try window.apply(page); more = page.hasMore
            }
        } catch {
            guard current, !Task.isCancelled else { return }
            self.error = "输出与来源未读取，请重试。"
        }
    }
}
