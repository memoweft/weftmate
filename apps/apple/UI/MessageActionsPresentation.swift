import SwiftUI
import UniformTypeIdentifiers
import WeftMateCore

/// D49: processed user messages are immutable. Queue editing remains in the queue controls.
struct MessageActionsPresentation: ViewModifier {
    @ObservedObject var app: AppleAppModel
    let id: String
    let text: String
    let at: String?
    let user: Bool
    let enabled: Bool
    let latest: Bool
    let menuID: String
    let quote: () -> Void
    let regenerate: () -> Void
    let extra: () -> AnyView
    @State private var hovering = false
    @State private var copied = false
    @State private var rating = ""
    @State private var exporting = false
    @State private var saving = false
    @State private var saveAfterPreview = false
    @State private var exportText = ""
    @State private var exportDirectory: URL?
    @State private var exportStatus: String?
    private var timestamp: String {
        guard let at else { return "时间未记录" }
        let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fractional.date(from: at) ?? ISO8601DateFormatter().date(from: at) else { return "时间未记录" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
    func body(content: Content) -> some View {
        VStack(alignment: user ? .trailing : .leading, spacing: AppleTokens.Space.p4) {
            content
            #if os(macOS)
            if enabled {
                HStack(spacing: AppleTokens.Space.p8) {
                    Text(timestamp).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    Button { copy() } label: { WeftLabel(copied ? "已复制" : "复制", icon: "copy", size: AppleTokens.Space.p16) }
                        .buttonStyle(.plain).accessibilityIdentifier("message.copy." + id)
                    if !user { actionMenu }
                }.font(AppleTokens.Fonts.caption).frame(maxWidth: .infinity, alignment: user ? .trailing : .leading)
                    .opacity(hovering || (!user && latest) ? 1 : 0)
                    .allowsHitTesting(hovering || (!user && latest))
                    .accessibilityHidden(!(hovering || (!user && latest)))
                    .accessibilityIdentifier("message.hover." + id)
            }
            #endif
        }
        #if os(macOS)
        .background(SessionHoverRegion(identifier: "messageHover." + id) { hovering = $0 })
        #endif
        .contentShape(Rectangle())
        .contextMenu { if enabled { Text(timestamp); Button("复制") { copy() }; if !user { assistantActions }; extra() } }
        .sheet(isPresented: $exporting, onDismiss: {
            if saveAfterPreview { saveAfterPreview = false; saving = true }
            else { clearExportDirectory() }
        }) {
            NavigationStack {
                VStack(spacing: AppleTokens.Space.p16) {
                    Text("导出此条回复").font(AppleTokens.Fonts.title3)
                    Text("已隐藏常见凭据和本机路径，请确认预览后保存。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    ScrollView { Text(exportText).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                    if let exportStatus { Text(exportStatus).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                    HStack { Button("取消") { exporting = false }.buttonStyle(OutlineActionStyle()); Button("保存 Markdown") { openSavePanel() }.buttonStyle(PrimaryActionStyle(fillsWidth: false)) }
                }.padding(AppleTokens.Space.p20).frame(minWidth: AppleTokens.Space.p24 * 10, minHeight: AppleTokens.Space.p32 * 10)
            }.accessibilityIdentifier("message.exportPreview")
        }
        .fileExporter(isPresented: $saving, document: MessageExportDocument(text: exportText), contentType: MessageExportDocument.exportType, defaultFilename: "WeftMate-reply") { result in
            switch result {
            case .success: exportStatus = "已保存。"
            case .failure(let error): if (error as NSError).code != CocoaError.userCancelled.rawValue { exportStatus = "未能保存，请重试。" }
            }
            clearExportDirectory()
        }
        .fileDialogDefaultDirectory(exportDirectory)
        .onAppear { rating = app.messageRating(id) }
        .onChange(of: app.accountEpoch) { _, _ in saveAfterPreview = false; exporting = false; saving = false; exportText = ""; clearExportDirectory(); rating = "" }
    }
    private func openSavePanel() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--a16-driver") {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("A16-export-" + UUID().uuidString)
            do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true); exportDirectory = directory }
            catch { exportStatus = "未能准备保存位置，请重试。"; return }
        }
        #endif
        saveAfterPreview = true; exporting = false
    }
    private func clearExportDirectory() {
        if let exportDirectory { try? FileManager.default.removeItem(at: exportDirectory) }; exportDirectory = nil
    }
    private var actionMenu: some View {
        Menu { assistantActions; extra() } label: { WeftIcon("more", size: AppleTokens.Space.p16) }
            .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("消息操作").accessibilityIdentifier(menuID)
    }
    @ViewBuilder private var assistantActions: some View {
        Button { rate("useful") } label: { if rating == "useful" { Label("有用", systemImage: "checkmark") } else { Text("有用") } }
        Button { rate("not-useful") } label: { if rating == "not-useful" { Label("没用", systemImage: "checkmark") } else { Text("没用") } }
        Button("重新生成") { regenerate() }
        Button("导出") { exportText = MessageExportDocument.redacted(text); exporting = true }
        Button("引用") { quote() }
    }
    private func rate(_ value: String) { rating = rating == value ? "" : value; app.rateMessage(id, rating: rating) }
    private func copy() {
        #if os(macOS)
        NSPasteboard.general.clearContents(); copied = NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text; copied = true
        #endif
    }
}
struct MessageExportDocument: FileDocument {
    static var exportType: UTType { UTType(filenameExtension: "md") ?? .plainText }
    static var readableContentTypes: [UTType] { [exportType, .plainText] }
    var text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { text = String(decoding: configuration.file.regularFileContents ?? Data(), as: UTF8.self) }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
    static func redacted(_ text: String) -> String {
        var result = text
        for pattern in [#"(?i)\bbearer\s+[^\s,;]+"#, #"(?i)["']?\b(?:api[_-]?key|token|password|secret)["']?\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)"#, #"(?:/Users/|/home/|[A-Z]:\\Users\\)[^\s\n]+"#, #"sk-[A-Za-z0-9_-]{12,}"#] {
            result = result.replacingOccurrences(of: pattern, with: "[已隐藏]", options: .regularExpression)
        }
        return result
    }
}
