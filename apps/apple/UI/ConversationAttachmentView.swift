import SwiftUI
import UniformTypeIdentifiers
import CoreTransferable
import ImageIO
import WeftMateCore
#if os(macOS)
import Quartz
#else
import QuickLook
import PDFKit
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
            #if os(iOS)
            PhoneAttachmentBlock(name:reference.name,image:thumbnail,isImage:reference.isImage,status:nil,remove:nil)
            #else
            HStack(spacing: AppleTokens.Space.p10) {
                AttachmentThumbnail(file: thumbnail, isImage: reference.isImage)
                Text(reference.name).lineLimit(2).font(AppleTokens.Fonts.callout)
                Spacer(minLength: AppleTokens.Space.p0)
                WeftIcon("open", size: 16).font(AppleTokens.Fonts.caption)
            }.padding(AppleTokens.Space.p10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
            #endif
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
            else { WeftIcon(isImage ? "image" : "file") }
            #else
            if let file, let image = UIImage(contentsOfFile: file.path) { Image(uiImage: image).resizable().scaledToFit() }
            else { WeftIcon(isImage ? "image" : "file") }
            #endif
        }.frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: AppleTokens.Radius.r8))
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
    var sourceAction: (() -> Void)? = nil
    var memoryData: Data? = nil
    var memoryText: String? = nil
    @State private var exporting = false
    @State private var exportError: String?
    var body: some View {
        Group {
            #if os(iOS)
        VStack(spacing:AppleTokens.Space.p0) {
            HStack(spacing:AppleTokens.Space.p8) {
                Button(action:close) { WeftIcon("deny") }.buttonStyle(PhoneIconStyle()).accessibilityLabel("关闭预览").accessibilityIdentifier("filePreview.close")
                Text(name).font(AppleTokens.Fonts.headline).lineLimit(1).truncationMode(.middle).frame(maxWidth:.infinity,alignment:.leading)
                if memoryData == nil {
                Menu {
                    if let file {
                        ShareLink(item:file) { WeftLabel("分享",icon:"open") }.accessibilityIdentifier("filePreview.share")
                        Button("保存到文件") { exporting=true }.accessibilityIdentifier("filePreview.save")
                    }
                    if let sourceAction { Button("来自哪个对话",action:sourceAction).accessibilityIdentifier("library.source") }
                } label: { WeftIcon("more").phoneMenuLabel(circle:true) }.accessibilityLabel("文件操作").accessibilityIdentifier("filePreview.more")
                }
            }.padding(AppleTokens.Space.p12)
            if loading { ProgressView("正在下载…").padding(AppleTokens.Space.p20) }
            if let error { Text(error).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.danger).padding(AppleTokens.Space.p16) }
            if let file {
                if contentType == "application/pdf" { PhonePDFPreview(file:file).frame(maxWidth:.infinity,maxHeight:.infinity) }
                else { NativeAttachmentPreview(file:file).frame(maxWidth:.infinity,maxHeight:.infinity) }
            }
            else if let memoryData {
                if contentType.hasPrefix("image/"), let image=UIImage(data:memoryData) { Image(uiImage:image).resizable().scaledToFit().frame(maxWidth:.infinity,maxHeight:.infinity) }
                else if contentType == "application/pdf" { PhoneMemoryPDFPreview(data:memoryData).frame(maxWidth:.infinity,maxHeight:.infinity) }
                else {
                    let original=String(data:memoryData,encoding:.utf8) ?? String(data:memoryData,encoding:.utf16) ?? memoryText ?? ""
                    ScrollView {
                        VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                            Text(String(original.prefix(128*1024))).textSelection(.enabled).frame(maxWidth:.infinity,alignment:.leading)
                            if original.count > 128*1024 { Text("仅预览开头，完整文件仍保存在手机上。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                        }.padding(AppleTokens.Space.p16)
                    }
                }
            } else { Spacer() }
            if let exportError { Text(exportError).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger).padding(AppleTokens.Space.p12) }
        }.background(Weave.surface).onAppear { dismissPhonePreviewKeyboard() }
            #else
        VStack(spacing: AppleTokens.Space.p12) {
            HStack {
                Text(name).font(AppleTokens.Fonts.headline).lineLimit(2)
                Spacer()
                Button(action: close) { WeftIcon("deny") }.accessibilityLabel("关闭预览")
            }
            if loading { ProgressView("正在下载…") }
            if let error { Text(error).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.danger) }
            if let file {
                AttachmentContentPreview(file: file, contentType: contentType).frame(maxWidth: .infinity, maxHeight: .infinity)
                HStack {
                    Button("保存文件") { exporting = true }.buttonStyle(PrimaryActionStyle(fillsWidth: false))
                    ShareLink(item: file) { WeftLabel("分享", icon: "open") }
                }
            } else { Spacer() }
            if let exportError { Text(exportError).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger) }
        }
        .padding(AppleTokens.Space.p16).background(Weave.surface)
            #endif
        }
        .fileExporter(isPresented: $exporting, item: file.map { AttachmentExport(file: $0) },
            contentTypes: [.data], defaultFilename: name, onCompletion: { @Sendable result in
                Task { @MainActor in if case .failure = result { exportError = "文件未保存，请重试。" } }
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
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                        Text(text).font(.system(AppleTokens.TextStyle.body, design: .monospaced)).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading).accessibilityIdentifier("attachmentTextContent")
                        if truncated { Text("仅预览开头，可保存完整文件。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                    }
                }
            } else { NativeAttachmentPreview(file: file) }
        }
        .task(id: file) {
            if contentType.hasPrefix("image/") {
                image = await Task.detached { @Sendable [file] in
                    guard let source = CGImageSourceCreateWithURL(file as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil as CGImage? }
                    return CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 2048] as CFDictionary)
                }.value
            } else if contentType.hasPrefix("text/") || AttachmentLimits.textTypes.contains(contentType) {
                let preview = await Task.detached { @Sendable [file] () -> (String?, Bool) in
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
struct NativeAttachmentPreview: UIViewControllerRepresentable {
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

@MainActor func dismissPhonePreviewKeyboard() {
    #if os(iOS)
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil)
    #endif
}
#if os(iOS)
struct PhonePDFPreview: View {
    let file: URL
    @State private var pages=0
    @State private var loading=true
    var body: some View {
        Group {
            if pages > 0 {
                ScrollView {
                    LazyVStack(spacing:AppleTokens.Space.p12) {
                        ForEach(0..<pages,id:\.self) { index in PhonePDFPage(file:file,index:index,total:pages) }
                    }.padding(AppleTokens.Space.p12)
                }
            } else if loading { ProgressView("正在打开文件…").frame(maxWidth:.infinity,maxHeight:.infinity) }
            else { Text("文件暂时打不开，请关闭后重试。") }
        }.task(id:file) { pages=CGPDFDocument(file as CFURL)?.numberOfPages ?? 0; loading=false }
    }
}
/// Core Graphics renders pages on demand; no PDFView tile layer or repeated layout/redraw loop.
private struct PhonePDFPage: View {
    let file: URL
    let index: Int
    let total: Int
    @State private var image: UIImage?
    @State private var text=""
    @State private var failed=false
    var body: some View {
        Group {
            if let image { Image(uiImage:image).resizable().scaledToFit().accessibilityLabel("第 \(index+1) 页，共 \(total) 页。"+text) }
            else if failed { Text("这一页暂时打不开，请重新打开文件。") }
            else { ProgressView("正在绘制第 \(index+1) 页…").frame(maxWidth:.infinity,minHeight:160) }
        }.task(id:"\(file)-\(index)") {
            guard image == nil else { return }
            guard let document=CGPDFDocument(file as CFURL),let page=document.page(at:index+1) else { failed=true;return }
            let bounds=page.getBoxRect(.mediaBox)
            guard bounds.width > 0,bounds.height > 0 else { failed=true;return }
            let width=UIScreen.main.bounds.width-AppleTokens.Space.p24
            let size=CGSize(width:width,height:width*bounds.height/bounds.width)
            let format=UIGraphicsImageRendererFormat();format.preferredRange = .standard
            let rendered=UIGraphicsImageRenderer(size:size,format:format).image { renderer in
                let context=renderer.cgContext
                UIColor.white.setFill();context.fill(CGRect(origin:.zero,size:size))
                context.translateBy(x:0,y:size.height);context.scaleBy(x:1,y:-1)
                context.concatenate(page.getDrawingTransform(.mediaBox,rect:CGRect(origin:.zero,size:size),rotate:0,preserveAspectRatio:true))
                context.drawPDFPage(page)
            }
            guard !Task.isCancelled else { return };image=rendered
            text=PDFDocument(url:file)?.page(at:index)?.string ?? ""
        }.onDisappear { image=nil; text="" }
    }
}

#endif

extension View {
    @ViewBuilder func attachmentCover<Content: View>(isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> Content) -> some View {
        #if os(iOS)
        self.fullScreenCover(isPresented:isPresented,content:content)
        #else
        self.sheet(isPresented:isPresented,content:content)
        #endif
    }
}

#if os(iOS)
private struct PhoneMemoryPDFPreview: UIViewRepresentable {
    let data: Data
    func makeUIView(context: Context) -> PDFView { let view=PDFView();view.autoScales=true;view.document=PDFDocument(data:data);return view }
    func updateUIView(_ view: PDFView,context: Context) {}
}
#endif
