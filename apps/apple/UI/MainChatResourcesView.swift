import SwiftUI
import WeftMateCore
struct MainChatResourcesView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: MainChatModel
    @State private var selected: JSONValue?
    @State private var use: ResourceUse?
    @State private var file: URL?
    @State private var folder: URL?
    @State private var detail: TimelineDetail?
    @State private var loading = false
    @State private var error: String?
    private var outputs: [JSONValue] { model.resources.filter { $0["artifactId"] != nil } }
    private var sources: [JSONValue] { model.resources.filter { $0["artifactId"] == nil } }
    var body: some View {
        NavigationStack {
            Group {
                if let selected, let artifact = selected["artifactId"]?.string {
                    ConversationAttachmentPreview(file: file, name: selected["fileName"]?.string ?? "成果", contentType: selected["contentType"]?.string ?? "application/octet-stream", loading: loading, error: error, close: clear)
                        .task(id: artifact) { await loadOutput(selected) }
                } else if let use {
                    ScrollView {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                            Button("返回来源") { clear() }
                            if loading { ProgressView() }
                            if let detail { Text(ToolStepDetail(raw: detail.text).readableText).font(AppleTokens.Fonts.callout).textSelection(.enabled) }
                            if let error { Text(error).foregroundStyle(Weave.danger) }
                        }.padding(AppleTokens.Space.p16)
                    }.task(id: use.id) { await loadUse(use) }
                } else {
                    List {
                        Section("输出内容") {
                            if outputs.isEmpty { Text("还没有输出内容").foregroundStyle(Weave.muted) }
                            ForEach(outputs.indices, id: \.self) { i in
                                Button { selected = outputs[i] } label: { WeftLabel(outputs[i]["fileName"]?.string ?? "成果", icon: "file") }
                            }
                        }
                        Section("来源") {
                            if sources.isEmpty { Text("还没有使用来源").foregroundStyle(Weave.muted) }
                            ForEach(sources.indices, id: \.self) { i in
                                if let source = decodeSource(sources[i]) {
                                    DisclosureGroup(source.displayName) {
                                        ForEach(source.uses) { value in
                                            Button(value.summary) { selected = sources[i]; use = value }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }.navigationTitle("输出与来源").toolbar { Button("完成") { model.resourceVisible = false } }
        }.onDisappear { clear() }.onChange(of: model.window.generation) { _, _ in clear() }
    }
    private func decodeSource(_ value: JSONValue) -> ConversationSource? {
        guard let bytes = try? JSONEncoder().encode(value) else { return nil }; return try? JSONDecoder().decode(ConversationSource.self, from: bytes)
    }
    private func clear() {
        selected = nil; use = nil; file = nil; detail = nil; error = nil; loading = false
        if let folder { try? FileManager.default.removeItem(at: folder) }; folder = nil
    }
    private func loadOutput(_ row: JSONValue) async {
        guard let id = row["artifactId"]?.string, let session = row["sessionId"]?.string else { return }
        loading = true; let epoch = app.accountEpoch, generation = model.window.generation
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-main-resource-" + UUID().uuidString)
        do {
            let result = try await app.assistantClient.timelineArtifactBytes(sessionID: session, artifactID: id)
            guard app.accountEpoch == epoch, model.window.generation == generation, !Task.isCancelled else { return }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent(result.artifact.fileName ?? "成果")
            try result.data.write(to: file); self.file = file; folder = directory; loading = false
        } catch {
            try? FileManager.default.removeItem(at: directory)
            if app.accountEpoch == epoch, model.window.generation == generation { self.error = "原成果不可用，请重试。"; loading = false }
        }
    }
    private func loadUse(_ value: ResourceUse) async {
        guard let session = selected?["sessionId"]?.string else { return }
        loading = true; let epoch = app.accountEpoch, generation = model.window.generation
        do {
            let result = try await app.assistantClient.conversationSourceContent(value, sessionID: session)
            guard app.accountEpoch == epoch, model.window.generation == generation, !Task.isCancelled else { return }
            detail = result; loading = false
        } catch { if app.accountEpoch == epoch, model.window.generation == generation { self.error = "原来源不可用，请重试。"; loading = false } }
    }
}
