import Foundation
import CryptoKit

public struct OfflineTurnFragment: Codable, Sendable, Equatable {
    public let id, conversationId: String
    public let timestamp: Int64
    public let index, count: Int
    public let sha256, encoding, data: String
}

/// Stored only inside OfflineVault. Freeze UTF-8 bytes once; retries and process restarts
/// must not depend on JSONEncoder output, local edits or later regenerations.
public struct OfflineTurnFragmentProgress: Codable, Sendable {
    public let generation: Int
    public let id, conversationId: String
    public let timestamp: Int64
    public let raw: Data
    public let sha256: String
    public var nextIndex: Int = 0
    public var sentComplete: Bool = false
    static let chunkBytes=96000
    var count: Int { (raw.count+Self.chunkBytes-1)/Self.chunkBytes }

    init(turn: OfflineTurn,generation: Int) throws {
        self.generation=generation;id=turn.id;conversationId=turn.conversationId;timestamp=turn.timestamp
        let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys,.withoutEscapingSlashes]
        raw=try encoder.encode(turn)
        sha256=SHA256.hash(data:raw).map { String(format:"%02x",$0) }.joined()
    }
    var fragment: OfflineTurnFragment {
        let start=nextIndex*Self.chunkBytes,end=min(start+Self.chunkBytes,raw.count)
        return .init(id:id,conversationId:conversationId,timestamp:timestamp,index:nextIndex,count:count,
            sha256:sha256,encoding:"json-utf8-base64",data:raw.subdata(in:start..<end).base64EncodedString())
    }
}
