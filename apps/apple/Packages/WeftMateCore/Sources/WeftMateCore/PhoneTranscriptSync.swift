import Foundation
import CryptoKit

/// Transcript delivery state. The phone never builds a second memory store.
public struct PhoneTranscriptSync: Codable, Sendable {
    public var hostID: String?
    public var excludedSourceIDs: Set<String> = []
    public var excludedTextDigests: Set<String> = []
    public init() {}
    func excludes(id: String, text: String) -> Bool {
        excludedSourceIDs.contains(id) || excludedTextDigests.contains(Self.digest(text))
    }
    static func digest(_ text: String) -> String {
        SHA256.hash(data:Data(text.lowercased().filter { !$0.isWhitespace }.utf8)).map { String(format:"%02x",$0) }.joined()
    }
}

/// One storage upgrade: decode only the old forget exclusions and delivery host.
/// Old derived bodies, extraction watermarks and switches are deliberately not decoded.
public enum PhoneTranscriptStorage {
    private struct LegacyExclusions: Decodable {
        var suppressedSources: Set<String>?
        var suppressedText: Set<String>?
        var computerHost: String?
    }
    public static func upgrade(_ data: Data) throws -> Data {
        let object=try JSONSerialization.jsonObject(with:data) as? [String:Any]
        guard let legacy=object?["memory"] else { return data }
        var state=try JSONDecoder().decode(PhoneChatState.self,from:data)
        if !(legacy is NSNull) {
            let old=try JSONDecoder().decode(LegacyExclusions.self,from:JSONSerialization.data(withJSONObject:legacy))
            var sync=state.transcriptSync ?? .init()
            sync.hostID=sync.hostID ?? old.computerHost
            sync.excludedSourceIDs.formUnion(old.suppressedSources ?? [])
            sync.excludedTextDigests.formUnion(old.suppressedText ?? [])
            for message in state.threads.flatMap(\.messages) where message.role == "user" && sync.excludes(id:message.id,text:message.text) {
                sync.excludedSourceIDs.insert(message.id)
            }
            state.transcriptSync=sync
        }
        return try JSONEncoder().encode(state)
    }
}
