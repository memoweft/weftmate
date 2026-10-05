import Foundation

public enum PublicUpdateFailure: Error, Equatable, Sendable {
    case invalidInstalledVersion
    case invalidManifest
    case unsupportedSchema
    case unsafeLink
    case responseTooLarge
    case httpStatus(Int)
    case network
    case timeout
    case cancelled
    case certificate
    case redirect
}

/// The executing binary's ABI. A translated Intel app remains an x86_64 app.
public enum PublicUpdateArchitecture {
    public static var current: String {
        #if arch(x86_64)
        "x86_64"
        #elseif arch(arm64)
        "arm64"
        #else
        "unknown"
        #endif
    }
}

public struct PublicInstalledVersion: Equatable, Sendable {
    public let version: String
    public let build: String
    fileprivate let numericVersion: NumericPublicVersion
    fileprivate let numericBuild: String

    public init(version: String?, build: String?) throws {
        guard let version, let build,
              let numericVersion = NumericPublicVersion(version),
              let numericBuild = NumericPublicVersion.build(build) else {
            throw PublicUpdateFailure.invalidInstalledVersion
        }
        self.version = version
        self.build = build
        self.numericVersion = numericVersion
        self.numericBuild = numericBuild
    }
}

public struct PublicMacRelease: Equatable, Sendable {
    public let version: String
    public let build: String
    public let architecture: String
    public let notes: String
    public let bytes: Int64
    public let sha256: String
    public let downloadURL: URL
    public let landingURL: URL
}

public enum PublicUpdateResult: Equatable, Sendable {
    case updateAvailable(PublicMacRelease)
    case upToDate(PublicMacRelease)
    case localIsNewer(PublicMacRelease)
    case noCompatibleRelease
}

/// Public website metadata is intentionally independent of account transport and credentials.
public struct PublicUpdateClient: Sendable {
    public static let downloadsURL = URL(string: "https://www.weftmate.com/downloads/")!
    public static let macLandingURL = URL(string: "https://www.weftmate.com/downloads/?platform=macos")!
    static let manifestURL = URL(string: "https://www.weftmate.com/downloads/releases.json")!
    static let maximumManifestBytes = 65_536

    private let fetcher: any PublicManifestFetching
    public init() { fetcher = PublicURLSessionManifestFetcher() }
    // Tests inject only the public metadata fetch. Production has no installed-version override.
    init(fetcher: any PublicManifestFetching) { self.fetcher = fetcher }

    public func check(installed: PublicInstalledVersion,
                      architecture: String = PublicUpdateArchitecture.current) async throws -> PublicUpdateResult {
        do {
            try Task.checkCancellation()
            let data = try await fetcher.fetchManifest()
            try Task.checkCancellation()
            let result = try Self.evaluate(data, installed: installed, architecture: architecture)
            try Task.checkCancellation()
            return result
        } catch is CancellationError {
            throw PublicUpdateFailure.cancelled
        } catch let failure as PublicUpdateFailure {
            throw failure
        } catch {
            throw PublicUpdateFailure.network
        }
    }

    static func evaluate(_ data: Data, installed: PublicInstalledVersion,
                         architecture: String) throws -> PublicUpdateResult {
        guard data.count <= maximumManifestBytes else { throw PublicUpdateFailure.responseTooLarge }
        let manifest: Manifest
        do { manifest = try JSONDecoder().decode(Manifest.self, from: data) }
        catch { throw PublicUpdateFailure.invalidManifest }
        guard manifest.schemaVersion == 1 else { throw PublicUpdateFailure.unsupportedSchema }
        guard manifest.siteUrl == downloadsURL.absoluteString else { throw PublicUpdateFailure.unsafeLink }
        let entries = manifest.platforms.filter { $0.id == "macos" }
        guard entries.count == 1, manifest.platforms.count <= 32 else { throw PublicUpdateFailure.invalidManifest }
        let mac = entries[0]
        guard !mac.name.isEmpty, mac.name.utf8.count <= 128,
              mac.notes.utf8.count <= 4_096 else { throw PublicUpdateFailure.invalidManifest }
        let landingURL = try checkedLandingURL(mac.landingUrl)
        try checkQRPath(mac.qrUrl)
        guard mac.status == "available" || mac.status == "unavailable" else {
            throw PublicUpdateFailure.invalidManifest
        }
        guard mac.status == "available" else { return .noCompatibleRelease }
        guard let version = mac.version, let build = mac.build,
              let numericVersion = NumericPublicVersion(version),
              let numericBuild = NumericPublicVersion.build(build),
              let releaseArchitecture = mac.architecture,
              safeArchitecture(releaseArchitecture),
              let bytes = mac.bytes, bytes > 0,
              let sha256 = mac.sha256, isSHA256(sha256),
              let download = mac.downloadUrl else { throw PublicUpdateFailure.invalidManifest }
        let normalizedSHA = sha256.lowercased()
        let downloadURL = try checkedDownloadURL(download, sha256: normalizedSHA)
        // Validate all metadata before reporting an architecture mismatch.
        let matches = releaseArchitecture == architecture ||
            (releaseArchitecture == "universal" && ["x86_64", "arm64"].contains(architecture))
        guard matches, ["x86_64", "arm64"].contains(architecture) else { return .noCompatibleRelease }
        let release = PublicMacRelease(version: version, build: build, architecture: releaseArchitecture,
            notes: mac.notes, bytes: bytes, sha256: normalizedSHA, downloadURL: downloadURL, landingURL: landingURL)
        let marketingOrder = numericVersion.compare(to: installed.numericVersion)
        let order = marketingOrder == .orderedSame
            ? NumericPublicVersion.compareDigits(numericBuild, installed.numericBuild) : marketingOrder
        switch order {
        case .orderedDescending: return .updateAvailable(release)
        case .orderedSame: return .upToDate(release)
        case .orderedAscending: return .localIsNewer(release)
        }
    }

    private static func safeArchitecture(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 32 && value.utf8.allSatisfy {
            (97...122).contains($0) || (48...57).contains($0) || $0 == 95
        }
    }
    private static func isSHA256(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0) || (65...70).contains($0)
        }
    }
    private static func checkedLandingURL(_ value: String) throws -> URL {
        // The server publishes an absolute platform page; an equivalent relative query is valid too.
        guard value == macLandingURL.absoluteString || value == "?platform=macos" else {
            throw PublicUpdateFailure.unsafeLink
        }
        return macLandingURL
    }
    private static func checkQRPath(_ value: String) throws {
        guard value == "qr/macos.svg" else { throw PublicUpdateFailure.unsafeLink }
    }
    private static func checkedDownloadURL(_ value: String, sha256: String) throws -> URL {
        // Permit precisely one relative files/ component and an ASCII immutable DMG filename.
        // Excluding percent escapes also excludes encoded separators and dot traversal.
        let components = value.split(separator: "/", omittingEmptySubsequences: false)
        guard components.count == 2, components[0] == "files",
              value.utf8.count <= 512 else { throw PublicUpdateFailure.unsafeLink }
        let filename = String(components[1])
        guard filename.hasPrefix(sha256 + "-"), filename.hasSuffix(".dmg"),
              !filename.contains(".."), filename.utf8.allSatisfy({
                  (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) ||
                      $0 == 45 || $0 == 46 || $0 == 95
              }) else { throw PublicUpdateFailure.unsafeLink }
        let suffix = filename.dropFirst(65).dropLast(4)
        guard let first = suffix.utf8.first,
              (65...90).contains(first) || (97...122).contains(first) || (48...57).contains(first),
              let url = URL(string: value, relativeTo: downloadsURL)?.absoluteURL,
              url.scheme == "https", url.host == "www.weftmate.com", url.port == nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path == "/downloads/" + value else { throw PublicUpdateFailure.unsafeLink }
        return url
    }
}

private struct Manifest: Decodable {
    let schemaVersion: Int
    let siteUrl: String
    let platforms: [PlatformEntry]
}
private struct PlatformEntry: Decodable {
    let id: String
    let status: String
    let name: String
    let notes: String
    let landingUrl: String
    let qrUrl: String
    let version: String?
    let build: String?
    let architecture: String?
    let bytes: Int64?
    let sha256: String?
    let downloadUrl: String?
}

/// Compare decimal fields without lexicographic or fixed-width integer overflow errors.
fileprivate struct NumericPublicVersion: Equatable, Sendable {
    private let parts: [String]
    init?(_ value: String) {
        let raw = value.split(separator: ".", omittingEmptySubsequences: false)
        guard !value.isEmpty, value.utf8.count <= 64, (1...4).contains(raw.count),
              raw.allSatisfy({ !$0.isEmpty && $0.utf8.allSatisfy({ (48...57).contains($0) }) }) else { return nil }
        var normalized = raw.map { Self.normalize(String($0)) }
        while normalized.count > 1 && normalized.last == "0" { normalized.removeLast() }
        parts = normalized
    }
    static func build(_ value: String) -> String? {
        guard !value.isEmpty, value.utf8.count <= 32,
              value.utf8.allSatisfy({ (48...57).contains($0) }) else { return nil }
        return normalize(value)
    }
    private static func normalize(_ value: String) -> String {
        let trimmed = value.drop(while: { $0 == "0" })
        return trimmed.isEmpty ? "0" : String(trimmed)
    }
    static func compareDigits(_ lhs: String, _ rhs: String) -> ComparisonResult {
        if lhs.count != rhs.count { return lhs.count < rhs.count ? .orderedAscending : .orderedDescending }
        if lhs == rhs { return .orderedSame }
        return lhs < rhs ? .orderedAscending : .orderedDescending
    }
    func compare(to other: Self) -> ComparisonResult {
        for index in 0..<max(parts.count, other.parts.count) {
            let order = Self.compareDigits(index < parts.count ? parts[index] : "0",
                index < other.parts.count ? other.parts[index] : "0")
            if order != .orderedSame { return order }
        }
        return .orderedSame
    }
}

protocol PublicManifestFetching: Sendable {
    func fetchManifest() async throws -> Data
}

private final class PublicRedirectRefuser: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct PublicURLSessionManifestFetcher: PublicManifestFetching {
    // Internal injection permits isolated URLProtocol tests; the public initializer never changes routing.
    let configurationFactory: @Sendable () -> URLSessionConfiguration
    init(configurationFactory: @escaping @Sendable () -> URLSessionConfiguration = Self.configuration) {
        self.configurationFactory = configurationFactory
    }
    static func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 20
        configuration.waitsForConnectivity = false
        return configuration
    }
    func fetchManifest() async throws -> Data {
        let session = URLSession(configuration: configurationFactory(), delegate: PublicRedirectRefuser(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: PublicUpdateClient.manifestURL, cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 20)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else { throw PublicUpdateFailure.invalidManifest }
            if (300...399).contains(http.statusCode) { throw PublicUpdateFailure.redirect }
            guard http.statusCode == 200 else { throw PublicUpdateFailure.httpStatus(http.statusCode) }
            guard response.url == PublicUpdateClient.manifestURL else { throw PublicUpdateFailure.unsafeLink }
            guard response.expectedContentLength <= Int64(PublicUpdateClient.maximumManifestBytes) else {
                throw PublicUpdateFailure.responseTooLarge
            }
            var data = Data()
            for try await byte in bytes {
                guard data.count < PublicUpdateClient.maximumManifestBytes else { throw PublicUpdateFailure.responseTooLarge }
                if data.count % 4_096 == 0 { try Task.checkCancellation() }
                data.append(byte)
            }
            try Task.checkCancellation()
            return data
        } catch is CancellationError {
            throw PublicUpdateFailure.cancelled
        } catch let failure as PublicUpdateFailure {
            throw failure
        } catch let error as URLError {
            switch error.code {
            case .timedOut: throw PublicUpdateFailure.timeout
            case .cancelled: throw PublicUpdateFailure.cancelled
            case .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot,
                 .serverCertificateNotYetValid, .secureConnectionFailed: throw PublicUpdateFailure.certificate
            default: throw PublicUpdateFailure.network
            }
        } catch {
            throw PublicUpdateFailure.network
        }
    }
}
