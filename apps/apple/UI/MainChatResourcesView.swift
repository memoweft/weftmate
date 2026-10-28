import SwiftUI
import WeftMateCore
struct MainChatResourcesView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: MainChatModel
    var embedded = false
    @State private var selected: JSONValue?
    @State private var use: ResourceUse?
    @State private var file: URL?
    @State private var folder: URL?
    @State private var detail: TimelineDetail?
    @State private var loading = false
    @State private var error: String?
    private var outputs: [JSONValue] { model.resources.filter { $0["artifactId"] != nil } }
    private var sources: [JSONValue] { model.resources.filter { $0["artifactId"] == nil } }
    @ViewBuilder var body: some View {
        #if os(iOS)
        if embedded { phoneContent }
        else { phoneContent.phoneSheet("对话中的内容", close: { model.resourceVisible = false }) }
        #else
        navigationContent
        #endif
    }
    #if os(iOS)
    private struct OutputGroup: Identifiable {
        let id: String
        let rows: [JSONValue]
    }
    private var outputGroups: [OutputGroup] {
        let grouped=Dictionary(grouping:outputs) { $0["fileName"]?.string ?? $0["artifactId"]?.string ?? "成果" }
        return grouped.keys.sorted().map { key in
            .init(id:key,rows:grouped[key]!.sorted { ($0["createdAt"]?.string ?? "") > ($1["createdAt"]?.string ?? "") })
        }
    }
    private var phoneContent: some View {
        List {
            Section("成果") {
                if outputs.isEmpty { Text("还没有成果").foregroundStyle(Weave.muted) }
                ForEach(outputGroups) { group in
                    let latest=group.rows[0]
                    Button { selected=latest } label: {
                        PhoneChatPageRow(title:latest["fileName"]?.string ?? "成果",subtitle:"最新版本",icon:"file")
                    }.buttonStyle(.plain).accessibilityIdentifier("mainChat.resource."+group.id)
                    if group.rows.count > 1 {
                        DisclosureGroup("查看旧版本") {
                            ForEach(Array(group.rows.dropFirst().enumerated()),id:\.offset) { _,old in
                                Button(old["createdAt"]?.string ?? "旧版本") { selected=old }.frame(minHeight:AppleTokens.Space.p44)
                            }
                        }
                    }
                }
            }
            Section("来源") {
                if sources.isEmpty { Text("还没有使用来源").foregroundStyle(Weave.muted) }
                ForEach(sources.indices,id:\.self) { i in
                    if let source=decodeSource(sources[i]) {
                        DisclosureGroup(source.displayName) {
                            ForEach(source.uses) { value in
                                Button { selected=sources[i]; use=value } label: { PhoneChatPageRow(title:value.summary,subtitle:"打开原始内容",icon:"source") }.buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            Section("过程") {
                if let sessionID=model.chat?.activeSessionId {
                    NavigationLink { PhoneTaskProcessPage(app:app,sessionID:sessionID,events:model.nativeEvents) } label: {
                        PhoneChatPageRow(title:"执行详情",subtitle:"步骤、输出和批准记录",icon:"code",showsChevron:false)
                    }.accessibilityIdentifier("resources.process")
                } else { Text("还没有执行记录").foregroundStyle(Weave.muted) }
            }
        }.listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Weave.canvas)
            .navigationTitle("对话中的内容").navigationBarTitleDisplayMode(.large).toolbar(.visible,for:.navigationBar)
            .navigationDestination(isPresented:Binding(get:{selected != nil},set:{if !$0 { clear() }})) {
                if let row=selected, let artifact=row["artifactId"]?.string {
                    ConversationAttachmentPreview(file:file,name:row["fileName"]?.string ?? "成果",contentType:row["contentType"]?.string ?? "application/octet-stream",loading:loading,error:error,close:clear)
                        .task(id:artifact) { await loadOutput(row) }
                } else if let value=use {
                    ScrollView {
                        VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                            if loading { ProgressView() }
                            if let detail { Text(ToolStepDetail(raw:detail.text).readableText).textSelection(.enabled) }
                            if let error { Text(error).foregroundStyle(Weave.danger); Button("重试") { Task { await loadUse(value) } } }
                        }.padding(AppleTokens.Phone.pageInset)
                    }.navigationTitle("来源内容").task(id:value.id) { await loadUse(value) }
                }
            }
            .onChange(of:model.window.generation) { _,_ in clear() }
            .onChange(of:app.accountEpoch) { _,_ in clear() }
            .onDisappear { if !model.resourceVisible { clear() } }
            .accessibilityIdentifier("mainChat.resourcesPage")
    }
    #endif
    #if os(macOS)
    private var navigationContent: some View {
        NavigationStack {
            Group {
                if let selected, let artifact = selected["artifactId"]?.string {
                    ConversationAttachmentPreview(file: file, name: selected["fileName"]?.string ?? "成果", contentType: selected["contentType"]?.string ?? "application/octet-stream", loading: loading, error: error, close: clear)
                        .task(id: artifact) { await loadOutput(selected) }
                } else if let use {
                    ScrollView {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                            Button("返回来源") { clear() }.buttonStyle(OutlineActionStyle())
                            if loading { ProgressView() }
                            if let detail { Text(ToolStepDetail(raw: detail.text).readableText).font(AppleTokens.Fonts.callout).textSelection(.enabled) }
                            if let error { Text(error).foregroundStyle(Weave.danger) }
                        }.padding(AppleTokens.Space.p16)
                    }.task(id: use.id) { await loadUse(use) }
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
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
                        }.phoneCard().phoneCardIdentifier("phoneSheet.resourcesCard").padding(AppleTokens.Space.p16).frame(maxWidth: .infinity, alignment: .leading).buttonStyle(OutlineActionStyle())
                    }
                }
            }.navigationTitle("输出与来源")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(embedded ? .visible : .hidden, for: .navigationBar)
            #endif
            .toolbar {
                #if os(iOS)
                if embedded { PhoneAccountMenu(model: app) }
                #else
                Button("完成") { model.resourceVisible = false }
                #endif
            }
        }.onDisappear { clear() }.onChange(of: model.window.generation) { _, _ in clear() }
    }
    #endif
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
