import Foundation

public struct CloudDirectory: Codable, Sendable {
    public let devices: [CloudDirectoryDevice]
    public let hosts: [CloudDirectoryDevice]
}
public struct CloudDirectoryDevice: Codable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let type: String
    public let online: Bool
    public let lastUsedAt: String?
    public let isCurrent: Bool
    public let hostId: String?
    public var icon: String {
        switch type { case "computer", "macos", "windows": "desktop"; case "web": "web"; case "watch": "watch"; default: "phone" }
    }
}
public struct CloudHostConnection: Decodable, Sendable {
    public let hostId: String
    public let baseUrl: String?
    public let status: String
    public let resource: String
    public let approval: String
    public let pairingRequired: Bool
}
public struct AppLoginReply: Decodable, Sendable {
    public let challengeId: String?
    public let resumeUrl: String?
}
public struct AppAccountError: Error, LocalizedError, Sendable, Equatable {
    public let code: String
    public let status: Int
    public let retryAfter: Int?
    public init(code: String, status: Int, retryAfter: Int? = nil) {
        self.code = code; self.status = status; self.retryAfter = retryAfter
    }
    public var errorDescription: String? {
        switch code {
        case "INVALID_CREDENTIALS", "EMAIL_NOT_VERIFIED", "EMAIL_IN_USE": "邮箱或密码不对，请检查后重试。"
        case "INVALID_EMAIL": "请输入有效的邮箱地址。"
        case "INVALID_PASSWORD": "当前服务要求密码为 15–128 位，请调整后重试。"
        case "CODE_INVALID", "CHALLENGE_INVALID": "验证码不对或已过期，请重新获取。"
        case "PASSWORD_TICKET_INVALID", "INTERACTION_INVALID": "本次验证已过期，请重新开始。"
        case "RATE_LIMITED": "尝试太多次，请等待 \(retryAfter ?? 60) 秒后重试。"
        default: "暂时无法完成，请稍后重试。"
        }
    }
}

/// Ephemeral account form state. Passwords, codes and tickets never enter saved credentials.
public struct AppAccountForm: Sendable {
    public enum Page: String, Sendable { case login, registration, recovery, deviceConfirmation }
    public enum Step: Int, Sendable { case email, code, password, deviceName }
    public var page: Page = .login
    public var step: Step = .email
    public var email = ""
    public var password = ""
    public var repeatedPassword = ""
    public var code = ""
    public var challenge = ""
    public var ticket = ""
    public var resendAt = Date.distantPast
    public init() {}
    public var validPassword: Bool { password.count >= 8 && password == repeatedPassword }
    public var strength: String {
        if password.count < 8 { return "至少 8 位" }
        let kinds = [password.rangeOfCharacter(from: .lowercaseLetters) != nil,
                     password.rangeOfCharacter(from: .uppercaseLetters) != nil,
                     password.rangeOfCharacter(from: .decimalDigits) != nil,
                     password.rangeOfCharacter(from: .symbols.union(.punctuationCharacters)) != nil].filter { $0 }.count
        return password.count >= 12 && kinds >= 3 ? "强度：较强" : "强度：可用，建议混合字母、数字与符号"
    }
    public func resendSeconds(now: Date = Date()) -> Int { max(0, Int(ceil(resendAt.timeIntervalSince(now)))) }
    public mutating func reset(to page: Page) {
        let email = email
        self = Self(); self.email = email; self.page = page
    }
}
