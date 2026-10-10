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
        .contextMenu { if enabled { Text(timestamp); Button("复制") { copy() }; if !user { assistantActions }; extra() } }
        .sheet(isPresented: $exporting) {
            NavigationStack {
                VStack(spacing: AppleTokens.Space.p16) {
                    Text("导出此条回复").font(AppleTokens.Fonts.title3)
                    Text("已隐藏常见凭据和本机路径，请确认预览后保存。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    ScrollView { Text(MessageExportDocument.redacted(text)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                    HStack { Button("取消") { exporting = false }.buttonStyle(OutlineActionStyle()); Button("保存 Markdown") { saving = true }.buttonStyle(PrimaryActionStyle(fillsWidth: false)) }
                }.padding(AppleTokens.Space.p20).frame(minWidth: AppleTokens.Space.p24 * 10, minHeight: AppleTokens.Space.p32 * 10)
            }.accessibilityIdentifier("message.exportPreview")
        }
        .fileExporter(isPresented: $saving, document: MessageExportDocument(text: MessageExportDocument.redacted(text)), contentType: .plainText, defaultFilename: "WeftMate-reply.md") { _ in }
        .onAppear { rating = app.messageRating(id) }
        .onChange(of: app.accountEpoch) { _, _ in exporting = false; saving = false; rating = "" }
    }
    private var actionMenu: some View {
        Menu { assistantActions; extra() } label: { WeftIcon("more", size: AppleTokens.Space.p16) }
            .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("消息操作").accessibilityIdentifier(menuID)
    }
    @ViewBuilder private var assistantActions: some View {
        Button { rate("useful") } label: { if rating == "useful" { Label("有用", systemImage: "checkmark") } else { Text("有用") } }
        Button { rate("not-useful") } label: { if rating == "not-useful" { Label("没用", systemImage: "checkmark") } else { Text("没用") } }
        Button("重新生成") { regenerate() }
        Button("导出") { exporting = true }
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
    static var readableContentTypes: [UTType] { [.plainText] }
    var text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { text = String(decoding: configuration.file.regularFileContents ?? Data(), as: UTF8.self) }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
    static func redacted(_ text: String) -> String {
        var result = text
        for pattern in [#"(?i)(bearer\s+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+"#, #"(?:/Users/|/home/|[A-Z]:\\Users\\)[^\s\n]+"#, #"sk-[A-Za-z0-9_-]{12,}"#] {
            result = result.replacingOccurrences(of: pattern, with: "[已隐藏]", options: .regularExpression)
        }
        return result
    }
}
