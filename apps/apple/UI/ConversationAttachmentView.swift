import SwiftUI
import UniformTypeIdentifiers
import CoreTransferable
import ImageIO
import WeftMateCore
#if os(macOS)
import Quartz
#else
import QuickLook
#endif

enum ConversationAttachmentReference: Identifiable, Equatable {
    case original(OriginalAttachment)
    case sessionImage(SharedHistoryImage, String)
    var id: String {
        switch self { case .original(let item): item.id; case .sessionImage(let image, let session): session + ":" + image.attachmentId }
    }
    var name: String {
        switch self { case .original(let item): item.name; case .sessionImage(let image, _): image.name ?? "图片." + (image.contentType == "image/jpeg" ? "jpg" : String(image.contentType.dropFirst(6))) }
    }
    var contentType: String {
        switch self { case .original(let item): item.contentType; case .sessionImage(let image, _): image.contentType }
    }
    var isImage: Bool { switch self { case .original(let item): item.isImage; case .sessionImage: true } }
    func download(using client: PersonalClient, to url: URL) async throws {
        switch self {
        case .original(let item): try await client.downloadOriginalAttachment(item, to: url)
        case .sessionImage(let image, let session): try await client.downloadSessionImage(image, sessionID: session, to: url)
        }
    }
    func thumbnail(using client: PersonalClient, to url: URL) async throws {
        switch self {
        case .original(let item):
            do { try await client.downloadAttachmentDisplay(item, to: url) }
            catch APIFailure.server(404, "NOT_FOUND") {
                guard item.size <= AttachmentLimits.imageBytes else { return }
                try await client.downloadOriginalAttachment(item, to: url)
            }
        case .sessionImage: try await download(using: client, to: url)
        }
    }
}

struct ConversationAttachmentTile: View {
    @ObservedObject var model: AppleAppModel
    let reference: ConversationAttachmentReference
    let open: () -> Void
    @State private var thumbnail: URL?
    @State private var directory: URL?
    var body: some View {
        Button(action: open) {
            HStack(spacing: 10) {
                AttachmentThumbnail(file: thumbnail, isImage: reference.isImage)
                Text(reference.name).lineLimit(2).font(.callout)
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right").font(.caption)
            }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Weave.soft, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain).accessibilityLabel("预览 " + reference.name)
        .accessibilityIdentifier("attachmentPreview.\(reference.id)")
        .task(id: model.accountEpoch) {
            guard reference.isImage else { return }
            let epoch = model.accountEpoch
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-thumbnail-" + UUID().uuidString)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let file = folder.appendingPathComponent(reference.name)
                try await reference.thumbnail(using: model.assistantClient, to: file)
                guard !Task.isCancelled, epoch == model.accountEpoch, FileManager.default.fileExists(atPath: file.path) else {
                    try? FileManager.default.removeItem(at: folder); return
                }
                directory = folder; thumbnail = file
            } catch { try? FileManager.default.removeItem(at: folder) }
        }
        .onDisappear { if let directory { try? FileManager.default.removeItem(at: directory) }; thumbnail = nil; directory = nil }
    }
}

struct AttachmentThumbnail: View {
    let file: URL?
    let isImage: Bool
    var body: some View {
        Group {
            #if os(macOS)
            if let file, let image = NSImage(contentsOf: file) { Image(nsImage: image).resizable().scaledToFit() }
            else { Image(systemName: isImage ? "photo" : "doc") }
            #else
            if let file, let image = UIImage(contentsOfFile: file.path) { Image(uiImage: image).resizable().scaledToFit() }
            else { Image(systemName: isImage ? "photo" : "doc") }
            #endif
        }.frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

struct AttachmentExport: Transferable {
    let file: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .data) { SentTransferredFile($0.file) }
    }
}
struct ConversationAttachmentPreview: View {
    let file: URL?
    let name: String
    let contentType: String
    let loading: Bool
    let error: String?
    let close: () -> Void
    @State private var exporting = false
    @State private var exportError: String?
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text(name).font(.headline).lineLimit(2)
                Spacer()
                Button(action: close) { Image(systemName: "xmark") }.accessibilityLabel("关闭预览")
            }
            if loading { ProgressView("正在下载…") }
            if let error { Text(error).font(.callout).foregroundStyle(Weave.danger) }
            if let file {
                AttachmentContentPreview(file: file, contentType: contentType).frame(maxWidth: .infinity, maxHeight: .infinity)
                HStack {
                    Button("保存文件") { exporting = true }.buttonStyle(.borderedProminent)
                    ShareLink(item: file) { Label("分享", systemImage: "square.and.arrow.up") }
                }
            } else { Spacer() }
            if let exportError { Text(exportError).font(.caption).foregroundStyle(Weave.danger) }
        }
        .padding(16).background(Weave.surface)
        .fileExporter(isPresented: $exporting, item: file.map { AttachmentExport(file: $0) },
            contentTypes: [.data], defaultFilename: name, onCompletion: { result in
                if case .failure = result { exportError = "文件未保存，请重试。" }
            }, onCancellation: {})
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("attachmentPreviewPanel")
    }
}
private struct AttachmentContentPreview: View {
    let file: URL
    let contentType: String
    @State private var image: CGImage?
    @State private var text: String?
    @State private var truncated = false
    var body: some View {
        Group {
            if let image {
                Image(image, scale: 1, label: Text("附件图片")).resizable().scaledToFit()
                    .accessibilityLabel("附件图片").accessibilityIdentifier("attachmentImageContent")
            } else if let text {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(text).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading).accessibilityIdentifier("attachmentTextContent")
                        if truncated { Text("仅预览开头，可保存完整文件。").font(.caption).foregroundStyle(Weave.muted) }
                    }
                }
            } else { NativeAttachmentPreview(file: file) }
        }
        .task(id: file) {
            if contentType.hasPrefix("image/") {
                image = await Task.detached {
                    guard let source = CGImageSourceCreateWithURL(file as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil as CGImage? }
                    return CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 2048] as CFDictionary)
                }.value
            } else if contentType.hasPrefix("text/") || AttachmentLimits.textTypes.contains(contentType) {
                let preview = await Task.detached { () -> (String?, Bool) in
                    guard let handle = try? FileHandle(forReadingFrom: file) else { return (nil, false) }
                    defer { try? handle.close() }
                    guard var data = try? handle.read(upToCount: 131_073) else { return (nil, false) }
                    let truncated = data.count > 131_072
                    if truncated { data.removeLast() }
                    for _ in 0..<4 {
                        if let value = String(data: data, encoding: .utf8) { return (value, truncated) }
                        if !truncated || data.isEmpty { break }; data.removeLast()
                    }
                    return (nil, false)
                }.value
                text = preview.0; truncated = preview.1
            }
        }
    }
}

#if os(macOS)
private struct NativeAttachmentPreview: NSViewRepresentable {
    let file: URL
    func makeNSView(context: Context) -> QLPreviewView { QLPreviewView(frame: .zero, style: .normal)! }
    func updateNSView(_ view: QLPreviewView, context: Context) { view.previewItem = file as NSURL }
}
#else
private struct NativeAttachmentPreview: UIViewControllerRepresentable {
    let file: URL
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var file: URL
        init(file: URL) { self.file = file }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem { file as NSURL }
    }
    func makeCoordinator() -> Coordinator { Coordinator(file: file) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController(); controller.dataSource = context.coordinator; return controller
    }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        context.coordinator.file = file; controller.reloadData()
    }
}
#endif
