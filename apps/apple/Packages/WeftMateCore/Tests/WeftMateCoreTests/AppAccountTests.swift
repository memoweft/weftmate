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
    let taskSupport: Int?
    let subject: String
    var requests: [URLRequest] = []
    var nonce = ""
    var state = ""
    var rotation = 0
    init(configuration: CloudConfiguration, thumbprint: String, fault: String? = nil, subject: String = "synthetic-sub", taskSupport: Int? = nil) throws {
        self.configuration = configuration; self.thumbprint = thumbprint; self.fault = fault; self.subject = subject;self.taskSupport=taskSupport
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
        if path.hasSuffix("/auth/login/code/request") {
            let fields = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            #expect(fields["password"] == nil && fields["publicJwk"] != nil && fields["interactionUid"] != nil)
            return try reply(["challengeId": "email-only", "confirmationRequired": true], status: 202)
        }
        if path.hasSuffix("/auth/login/code/confirm") {
            let fields = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            #expect(fields["challengeId"] as? String == "email-only" && fields["code"] as? String == "123456")
            return try reply(["resumeUrl": configuration.issuer + "/auth/native"])
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
            if resource.contains("/hosts/") {
                access["device_verified"] = fault != "unverified"
                access["host_id"] = fault == "pair-host" ? "other-host" : "host-one"
                access["device_id"] = fault == "pair-device" ? "other-device" : "apple-" + thumbprint
                if fault == "pair-key" { access["cnf"] = ["jkt": "other-key"] }
                if fault == "pair-account" { access["sub"] = "other-account" }
            }
            var id = access; id["aud"] = configuration.clientID; id["nonce"] = fault == "nonce" ? "wrong" : nonce
            return try reply(["access_token": token(access, type: "at+jwt"), "id_token": token(id),
                "refresh_token": "rotation-\(rotation)", "token_type": fault == "bearer" ? "Bearer" : "DPoP"])
        }
        if path.hasSuffix("/hosts/rename") || path.hasSuffix("/hosts/remove") {
            #expect(request.value(forHTTPHeaderField:"Authorization")?.hasPrefix("DPoP ") == true)
            #expect(request.value(forHTTPHeaderField:"DPoP") != nil)
            return try reply(["updated":true])
        }
        if path.hasSuffix("devices") {
            #expect(request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("DPoP ") == true)
            #expect(request.value(forHTTPHeaderField: "DPoP") != nil)
            return try reply(["devices": [], "hosts": []])
        }
        if path.hasSuffix("/hosts/connect") {
            return try reply(["hostId": "host-one", "baseUrl": fault == "pair-connection" ? "https://other.example.test" : "https://relay.example.test",
                "status": "online", "resource": configuration.audience + "/hosts/host-one", "approval": "automatic", "pairingRequired": true])
        }
        if path.hasSuffix("/hosts/offline/status") {
            var value: [String:Any] = ["hostId": "host-one", "accountId": subject, "generation": 3, "authorized": true]
            if let taskSupport { value["capabilities"]=["offlineTasks":taskSupport] }
            return try reply(value)
        }
        if path.contains("/hosts/offline/tasks/") {
            #expect(taskSupport == 1)
            let body=try JSONSerialization.jsonObject(with:request.httpBody!) as! [String:Any]
            if fault == "task-not-found",path.hasSuffix("cancel") { return try reply(["error":["code":"NOT_FOUND"]],status:404) }
            if path.hasSuffix("clear") { return try reply(["deleted":true]) }
            if path.hasSuffix("list") { return try reply(["items":[["id":"task-offline","hostId":"host-one","state":"waiting"]]]) }
            return try reply(["id":body["id"]!,"hostId":body["hostId"]!,"state":path.hasSuffix("cancel") ? "canceled" : "waiting"])
        }
        if path.hasSuffix("/auth/logout") { return try reply(["loggedOut":true]) }
        if path.hasSuffix("request") { return try reply(["error": ["code": "RATE_LIMITED"]], headers: ["retry-after": "37"], status: 429) }
        throw APIFailure.invalidResponse
    }
    func recorded() -> [URLRequest] { requests }
}

@Suite struct AppAccountTests {
    @Test func pairingDestinationMustMatchAuthenticatedCloudConnection() async throws {
        for fault in [nil, "pair-connection"] as [String?] {
            let configuration = CloudConfiguration(server: try ServerConfiguration(input: "https://cloud.example.com"))
            let key = try CloudDeviceKey(softwareStore: MemoryStore())
            let transport = try NativeAccountTransport(configuration: configuration, thumbprint: key.thumbprint, fault: fault)
            let client = CloudAccountClient(configuration: configuration, key: key, store: MemoryStore(), transport: transport)
            try await client.beginAppLogin()
            let login = try await client.appLogin(email: "synthetic@example.com", password: UUID().uuidString, name: "Synthetic", type: "ios")
            try await client.finishAppLogin(resumeURL: login.resumeUrl!)
            let fields: [String: Any] = ["version": 2, "issuer": configuration.issuer, "sub": "synthetic-sub", "hostId": "host-one",
                "publicJwk": key.publicJwk, "challenge": String(repeating: "A", count: 43), "hostCommitment": String(repeating: "A", count: 43),
                "tlsSpki": String(repeating: "A", count: 43), "expiresIn": 120, "expiresAt": Int64(Date().timeIntervalSince1970 * 1000) + 119_000,
                "origin": "http://127.0.0.1:47777", "relay": ["state": "online", "baseUrl": "https://relay.example.test"]]
            let pairing = try HostPairing.parse(JSONSerialization.data(withJSONObject: fields))
            if fault == nil { #expect(try await client.pairingConnection(pairing).originString == "https://relay.example.test") }
            else { await #expect(throws: CloudLoginFailure.pairing) { try await client.pairingConnection(pairing) } }
        }
    }
    @Test func pairingUsesSignatureVerifiedAccountDeviceHostAndActualDPoPKey() async throws {
        for fault in [nil, "pair-device", "pair-host", "pair-key", "pair-account", "unverified"] as [String?] {
            let configuration = CloudConfiguration(server: try ServerConfiguration(input: "https://cloud.example.com"))
            let key = try CloudDeviceKey(softwareStore: MemoryStore())
            let transport = try NativeAccountTransport(configuration: configuration, thumbprint: key.thumbprint, fault: fault)
            let client = CloudAccountClient(configuration: configuration, key: key, store: MemoryStore(), transport: transport)
            try await client.beginAppLogin()
            let reply = try await client.appLogin(email: "synthetic@example.com", password: UUID().uuidString, name: "Synthetic", type: "ios")
            try await client.finishAppLogin(resumeURL: reply.resumeUrl!)
            if fault == nil {
                let identity = try await client.pairingIdentity(hostID: "host-one")
                #expect(identity.issuer == configuration.issuer && identity.subject == "synthetic-sub")
                #expect(identity.hostID == "host-one" && identity.deviceID == "apple-" + key.thumbprint && identity.thumbprint == key.thumbprint)
            } else {
                await #expect(throws: CloudLoginFailure.token) { try await client.pairingIdentity(hostID: "host-one") }
            }
        }
    }
    @Test func computerManagementUsesExactAccountRoutesAndStableHostID() async throws {
        let config=CloudConfiguration(server:try ServerConfiguration(input:"https://cloud.example.com"))
        let key=try CloudDeviceKey(softwareStore:MemoryStore()),fixture=try NativeAccountTransport(configuration:config,thumbprint:key.thumbprint)
        let client=CloudAccountClient(configuration:config,key:key,store:MemoryStore(),transport:fixture)
        try await client.beginAppLogin()
        let reply=try await client.appLogin(email:"synthetic@example.com",password:UUID().uuidString,name:"Test",type:"ios")
        guard let resume=reply.resumeUrl else { throw APIFailure.invalidResponse };try await client.finishAppLogin(resumeURL:resume)
        try await client.renameComputer(hostID:"host-two",name:"合成电脑")
        try await client.removeComputer(hostID:"host-two")
        let requests=await fixture.recorded().filter {$0.url?.path.hasSuffix("/hosts/rename") == true || $0.url?.path.hasSuffix("/hosts/remove") == true}
        #expect(requests.map {$0.url?.path} == ["/personal/v1/cloud/hosts/rename","/personal/v1/cloud/hosts/remove"])
        for request in requests {
            let data=try #require(request.httpBody),body=try #require(JSONSerialization.jsonObject(with:data) as? [String:Any])
            #expect(body["hostId"] as? String == "host-two");#expect(body["deviceId"] == nil)
        }
    }
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
    @MainActor @Test func mode2iFix6CloudMissingCancellationRemovesLocalSendingTask() async throws {
        let config=CloudConfiguration(server:try ServerConfiguration(input:"https://cloud.example.com")),key=try CloudDeviceKey(softwareStore:MemoryStore())
        let fixture=try NativeAccountTransport(configuration:config,thumbprint:key.thumbprint,fault:"task-not-found",taskSupport:1)
        let client=CloudAccountClient(configuration:config,key:key,store:MemoryStore(),transport:fixture)
        try await client.beginAppLogin();let login=try await client.appLogin(email:"synthetic@example.com",password:UUID().uuidString,name:"Synthetic",type:"ios")
        try await client.finishAppLogin(resumeURL:login.resumeUrl!)
        let auth=try await client.offlineStatus(hostID:"host-one")
        let task=try JSONDecoder().decode(OfflineWorkTask.self,from:Data("{\"id\":\"never-submitted\",\"hostId\":\"host-one\",\"generation\":3,\"state\":\"sending\",\"envelope\":{\"version\":1,\"algorithm\":\"RSA-OAEP-256+A256GCM\",\"aad\":\"synthetic\",\"wrappedKey\":\"synthetic\",\"iv\":\"synthetic\",\"ciphertext\":\"synthetic\"}}".utf8))
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:directory) }
        let vault=try OfflineVault(identity:.init(ownerId:"owner",hostId:"host-one",deviceId:"device"),directory:directory,store:MemoryStore())
        let snapshot=try JSONDecoder().decode(OfflineSnapshot.self,from:Data("{\"generation\":3,\"reset\":false,\"items\":[],\"remove\":[],\"hashes\":{},\"truncated\":false,\"recent\":[],\"control\":{\"accountId\":\"synthetic-sub\",\"hostId\":\"host-one\",\"generation\":3}}".utf8))
        let engine=try OfflineReplica(vault:vault);try engine.merge(snapshot);try engine.retainWorkTask(task)
        let receipt=try await client.cancelOfflineWork(task,authorization:auth)
        #expect(receipt.state == "canceled")
        try engine.acknowledgeWorkTask(receipt)
        #expect(engine.state.workTasks?.contains { $0.id == task.id } != true)
        #expect(try OfflineReplica(vault:vault).state.workTasks?.contains { $0.state == "sending" } != true)
    }
    @Test func mode2iOfflineCloudOnlyUsesDeclaredTaskRoutesAndDPoP() async throws {
        for capability in [nil,1] as [Int?] {
            let config=CloudConfiguration(server:try ServerConfiguration(input:"https://cloud.example.com"))
            let key=try CloudDeviceKey(softwareStore:MemoryStore())
            let fixture=try NativeAccountTransport(configuration:config,thumbprint:key.thumbprint,taskSupport:capability)
            let client=CloudAccountClient(configuration:config,key:key,store:MemoryStore(),transport:fixture)
            try await client.beginAppLogin()
            let reply=try await client.appLogin(email:"synthetic@example.com",password:UUID().uuidString,name:"Synthetic",type:"ios")
            try await client.finishAppLogin(resumeURL:reply.resumeUrl!)
            let authorization=try await client.offlineStatus(hostID:"host-one")
            let task=try JSONDecoder().decode(OfflineWorkTask.self,from:Data("{\"id\":\"task-offline\",\"hostId\":\"host-one\",\"generation\":3,\"state\":\"sending\",\"envelope\":{\"version\":1,\"algorithm\":\"RSA-OAEP-256+A256GCM\",\"aad\":\"synthetic\",\"wrappedKey\":\"synthetic\",\"iv\":\"synthetic\",\"ciphertext\":\"synthetic\"}}".utf8))
            if capability == 1 {
                let first=try await client.submitOfflineWork(task,authorization:authorization)
                let repeated=try await client.submitOfflineWork(task,authorization:authorization)
                #expect(first.id == repeated.id && first.state == "waiting")
                #expect(try await client.listOfflineWork(hostID:"host-one",authorization:authorization).count == 1)
                #expect(try await client.cancelOfflineWork(task,authorization:authorization).state == "canceled")
            } else {
                await #expect(throws:OfflineFailure.authorization) { try await client.submitOfflineWork(task,authorization:authorization) }
            }
            try await client.logout()
            let requests=await fixture.recorded().filter { $0.url!.path.contains("/hosts/offline/tasks/") }
            #expect(requests.count == (capability == 1 ? 5 : 0))
            if capability == 1 {
                #expect(requests.last?.url!.path.hasSuffix("/clear") == true)
                #expect(requests[0].httpBody == requests[1].httpBody)
            }
            for request in requests {
                #expect(request.value(forHTTPHeaderField:"Authorization")?.hasPrefix("DPoP ") == true)
                #expect(request.value(forHTTPHeaderField:"DPoP") != nil && request.value(forHTTPHeaderField:"Cookie") == nil)
                let body=try JSONDecoder().decode(JSONValue.self,from:request.httpBody!)
                #expect(body["text"] == nil && body["sessionId"] == nil && body["projectId"] == nil)
            }
        }
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
    @Test func emailOnlyLoginUsesProviderPKCEAndDPoPWithoutPassword() async throws {
        let config = CloudConfiguration(server: try ServerConfiguration(input: "https://cloud.example.com"))
        let store = MemoryStore(), key = try CloudDeviceKey(softwareStore: MemoryStore())
        let fixture = try NativeAccountTransport(configuration: config, thumbprint: key.thumbprint)
        let client = CloudAccountClient(configuration: config, key: key, store: store, transport: fixture)
        try await client.beginAppLogin()
        let challenge = try await client.requestLoginCode(email: "synthetic@example.com", name: "Synthetic", type: "ios")
        let reply = try await client.confirmLoginCode(challenge: challenge.challengeId!, code: "123456")
        try await client.finishAppLogin(resumeURL: reply.resumeUrl!)
        #expect(try await client.savedSubject() == "synthetic-sub")
        _ = try await client.accessToken(hostID: "host-one")
        let requests = await fixture.recorded()
        #expect(!requests.contains { $0.url?.path.hasSuffix("/auth/login") == true })
        #expect(requests.filter { $0.url?.path.hasSuffix("/token") == true }.allSatisfy { $0.value(forHTTPHeaderField: "DPoP") != nil })
    }
    @Test func unverifiedHostResourceCannotAuthorizeContent() async throws {
        let config = CloudConfiguration(server: try ServerConfiguration(input: "https://cloud.example.com"))
        let store = MemoryStore(), key = try CloudDeviceKey(softwareStore: MemoryStore())
        let fixture = try NativeAccountTransport(configuration: config, thumbprint: key.thumbprint, fault: "unverified")
        let client = CloudAccountClient(configuration: config, key: key, store: store, transport: fixture)
        try await client.beginAppLogin()
        let reply = try await client.appLogin(email: "synthetic@example.com", password: UUID().uuidString, name: "Synthetic", type: "ios")
        try await client.finishAppLogin(resumeURL: reply.resumeUrl!)
        await #expect(throws: CloudLoginFailure.token) { try await client.accessToken(hostID: "host-one") }
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
