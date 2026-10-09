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
public struct OfflineMemoryRef: Codable, Sendable, Hashable {
    public let kind, id: String
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
public struct OfflineTurn: Codable, Sendable, Identifiable {
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
public struct OfflineAuthorization: Codable, Sendable {
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
    public let model: OfflineModelConfiguration
    public let control: OfflineControl
}
public struct OfflineSyncRequest: Encodable, Sendable {
    public let publicJwk: [String: String]
    public let generation: Int
    public let hashes: [String: String]
}
public struct OfflineSubmission: Encodable, Sendable {
    public let generation: Int
    public let turns: [OfflineTurn]
}
public struct OfflineReceipts: Codable, Sendable {
    public struct Receipt: Codable, Sendable { public let id, state: String }
    public let generation: Int
    public let receipts: [Receipt]
}
public struct OfflineState: Codable, Sendable {
    public var snapshot: OfflineSnapshot?
    public var turns: [OfflineTurn] = []
    public var synced: Set<String> = []
    public var contexts: [String: [OfflineMessage]] = [:]
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
