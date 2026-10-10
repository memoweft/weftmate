import Foundation
import CryptoKit
import CoreFoundation

/// SemVer bounds shared with UPD-1. Digit strings avoid overflow and preserve large versions.
public struct NativeVersion: Sendable, Equatable, Comparable {
    private let core: [String]
    private let prerelease: [String]
    public init?(_ value: String) {
        guard value.range(of: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?$", options: .regularExpression) != nil else { return nil }
        let pieces = value.split(separator: "-", maxSplits: 1)
        core = pieces[0].split(separator: ".").map { Self.normal(String($0)) }
        prerelease = pieces.count == 2 ? pieces[1].split(separator: ".", omittingEmptySubsequences: false).map(String.init) : []
        guard prerelease.allSatisfy({ !$0.isEmpty }) else { return nil }
    }
    private static func normal(_ value: String) -> String { String(value.drop(while: { $0 == "0" })).isEmpty ? "0" : String(value.drop(while: { $0 == "0" })) }
    private static func digits(_ a: String, _ b: String) -> Bool {
        let a = normal(a), b = normal(b); return a.count == b.count ? a < b : a.count < b.count
    }
    public static func == (a: Self, b: Self) -> Bool { !(a < b) && !(b < a) }
    public static func < (a: Self, b: Self) -> Bool {
        for (x, y) in zip(a.core, b.core) where x != y { return digits(x, y) }
        if a.prerelease.isEmpty || b.prerelease.isEmpty { return !a.prerelease.isEmpty && b.prerelease.isEmpty }
        for (x, y) in zip(a.prerelease, b.prerelease) where x != y {
            let xn = x.allSatisfy(\.isNumber), yn = y.allSatisfy(\.isNumber)
            if xn && yn { if normal(x) == normal(y) { continue }; return digits(x, y) }
            if xn != yn { return xn }
            return x < y
        }
        return a.prerelease.count < b.prerelease.count
    }
}

public enum NativeCompatibility {
    public static func notice(installed: String, minimum: String?, platform: ApplePlatform) -> String? {
        guard let minimum else { return nil }
        guard let local = NativeVersion(installed), let required = NativeVersion(minimum) else { return "无法确认版本兼容性，请更新 App 后重试。" }
        guard local < required else { return nil }
        let destination = platform == .iOS ? "有新版本可在 TestFlight 更新；正式版请在 App Store 更新。" : "请检查更新并安装新版 App。"
        return "需要更新：所连电脑要求 App \(minimum) 或更高版本，当前为 \(installed)。\(destination)"
    }
}

public struct HostUpdateLayer: Codable, Sendable, Identifiable {
    public let layer: String
    public let currentVersion: String?
    public let availableVersion: String?
    public let status: String
    public let channel: String?
    public var id: String { layer }
    public var title: String { switch layer { case "ui": "界面与功能包"; case "app": "程序本体"; case "mobile-ui": "手机界面包"; default: layer } }
    public var statusText: String {
        switch status {
        case "disabled": "尚未配置"
        case "idle": "尚未检查"
        case "checking": "检查中"
        case "downloading", "available": "下载中"
        case "downloaded": "已就绪，重启后完成更新"
        case "ready": "已就绪，下次打开窗口时更新"
        case "starting": "正在验证新界面"
        case "current", "not-available": "已是最新版本"
        case "failed", "error": "更新失败"
        case "device-managed": "在手机上检查"
        default: "宿主未提供版本状态"
        }
    }
}
public struct HostUpdateSnapshot: Codable, Sendable { public let layers: [HostUpdateLayer] }
public struct NativeHostStatus: Codable, Sendable {
    public let ownerId: String
    public let hostId: String
    public let personalCapabilities: [String: JSONValue]?
    public let executionAccount: Bool?
    public let updates: HostUpdateSnapshot?
    /// Keys are ApplePlatform wire names. Android mobile-ui minimums are independent.
    public let nativeMinimumVersions: [String: String]?
    public func minimum(for platform: ApplePlatform) -> String? { nativeMinimumVersions?[platform.rawValue] }
}

public enum NativeUpdateFailure: Error, Equatable { case unconfigured, invalidConfiguration, signature, manifest, network }
public struct NativeUpdateConfiguration: Sendable {
    public let feed: URL?
    public let publicKey: Data?
    public let channel: String
    public let allowsLoopback: Bool
    public init(feed: String?, publicKey: String?, channel: String = "stable", allowsLoopback: Bool = false) throws {
        self.channel = channel; self.allowsLoopback = allowsLoopback
        if let feed, !feed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let url = URL(string: feed), Self.safeURL(url, allowsLoopback: allowsLoopback) else { throw NativeUpdateFailure.invalidConfiguration }
            self.feed = url
        } else { self.feed = nil }
        self.publicKey = publicKey.flatMap { Data(base64Encoded: $0) }
        guard ["stable", "preview"].contains(channel) else { throw NativeUpdateFailure.invalidConfiguration }
    }
    public var statusText: String { feed == nil ? "未配置更新源" : "尚未检查" }
    public static func safeURL(_ url: URL, allowsLoopback: Bool) -> Bool {
        guard let host = url.host, !host.isEmpty, url.user == nil, url.password == nil, url.fragment == nil else { return false }
        return url.scheme == "https" || (allowsLoopback && url.scheme == "http" && ["127.0.0.1", "localhost", "[::1]"].contains(host))
    }
}
public struct NativeMacRelease: Sendable, Equatable {
    public let version: String
    public let build: String
    public let downloadPage: URL
    public func isNewer(than version: String, build installedBuild: String) throws -> Bool {
        guard let current = NativeVersion(version), let available = NativeVersion(self.version),
              !installedBuild.isEmpty, installedBuild.allSatisfy({ $0.isASCII && $0.isNumber }) else { throw NativeUpdateFailure.manifest }
        if current != available { return current < available }
        let old = String(installedBuild.drop(while: { $0 == "0" })), new = String(build.drop(while: { $0 == "0" }))
        return old.count == new.count ? old < new : old.count < new.count
    }
}

/// Detection only: no archive fetch, extraction, installation or executable resource activation.
/// Reuses UPD-1 canonical bytes and Ed25519 identity, including unknown signed extensions.
public enum SignedNativeUpdate {
    public static func evaluate(_ data: Data, configuration: NativeUpdateConfiguration, now: Date = Date()) throws -> NativeMacRelease {
        guard data.count <= 1_048_576,
              var object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let signature = object.removeValue(forKey: "signature") as? [String: String],
              signature["algorithm"] == "Ed25519", let signatureBytes = signature["value"].flatMap({ Data(base64Encoded: $0) }),
              let raw = configuration.publicKey, raw.count == 32 else { throw NativeUpdateFailure.signature }
        let der = Data([0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00]) + raw
        let keyID = SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined().prefix(32)
        let key = try Curve25519.Signing.PublicKey(rawRepresentation: raw)
        guard signature["keyId"] == String(keyID), key.isValidSignature(signatureBytes, for: try canonical(object)) else { throw NativeUpdateFailure.signature }
        guard object["schemaVersion"] as? Int == 1, object["layer"] as? String == "app",
              object["channel"] as? String == configuration.channel, object["nativePlatform"] as? String == "macOS",
              let version = object["version"] as? String, NativeVersion(version) != nil,
              let build = object["nativeBuild"] as? String, !build.isEmpty, build.allSatisfy({ $0.isASCII && $0.isNumber }),
              let page = object["downloadPage"] as? String, let url = URL(string: page),
              NativeUpdateConfiguration.safeURL(url, allowsLoopback: configuration.allowsLoopback),
              let files = object["files"] as? [[String: Any]], !files.isEmpty else { throw NativeUpdateFailure.manifest }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func date(_ value: String) -> Date? { formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value) }
        guard let published = object["publishedAt"] as? String, let publishedDate = date(published), publishedDate <= now.addingTimeInterval(300) else { throw NativeUpdateFailure.manifest }
        if let expiry = object["expiresAt"] { guard let expiry = expiry as? String, let expires = date(expiry), expires > now else { throw NativeUpdateFailure.manifest } }
        return NativeMacRelease(version: version, build: build, downloadPage: url)
    }
    static func canonical(_ value: Any) throws -> Data {
        func string(_ value: Any) throws -> String {
            if let dict = value as? [String: Any] {
                return "{" + (try dict.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }.map { key in
                    try string(key) + ":" + string(dict[key]!)
                }).joined(separator: ",") + "}"
            }
            if let array = value as? [Any] { return "[" + (try array.map(string)).joined(separator: ",") + "]" }
            if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
                guard number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue, abs(number.doubleValue) <= 9_007_199_254_740_991 else { throw NativeUpdateFailure.manifest }
                return String(Int64(number.doubleValue))
            }
            let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .withoutEscapingSlashes])
            guard let result = String(data: data, encoding: .utf8) else { throw NativeUpdateFailure.manifest }
            return result
        }
        return Data(try string(value).utf8)
    }
}

/// Anonymous feed requests never inherit host cookies or redirects.
public final class NativeUpdateFetcher: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    public func fetch(_ configuration: NativeUpdateConfiguration) async throws -> Data {
        guard let url = configuration.feed else { throw NativeUpdateFailure.unconfigured }
        let settings = URLSessionConfiguration.ephemeral
        settings.httpCookieStorage = nil; settings.httpShouldSetCookies = false
        settings.urlCredentialStorage = nil; settings.urlCache = nil
        let session = URLSession(configuration: settings, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url); request.timeoutInterval = 20
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, response.url == url, data.count <= 1_048_576 else { throw NativeUpdateFailure.network }
        return data
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
