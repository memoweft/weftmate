import SwiftUI
import WeftMateCore

/// One compact list per native round. Downloads retain the existing authorized artifact route.
struct ReplyArtifactList: View {
    @ObservedObject var app: AppleAppModel
    let sessionID: String
    let bundle: ReplyArtifactBundle
    @State private var expanded = false
    @State private var selected: TimelineEvent?
    @State private var file: URL?
    @State private var folder: URL?
    @State private var loading = false
    @State private var error: String?
    @State private var exporting = false
    @State private var sharing = false
    @State private var previewing = false
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            ForEach(bundle.visible(expanded: expanded), id: \.artifactPresentationID) { row in
                HStack(spacing: AppleTokens.Space.p8) {
                    Button { Task { await load(row); if file != nil { previewing = true } } } label: {
                        WeftLabel(row.data["fileName"]?.string ?? "成果文件", icon: "file", size: AppleTokens.Space.p16)
                            .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.plain).accessibilityIdentifier("replyFile.\(row.seq)")
                    Menu {
                        Button("保存") { Task { await load(row); if file != nil { exporting = true } } }
                        Button("分享") { Task { await load(row); if file != nil { sharing = true } } }
                    } label: { WeftIcon("more", size: AppleTokens.Space.p16) }
                        .accessibilityLabel("成果操作").accessibilityIdentifier("replyFileMenu.\(row.seq)")
                }.frame(minHeight: AppleTokens.Space.p44).disabled(loading || app.historyCachedAt != nil)
            }
            if bundle.files.count > 3 {
                Button(expanded ? "收起成果" : "还有 \(bundle.files.count - 3) 个文件") { expanded.toggle() }
                    .buttonStyle(.plain).foregroundStyle(Weave.muted).accessibilityIdentifier("replyFiles.expand")
            }
            if loading { ProgressView() }
            if let error { Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger) }
        }.font(AppleTokens.Fonts.callout).accessibilityElement(children: .contain).accessibilityIdentifier("replyFiles." + bundle.id)
            .sheet(isPresented: $previewing) {
                ConversationAttachmentPreview(file: file, name: selected?.data["fileName"]?.string ?? "成果", contentType: selected?.data["contentType"]?.string ?? "application/octet-stream", loading: loading, error: error, close: { previewing = false })
            }
            .fileExporter(isPresented: $exporting, item: file.map { AttachmentExport(file: $0) }, contentTypes: [.data], defaultFilename: selected?.data["fileName"]?.string ?? "成果",
                onCompletion: { @Sendable result in Task { @MainActor in if case .failure = result { error = "文件未保存，请重试。" } } }, onCancellation: {})
            .popover(isPresented: $sharing) { if let file { ShareLink(item: file) { WeftLabel("分享文件", icon: "open") }.padding(AppleTokens.Space.p24) } }
            .onDisappear { cleanup() }
            .onChange(of: app.accountEpoch) { _, _ in cleanup(); selected = nil; previewing = false; sharing = false; exporting = false }
    }
    private func cleanup() { if let folder { try? FileManager.default.removeItem(at: folder) }; folder = nil; file = nil }
    private func load(_ row: TimelineEvent) async {
        guard !loading, let id = row.data["artifactId"]?.string else { return }
        let epoch = app.accountEpoch; loading = true; error = nil
        defer { loading = false }
        do {
            let value = try await app.assistantClient.timelineArtifactBytes(sessionID: sessionID, artifactID: id)
            guard epoch == app.accountEpoch, !Task.isCancelled else { return }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("apple-reply-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(value.artifact.fileName ?? "成果.txt")
            try value.data.write(to: url); cleanup(); folder = directory; file = url; selected = row
        } catch { if epoch == app.accountEpoch { self.error = "成果未下载，请重试。" } }
    }
}
