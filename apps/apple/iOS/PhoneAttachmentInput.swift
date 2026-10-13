import Foundation
import ImageIO
import UniformTypeIdentifiers
import PDFKit
import WeftMateCore

/// The system chooser supplies bytes; preparation does not create plaintext copies or image caches.
enum PhoneAttachmentInput {
    static func image(_ data: Data, name: String = "照片.jpg") throws -> PhoneAttachment {
        guard let source=CGImageSourceCreateWithData(data as CFData,[kCGImageSourceShouldCache:false] as CFDictionary),
              let image=CGImageSourceCreateThumbnailAtIndex(source,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceCreateThumbnailWithTransform:true,kCGImageSourceThumbnailMaxPixelSize:2048,kCGImageSourceShouldCacheImmediately:true] as CFDictionary) else { throw PhoneAttachmentFailure.unsupported }
        for quality in [0.8,0.6,0.4,0.2] {
            let output=NSMutableData()
            guard let destination=CGImageDestinationCreateWithData(output,UTType.jpeg.identifier as CFString,1,nil) else { throw PhoneAttachmentFailure.unsupported }
            CGImageDestinationAddImage(destination,image,[kCGImageDestinationLossyCompressionQuality:quality] as CFDictionary)
            if CGImageDestinationFinalize(destination),output.length <= PhoneAttachment.imageBytes {
                return .init(name:(name as NSString).deletingPathExtension+".jpg",contentType:"image/jpeg",data:output as Data)
            }
        }
        throw PhoneAttachmentFailure.imageTooLarge
    }
    static func file(_ url: URL, remainingText: Int) throws -> PhoneAttachment {
        let scoped=url.startAccessingSecurityScopedResource();defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let size=try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
        guard size <= PhoneAttachment.fileBytes else { throw PhoneAttachmentFailure.tooLarge }
        return try file(Data(contentsOf:url),name:url.lastPathComponent,remainingText:remainingText)
    }
    static func file(_ data: Data, name: String, remainingText: Int) throws -> PhoneAttachment {
        guard data.count <= PhoneAttachment.fileBytes else { throw PhoneAttachmentFailure.tooLarge }
        let ext=(name as NSString).pathExtension.lowercased()
        if ["jpg","jpeg","png","heic","heif","webp","gif","tiff","bmp"].contains(ext) { return try image(data,name:name) }
        let text: String, mime: String
        var truncated=false
        if ext == "pdf" {
            guard let pdf=PDFDocument(data:data) else { throw PhoneAttachmentFailure.unreadablePDF }
            var extracted=""
            for index in 0..<min(pdf.pageCount,PhoneAttachment.pdfPages) {
                extracted += (pdf.page(at:index)?.string ?? "")+"\n"
                if extracted.utf16.count >= remainingText { truncated=true;break }
            }
            guard !extracted.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { throw PhoneAttachmentFailure.unreadablePDF }
            text=extracted;mime="application/pdf";truncated = truncated || pdf.pageCount > PhoneAttachment.pdfPages
        } else {
            guard ["txt","md","markdown","csv","tsv","json","jsonl","ndjson","log","swift","js","mjs","cjs","ts","tsx","jsx","py","rb","go","rs","c","h","cpp","hpp","java","kt","kts","sh","bash","zsh","sql","html","css","xml","yaml","yml","toml","ini","conf"].contains(ext) else { throw PhoneAttachmentFailure.unsupported }
            guard let decoded=String(data:data,encoding:.utf8) ?? String(data:data,encoding:.utf16),!decoded.contains("\0") else { throw PhoneAttachmentFailure.unreadableText }
            text=decoded;mime=UTType(filenameExtension:ext)?.preferredMIMEType ?? "text/plain"
        }
        guard remainingText > 0 else { throw PhoneAttachmentFailure.textLimit }
        let prefix=PhoneAttachment.prefix(text,units:remainingText)
        return .init(name:name,contentType:mime,data:data,text:prefix,truncated:truncated || prefix != text)
    }
}
