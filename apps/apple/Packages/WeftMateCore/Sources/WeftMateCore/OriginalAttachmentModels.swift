import Foundation

/// Permanent original metadata returned by the existing personal attachment contract.
/// This is an authenticated history projection, not permission to fetch or execute the file.
public struct OriginalAttachment: Codable, Equatable, Sendable, Identifiable {
    public var id: String { attachmentId }
    public let attachmentId: String
    public let name: String
    public let contentType: String
    public let size: Int
    public let sha256: String
    public var isImage: Bool { ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(contentType) }

    func validate() throws {
        try SharedValidation.require(OriginalAttachmentValidation.syncID(attachmentId) &&
            !name.isEmpty && name == name.trimmingCharacters(in: .whitespacesAndNewlines) &&
            name.unicodeScalars.count <= 128 && ![".", ".."].contains(name) &&
            !name.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 || $0 == "/" || $0 == "\\" }) &&
            contentType.utf8.count <= 127 && SharedValidation.matches(contentType,
                "^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$") &&
            (1...1_073_741_824).contains(size) && SharedValidation.hash(sha256))
    }
}

enum OriginalAttachmentValidation {
    static func syncID(_ value: String) -> Bool {
        SharedValidation.matches(value,
            "^(?:[A-Za-z][A-Za-z0-9_-]{0,31}-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    }
    static func validate(_ originals: [OriginalAttachment]?, messageID: String?, unpreviewedIDs: [String]?) throws {
        let originals = originals ?? [], unpreviewedIDs = unpreviewedIDs ?? []
        try SharedValidation.require(originals.count <= 4 && Set(originals.map(\.attachmentId)).count == originals.count &&
            messageID.map(syncID) ?? true && unpreviewedIDs.count <= 4 &&
            Set(unpreviewedIDs).count == unpreviewedIDs.count && unpreviewedIDs.allSatisfy(syncID))
        for original in originals { try original.validate() }
    }
    static func count(originals: [OriginalAttachment]?, previewCount: Int, unpreviewedIDs: [String]?) -> Int {
        // Original metadata includes the previewed originals: avoid counting the same image twice.
        max(originals?.count ?? 0, previewCount, unpreviewedIDs?.count ?? 0)
    }
}
