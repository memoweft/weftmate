import Foundation
import CryptoKit

public enum CloudLoginFailure: Error, LocalizedError, Sendable, Equatable {
    case callback, token, busy, pinChanged, pairing, hostOffline, needsPairing, browserCancelled
    public var errorDescription: String? {
        switch self {
        case .callback: "云登录回调校验失败，请重新登录。"
        case .token: "云登录凭据校验失败；请确认云端已登记此客户端和设备公钥。"
        case .busy: "云登录正在处理，请稍候。"
        case .pinChanged: "电脑的安全密钥与配对记录不同，请在电脑上核对。"
        case .pairing: "配对二维码无效或已过期，请在电脑上重新生成。"
        case .hostOffline: "宿主离线 / 连接不可用。云账号仍已登录，可稍后重试。"
        case .needsPairing: "请先从电脑取得配对信息，固定电脑的安全密钥。"
        case .browserCancelled: "已取消云登录。"
        }
    }
}

public struct CloudConfiguration: Sendable, Equatable {
    public let server: ServerConfiguration
    public let clientID: String
    public let redirectURI: String
    public var issuer: String { server.originString + "/personal/v1/cloud/oidc" }
    public var audience: String { server.originString + "/personal/v1/cloud" }
    public init(server: ServerConfiguration, clientID: String = "weftmate-apple", redirectURI: String = "com.weftmate.apple:/oauth/callback") {
        self.server = server; self.clientID = clientID; self.redirectURI = redirectURI
    }
}

public struct CloudAuthorization: Sendable {
    public let url: URL
    public let verifier: String
    public let state: String
    public let nonce: String
    public let configuration: CloudConfiguration
    public init(configuration: CloudConfiguration, hostID: String? = nil, deviceID: String? = nil, publicJwk: [String: String]? = nil) throws {
        self.configuration = configuration
        verifier = cloudBase64(Data((0..<32).map { _ in UInt8.random(in: 0...255) }))
        state = UUID().uuidString; nonce = UUID().uuidString
        var parts = URLComponents(string: configuration.issuer + "/auth")!
        var fields = ["client_id": configuration.clientID, "redirect_uri": configuration.redirectURI,
            "response_type": "code", "scope": "openid offline_access cloud:account" + (hostID == nil ? "" : " host:session"),
            "prompt": "consent", "state": state, "nonce": nonce, "code_challenge_method": "S256",
            "code_challenge": cloudBase64(Data(SHA256.hash(data: Data(verifier.utf8))))]
        if let hostID {
            guard hostID.range(of: "^[A-Za-z0-9_.:-]{1,128}$", options: .regularExpression) != nil else { throw CloudLoginFailure.pairing }
            fields["resource"] = configuration.audience + "/hosts/" + hostID
        }
        if let deviceID, let publicJwk {
            fields["wm_device_id"] = deviceID
            fields["wm_public_jwk"] = String(data: try JSONSerialization.data(withJSONObject: publicJwk, options: [.sortedKeys]), encoding: .utf8)
        }
        parts.queryItems = fields.map { URLQueryItem(name: $0.key, value: $0.value) }
        if hostID != nil { parts.queryItems!.append(URLQueryItem(name: "resource", value: configuration.audience)) }
        url = parts.url!
    }
    public func code(from callback: URL) throws -> String {
        guard let actual = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              let expected = URLComponents(string: configuration.redirectURI),
              actual.scheme == expected.scheme, actual.host == expected.host, actual.path == expected.path,
              actual.user == nil, actual.password == nil, actual.port == expected.port, actual.fragment == nil else { throw CloudLoginFailure.callback }
        let items = actual.queryItems ?? []
        for field in ["state", "code", "error"] where items.filter({ $0.name == field }).count > 1 { throw CloudLoginFailure.callback }
        guard items.first(where: { $0.name == "state" })?.value == state,
              items.first(where: { $0.name == "error" }) == nil,
              let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else { throw CloudLoginFailure.callback }
        return code
    }
}

/// Exact /cloud/pairings response, carried as JSON in the QR. Cloud never supplies this pin.
public struct HostPairing: Codable, Sendable, Equatable {
    public let challenge: String
    public let expiresIn: Int
    public let hostId: String
    public let tlsSpki: String
    public let publicJwk: [String: String]
    public let origin: String
    public let relay: Relay?
    public struct Relay: Codable, Sendable, Equatable { public let state: String; public let baseUrl: String? }
    public static func parse(_ data: Data, allowLoopbackHTTP: Bool = false) throws -> Self {
        let input = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var encoded: String?
        if input.hasPrefix("wm1.") { encoded = String(input.dropFirst(4)) }
        else if let url = URLComponents(string: input), let fragment = url.fragment,
                let fields = URLComponents(string: "https://pair.invalid/?" + fragment)?.queryItems {
            let matches = fields.filter { $0.name == "pair" }
            guard matches.count == 1 else { throw CloudLoginFailure.pairing }
            encoded = matches[0].value
        }
        var json = data
        if let encoded {
            guard encoded.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { throw CloudLoginFailure.pairing }
            let base = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            guard let bytes = Data(base64Encoded: base + String(repeating: "=", count: (4 - base.count % 4) % 4)) else { throw CloudLoginFailure.pairing }
            json = bytes
        }
        guard let pair = try? JSONDecoder().decode(Self.self, from: json),
              pair.expiresIn > 0, pair.expiresIn <= 120,
              pair.challenge.range(of: "^[A-Za-z0-9_-]{20,256}$", options: .regularExpression) != nil,
              pair.hostId.range(of: "^[A-Za-z0-9_.:-]{1,128}$", options: .regularExpression) != nil,
              pair.tlsSpki.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              pair.publicJwk["kty"] == "EC", pair.publicJwk["crv"] == "P-256", pair.publicJwk["d"] == nil,
              (try? ServerConfiguration(input: pair.origin, allowLoopbackHTTP: allowLoopbackHTTP)) != nil else { throw CloudLoginFailure.pairing }
        if let base = pair.relay?.baseUrl { _ = try ServerConfiguration(input: base) }
        return pair
    }
}

/// Host names use a 128 UTF-16 unit contract; preserve whole characters (including emoji).
public func cloudDeviceName(_ name: String, platform: ApplePlatform = .current) -> String {
    var result = ""
    for character in platform.deviceLabel + " · " + name {
        if result.utf16.count + String(character).utf16.count > 128 { break }
        result.append(character)
    }
    return result
}

public struct PendingCloudDevice: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let requestedAt: String
    public let fingerprint: String
    // S1b has no separate platform field: show the platform supplied in deviceName, without guessing.
    public var requestedAtLabel: String {
        guard let date = ISO8601DateFormatter().date(from: requestedAt) else {
            let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return parser.date(from: requestedAt)?.formatted(date: .abbreviated, time: .shortened) ?? "时间未提供"
        }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
    public var platformLabel: String { name.hasPrefix("iPhone") ? "iOS" : name.hasPrefix("Mac") ? "macOS" : "平台未提供" }
}
public enum CloudSessionExchange: Sendable, Equatable { case pending(requestID: String), authenticated(AccountSession) }
