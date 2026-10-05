import Foundation
import Testing
@testable import WeftMateCore

private let updateTestSHA = String(repeating: "a", count: 64)

private func updateManifest(version: Any = "0.1.0", build: Any = "4", architecture: Any = "x86_64",
                            change: (inout [String: Any], inout [String: Any]) -> Void = { _, _ in }) throws -> Data {
    var mac: [String: Any] = ["id": "macos", "status": "available", "name": "Mac", "notes": "试用版",
        "landingUrl": "https://www.weftmate.com/downloads/?platform=macos", "qrUrl": "qr/macos.svg",
        "version": version, "build": build, "architecture": architecture,
        "bytes": 937_054, "sha256": updateTestSHA,
        "downloadUrl": "files/\(updateTestSHA)-WeftMate-Mac-0.1.0-build4.dmg"]
    var root: [String: Any] = ["schemaVersion": 1, "siteUrl": "https://www.weftmate.com/downloads/"]
    change(&root, &mac)
    if root["platforms"] == nil { root["platforms"] = [mac] }
    return try JSONSerialization.data(withJSONObject: root)
}

private func resultTag(_ result: PublicUpdateResult) -> String {
    switch result {
    case .updateAvailable: "new"
    case .upToDate: "equal"
    case .localIsNewer: "local-newer"
    case .noCompatibleRelease: "no-compatible"
    }
}

@Suite(.serialized) struct PublicUpdatesTests {
    @Test(arguments: [
        ("0.1.0", "4", "0.1.0", "10", "new"),
        ("0.1.0", "10", "0.1.0", "4", "local-newer"),
        ("0.1.0", "4", "0.1.0", "4", "equal"),
        ("0.1.0", "100", "0.2.0", "1", "new"),
        ("2.0.0", "1", "1.9.9", "999", "local-newer"),
        ("0.9.0", "4", "0.10.0", "1", "new"),
        ("1.2", "004", "1.2.0", "4", "equal"),
        ("1.0.0", "99999999999999999999", "1.0.0", "100000000000000000000", "new")
    ]) func numericalVersionOrder(row: (String, String, String, String, String)) throws {
        let installed = try PublicInstalledVersion(version: row.0, build: row.1)
        let data = try updateManifest(version: row.2, build: row.3)
        #expect(resultTag(try PublicUpdateClient.evaluate(data, installed: installed, architecture: "x86_64")) == row.4)
    }

    @Test func architectureIsExecutingABIAndMismatchNeverReportsLatest() throws {
        #if arch(x86_64)
        #expect(PublicUpdateArchitecture.current == "x86_64")
        #elseif arch(arm64)
        #expect(PublicUpdateArchitecture.current == "arm64")
        #endif
        let installed = try PublicInstalledVersion(version: "0.1.0", build: "4")
        #expect(resultTag(try PublicUpdateClient.evaluate(updateManifest(architecture: "arm64"),
            installed: installed, architecture: "x86_64")) == "no-compatible")
        #expect(resultTag(try PublicUpdateClient.evaluate(updateManifest(),
            installed: installed, architecture: "unknown")) == "no-compatible")
        #expect(resultTag(try PublicUpdateClient.evaluate(updateManifest(architecture: "universal"),
            installed: installed, architecture: "arm64")) == "equal")
    }

    @Test(arguments: ["", "1..0", "v1.0", "1.0-beta", " 1.0", "１.０", "1.2.3.4.5"])
    func invalidInstalledVersionsFail(value: String) {
        #expect(throws: PublicUpdateFailure.invalidInstalledVersion) {
            try PublicInstalledVersion(version: value, build: "4")
        }
    }

    @Test func missingOrInvalidInstalledBuildDoesNotAssumeZero() {
        for build in [nil, "", "4.0", "4beta", "-1", " 4"] as [String?] {
            #expect(throws: PublicUpdateFailure.invalidInstalledVersion) {
                try PublicInstalledVersion(version: "0.1.0", build: build)
            }
        }
        #expect(throws: PublicUpdateFailure.invalidInstalledVersion) {
            try PublicInstalledVersion(version: nil, build: "4")
        }
    }

    @Test func manifestMetadataMustBeCompleteAndTypedEvenForWrongArchitecture() throws {
        let installed = try PublicInstalledVersion(version: "0.1.0", build: "4")
        for key in ["version", "build", "architecture", "bytes", "sha256", "downloadUrl", "status", "name", "notes", "landingUrl", "qrUrl"] {
            let data = try updateManifest { _, mac in mac.removeValue(forKey: key) }
            #expect(throws: PublicUpdateFailure.invalidManifest, "missing \(key)") {
                try PublicUpdateClient.evaluate(data, installed: installed, architecture: "arm64")
            }
        }
        for pair: (String, Any) in [("version", "0.1-beta"), ("build", 4), ("build", "10x"),
            ("architecture", "arm 64"), ("bytes", 0), ("bytes", -1), ("bytes", "937054"),
            ("sha256", "not-a-hash"), ("status", "web")] {
            let data = try updateManifest { _, mac in mac[pair.0] = pair.1 }
            #expect(throws: PublicUpdateFailure.invalidManifest, "invalid \(pair.0)") {
                try PublicUpdateClient.evaluate(data, installed: installed, architecture: "x86_64")
            }
        }
    }

    @Test func schemaOriginAndUniqueMacPlatformAreRequired() throws {
        let installed = try PublicInstalledVersion(version: "0.1.0", build: "4")
        let schema = try updateManifest { root, _ in root["schemaVersion"] = 2 }
        #expect(throws: PublicUpdateFailure.unsupportedSchema) {
            try PublicUpdateClient.evaluate(schema, installed: installed, architecture: "x86_64")
        }
        for site in ["https://evil.example/downloads/", "http://www.weftmate.com/downloads/",
            "https://www.weftmate.com/downloads", "https://u:p@www.weftmate.com/downloads/"] {
            let data = try updateManifest { root, _ in root["siteUrl"] = site }
            #expect(throws: PublicUpdateFailure.unsafeLink) {
                try PublicUpdateClient.evaluate(data, installed: installed, architecture: "x86_64")
            }
        }
        for duplicate in [false, true] {
            let data = try updateManifest { root, mac in root["platforms"] = duplicate ? [mac, mac] : [] }
            #expect(throws: PublicUpdateFailure.invalidManifest) {
                try PublicUpdateClient.evaluate(data, installed: installed, architecture: "x86_64")
            }
        }
        #expect(throws: PublicUpdateFailure.invalidManifest) {
            try PublicUpdateClient.evaluate(Data("not JSON".utf8), installed: installed, architecture: "x86_64")
        }
    }

    @Test func unavailableIsHonestAndValidAvailableProducesImmutableURL() throws {
        let installed = try PublicInstalledVersion(version: "0.1.0", build: "4")
        let unavailable = try updateManifest { _, mac in
            mac["status"] = "unavailable"
            for key in ["version", "build", "architecture", "bytes", "sha256", "downloadUrl"] { mac.removeValue(forKey: key) }
        }
        #expect(resultTag(try PublicUpdateClient.evaluate(unavailable, installed: installed, architecture: "x86_64")) == "no-compatible")
        guard case let .upToDate(release) = try PublicUpdateClient.evaluate(updateManifest(),
            installed: installed, architecture: "x86_64") else { Issue.record("Expected matching release"); return }
        #expect(release.downloadURL.absoluteString == "https://www.weftmate.com/downloads/files/\(updateTestSHA)-WeftMate-Mac-0.1.0-build4.dmg")
        #expect(release.landingURL == PublicUpdateClient.macLandingURL)
        #expect(release.sha256 == updateTestSHA && release.bytes == 937_054)
    }

    @Test(arguments: [
        "https://evil.example/file.dmg", "https://www.weftmate.com/downloads/files/file.dmg",
        "//evil.example/file.dmg", "/downloads/files/file.dmg", "../file.dmg",
        "files/../file.dmg", "files/%2e%2e/file.dmg", "files/a%2fb.dmg", "files/a\\b.dmg",
        "files/a.dmg?key=secret", "files/a.dmg#fragment", "files/a.apk", "files/a.dmg"
    ]) func unsafeDownloadURLIsRejected(value: String) throws {
        let installed = try PublicInstalledVersion(version: "0.1.0", build: "4")
        let data = try updateManifest { _, mac in mac["downloadUrl"] = value }
        #expect(throws: PublicUpdateFailure.unsafeLink) {
            try PublicUpdateClient.evaluate(data, installed: installed, architecture: "x86_64")
        }
    }

    @Test func HashBindingAndLandingQRValidation() throws {
        let installed = try PublicInstalledVersion(version: "0.1.0", build: "4")
        for pair in [("downloadUrl", "files/\(String(repeating: "b", count: 64))-Mac.dmg"),
            ("downloadUrl", "files/\(updateTestSHA)-Mac..dmg"),
            ("downloadUrl", "files/\(updateTestSHA)-Mac.dmg?download=1"),
            ("downloadUrl", "files/\(updateTestSHA)-Mac.dmg#x"),
            ("landingUrl", "https://www.weftmate.com/downloads/?platform=macos&key=x"),
            ("qrUrl", "https://evil.example/mac.svg")] {
            let data = try updateManifest { _, mac in mac[pair.0] = pair.1 }
            #expect(throws: PublicUpdateFailure.unsafeLink) {
                try PublicUpdateClient.evaluate(data, installed: installed, architecture: "x86_64")
            }
        }
    }

    @Test func publicSessionHasNoAccountStoresAndRequestsOnlyFixedManifest() async throws {
        let config = PublicURLSessionManifestFetcher.configuration()
        #expect(config.httpCookieStorage == nil && config.urlCredentialStorage == nil && config.urlCache == nil)
        #expect(!config.httpShouldSetCookies && config.httpCookieAcceptPolicy == .never)
        #expect(config.timeoutIntervalForRequest == 20 && config.timeoutIntervalForResource == 20)
        UpdateProtocolStore.shared.install(.init(body: try updateManifest()))
        let client = PublicUpdateClient(fetcher: isolatedFetcher())
        _ = try await client.check(installed: PublicInstalledVersion(version: "0.1.0", build: "4"))
        let requests = UpdateProtocolStore.shared.requests()
        #expect(requests.count == 1)
        let request = try #require(requests.first)
        #expect(request.url == PublicUpdateClient.manifestURL && request.httpMethod == "GET")
        #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(request.httpBody == nil && !request.httpShouldHandleCookies)
    }

    @Test func boundedResponseRejectsDeclaredAndStreamingOversize() async throws {
        let installed = try PublicInstalledVersion(version: "0.1.0", build: "4")
        for fixture in [UpdateProtocolFixture(body: Data(), declaredLength: 65_537),
            UpdateProtocolFixture(body: Data(repeating: 32, count: 65_537))] {
            UpdateProtocolStore.shared.install(fixture)
            await #expect(throws: PublicUpdateFailure.responseTooLarge) {
                try await PublicUpdateClient(fetcher: isolatedFetcher()).check(installed: installed)
            }
        }
        #expect(throws: PublicUpdateFailure.responseTooLarge) {
            try PublicUpdateClient.evaluate(Data(repeating: 32, count: 65_537), installed: installed, architecture: "x86_64")
        }
    }

    @Test func HTTPRedirectAndWrongResponseOriginNeverYieldSuccess() async throws {
        let installed = try PublicInstalledVersion(version: "0.1.0", build: "4")
        for (fixture, expected) in [
            (UpdateProtocolFixture(body: Data(), status: 302), PublicUpdateFailure.redirect),
            (UpdateProtocolFixture(body: Data(), status: 503), PublicUpdateFailure.httpStatus(503)),
            (UpdateProtocolFixture(body: try updateManifest(), responseURL: URL(string: "https://evil.example/releases.json")!), PublicUpdateFailure.unsafeLink),
            (UpdateProtocolFixture(body: Data(), errorCode: .timedOut), PublicUpdateFailure.timeout),
            (UpdateProtocolFixture(body: Data(), errorCode: .serverCertificateUntrusted), PublicUpdateFailure.certificate)
        ] {
            UpdateProtocolStore.shared.install(fixture)
            await #expect(throws: expected) {
                try await PublicUpdateClient(fetcher: isolatedFetcher()).check(installed: installed)
            }
        }
    }

    @Test func cancelledLateReplyCannotPublishSuccess() async throws {
        let fetcher = PausedPublicFetcher(data: try updateManifest())
        let client = PublicUpdateClient(fetcher: fetcher)
        let installed = try PublicInstalledVersion(version: "0.1.0", build: "4")
        let operation = Task { try await client.check(installed: installed) }
        await fetcher.waitUntilPaused()
        operation.cancel()
        await fetcher.release()
        await #expect(throws: PublicUpdateFailure.cancelled) { try await operation.value }
    }
}

private actor PausedPublicFetcher: PublicManifestFetching {
    let data: Data
    private var continuation: CheckedContinuation<Void, Never>?
    init(data: Data) { self.data = data }
    func fetchManifest() async -> Data {
        await withCheckedContinuation { continuation = $0 }
        return data
    }
    func waitUntilPaused() async { while continuation == nil { await Task.yield() } }
    func release() { continuation?.resume(); continuation = nil }
}

private struct UpdateProtocolFixture: Sendable {
    let body: Data
    var status: Int = 200
    var declaredLength: Int? = nil
    var responseURL: URL = PublicUpdateClient.manifestURL
    var errorCode: URLError.Code? = nil
}
private final class UpdateProtocolStore: @unchecked Sendable {
    static let shared = UpdateProtocolStore()
    private let lock = NSLock()
    private var fixture = UpdateProtocolFixture(body: Data())
    private var seen: [URLRequest] = []
    func install(_ fixture: UpdateProtocolFixture) { lock.withLock { self.fixture = fixture; seen = [] } }
    func record(_ request: URLRequest) -> UpdateProtocolFixture { lock.withLock { seen.append(request); return fixture } }
    func requests() -> [URLRequest] { lock.withLock { seen } }
}
private final class IsolatedUpdateURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let fixture = UpdateProtocolStore.shared.record(request)
        if let errorCode = fixture.errorCode {
            client?.urlProtocol(self, didFailWithError: URLError(errorCode)); return
        }
        var headers = ["Content-Type": "application/json"]
        if let length = fixture.declaredLength { headers["Content-Length"] = String(length) }
        let response = HTTPURLResponse(url: fixture.responseURL, statusCode: fixture.status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: fixture.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
private func isolatedFetcher() -> PublicURLSessionManifestFetcher {
    PublicURLSessionManifestFetcher {
        let config = PublicURLSessionManifestFetcher.configuration()
        config.protocolClasses = [IsolatedUpdateURLProtocol.self]
        return config
    }
}
