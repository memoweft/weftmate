import Foundation
import CryptoKit

public enum ClientInputFailure: Error, LocalizedError, Equatable, Sendable {
    case messageTooLong, requestTooLarge, correctionTooLarge, deviceNameTooLong, attachmentTooLarge, invalidAttachment
    public var errorDescription: String? {
        switch self {
        case .messageTooLong: "消息太长，请缩短后发送。"
        case .requestTooLarge: "消息和附件信息太长，请缩短后发送。"
        case .correctionTooLarge: "纠正内容太长，请缩短后保存。"
        case .deviceNameTooLong: "设备名太长，请缩短后登录。"
        case .attachmentTooLarge: "文件太大，请选择不超过 1 GiB 的文件。"
        case .invalidAttachment: "文件名称或内容无法使用，请重新选择。"
        }
    }
}

public enum AttachmentLimits {
    public static let originalBytes = 1_073_741_824
    public static let imageBytes = 5 * 1_048_576
    public static let textBytes = 16 * 1024
    public static let messageBytes = 10 * 1_048_576
    public static let displayBytes = 512 * 1024
    public static let textTypes = Set(["text/plain", "text/markdown", "text/csv", "application/json", "application/x-ndjson"])
    public static func validate(staged: [OriginalAttachment]?, originals: [OriginalAttachment]?, messageID: String?) throws {
        try OriginalAttachmentValidation.validate(originals, messageID: messageID, unpreviewedIDs: nil)
        try SharedValidation.require((originals == nil) == (messageID == nil) && originals.map { !$0.isEmpty } ?? true)
        if let staged {
            try SharedValidation.require((1...4).contains(staged.count) && Set(staged.map(\.id)).count == staged.count)
            for item in staged {
                try item.validate()
                try SharedValidation.require(item.id.hasPrefix("attachment-") &&
                    (["image/png", "image/jpeg", "image/webp", "image/gif"].contains(item.contentType) ? item.size <= imageBytes : textTypes.contains(item.contentType) && item.size <= textBytes))
            }
            try SharedValidation.require(staged.reduce(0) { $0 + $1.size } <= messageBytes &&
                staged.filter { textTypes.contains($0.contentType) }.reduce(0) { $0 + $1.size } <= textBytes)
        }
    }
    public static func sha256(file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty { hash.update(data: data) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

extension OriginalAttachment {
    public init(attachmentID: String, name: String, contentType: String, size: Int, sha256: String) throws {
        self.attachmentId = attachmentID; self.name = name; self.contentType = contentType
        self.size = size; self.sha256 = sha256
        try validate()
    }
    public static func fromFile(_ file: URL, name: String, contentType: String,
                                attachmentID: String = "attachment-" + UUID().uuidString.lowercased()) throws -> Self {
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard (1...AttachmentLimits.originalBytes).contains(size) else { throw ClientInputFailure.attachmentTooLarge }
        do { return try .init(attachmentID: attachmentID, name: name, contentType: contentType, size: size,
                             sha256: AttachmentLimits.sha256(file: file)) }
        catch { throw ClientInputFailure.invalidAttachment }
    }
}
