import Foundation
import CryptoKit
import Testing
@testable import WeftMateCore

@Test func upd2VersionOrderAndPrereleases() throws {
    for (old, new) in [("0.9.0", "0.10.0"), ("1.0.0-beta.2", "1.0.0-beta.10"), ("1.0.0-beta", "1.0.0"), ("1.0.0-alpha", "1.0.0-beta"), ("1.0.0", "999999999999999999999.0.0")] {
        #expect(try #require(NativeVersion(old)) < #require(NativeVersion(new)))
    }
    #expect(NativeVersion("1.2.0") == NativeVersion("1.02.0"))
    #expect(NativeVersion("1.0") == nil)
    #expect(NativeVersion("1.0.0-a..b") == nil)
}
@Test func upd2BuildComparisonUsesNumericOrderAndVersionFirst() throws {
    let release = NativeMacRelease(version: "0.2.0", build: "0012", downloadPage: URL(string: "https://example.com")!)
    #expect(try release.isNewer(than: "0.2.0", build: "11"))
    #expect(try !release.isNewer(than: "0.2.0", build: "12"))
    #expect(try !release.isNewer(than: "0.2.0", build: "13"))
    #expect(try release.isNewer(than: "0.1.0", build: "999"))
    #expect(try !release.isNewer(than: "0.3.0", build: "1"))
}
@Test func upd2MinimumCompatibilityAndPhoneCopy() {
    #expect(NativeCompatibility.notice(installed: "0.1.0", minimum: nil, platform: .iOS) == nil)
    #expect(NativeCompatibility.notice(installed: "0.2.0", minimum: "0.2.0", platform: .iOS) == nil)
    #expect(NativeCompatibility.notice(installed: "0.1.0", minimum: "0.2.0", platform: .iOS)?.contains("有新版本可在 TestFlight 更新") == true)
    #expect(NativeCompatibility.notice(installed: "unknown", minimum: "0.2.0", platform: .macOS) != nil)
}
@Test func upd2UnconfiguredSourceAndUnsafeConfig() async throws {
    #expect(try NativeUpdateConfiguration(feed: "", publicKey: "").statusText == "未配置更新源")
    #expect(throws: NativeUpdateFailure.invalidConfiguration) { try NativeUpdateConfiguration(feed: "http://example.com/feed", publicKey: nil) }
    #expect(throws: NativeUpdateFailure.invalidConfiguration) { try NativeUpdateConfiguration(feed: "https://secret@example.com/feed", publicKey: nil) }
    await #expect(throws: NativeUpdateFailure.unconfigured) { () async throws in _ = try await NativeUpdateFetcher().fetch(NativeUpdateConfiguration(feed: nil, publicKey: nil)) }
}
private func upd2SignedFixture(key: Curve25519.Signing.PrivateKey, changes: [String: Any] = [:]) throws -> Data {
    var value: [String: Any] = ["schemaVersion": 1, "layer": "app", "channel": "stable", "version": "0.2.0", "nativePlatform": "macOS", "nativeBuild": "12", "downloadPage": "https://example.com/downloads/mac", "publishedAt": "2026-10-08T00:00:00Z", "files": [["path": "app.dmg", "size": 123, "sha256": String(repeating: "a", count: 64)]]]
    value.merge(changes) { _, new in new }
    let raw = key.publicKey.rawRepresentation
    let der = Data([0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00]) + raw
    value["signature"] = ["algorithm": "Ed25519", "keyId": String(SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined().prefix(32)), "value": try key.signature(for: SignedNativeUpdate.canonical(value)).base64EncodedString()]
    return try JSONSerialization.data(withJSONObject: value)
}
@Test func upd2SignatureAndTamperingRejection() throws {
    let key = Curve25519.Signing.PrivateKey()
    let config = try NativeUpdateConfiguration(feed: "https://example.com/feed", publicKey: key.publicKey.rawRepresentation.base64EncodedString())
    let data = try upd2SignedFixture(key: key)
    #expect(try SignedNativeUpdate.evaluate(data, configuration: config).version == "0.2.0")
    var tampered = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    tampered["downloadPage"] = "https://example.com/tampered"
    #expect(throws: NativeUpdateFailure.signature) { try SignedNativeUpdate.evaluate(JSONSerialization.data(withJSONObject: tampered), configuration: config) }
    let wrong = try NativeUpdateConfiguration(feed: "https://example.com/feed", publicKey: Curve25519.Signing.PrivateKey().publicKey.rawRepresentation.base64EncodedString())
    #expect(throws: NativeUpdateFailure.signature) { try SignedNativeUpdate.evaluate(data, configuration: wrong) }
    tampered.removeValue(forKey: "signature")
    #expect(throws: NativeUpdateFailure.signature) { try SignedNativeUpdate.evaluate(JSONSerialization.data(withJSONObject: tampered), configuration: config) }
}
@Test func upd2SignedChannelPlatformExpiryAndURLRejection() throws {
    let key = Curve25519.Signing.PrivateKey()
    let config = try NativeUpdateConfiguration(feed: "https://example.com/feed", publicKey: key.publicKey.rawRepresentation.base64EncodedString())
    for changes: [String: Any] in [["channel": "preview"], ["nativePlatform": "iOS"], ["downloadPage": "javascript:bad"], ["expiresAt": "2020-01-01T00:00:00Z"]] {
        #expect(throws: NativeUpdateFailure.manifest) { try SignedNativeUpdate.evaluate(upd2SignedFixture(key: key, changes: changes), configuration: config) }
    }
}
@Test func upd2CanonicalMatchesUPD1UTF16AndEscaping() throws {
    let object: [String: Any] = ["\u{e000}": 2, "😀": 1, "a": [true, NSNull(), "https://example.com/\n中文"], "z": 123]
    #expect(String(data: try SignedNativeUpdate.canonical(object), encoding: .utf8) == "{\"a\":[true,null,\"https://example.com/\\n中文\"],\"z\":123,\"😀\":1,\"\u{e000}\":2}")
}

private actor UPD2Transport: HTTPTransport {
    var minimum: String?
    var commands = 0
    init(minimum: String?) { self.minimum = minimum }
    func setMinimum(_ value: String) { minimum = value }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let body: [String: Any]
        if request.url!.path.hasSuffix("/status") {
            body = ["ownerId": "owner", "hostId": "host", "nativeMinimumVersions": minimum.map { ["iOS": $0] } ?? [:]]
        } else if request.url!.path.contains("/auth/") {
            body = ["account": ["ownerId": "owner", "username": "synthetic", "displayName": "合成"], "device": ["id": "device", "name": "iPhone"], "csrfToken": String(repeating: "b", count: 43)]
        } else { commands += 1; body = ["items": []] }
        return HTTPResponse(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)], body: try JSONSerialization.data(withJSONObject: body))
    }
}
private final class UPD2Credentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock(); private var values: [String: Data] = [:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ value: Data, key: String) { lock.withLock { values[key] = value } }
    func delete(key: String) { lock.withLock { values[key] = nil } }
}
@Test func upd2IncompatibleHostCannotConnectOrPersistSession() async throws {
    let http = UPD2Transport(minimum: "0.2.0")
    let client = PersonalClient(credentialStore: UPD2Credentials(), transport: http, platform: .iOS, nativeVersion: "0.1.0")
    do {
        _ = try await client.login(server: ServerConfiguration(input: "https://example.com"), username: "synthetic", password: "synthetic-password", deviceName: "iPhone")
        Issue.record("Incompatible login succeeded")
    } catch let failure as APIFailure { #expect(failure.safeCode == "NATIVE_UPDATE_REQUIRED") }
    #expect(await client.currentSession() == nil)
    #expect(await http.commands == 0)
}
@Test func upd2RequirementChangeBlocksSubsequentHostOperations() async throws {
    let http = UPD2Transport(minimum: nil)
    let client = PersonalClient(credentialStore: UPD2Credentials(), transport: http, platform: .iOS, nativeVersion: "0.1.0")
    _ = try await client.login(server: ServerConfiguration(input: "https://example.com"), username: "synthetic", password: "synthetic-password", deviceName: "iPhone")
    await http.setMinimum("0.2.0")
    #expect(try await client.nativeUpdateStatus().minimum(for: .iOS) == "0.2.0")
    do { _ = try await client.settingsSchedules(); Issue.record("Incompatible operation succeeded") }
    catch let failure as APIFailure { #expect(failure.safeCode == "NATIVE_UPDATE_REQUIRED") }
    #expect(await http.commands == 0)
    await http.setMinimum("0.1.0")
    #expect(try await client.nativeUpdateStatus().minimum(for: .iOS) == "0.1.0")
    #expect(try await client.settingsSchedules().items.isEmpty)
    #expect(await http.commands == 1)
}
@Test func upd2OldHostAndOtherPlatformMinimumRemainCompatible() throws {
    let status = try JSONDecoder().decode(NativeHostStatus.self, from: Data(#"{"ownerId":"owner","hostId":"host","nativeMinimumVersions":{"Android":"0.9.0"}}"#.utf8))
    #expect(status.updates == nil)
    #expect(status.minimum(for: .iOS) == nil)
}
