import Foundation
import Security
import CryptoKit
import JOSESwift

public actor CloudAccountClient {
    private let configuration: CloudConfiguration
    private let transport: any HTTPTransport
    private let store: any CredentialStore
    private let key: CloudDeviceKey
    private var jwks: [[String: String]] = []
    private var generation: UInt64 = 0
    private var busy = false
    private struct Saved: Codable { let refresh: String; let subject: String; let hostID: String? }
    private struct Tokens: Decodable {
        let access_token: String; let token_type: String; let refresh_token: String?; let id_token: String?
    }
    private var saved: Saved?
    private var control: String?
    private var controlExpiry: Double = 0
    private var hostToken: String?
    private var hostExpiry: Double = 0
    public nonisolated static func credentialKey(configuration: CloudConfiguration) -> String {
        "cloud." + cloudBase64(Data(SHA256.hash(data: Data((configuration.issuer + configuration.clientID).utf8))))
    }
    private var storageKey: String { Self.credentialKey(configuration: configuration) }
    public init(configuration: CloudConfiguration, key: CloudDeviceKey,
                store: any CredentialStore = KeychainCredentialStore(service: "com.weftmate.apple.cloud"),
                transport: any HTTPTransport = URLSessionTransport()) {
        self.configuration = configuration; self.key = key; self.store = store; self.transport = transport
    }
    public func hasSavedSession(hostID: String) throws -> Bool {
        if saved == nil, let bytes = try store.load(key: storageKey) { saved = try JSONDecoder().decode(Saved.self, from: bytes) }
        return saved?.hostID == hostID
    }
    public func cancel() { generation &+= 1 }
    public func forget() throws {
        generation &+= 1; saved = nil; control = nil; hostToken = nil; hostExpiry = 0
        try store.delete(key: storageKey)
    }
    private func check(_ value: UInt64) throws {
        guard value == generation, !Task.isCancelled else { throw APIFailure.accountChanged }
    }
    public func authorize(hostID: String?, browser: @MainActor @Sendable (CloudAuthorization, [String: String]) async throws -> URL) async throws {
        guard !busy else { throw CloudLoginFailure.busy }
        busy = true; defer { busy = false }
        let epoch = generation
        let discovery = try await send(url: URL(string: configuration.issuer + "/.well-known/openid-configuration")!)
        try check(epoch)
        let metadata = try object(discovery.body)
        guard metadata["issuer"] as? String == configuration.issuer,
              metadata["authorization_endpoint"] as? String == configuration.issuer + "/auth",
              metadata["token_endpoint"] as? String == configuration.issuer + "/token",
              metadata["jwks_uri"] as? String == configuration.issuer + "/jwks" else { throw CloudLoginFailure.token }
        let flow = try CloudAuthorization(configuration: configuration, hostID: hostID, deviceID: "apple-" + key.thumbprint, publicJwk: key.publicJwk)
        let callback = try await browser(flow, key.publicJwk)
        try check(epoch)
        let code = try flow.code(from: callback)
        let tokens = try await token(["grant_type": "authorization_code", "client_id": configuration.clientID,
            "redirect_uri": configuration.redirectURI, "code": code, "code_verifier": flow.verifier, "resource": configuration.audience])
        try check(epoch)
        guard let idToken = tokens.id_token, let refresh = tokens.refresh_token else { throw CloudLoginFailure.token }
        let id = try await claims(idToken, audience: configuration.clientID, type: nil)
        try check(epoch)
        guard id["nonce"] as? String == flow.nonce, let subject = id["sub"] as? String else { throw CloudLoginFailure.token }
        let access = try await claims(tokens.access_token, audience: configuration.audience, type: "at+jwt")
        try check(epoch)
        guard access["sub"] as? String == subject, tokens.token_type.lowercased() == "bearer" else { throw CloudLoginFailure.token }
        let next = Saved(refresh: refresh, subject: subject, hostID: hostID)
        try store.save(JSONEncoder().encode(next), key: storageKey)
        saved = next; control = tokens.access_token; controlExpiry = access["exp"] as? Double ?? 0; hostToken = nil; hostExpiry = 0
    }
    public func relay(hostID: String) async throws -> ServerConfiguration {
        guard !busy else { throw CloudLoginFailure.busy }
        busy = true; defer { busy = false }
        let epoch = generation
        if control == nil || controlExpiry <= Date().timeIntervalSince1970 + 30 { control = try await refresh(resource: configuration.audience, hostID: nil, epoch: epoch) }
        let url = URL(string: configuration.audience + "/hosts/relay/discover")!
        var request = URLRequest(url: url); request.httpMethod = "POST"
        request.httpBody = try JSONEncoder().encode(["hostId": hostID])
        request.setValue("Bearer " + control!, forHTTPHeaderField: "Authorization")
        request.setValue(configuration.server.originString, forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let response = try await transport.send(request); try check(epoch)
        try accepted(response)
        let reply = try object(response.body)
        guard reply["hostId"] as? String == hostID, reply["status"] as? String == "online", let base = reply["baseUrl"] as? String else {
            throw CloudLoginFailure.hostOffline
        }
        return try ServerConfiguration(input: base)
    }
    public func accessToken(hostID: String) async throws -> String {
        guard !busy else { throw CloudLoginFailure.busy }
        if let hostToken, hostExpiry > Date().timeIntervalSince1970 + 30, saved?.hostID == hostID { return hostToken }
        busy = true; defer { busy = false }
        hostToken = try await refresh(resource: configuration.audience + "/hosts/" + hostID, hostID: hostID, epoch: generation)
        return hostToken!
    }
    private func refresh(resource: String, hostID: String?, epoch: UInt64) async throws -> String {
        if saved == nil, let bytes = try store.load(key: storageKey) { saved = try JSONDecoder().decode(Saved.self, from: bytes) }
        guard let saved, hostID == nil || saved.hostID == hostID else { throw APIFailure.notAuthenticated }
        let tokens = try await token(["grant_type": "refresh_token", "client_id": configuration.clientID,
            "refresh_token": saved.refresh, "resource": resource])
        // Cancellation may suppress the response's UI, but must still save an already consumed rotation.
        // A concurrent forget has cleared saved, so it must never resurrect this credential.
        guard self.saved?.refresh == saved.refresh else { throw APIFailure.accountChanged }
        guard let refresh = tokens.refresh_token else { throw CloudLoginFailure.token }
        let next = Saved(refresh: refresh, subject: saved.subject, hostID: saved.hostID)
        do { try store.save(JSONEncoder().encode(next), key: storageKey); self.saved = next }
        catch { self.saved = nil; try? store.delete(key: storageKey); throw APIFailure.credentialStorage }
        try check(epoch)
        let payload = try await claims(tokens.access_token, audience: resource, type: "at+jwt"); try check(epoch)
        guard payload["sub"] as? String == saved.subject else { throw CloudLoginFailure.token }
        if let hostID {
            guard tokens.token_type.lowercased() == "dpop", payload["host_id"] as? String == hostID,
                  (payload["cnf"] as? [String: String])?["jkt"] == key.thumbprint,
                  (payload["scope"] as? String)?.split(separator: " ").contains("host:session") == true else { throw CloudLoginFailure.token }
            hostExpiry = payload["exp"] as? Double ?? 0
        } else {
            guard tokens.token_type.lowercased() == "bearer", (payload["scope"] as? String)?.split(separator: " ").contains("cloud:account") == true else { throw CloudLoginFailure.token }
            controlExpiry = payload["exp"] as? Double ?? 0
        }
        return tokens.access_token
    }
    private func token(_ fields: [String: String]) async throws -> Tokens {
        let url = URL(string: configuration.issuer + "/token")!
        var request = URLRequest(url: url); request.httpMethod = "POST"
        var parts = URLComponents(); parts.queryItems = fields.map { URLQueryItem(name: $0.key, value: $0.value) }
        // URLComponents encodes spaces; '+' needs escaping for application/x-www-form-urlencoded.
        request.httpBody = Data(parts.percentEncodedQuery!.replacingOccurrences(of: "+", with: "%2B").utf8)
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        if fields["resource"] != configuration.audience { request.setValue(try key.proof(url: url), forHTTPHeaderField: "DPoP") }
        var response = try await transport.send(request)
        if response.status == 400, let nonce = response.headers.first(where: { $0.key.lowercased() == "dpop-nonce" })?.value,
           (try? object(response.body)["error"] as? String) == "use_dpop_nonce" {
            request.setValue(try key.proof(url: url, nonce: nonce), forHTTPHeaderField: "DPoP")
            response = try await transport.send(request)
        }
        try accepted(response)
        return try JSONDecoder().decode(Tokens.self, from: response.body)
    }
    private func claims(_ raw: String, audience: String, type: String?) async throws -> [String: Any] {
        let jws = try JWS(compactSerialization: raw)
        guard jws.header.algorithm == .RS256, let kid = jws.header.kid, jws.header.jku == nil,
              jws.header.x5u == nil, jws.header.crit == nil,
              type == nil || jws.header.typ == type else { throw CloudLoginFailure.token }
        if !jwks.contains(where: { $0["kid"] == kid }) {
            let response = try await send(url: URL(string: configuration.issuer + "/jwks")!)
            jwks = (try object(response.body)["keys"] as? [[String: String]]) ?? []
        }
        guard let jwk = jwks.first(where: { $0["kid"] == kid && $0["kty"] == "RSA" && $0["alg"] == "RS256" && $0["use"] == "sig" }) else { throw CloudLoginFailure.token }
        let publicKey = try RSAPublicKey(data: JSONSerialization.data(withJSONObject: jwk)).converted(to: SecKey.self)
        guard let verifier = Verifier(signatureAlgorithm: .RS256, key: publicKey) else { throw CloudLoginFailure.token }
        let verified = try object(jws.validate(using: verifier).payload.data())
        let now = Date().timeIntervalSince1970
        let audiences = verified["aud"] as? [String] ?? (verified["aud"] as? String).map { [$0] } ?? []
        let authorizedParty = verified["azp"] as? String
        let validAudience = audiences.count == 1 || authorizedParty == configuration.clientID
        guard verified["iss"] as? String == configuration.issuer, audiences.contains(audience),
              validAudience,
              let exp = verified["exp"] as? Double, exp > now,
              let iat = verified["iat"] as? Double, iat <= now + 60,
              (verified["nbf"] as? Double ?? 0) <= now + 60,
              let subject = verified["sub"] as? String, !subject.isEmpty else { throw CloudLoginFailure.token }
        return verified
    }
    private func object(_ data: Data) throws -> [String: Any] {
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw APIFailure.invalidResponse }
        return result
    }
    private func send(url: URL) async throws -> HTTPResponse {
        let response = try await transport.send(URLRequest(url: url)); try accepted(response); return response
    }
    private func accepted(_ response: HTTPResponse) throws {
        guard (200...299).contains(response.status) else {
            let json = try? object(response.body)
            let code = (json?["error"] as? [String: String])?["code"] ?? json?["error"] as? String ?? "HTTP_\(response.status)"
            // Never show provider descriptions (may contain URL, token or account details).
            throw APIFailure.server(status: response.status, code: code)
        }
    }
}
