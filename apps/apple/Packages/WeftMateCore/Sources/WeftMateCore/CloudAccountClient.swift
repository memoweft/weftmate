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
    private var rotating = false
    private var rotationWaiters: [CheckedContinuation<Void, Never>] = []
    private struct Saved: Codable { let refresh: String; let subject: String; let hostID: String?; var appGrant: Bool? = nil }
    private struct Tokens: Decodable {
        let access_token: String; let token_type: String; let refresh_token: String?; let id_token: String?
    }
    private var flow: CloudAuthorization?
    private var interaction: [String: String] = [:]
    private var cookies: [HTTPCookie] = []
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
        generation &+= 1; flow = nil; cookies = []; interaction = [:]; saved = nil; control = nil; hostToken = nil; hostExpiry = 0
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
    public var deviceID: String { "apple-" + key.thumbprint }
    public func savedSubject() throws -> String? {
        if saved == nil, let bytes = try store.load(key: storageKey) { saved = try JSONDecoder().decode(Saved.self, from: bytes) }
        return saved?.appGrant == true ? saved?.subject : nil
    }
    /// Transport identity references stay separated by issuer/client and verified account subject.
    public func savedHostReference(hostID: String) throws -> [String: String]? {
        guard let subject = try savedSubject(), let bytes = try store.load(key: storageKey + ".hosts." + subject) else { return nil }
        return try JSONDecoder().decode([String: [String: String]].self, from: bytes)[hostID]
    }
    public func rememberHost(hostID: String, reference: [String: String]) throws {
        guard let subject = try savedSubject() else { throw APIFailure.notAuthenticated }
        let metadataKey = storageKey + ".hosts." + subject
        var refs: [String: [String: String]] = [:]
        if let bytes = try store.load(key: metadataKey) { refs = try JSONDecoder().decode([String: [String: String]].self, from: bytes) }
        refs[hostID] = reference
        try store.save(JSONEncoder().encode(refs), key: metadataKey)
    }
    public func beginAppLogin() async throws {
        let discovery = try await send(url: URL(string: configuration.issuer + "/.well-known/openid-configuration")!)
        let metadata = try object(discovery.body)
        guard metadata["issuer"] as? String == configuration.issuer,
              metadata["token_endpoint"] as? String == configuration.issuer + "/token",
              metadata["jwks_uri"] as? String == configuration.issuer + "/jwks" else { throw CloudLoginFailure.token }
        cookies = []; interaction = [:]
        let next = try CloudAuthorization(configuration: configuration)
        flow = next
        let response = try await appJSON("/auth/authorization", body: ["clientId": configuration.clientID,
            "redirectUri": configuration.redirectURI, "deviceId": deviceID, "publicJwk": key.publicJwk,
            "codeChallenge": cloudBase64(Data(SHA256.hash(data: Data(next.verifier.utf8)))), "state": next.state, "nonce": next.nonce])
        let fields = try object(response.body)
        guard fields["appLogin"] as? Bool == true, fields["deviceId"] as? String == deviceID,
              let uid = fields["interactionUid"] as? String, let csrf = fields["csrfToken"] as? String else { throw CloudLoginFailure.token }
        interaction = ["interactionUid": uid, "csrfToken": csrf]
    }
    public func appLogin(email: String, password: String, name: String, type: String) async throws -> AppLoginReply {
        guard flow != nil, !interaction.isEmpty else { throw CloudLoginFailure.callback }
        var body: [String: Any] = interaction
        body.merge(["email": email, "password": password, "deviceId": deviceID, "publicJwk": key.publicJwk,
                    "deviceName": cloudDeviceName(name), "deviceType": type]) { _, value in value }
        return try JSONDecoder().decode(AppLoginReply.self, from: await appJSON("/auth/login", body: body).body)
    }
    public func confirmAppDevice(challenge: String, code: String) async throws -> AppLoginReply {
        var body = interaction; body["challengeId"] = challenge; body["code"] = code
        return try JSONDecoder().decode(AppLoginReply.self, from: await appJSON("/auth/device/confirm", body: body).body)
    }
    public func finishAppLogin(resumeURL: String) async throws {
        guard let flow else { throw CloudLoginFailure.callback }
        let epoch = generation
        guard let resume = URLComponents(string: resumeURL), let issuer = URLComponents(string: configuration.issuer),
              resume.scheme == issuer.scheme, resume.host == issuer.host, resume.port == issuer.port,
              resume.user == nil, resume.password == nil, resume.query == nil, resume.fragment == nil,
              resume.path.hasPrefix(issuer.path + "/auth/") else { throw CloudLoginFailure.callback }
        let response = try await appJSON("/auth/authorization/resume", body: ["resumeUrl": resumeURL],
            providerCookiePath: resume.path)
        guard let raw = try object(response.body)["callbackUrl"] as? String, let callback = URL(string: raw) else { throw CloudLoginFailure.callback }
        let code = try flow.code(from: callback)
        let tokens = try await token(["grant_type": "authorization_code", "client_id": configuration.clientID,
            "redirect_uri": configuration.redirectURI, "code": code, "code_verifier": flow.verifier, "resource": configuration.audience])
        try check(epoch)
        guard let idToken = tokens.id_token, let refresh = tokens.refresh_token else { throw CloudLoginFailure.token }
        let id = try await claims(idToken, audience: configuration.clientID, type: nil)
        let access = try await claims(tokens.access_token, audience: configuration.audience, type: "at+jwt")
        try check(epoch)
        guard id["nonce"] as? String == flow.nonce, let subject = id["sub"] as? String,
              access["sub"] as? String == subject, tokens.token_type.lowercased() == "dpop",
              (access["cnf"] as? [String: String])?["jkt"] == key.thumbprint else { throw CloudLoginFailure.token }
        let next = Saved(refresh: refresh, subject: subject, hostID: nil, appGrant: true)
        try store.save(JSONEncoder().encode(next), key: storageKey)
        saved = next; control = tokens.access_token; controlExpiry = access["exp"] as? Double ?? 0
        hostToken = nil; hostExpiry = 0; self.flow = nil; interaction = [:]; cookies = []
    }
    public func requestEmail(email: String, recovery: Bool) async throws -> String {
        let response = try await appJSON("/auth/\(recovery ? "recovery" : "registration")/request", body: ["email": email])
        guard let challenge = try object(response.body)["challengeId"] as? String else { throw APIFailure.invalidResponse }
        return challenge
    }
    public func verifyEmail(challenge: String, code: String, recovery: Bool) async throws -> String {
        let response = try await appJSON("/auth/\(recovery ? "recovery" : "registration")/verify", body: ["challengeId": challenge, "code": code])
        guard let ticket = try object(response.body)["passwordTicket"] as? String else { throw APIFailure.invalidResponse }
        return ticket
    }
    public func completeEmail(ticket: String, password: String, recovery: Bool) async throws {
        _ = try await appJSON("/auth/\(recovery ? "recovery" : "registration")/complete", body: ["passwordTicket": ticket, "password": password])
    }
    public func offlineStatus(hostID: String) async throws -> OfflineAuthorization {
        let response = try await appJSON("/hosts/offline/status", body: ["hostId": hostID], authorized: true)
        return try JSONDecoder().decode(OfflineAuthorization.self, from: response.body)
    }
    public func directory() async throws -> CloudDirectory {
        try JSONDecoder().decode(CloudDirectory.self, from: await appJSON("/devices", body: nil, authorized: true).body)
    }
    public func accountEmail() async throws -> String {
        let response = try await appJSON("/account", body: nil, authorized: true)
        guard let email = (try object(response.body)["account"] as? [String: Any])?["email"] as? String else { throw APIFailure.invalidResponse }
        return email
    }
    public func connect(hostID: String) async throws -> CloudHostConnection {
        try JSONDecoder().decode(CloudHostConnection.self, from: await appJSON("/hosts/connect", body: ["hostId": hostID], authorized: true).body)
    }
    public func changePassword(current: String, password: String) async throws {
        _ = try await appJSON("/auth/password/change", body: ["currentPassword": current, "password": password], authorized: true)
    }
    public func requestEmailChange(email: String) async throws -> String {
        let response = try await appJSON("/auth/email/change/request", body: ["email": email], authorized: true)
        guard let challenge = try object(response.body)["challengeId"] as? String else { throw APIFailure.invalidResponse }
        return challenge
    }
    public func confirmEmailChange(challenge: String, code: String) async throws -> String {
        let response = try await appJSON("/auth/email/change/confirm", body: ["challengeId": challenge, "code": code], authorized: true)
        guard let email = (try object(response.body)["account"] as? [String: Any])?["email"] as? String else { throw APIFailure.invalidResponse }
        return email
    }
    public func logoutOthers() async throws {
        _ = try await appJSON("/auth/logout/others", body: [:], authorized: true)
    }
    public func renameDevice(id: String, name: String) async throws {
        _ = try await appJSON("/devices/rename", body: ["deviceId": id, "name": name], authorized: true)
    }
    public func revokeDevice(id: String) async throws {
        _ = try await appJSON("/auth/devices/revoke", body: ["deviceId": id], authorized: true)
    }
    public func deleteAccount(password: String) async throws {
        _ = try await appJSON("/auth/account/delete", body: ["password": password], authorized: true)
    }
    public func logout() async throws {
        defer { try? forget() }
        _ = try await appJSON("/auth/logout", body: [:], authorized: true)
    }
    private func appJSON(_ path: String, body: [String: Any]?, authorized: Bool = false, providerCookiePath: String? = nil) async throws -> HTTPResponse {
        let epoch = generation
        let url = URL(string: configuration.audience + path)!
        var request = URLRequest(url: url); request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue(configuration.server.originString, forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if authorized {
            if control == nil || controlExpiry <= Date().timeIntervalSince1970 + 30 {
                control = try await refresh(resource: configuration.audience, hostID: nil, epoch: epoch)
            }
            request.setValue("DPoP " + control!, forHTTPHeaderField: "Authorization")
            request.setValue(try key.proof(url: url, method: request.httpMethod!, accessToken: control), forHTTPHeaderField: "DPoP")
        } else {
            let matching = cookies.filter {
                (url.path.hasPrefix($0.path) || (providerCookiePath?.hasPrefix($0.path) == true)) && ($0.expiresDate ?? .distantFuture) > Date()
            }
            for (header, value) in HTTPCookie.requestHeaderFields(with: matching) { request.setValue(value, forHTTPHeaderField: header) }
        }
        let response = try await transport.send(request); try check(epoch)
        if !authorized, let raw = response.headers.first(where: { $0.key.lowercased() == "set-cookie" })?.value {
            for cookie in HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": raw], for: url) {
                // The jar belongs solely to the fixed configured origin and lives for one interaction.
                cookies.removeAll { $0.name == cookie.name && $0.path == cookie.path }
                cookies.append(cookie)
            }
        }
        if !(200...299).contains(response.status) {
            let json = try? object(response.body)
            let code = (json?["error"] as? [String: String])?["code"] ?? json?["error"] as? String ?? "HTTP_\(response.status)"
            let retry = response.headers.first(where: { $0.key.lowercased() == "retry-after" }).flatMap { Int($0.value) }
            throw AppAccountError(code: code, status: response.status, retryAfter: retry)
        }
        return response
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
    private func acquireRotation() async {
        if rotating { await withCheckedContinuation { rotationWaiters.append($0) } }
        else { rotating = true }
    }
    private func releaseRotation() {
        if rotationWaiters.isEmpty { rotating = false }
        else { rotationWaiters.removeFirst().resume() }
    }
    private func refresh(resource: String, hostID: String?, epoch: UInt64) async throws -> String {
        // Foreground directory polling and a host exchange share one single-use refresh family.
        await acquireRotation(); defer { releaseRotation() }
        try check(epoch)
        if saved == nil, let bytes = try store.load(key: storageKey) { saved = try JSONDecoder().decode(Saved.self, from: bytes) }
        guard let saved, hostID == nil || saved.appGrant == true || saved.hostID == hostID else { throw APIFailure.notAuthenticated }
        let tokens = try await token(["grant_type": "refresh_token", "client_id": configuration.clientID,
            "refresh_token": saved.refresh, "resource": resource])
        // Cancellation may suppress the response's UI, but must still save an already consumed rotation.
        // A concurrent forget has cleared saved, so it must never resurrect this credential.
        guard self.saved?.refresh == saved.refresh else { throw APIFailure.accountChanged }
        guard let refresh = tokens.refresh_token else { throw CloudLoginFailure.token }
        let next = Saved(refresh: refresh, subject: saved.subject, hostID: hostID ?? saved.hostID, appGrant: saved.appGrant)
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
            guard tokens.token_type.lowercased() == (saved.appGrant == true ? "dpop" : "bearer"),
                   (payload["scope"] as? String)?.split(separator: " ").contains("cloud:account") == true else { throw CloudLoginFailure.token }
            if saved.appGrant == true {
                guard (payload["cnf"] as? [String: String])?["jkt"] == key.thumbprint else { throw CloudLoginFailure.token }
            }
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
        if flow != nil || saved?.appGrant == true || fields["resource"] != configuration.audience { request.setValue(try key.proof(url: url), forHTTPHeaderField: "DPoP") }
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
