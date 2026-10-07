import Foundation
import ImageIO
import UniformTypeIdentifiers
import WeftMateCore

struct ConversationAttachmentDraft: Identifiable, Equatable, Sendable {
    var id: String { original.id }
    let original: OriginalAttachment
    let file: URL
    let display: URL?

    static func prepare(file source: URL, name: String? = nil) throws -> Self {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let name = name ?? source.lastPathComponent
        let type = UTType(filenameExtension: (name as NSString).pathExtension)
        let mime: String
        switch (name as NSString).pathExtension.lowercased() {
        case "md", "markdown": mime = "text/markdown"
        case "csv": mime = "text/csv"
        case "json": mime = "application/json"
        case "jsonl", "ndjson": mime = "application/x-ndjson"
        default: mime = type?.preferredMIMEType ?? "application/octet-stream"
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-attachment-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var success = false
        defer { if !success { try? FileManager.default.removeItem(at: directory) } }
        let destination = directory.appendingPathComponent("original")
        // Check the source before copying a potentially oversized file.
        let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard (1...AttachmentLimits.originalBytes).contains(size) else { throw ClientInputFailure.attachmentTooLarge }
        try FileManager.default.copyItem(at: source, to: destination)
        let original = try OriginalAttachment.fromFile(destination, name: name, contentType: mime)
        let display = makeDisplay(source: destination, directory: directory)
        success = true
        return .init(original: original, file: destination, display: display)
    }
    private static func makeDisplay(source: URL, directory: URL) -> URL? {
        guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1600, kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { return nil }
        let file = directory.appendingPathComponent("display.jpg")
        for quality in [0.8, 0.6, 0.4, 0.2] {
            guard let destination = CGImageDestinationCreateWithURL(file as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
            CGImageDestinationAddImage(destination, thumbnail, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
            if CGImageDestinationFinalize(destination),
               let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= AttachmentLimits.displayBytes { return file }
        }
        try? FileManager.default.removeItem(at: file); return nil
    }
    func stage(remainingTextBytes: Int, remainingBytes: Int) throws -> StagedConversationAttachment? {
        var stagedFile: URL?, mime = original.contentType
        if ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(mime),
           original.size <= AttachmentLimits.imageBytes, original.size <= remainingBytes { stagedFile = file }
        else if let display { stagedFile = display; mime = "image/jpeg" }
        else if AttachmentLimits.textTypes.contains(mime), remainingTextBytes > 0 {
            let input = try FileHandle(forReadingFrom: file); defer { try? input.close() }
            var data = try input.read(upToCount: min(remainingTextBytes, remainingBytes)) ?? Data()
            // Keep a UTF-8 boundary when taking the model-readable prefix.
            for _ in 0..<4 { if String(data: data, encoding: .utf8) != nil { break }; if !data.isEmpty { data.removeLast() } }
            guard !data.isEmpty, String(data: data, encoding: .utf8) != nil else { return nil }
            let textFile = file.deletingLastPathComponent().appendingPathComponent("stage.txt")
            try data.write(to: textFile); stagedFile = textFile
        }
        guard let stagedFile else { return nil }
        let meta = try OriginalAttachment.fromFile(stagedFile, name: original.name, contentType: mime, attachmentID: id)
        guard meta.size <= remainingBytes else { return nil }
        return .init(metadata: meta, file: stagedFile)
    }
    func removeTemporaryFiles() { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
}
struct StagedConversationAttachment: Equatable, Sendable { let metadata: OriginalAttachment; let file: URL }
struct ConversationAttachmentAttempt: Sendable {
    let requestID: String
    let messageID: String
    let drafts: [ConversationAttachmentDraft]
    let staged: [StagedConversationAttachment]
    let payload: SharedCommandPayload
}
