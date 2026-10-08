import SwiftUI
import WeftMateCore
import UniformTypeIdentifiers

struct TimelineArtifactCard: View {
    @ObservedObject var appModel: AppleAppModel
    let sessionID: String
    let entry: TimelineEntry
    let openPreview: (TimelineEvent) -> Void
    @State private var file: URL?
    @State private var folder: URL?
    @State private var loading = false
    @State private var error: String?
    @State private var exporting = false
    @State private var sharing = false
    private var name: String { entry.event.data["fileName"]?.string ?? "成果文件" }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            WeftLabel(name, icon: "outputs").font(.headline)
            Text("\(entry.event.data["contentType"]?.string ?? "文件") · \(entry.event.data["size"]?.int ?? 0) 字节")
                .font(.caption).foregroundStyle(Weave.muted)
            HStack {
                Button("预览") { openPreview(entry.event) }.accessibilityIdentifier("previewArtifact.\(entry.seq)")
                Button("保存") { Task { await prepare(); if file != nil { exporting = true } } }
                Button("分享") { Task { await prepare(); if file != nil { sharing = true } } }
            }.buttonStyle(.bordered).disabled(loading || appModel.historyCachedAt != nil)
            if loading { ProgressView() }
            if let error { Text(error).font(.caption).foregroundStyle(Weave.danger) }
        }
        .padding(14).background(Weave.soft, in: RoundedRectangle(cornerRadius: 14))
        .fileExporter(isPresented: $exporting, item: file.map { AttachmentExport(file: $0) }, contentTypes: [.data], defaultFilename: name,
            onCompletion: { result in if case .failure = result { error = "文件未保存，请重试。" } }, onCancellation: {})
        .popover(isPresented: $sharing) { if let file { ShareLink(item: file) { WeftLabel("分享文件", icon: "open") }.padding(24) } }
        .onDisappear { cleanup() }
        .onChange(of: appModel.accountEpoch) { _, _ in cleanup() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("artifactCard.\(entry.event.data["artifactId"]?.string ?? String(entry.seq))")
    }
    private func cleanup() { if let folder { try? FileManager.default.removeItem(at: folder) }; folder = nil; file = nil }
    private func prepare() async {
        guard !loading, let artifact = entry.event.data["artifactId"]?.string else { return }
        loading = true; error = nil; let epoch = appModel.accountEpoch
        defer { loading = false }
        do {
            let value = try await appModel.assistantClient.timelineArtifactBytes(sessionID: sessionID, artifactID: artifact)
            guard appModel.accountEpoch == epoch, !Task.isCancelled else { return }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-artifact-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(value.artifact.fileName ?? "成果.txt")
            try value.data.write(to: url); cleanup(); folder = directory; file = url
        } catch { if appModel.accountEpoch == epoch { self.error = "成果未下载，请重试。" } }
    }
}
