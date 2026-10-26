import Foundation

public struct OfflineEnvelope: Codable, Sendable {
    public let version: Int
    public let algorithm: String
    public let aad, wrappedKey, iv, ciphertext: String
}
public struct OfflineIdentity: Codable, Sendable, Equatable {
    public let ownerId, hostId, deviceId: String
    public init(ownerId: String, hostId: String, deviceId: String) {
        self.ownerId = ownerId; self.hostId = hostId; self.deviceId = deviceId
    }
    // Cookie device IDs rotate. Only the authenticated envelope check uses deviceId.
    var scope: String { "\(hostId.utf8.count):\(hostId)\(ownerId.utf8.count):\(ownerId)" }
}
/// Last successful binding, scoped by the cloud issuer and subject, without a host Cookie.
public struct OfflineBinding: Codable, Sendable {
    public let issuer, subject: String
    public let identity: OfflineIdentity
    public init(issuer: String, subject: String, identity: OfflineIdentity) {
        self.issuer=issuer;self.subject=subject;self.identity=identity
    }
    public func matches(issuer: String,subject: String,hostID: String?) -> Bool {
        self.issuer == issuer && self.subject == subject && (hostID == nil || identity.hostId == hostID)
    }
}
public struct OfflineMemoryRef: Codable, Sendable, Hashable {
    public let kind, id: String
    public init(kind: String,id: String) { self.kind=kind;self.id=id }
}
public struct OfflineMemory: Codable, Sendable, Identifiable {
    public struct Source: Codable, Sendable { public let id: String; public let summary: String? }
    public let id, kind, text: String
    public let sources: [Source]
    public let currentState: String
}
public struct OfflineMessage: Codable, Sendable, Equatable {
    public let role, text: String
}
public struct OfflineTurn: Codable, Sendable, Identifiable, Equatable {
    public let id, conversationId: String
    public let timestamp: Int64
    public var messages: [OfflineMessage]
    public let memoryRefs: [OfflineMemoryRef]
    public let dependencyComplete: Bool
}
public struct OfflineModelConfiguration: Codable, Sendable {
    public let profileId, name, baseUrl, modelId, apiKey: String
}
public struct OfflineControl: Codable, Sendable {
    public let hostId, accountId: String
    public let generation: Int
}
public struct OfflineMemoryAuthority: Codable, Sendable {
    public let ready: Bool
    public let hostId: String
}
public struct OfflineAuthorization: Codable, Sendable {
    public var capabilities: [String: JSONValue]? = nil
    public var supportsTasks: Bool { capabilities?["offlineTasks"] == .number(1) }
    public let hostId, accountId: String
    public let generation: Int
    public let authorized: Bool
}
public struct OfflineRecent: Codable, Sendable, Identifiable {
    public let id: String
    public let title: String?
    public let messages: [OfflineMessage]
}
public struct OfflineSnapshot: Codable, Sendable {
    public let generation: Int
    public let reset: Bool
    public var items: [OfflineMemory]
    public let remove: [String]
    public let hashes: [String: String]
    public let truncated: Bool
    public let recent: [OfflineRecent]
    public let model: OfflineModelConfiguration?
    public let control: OfflineControl
    public var memoryAuthority: OfflineMemoryAuthority? = nil
    public var taskRecipient: [String: String]? = nil
    public var taskReferences: [OfflineTaskReference]? = nil
}
public struct OfflineSyncRequest: Encodable, Sendable {
    public let publicJwk: [String: String]
    public let generation: Int
    public let hashes: [String: String]
    public var phoneFirst: Bool? = nil
    public var taskSupport: Int? = nil
}
public struct OfflineHandover: Codable, Sendable, Equatable {
    public let id: String
    public let totalTurns, conversationCount, bytes: Int
    public var complete: Bool = false
}
public struct OfflinePhoneHandover: Codable, Sendable {
    public let handover: OfflineHandover
    public var turnIDs: [String]
}
public struct OfflineSubmission: Codable, Sendable, Equatable {
    public let generation: Int
    public let turns: [OfflineTurn]
    public var handover: OfflineHandover? = nil
    public var turnFragments: [OfflineTurnFragment]? = nil
    /// The size check and PersonalClient must use the exact same wire encoding.
    public func encoded() throws -> Data {
        let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys,.withoutEscapingSlashes]
        return try encoder.encode(self)
    }
}
public struct OfflineReceipts: Codable, Sendable {
    public struct Receipt: Codable, Sendable { public let id, state: String }
    public struct FragmentReceipt: Codable, Sendable {
        public let id, state: String
        public let index: Int
        public var sha256: String? = nil
    }
    public let generation: Int
    public let receipts: [Receipt]
    public var fragmentReceipts: [FragmentReceipt]? = nil
}
public struct OfflineReplicaErasure: Codable, Sendable {
    public var id: String = UUID().uuidString
    public var hostID: String
    public var removedIDs: [String]
    public var reset: Bool
    public init(hostID: String,removedIDs: [String],reset: Bool) { self.hostID=hostID;self.removedIDs=removedIDs;self.reset=reset }
}
public struct OfflineState: Codable, Sendable {
    public var snapshot: OfflineSnapshot?
    public var turns: [OfflineTurn] = []
    public var synced: Set<String> = []
    public var contexts: [String: [OfflineMessage]] = [:]
    public var workTasks: [OfflineWorkTask]? = nil
    public var phoneHandovers: [OfflinePhoneHandover]? = nil
    public var pendingSubmission: OfflineSubmission? = nil
    public var phoneTurnFragments: [String: OfflineTurnFragmentProgress]? = nil
    public var retiredPhoneTurnIDs: Set<String>? = nil
    public var erasure: OfflineReplicaErasure? = nil
    public init() {}
}
public enum OfflineFailure: Error, LocalizedError {
    case notReady, identity, authorization, model, busy, invalid
    public var errorDescription: String? {
        switch self {
        case .notReady: "请先连接电脑，同步记忆副本与账户云模型。"
        case .identity: "离线副本身份不符，已停止使用。"
        case .authorization: "离线授权已变更，本机副本与离线历史已清理。"
        case .model: "云模型暂不可用，请联网后重试。"
        case .busy: "正在同步或回复，请稍后再试。"
        case .invalid: "离线数据无法验证，请重新连接电脑。"
        }
    }
}
