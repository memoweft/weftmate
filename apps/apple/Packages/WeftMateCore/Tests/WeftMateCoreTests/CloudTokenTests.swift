import Foundation
import Testing
import Security
import JOSESwift
@testable import WeftMateCore

private final class RSAFixture: @unchecked Sendable {
    let key: SecKey
    let jwk: RSAPublicKey
    init() throws {
        key = SecKeyCreateRandomKey([kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeySizeInBits: 2048] as CFDictionary, nil)!
        jwk = try RSAPublicKey(publicKey: SecKeyCopyPublicKey(key)!, additionalParameters: ["kid": "fixture", "alg": "RS256", "use": "sig"])
    }
    func token(_ payload: [String: Any], type: String? = nil, kid: String = "fixture") throws -> String {
        var header = JWSHeader(algorithm: .RS256); header.kid = kid; header.typ = type
        return try JWS(header: header, payload: Payload(JSONSerialization.data(withJSONObject: payload)), signer: Signer(signatureAlgorithm: .RS256, key: key)!).compactSerializedString
    }
}
private actor TokenFixture: HTTPTransport {
    let rsa: RSAFixture
    let configuration: CloudConfiguration
    var nonce: String = ""
    let fault: String?
    var refreshes = 0
    var requests: [URLRequest] = []
    let thumbprint: String
    init(rsa: RSAFixture, configuration: CloudConfiguration, fault: String? = nil, thumbprint: String) {
        self.rsa = rsa; self.configuration = configuration; self.fault = fault; self.thumbprint = thumbprint
    }
    func setNonce(_ value: String) { nonce = value }
    func send(_ request: URLRequest) throws -> HTTPResponse {
        requests.append(request)
        func reply(_ fields: [String: Any]) throws -> HTTPResponse { .init(status: 200, body: try JSONSerialization.data(withJSONObject: fields)) }
        if request.url!.path.hasSuffix("openid-configuration") {
            return try reply(["issuer": configuration.issuer, "authorization_endpoint": configuration.issuer + "/auth", "token_endpoint": configuration.issuer + "/token", "jwks_uri": configuration.issuer + "/jwks"])
        }
        if request.url!.path.hasSuffix("jwks") { return try reply(["keys": [rsa.jwk.parameters]]) }
        if request.url!.path.hasSuffix("discover") { return try reply(["hostId": "host-one", "baseUrl": "https://host.example.com", "status": "online"]) }
        let form = URLComponents(string: "http://fixture/?" + String(data: request.httpBody!, encoding: .utf8)!)!.queryItems!
        let refreshing = form.first { $0.name == "grant_type" }?.value == "refresh_token"
        let host = form.first { $0.name == "resource" }?.value?.contains("/hosts/") == true
        var payload: [String: Any] = ["iss": configuration.issuer, "sub": "subject-one", "aud": host ? configuration.audience + "/hosts/host-one" : configuration.audience,
            "iat": Date().timeIntervalSince1970, "exp": Date().timeIntervalSince1970 + 300, "scope": host ? "host:session" : "cloud:account"]
        if fault == "audience" { payload["aud"] = "https://another.example.com" }
        if fault == "issuer" { payload["iss"] = "https://another.example.com/oidc" }
        if fault == "expired" { payload["exp"] = 1 }
        if host { payload["host_id"] = "host-one"; payload["cnf"] = ["jkt": thumbprint] }
        var id = payload; id["aud"] = configuration.clientID; id["nonce"] = fault == "nonce" ? "wrong" : nonce
        if refreshing { refreshes += 1 }
        return try reply(["access_token": rsa.token(payload, type: "at+jwt", kid: fault == "kid" ? "unknown" : "fixture"),
            "id_token": rsa.token(id), "token_type": host ? "DPoP" : "Bearer", "refresh_token": "rotated-\(refreshes)"])
    }
    func recorded() -> [URLRequest] { requests }
}

@Suite struct CloudTokenTests {
    @Test(arguments: ["nonce", "issuer", "audience", "expired", "kid"])
    @MainActor func invalidSignedTokensCannotPersist(fault: String) async throws {
        let key = try CloudDeviceKey(softwareStore: MemoryStore()), store = MemoryStore()
        let config = CloudConfiguration(server: try ServerConfiguration(input: "https://cloud.example.com"))
        let fixture = TokenFixture(rsa: try RSAFixture(), configuration: config, fault: fault, thumbprint: key.thumbprint)
        let client = CloudAccountClient(configuration: config, key: key, store: store, transport: fixture)
        await #expect(throws: (any Error).self) {
            try await client.authorize(hostID: "host-one") { flow, _ in
                await fixture.setNonce(flow.nonce)
                return URL(string: config.redirectURI + "?state=\(flow.state)&code=synthetic")!
            }
        }
        #expect(store.count == 0)
    }
    @Test @MainActor func rotatedRefreshSurvivesRestartAndDirectoryCannotSupplyPin() async throws {
        let key = try CloudDeviceKey(softwareStore: MemoryStore()), store = MemoryStore()
        let config = CloudConfiguration(server: try ServerConfiguration(input: "https://cloud.example.com"))
        let fixture = TokenFixture(rsa: try RSAFixture(), configuration: config, thumbprint: key.thumbprint)
        let client = CloudAccountClient(configuration: config, key: key, store: store, transport: fixture)
        try await client.authorize(hostID: "host-one") { flow, _ in
            await fixture.setNonce(flow.nonce)
            return URL(string: config.redirectURI + "?state=\(flow.state)&code=synthetic")!
        }
        _ = try await client.accessToken(hostID: "host-one")
        let reopened = CloudAccountClient(configuration: config, key: key, store: store, transport: fixture)
        #expect(try await reopened.hasSavedSession(hostID: "host-one"))
        _ = try await reopened.accessToken(hostID: "host-one")
        #expect(try await reopened.relay(hostID: "host-one").originString == "https://host.example.com")
        let requests = await fixture.recorded()
        let refresh = requests.filter { String(data: $0.httpBody ?? Data(), encoding: .utf8)?.contains("refresh_token") == true }
        #expect(String(data: refresh[1].httpBody!, encoding: .utf8)!.contains("rotated-1"))
        #expect(refresh[0].value(forHTTPHeaderField: "DPoP") != nil)
        #expect(try HostPinStore(store: store).pin(for: "https://host.example.com") == nil)
        try await reopened.forget(); #expect(store.count == 0)
    }
}
