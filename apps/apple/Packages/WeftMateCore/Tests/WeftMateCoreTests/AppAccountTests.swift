import Foundation
import Testing
import Security
import JOSESwift
@testable import WeftMateCore

private actor NativeAccountTransport: HTTPTransport {
    let configuration: CloudConfiguration
    let thumbprint: String
    let privateKey: SecKey
    let jwk: RSAPublicKey
    let fault: String?
    let subject: String
    var requests: [URLRequest] = []
    var nonce = ""
    var state = ""
    var rotation = 0
    init(configuration: CloudConfiguration, thumbprint: String, fault: String? = nil, subject: String = "synthetic-sub") throws {
        self.configuration = configuration; self.thumbprint = thumbprint; self.fault = fault; self.subject = subject
        privateKey = SecKeyCreateRandomKey([kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeySizeInBits: 2048] as CFDictionary, nil)!
        jwk = try RSAPublicKey(publicKey: SecKeyCopyPublicKey(privateKey)!, additionalParameters: ["kid": "native", "alg": "RS256", "use": "sig"])
    }
    func token(_ payload: [String: Any], type: String? = nil) throws -> String {
        var header = JWSHeader(algorithm: .RS256); header.kid = "native"; header.typ = type
        return try JWS(header: header, payload: Payload(JSONSerialization.data(withJSONObject: payload)), signer: Signer(signatureAlgorithm: .RS256, key: privateKey)!).compactSerializedString
    }
    func send(_ request: URLRequest) throws -> HTTPResponse {
        requests.append(request)
        func reply(_ body: [String: Any], headers: [String: String] = [:], status: Int = 200) throws -> HTTPResponse {
            .init(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: body))
        }
        let path = request.url!.path
        if path.hasSuffix("openid-configuration") {
            return try reply(["issuer": configuration.issuer, "token_endpoint": configuration.issuer + "/token", "jwks_uri": configuration.issuer + "/jwks"])
        }
        if path.hasSuffix("jwks") { return try reply(["keys": [jwk.parameters]]) }
        if path.hasSuffix("authorization") {
            let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            nonce = body["nonce"] as! String; state = body["state"] as! String
            return try reply(["appLogin": true, "deviceId": body["deviceId"]!, "interactionUid": "native", "csrfToken": "csrf"], headers: ["set-cookie": "interaction=private; Path=/personal/v1/cloud; HttpOnly, resume=private-resume; Path=/personal/v1/cloud/oidc/auth; HttpOnly"])
        }
        if path.hasSuffix("auth/login") {
            #expect(request.value(forHTTPHeaderField: "Cookie") == "interaction=private")
            return try reply(["resumeUrl": configuration.issuer + "/auth/native"])
        }
        if path.hasSuffix("resume") {
            #expect(request.value(forHTTPHeaderField: "Cookie")?.contains("resume=private-resume") == true)
            let callback = configuration.redirectURI + "?state=\(fault == "state" ? "wrong" : state)&code=code"
            return try reply(["callbackUrl": fault == "callback" ? "https://foreign.example.com/?state=\(state)&code=code" : callback])
        }
        if path.hasSuffix("/token") {
            #expect(request.value(forHTTPHeaderField: "DPoP") != nil)
            #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
            let form = URLComponents(string: "https://example.com/?" + String(data: request.httpBody!, encoding: .utf8)!)!.queryItems!
            if form.contains(where: { $0.value == "refresh_token" }) {
                #expect(form.first(where: { $0.name == "refresh_token" })?.value == "rotation-\(rotation)")
                rotation += 1
            }
            let resource = form.first(where: { $0.name == "resource" })?.value ?? configuration.audience
            var access: [String: Any] = ["iss": configuration.issuer, "sub": subject, "aud": resource,
                "iat": Date().timeIntervalSince1970, "exp": Date().timeIntervalSince1970 + 15, "scope": "cloud:account host:session",
                "cnf": ["jkt": fault == "key" ? "wrong" : thumbprint]]
            if resource.contains("/hosts/") { access["host_id"] = "host-one" }
            var id = access; id["aud"] = configuration.clientID; id["nonce"] = fault == "nonce" ? "wrong" : nonce
            return try reply(["access_token": token(access, type: "at+jwt"), "id_token": token(id),
                "refresh_token": "rotation-\(rotation)", "token_type": fault == "bearer" ? "Bearer" : "DPoP"])
        }
        if path.hasSuffix("devices") {
            #expect(request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("DPoP ") == true)
            #expect(request.value(forHTTPHeaderField: "DPoP") != nil)
            return try reply(["devices": [], "hosts": []])
        }
        if path.hasSuffix("/hosts/offline/status") {
            return try reply(["hostId": "host-one", "accountId": subject, "generation": 3, "authorized": true])
        }
        if path.hasSuffix("request") { return try reply(["error": ["code": "RATE_LIMITED"]], headers: ["retry-after": "37"], status: 429) }
        throw APIFailure.invalidResponse
    }
    func recorded() -> [URLRequest] { requests }
}

@Suite struct AppAccountTests {
    @Test func offlineStatusUsesNativeDPoPAndRestoredAccount() async throws {
        let config = CloudConfiguration(server: try ServerConfiguration(input: "https://cloud.example.com"))
        let store = MemoryStore(), key = try CloudDeviceKey(softwareStore: MemoryStore())
        let fixture = try NativeAccountTransport(configuration: config, thumbprint: key.thumbprint)
        let client = CloudAccountClient(configuration: config, key: key, store: store, transport: fixture)
        try await client.beginAppLogin()
        let reply = try await client.appLogin(email: "synthetic@example.com", password: UUID().uuidString, name: "Test", type: "ios")
        try await client.finishAppLogin(resumeURL: reply.resumeUrl!)
        let restored = CloudAccountClient(configuration: config, key: key, store: store, transport: fixture)
        let status = try await restored.offlineStatus(hostID: "host-one")
        #expect(status.accountId == "synthetic-sub" && status.generation == 3 && status.authorized)
        let request = await fixture.recorded().last!
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("DPoP ") == true)
        #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
        #expect(try JSONDecoder().decode([String: String].self, from: request.httpBody!) == ["hostId": "host-one"])
        let proof = request.value(forHTTPHeaderField: "DPoP")!.split(separator: ".")
        let payload = try JSONSerialization.jsonObject(with: OfflineVault.decode(String(proof[1]))) as! [String: Any]
        #expect(payload["htu"] as? String == config.audience + "/hosts/offline/status")
        #expect(payload["htm"] as? String == "POST"); #expect(payload["ath"] as? String != nil)
    }
    @Test func formTransitionsClearSecretsPreserveEmailAndCountdown() {
        var form = AppAccountForm(); form.email = "synthetic@example.com"
        form.page = .registration; form.password = UUID().uuidString; form.repeatedPassword = form.password
        #expect(form.validPassword)
        form.code = "123456"; form.ticket = "ticket"
        form.resendAt = Date(timeIntervalSince1970: 160)
        #expect(form.resendSeconds(now: Date(timeIntervalSince1970: 101)) == 59)
        #expect(form.resendSeconds(now: Date(timeIntervalSince1970: 161)) == 0)
        form.reset(to: .login)
        #expect(form.email == "synthetic@example.com")
        #expect(form.password.isEmpty && form.repeatedPassword.isEmpty && form.code.isEmpty && form.ticket.isEmpty)
        #expect(form.step == .email)
    }
    @Test func errorsDoNotEnumerateAccountsAndRateWaitIsVisible() {
        #expect(AppAccountError(code: "EMAIL_IN_USE", status: 409).localizedDescription == AppAccountError(code: "INVALID_CREDENTIALS", status: 401).localizedDescription)
        #expect(AppAccountError(code: "RATE_LIMITED", status: 429, retryAfter: 37).localizedDescription.contains("37 秒"))
    }
    @Test(arguments: ["callback", "state", "nonce", "key", "bearer"])
    func invalidNativeGrantCannotPersist(fault: String) async throws {
        let config = CloudConfiguration(server: try ServerConfiguration(input: "https://cloud.example.com"))
        let store = MemoryStore(), key = try CloudDeviceKey(softwareStore: MemoryStore())
        let fixture = try NativeAccountTransport(configuration: config, thumbprint: key.thumbprint, fault: fault)
        let client = CloudAccountClient(configuration: config, key: key, store: store, transport: fixture)
        try await client.beginAppLogin()
        let reply = try await client.appLogin(email: "synthetic@example.com", password: UUID().uuidString, name: "Test iPhone", type: "ios")
        await #expect(throws: (any Error).self) { try await client.finishAppLogin(resumeURL: reply.resumeUrl!) }
        #expect(store.count == 0)
    }
    @Test func multipleRememberedHostsStayWithinVerifiedSubject() async throws {
        let config = CloudConfiguration(server: try ServerConfiguration(input: "https://cloud.example.com"))
        let store = MemoryStore(), key = try CloudDeviceKey(softwareStore: MemoryStore())
        func login(subject: String) async throws -> CloudAccountClient {
            let fixture = try NativeAccountTransport(configuration: config, thumbprint: key.thumbprint, subject: subject)
            let client = CloudAccountClient(configuration: config, key: key, store: store, transport: fixture)
            try await client.beginAppLogin()
            let reply = try await client.appLogin(email: "synthetic@example.com", password: UUID().uuidString, name: "Test", type: "ios")
            try await client.finishAppLogin(resumeURL: reply.resumeUrl!)
            return client
        }
        let a = try await login(subject: "account-a")
        try await a.rememberHost(hostID: "host-one", reference: ["pin": String(repeating: "A", count: 43)])
        try await a.rememberHost(hostID: "host-two", reference: ["pin": String(repeating: "B", count: 43)])
        let reopened = CloudAccountClient(configuration: config, key: key, store: store)
        #expect(try await reopened.savedHostReference(hostID: "host-one")?["pin"] == String(repeating: "A", count: 43))
        #expect(try await reopened.savedHostReference(hostID: "host-two")?["pin"] == String(repeating: "B", count: 43))
        try await a.forget()
        let b = try await login(subject: "account-b")
        #expect(try await b.savedHostReference(hostID: "host-one") == nil)
        #expect(try await b.savedHostReference(hostID: "host-two") == nil)
    }
    @Test func nativeRotationSavesOneFamilyAndRestoresDPoP() async throws {
        let config = CloudConfiguration(server: try ServerConfiguration(input: "https://cloud.example.com"))
        let store = MemoryStore(), key = try CloudDeviceKey(softwareStore: MemoryStore())
        let fixture = try NativeAccountTransport(configuration: config, thumbprint: key.thumbprint)
        let client = CloudAccountClient(configuration: config, key: key, store: store, transport: fixture)
        try await client.beginAppLogin()
        let reply = try await client.appLogin(email: "synthetic@example.com", password: UUID().uuidString, name: "Test iPhone", type: "ios")
        try await client.finishAppLogin(resumeURL: reply.resumeUrl!)
        _ = try await client.directory()
        _ = try await client.accessToken(hostID: "host-one")
        let restored = CloudAccountClient(configuration: config, key: key, store: store, transport: fixture)
        #expect(try await restored.savedSubject() == "synthetic-sub")
        _ = try await restored.directory()
        let recorded = await fixture.recorded()
        let tokenRequests = recorded.filter { $0.url!.path.hasSuffix("/token") }
        #expect(tokenRequests.count == 4)
        #expect(String(data: tokenRequests.last!.httpBody!, encoding: .utf8)!.contains("rotation-2"))
        #expect(tokenRequests.allSatisfy { $0.value(forHTTPHeaderField: "DPoP") != nil })
        do { _ = try await restored.requestEmail(email: "synthetic@example.com", recovery: true); Issue.record("rate limit expected") }
        catch let error as AppAccountError { #expect(error.retryAfter == 37) }
        try await restored.forget(); #expect(store.count == 0)
    }
}
