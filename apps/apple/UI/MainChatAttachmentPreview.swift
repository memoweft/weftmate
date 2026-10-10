import SwiftUI
import WeftMateCore
struct MainChatAttachmentPreview: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: MainChatModel
    let reference: ConversationAttachmentReference
    let close: () -> Void
    @State private var folder: URL?
    @State private var file: URL?
    @State private var loading = true
    @State private var error: String?
    var body: some View {
        ConversationAttachmentPreview(file: file, name: reference.name, contentType: reference.contentType, loading: loading, error: error, close: close)
            .task {
                let epoch = app.accountEpoch, generation = model.window.generation
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-main-preview-" + UUID().uuidString)
                do {
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    let file = folder.appendingPathComponent(reference.name)
                    try await reference.download(using: app.assistantClient, to: file)
                    guard app.accountEpoch == epoch, model.window.generation == generation, !Task.isCancelled else { try? FileManager.default.removeItem(at: folder); return }
                    self.folder = folder; self.file = file; loading = false
                } catch {
                    try? FileManager.default.removeItem(at: folder)
                    if app.accountEpoch == epoch, model.window.generation == generation { self.error = "附件不可用，请重试。"; loading = false }
                }
            }.onDisappear { if let folder { try? FileManager.default.removeItem(at: folder) } }
            .onChange(of: model.window.generation) { _, _ in file = nil; if let folder { try? FileManager.default.removeItem(at: folder) }; close() }
    }
}
