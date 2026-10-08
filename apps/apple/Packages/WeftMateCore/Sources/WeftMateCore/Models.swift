import Foundation

public enum ApplePlatform: String, Codable, Sendable, CaseIterable {
    case macOS, iOS, watchOS
    public static var current: Self {
        #if os(watchOS)
        .watchOS
        #elseif os(iOS)
        .iOS
        #else
        .macOS
        #endif
    }
    public var deviceLabel: String {
        switch self { case .macOS: "Mac"; case .iOS: "iPhone"; case .watchOS: "Apple Watch" }
    }
}

public struct ServerConfiguration: Codable, Hashable, Sendable {
    public let origin: URL
    public var originString: String { origin.absoluteString }

    /// HTTPS only, except explicit loopback development. No credentials, query or fragments.
    public init(input: String, allowLoopbackHTTP: Bool = false) throws {
        guard var parts = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = parts.scheme?.lowercased(), let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              ["", "/", "/personal/v1/ui", "/personal/v1/ui/"].contains(parts.path),
              parts.port.map({ (1...65535).contains($0) }) ?? true,
              scheme == "https" || (allowLoopbackHTTP && scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host))
        else { throw APIFailure.invalidServer }
        parts.scheme = scheme; parts.host = host; parts.path = ""
        guard let origin = parts.url else { throw APIFailure.invalidServer }
        self.origin = origin
    }
    // Do not allow decoded credential data to bypass origin validation.
    public init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        let url = try box.decode(URL.self, forKey: .origin)
        try self.init(input: url.absoluteString, allowLoopbackHTTP: true)
    }
    enum CodingKeys: String, CodingKey { case origin }
}

public struct AccountProfile: Codable, Sendable, Equatable {
    public let ownerId: String
    public let username: String
    public let displayName: String
    public let profileRevision: Int?
}

public struct DeviceRecord: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let createdAt: String?
    public let lastSeenAt: String?
    public let expiresAt: String?
    public let revoked: Bool
    public let current: Bool

    public init(id: String, name: String, createdAt: String? = nil, lastSeenAt: String? = nil,
                expiresAt: String? = nil, revoked: Bool = false, current: Bool = false) {
        self.id = id; self.name = name; self.createdAt = createdAt; self.lastSeenAt = lastSeenAt
        self.expiresAt = expiresAt; self.revoked = revoked; self.current = current
    }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id); name = try c.decode(String.self, forKey: .name)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        lastSeenAt = try c.decodeIfPresent(String.self, forKey: .lastSeenAt)
        expiresAt = try c.decodeIfPresent(String.self, forKey: .expiresAt)
        revoked = try c.decodeIfPresent(Bool.self, forKey: .revoked) ?? false
        current = try c.decodeIfPresent(Bool.self, forKey: .current) ?? false
    }
    enum CodingKeys: String, CodingKey { case id, name, createdAt, lastSeenAt, expiresAt, revoked, current }
}

/// Safe UI projection. Cookie and CSRF token are never part of this public value.
public struct AccountSession: Codable, Sendable, Equatable {
    public let server: ServerConfiguration
    public let account: AccountProfile
    public let device: DeviceRecord
    public let hostId: String
    public let verification: SessionVerification
}

public enum SessionVerification: String, Codable, Sendable {
    case verified, unverifiedOffline
}

public struct ConversationSummary: Identifiable, Sendable, Equatable {
    public let id: String
    public let title: String
    public let conversationId: String?
    public let sessionId: String?
    public let running: Bool
    public let sendAvailable: Bool
    public let originalModelLabel: String?
    public let archived: Bool
    public init(id: String, title: String, conversationId: String?, sessionId: String?, running: Bool,
                sendAvailable: Bool, originalModelLabel: String?, archived: Bool = false) {
        self.id = id; self.title = title; self.conversationId = conversationId; self.sessionId = sessionId
        self.running = running; self.sendAvailable = sendAvailable; self.originalModelLabel = originalModelLabel; self.archived = archived
    }

}

public enum MessageRole: String, Codable, Sendable { case user, assistant }

public struct ChatMessage: Identifiable, Sendable, Equatable {
    public let id: String
    public let role: MessageRole
    public let text: String
    public let occurredAt: String?
    public let sourceDeviceId: String?
    public let attachmentCount: Int
    public let truncated: Bool
    /// Late phone records remain visible, without implying they entered host context.
    public let pendingContext: Bool
    public let images: [SharedHistoryImage]
    public let originalAttachments: [OriginalAttachment]
    public let attachmentMessageId: String?
    public let unpreviewedOriginalImageIds: [String]

    public init(id: String, role: MessageRole, text: String, occurredAt: String?, sourceDeviceId: String?,
                attachmentCount: Int, truncated: Bool, pendingContext: Bool,
                images: [SharedHistoryImage] = [], originalAttachments: [OriginalAttachment] = [], attachmentMessageId: String? = nil,
                unpreviewedOriginalImageIds: [String] = []) {
        self.id = id; self.role = role; self.text = text; self.occurredAt = occurredAt
        self.sourceDeviceId = sourceDeviceId; self.attachmentCount = attachmentCount
        self.truncated = truncated; self.pendingContext = pendingContext
        self.images = images; self.originalAttachments = originalAttachments; self.attachmentMessageId = attachmentMessageId
        self.unpreviewedOriginalImageIds = unpreviewedOriginalImageIds
    }
}

public enum APIFailure: Error, Sendable, Equatable, LocalizedError {
    case invalidServer, notAuthenticated, accountChanged, identityMismatch
    case transport(TransportFailure)
    case server(status: Int, code: String)
    case invalidResponse, responseTooLarge, credentialStorage
    case platformCapabilityUnavailable
    case requestLedgerLimit
    case logoutIncomplete(credentialRemoved: Bool, remoteConfirmed: Bool)

    public var safeCode: String {
        switch self {
        case .invalidServer: "INVALID_SERVER"
        case .notAuthenticated: "NOT_AUTHENTICATED"
        case .accountChanged: "ACCOUNT_CHANGED"
        case .identityMismatch: "ACCOUNT_IDENTITY_MISMATCH"
        case .transport(let reason): reason.rawValue
        case .server(_, let code): code
        case .invalidResponse: "INVALID_RESPONSE"
        case .responseTooLarge: "RESPONSE_TOO_LARGE"
        case .credentialStorage: "CREDENTIAL_STORAGE_UNAVAILABLE"
        case .platformCapabilityUnavailable: "APPLE_CAPABILITY_UNAVAILABLE"
        case .requestLedgerLimit: "LOCAL_REQUEST_LEDGER_LIMIT"
        case .logoutIncomplete: "LOGOUT_UNCONFIRMED"
        }
    }
    public var errorDescription: String? {
        switch self {
        case .invalidServer: "请输入有效的 HTTPS 服务器地址。"
        case .notAuthenticated: "请先登录。"
        case .accountChanged: "账户已切换，请重新读取。"
        case .identityMismatch: "服务器返回的账户或设备身份不一致。"
        case .transport(.timeout): "连接超时，请检查服务器地址和网络。"
        case .transport(.certificate): "无法验证服务器证书。"
        case .transport(.cancelled): "操作已取消。"
        case .transport: "服务器暂不可达，请检查网络后重试。"
        case .server(_, "INVALID_CREDENTIALS"): "账户或密码不正确。"
        case .server(_, "ACCOUNT_ALREADY_EXISTS"): "这个账户名已被使用。"
        case .server(_, "LOGIN_RATE_LIMITED"): "尝试次数较多，请稍后再登录。"
        case .server(401, _): "登录已过期或设备已撤权，请重新登录。"
        case .server(403, _): "当前账户或设备没有这项权限。"
        case .server(402, "USAGE_LIMIT_REACHED"): "本月用量已达到上限，云端模型请求已暂停。请在设置 → 用量提高本月上限，或切换本地模型。"
        case .server(409, _): "当前记录有冲突，请刷新后重试。"
        case .server(_, "DEVICE_LIMIT"): "已登录设备达到上限，请先管理已有设备。"
        case .server(_, let code): "服务器暂时无法完成操作（\(code)）。"
        case .invalidResponse: "服务器响应格式不符合接口约定。"
        case .responseTooLarge: "服务器响应超过读取上限。"
        case .credentialStorage: "无法安全保存登录凭据，请检查钥匙串访问。"
        case .platformCapabilityUnavailable: "服务器尚未接通 Apple 设备的续聊能力；当前可读取原会话。"
        case .requestLedgerLimit: "本机请求记录已达到保存上限，请先核对已有请求。"
        case .logoutIncomplete(false, true): "服务器已退出，但钥匙串中的旧凭据未能清除。请检查钥匙串访问。"
        case .logoutIncomplete(false, false): "钥匙串中的凭据未能清除，服务器退出也未确认。请恢复连接并检查钥匙串访问后重试。"
        case .logoutIncomplete(true, false): "已清除本机登录，服务器暂不可达，远端退出尚未确认。"
        case .logoutIncomplete(true, true): "退出状态需要重新核对。"
        }
    }
}

public enum TransportFailure: String, Sendable { case unavailable = "SERVICE_UNAVAILABLE", timeout = "TIMEOUT", certificate = "TLS_UNVERIFIED", cancelled = "CANCELLED", redirect = "REDIRECT_REFUSED" }
