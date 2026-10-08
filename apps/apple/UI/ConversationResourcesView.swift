import SwiftUI
import WeftMateCore

struct ConversationResourceList: View {
    @ObservedObject var resources: ConversationResourcesModel
    let memories: [TimelineEvent]
    var onOpen: () -> Void = {}
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("输出内容").font(.headline)
                if resources.window.outputs.isEmpty { Text("还没有输出内容").font(.caption).foregroundStyle(Weave.muted) }
                ForEach(resources.window.outputs) { output in
                    Button { resources.open(.output(output.id, output.fileName ?? "成果")); onOpen() } label: {
                        Label(output.fileName ?? "成果", systemImage: "doc")
                    }.accessibilityIdentifier("resourceOutput.\(output.id)")
                }
                Divider()
                Text("来源").font(.headline)
                if resources.window.sources.isEmpty && memories.isEmpty { Text("还没有来源").font(.caption).foregroundStyle(Weave.muted) }
                ForEach(resources.window.sources) { source in
                    Button { resources.open(.source(source.key, source.name)); onOpen() } label: {
                        Label(source.name + " · \(source.uses.count) 次", systemImage: source.kind == "tool" ? "chevron.left.forwardslash.chevron.right" : "link")
                            .lineLimit(2).multilineTextAlignment(.leading)
                    }.accessibilityIdentifier("resourceSource.\(source.key)")
                }
                ForEach(memories) { event in
                    Button { resources.open(.memory(event.seq, UsedMemory.references(in: event))); onOpen() } label: {
                        Label("用到了 \(UsedMemory.references(in: event).count) 条记忆", systemImage: "brain")
                    }.accessibilityIdentifier("resourceMemory.\(event.seq)")
                }
                if resources.loading { ProgressView("正在读取…") }
                if let error = resources.error { Text(error).font(.caption).foregroundStyle(Weave.danger) }
                Button("查看全部 / 重新读取") { Task { await resources.refresh() } }.disabled(resources.loading)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(18)
        }.buttonStyle(.plain).frame(idealWidth: 360)
            .task { await resources.refresh() }
            .accessibilityIdentifier("conversationResourceList")
    }
}
struct ConversationResourcesPanel: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var resources: ConversationResourcesModel
    @State private var enlarged = false
    @State private var width: CGFloat = 400
    @GestureState private var dragWidth: CGFloat = 0
    private var memories: [TimelineEvent] { app.timeline.events.filter { !UsedMemory.references(in: $0).isEmpty } }
    var body: some View {
        HStack(spacing: 0) {
            #if os(macOS)
            Rectangle().fill(Weave.line).frame(width: 5).contentShape(Rectangle())
                .gesture(DragGesture().updating($dragWidth) { value, state, _ in state = -value.translation.width }
                    .onEnded { value in width = min(800, max(320, width - value.translation.width)); enlarged = false })
                .accessibilityLabel("调整面板宽度")
            #endif
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    #if os(iOS)
                    Button { resources.visible = false } label: { Label("返回", systemImage: "chevron.left") }
                        .accessibilityIdentifier("closeResourcesPanel")
                    Text("输出与来源").font(.headline)
                    Spacer()
                    #else
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(resources.tabs) { tab in
                                HStack(spacing: 5) {
                                    Button { resources.selected = tab.id; resources.showingList = false } label: {
                                        Label(tab.name, systemImage: tab.icon).lineLimit(1)
                                    }.accessibilityIdentifier("resourceTab.\(tab.id)")
                                    Button { resources.close(tab.id) } label: { Image(systemName: "xmark").font(.caption) }
                                        .accessibilityLabel("关闭 " + tab.name).accessibilityIdentifier("closeResourceTab.\(tab.id)")
                                }.padding(8).background(resources.selected == tab.id ? Weave.soft : Weave.surface)
                            }
                        }
                    }
                    #endif
                    Button { resources.showingList.toggle() } label: { Image(systemName: "plus") }.accessibilityLabel("打开另一个输出或来源")
                        .accessibilityIdentifier("addResourceTab")
                    #if os(macOS)
                    Button(enlarged ? "还原" : "放大") { enlarged.toggle() }
                    Button("收起") { resources.visible = false }.accessibilityIdentifier("closeResourcesPanel")
                    #endif
                }.buttonStyle(.plain).padding(14)
                Divider()
                if resources.showingList || resources.activeTab == nil {
                    ConversationResourceList(resources: resources, memories: memories)
                } else if let tab = resources.activeTab {
                    ResourceTabContent(app: app, resources: resources, tab: tab)
                        .id(tab.id + app.accountEpoch.uuidString)
                }
            }
        }
        .background(Weave.surface)
        #if os(macOS)
        .frame(width: enlarged ? 700 : min(800, max(320, width + dragWidth)))
        #endif
        .accessibilityElement(children: .contain).accessibilityIdentifier("conversationResourcesPanel")
    }
}
private struct ResourceTabContent: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var resources: ConversationResourcesModel
    let tab: ResourceTab
    @State private var file: URL?
    @State private var folder: URL?
    @State private var loading = false
    @State private var error: String?
    @State private var sources: [String: MemorySourcesSnapshot] = [:]
    @State private var sourceErrors: [String: String] = [:]
    @State private var expandedMemories = Set<String>()
    var body: some View {
        Group {
            switch tab {
            case .output(_, let name):
                VStack(spacing: 8) {
                    ConversationAttachmentPreview(file: file, name: name, contentType: "text/plain", loading: loading, error: error,
                        close: { resources.close(tab.id) })
                    if error != nil { Button("重新读取") { Task { await loadOutput() } } }
                    #if os(macOS)
                    if let file {
                        HStack {
                            Button("用默认程序打开") { NSWorkspace.shared.open(file) }
                            Button("在文件夹中显示") { NSWorkspace.shared.activateFileViewerSelecting([file]) }
                        }.padding(.bottom, 14)
                    }
                    #endif
                }.task { await loadOutput() }
            case .source(let key, let name):
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(name).font(.title3)
                        if let source = resources.window.sources.first(where: { $0.key == key }) {
                            Text((source.kind == "tool" ? "调用" : "读取") + " \(source.uses.count) 次").foregroundStyle(Weave.muted)
                                .accessibilityIdentifier("resourceUseCount")
                            if let location = source.location ?? source.url { Text(location).font(.caption).textSelection(.enabled) }
                            ForEach(source.uses) { use in
                                ResourceUseView(client: app.assistantClient, sessionID: resources.sessionID, use: use)
                                Divider()
                            }
                        } else if resources.loading { ProgressView() }
                        else { Text("正在读取来源列表…") }
                        if let error = resources.error { Text(error).foregroundStyle(Weave.danger) }
                        Button("重新读取来源") { Task { await resources.refresh() } }
                    }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                }.task { await resources.refresh() }
            case .memory(_, let memories):
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("这条回复的记忆来源").font(.title3)
                        ForEach(memories) { memory in
                            VStack(alignment: .leading, spacing: 9) {
                                Text(memory.summary).font(.body).textSelection(.enabled)
                                DisclosureGroup("来源原话", isExpanded: Binding(get: { expandedMemories.contains(memory.id) }, set: { if $0 { expandedMemories.insert(memory.id) } else { expandedMemories.remove(memory.id) } })) {
                                    if let value = sources[memory.id] {
                                        if value.sources.isEmpty { Text("当前没有可读取的来源。") }
                                        ForEach(value.sources, id: \.evidenceId) { source in
                                            VStack(alignment: .leading, spacing: 6) {
                                                Text("记录于 " + source.recordedAt).font(.caption).foregroundStyle(Weave.muted)
                                                Text(source.rawContent ?? source.summary ?? (source.contentAvailable ? "当前权限不允许读取这条原话。" : "来源已不可读。"))
                                                    .textSelection(.enabled)
                                                if source.rawContentTruncated { Text("原话仅显示部分内容。").font(.caption).foregroundStyle(Weave.muted) }
                                            }.padding(.vertical, 6)
                                        }
                                    } else if let error = sourceErrors[memory.id] {
                                        Text(error).foregroundStyle(Weave.muted)
                                        Button("重新读取") { Task { await loadMemory(memory) } }
                                    } else { ProgressView() }
                                }.accessibilityIdentifier("memoryOriginal.\(memory.id)")
                            }.task(id: expandedMemories.contains(memory.id)) {
                                if expandedMemories.contains(memory.id), sources[memory.id] == nil { await loadMemory(memory) }
                            }
                            Divider()
                        }
                    }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }.onDisappear { cleanup() }
    }
    private func loadMemory(_ memory: UsedMemory) async {
        let epoch = app.accountEpoch; sourceErrors[memory.id] = nil
        do {
            let result = try await app.assistantClient.memorySources(kind: memory.kind, itemID: memory.id)
            guard !Task.isCancelled, epoch == app.accountEpoch else { return }
            sources[memory.id] = result
        } catch {
            guard !Task.isCancelled, epoch == app.accountEpoch else { return }
            sourceErrors[memory.id] = "当前来源不可读或已被忘掉，请稍后重试。"
        }
    }
    private func loadOutput() async {
        guard case .output(let id, _) = tab, !loading else { return }
        loading = true; error = nil; let epoch = app.accountEpoch
        defer { loading = false }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-resource-" + UUID().uuidString)
        do {
            let result = try await app.assistantClient.timelineArtifactBytes(sessionID: resources.sessionID, artifactID: id)
            guard !Task.isCancelled, epoch == app.accountEpoch else { return }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(result.artifact.fileName ?? "成果.txt")
            try result.data.write(to: url); cleanup(); folder = directory; file = url
        } catch {
            try? FileManager.default.removeItem(at: directory)
            guard !Task.isCancelled, epoch == app.accountEpoch else { return }
            self.error = "成果未读取，请重试。"
        }
    }
    private func cleanup() { if let folder { try? FileManager.default.removeItem(at: folder) }; folder = nil; file = nil }
}
private struct ResourceUseView: View {
    let client: PersonalClient
    let sessionID: String
    let use: ResourceUse
    @State private var expanded = false
    @State private var detail: TimelineDetail?
    @State private var error: String?
    @State private var loading = false
    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            if loading { ProgressView() }
            if let detail {
                Text(detail.text).font(.caption.monospaced()).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading).accessibilityIdentifier("resourceRaw.\(use.id)")
                if detail.truncated == true { Text("内容已截断。").font(.caption).foregroundStyle(Weave.muted) }
                Button("复制原始内容") {
                    #if os(macOS)
                    NSPasteboard.general.clearContents(); NSPasteboard.general.setString(detail.text, forType: .string)
                    #else
                    UIPasteboard.general.string = detail.text
                    #endif
                }
            }
            if let error { Text(error); Button("重新读取") { Task { await load() } } }
        } label: { Text(use.summary).font(.callout).multilineTextAlignment(.leading) }
            .accessibilityIdentifier("resourceUse.\(use.id)")
            .task(id: expanded) { if expanded && detail == nil { await load() } }
    }
    private func load() async {
        guard !loading else { return }; loading = true; error = nil
        defer { loading = false }
        do { let value = try await client.conversationSourceContent(use, sessionID: sessionID); if !Task.isCancelled { detail = value } }
        catch { if !Task.isCancelled { self.error = "原始内容未读取，请重试。" } }
    }
}
