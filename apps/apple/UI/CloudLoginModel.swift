import SwiftUI
import WeftMateCore

@MainActor
final class CloudLoginModel: ObservableObject {
    @Published var form = AppAccountForm()
    @Published private(set) var emailChangeChallenge: String?
    @Published private(set) var emailResendAt = Date.distantPast
    @Published var deviceName = ""
    @Published private(set) var email = ""
    @Published private(set) var devices: [CloudDirectoryDevice] = []
    @Published private(set) var hosts: [CloudDirectoryDevice] = []
    @Published private(set) var authenticated = false
    @Published private(set) var notice: String?
    @Published private(set) var pairingCode: String?
    @Published var showTrustDelivery = false
    @Published private(set) var retryAt = Date.distantPast
    @Published var showAccount = false
    @Published var showDevices = false
    private var selectedHost: CloudHostConnection?
    private var directServer: ServerConfiguration?
    @Published var showLogin = false
    @Published var cloudAddress = "https://api.weftmate.com"
    @Published var pairingText = ""
    @Published private(set) var hasPairing = false
    @Published private(set) var busy = false
    @Published private(set) var waiting = false
    @Published private(set) var cloudSignedIn = false
    @Published private(set) var error: String?
    @Published private(set) var pending: [PendingCloudDevice] = []
    @Published var showPending = false
    @Published var showScanner = false
    private weak var app: AppleAppModel?
    private let namespace: String
    private let pins: HostPinStore
    private let store: KeychainCredentialStore
    private let browser = CloudBrowser()
    private var client: CloudAccountClient?
    private var key: CloudDeviceKey?
    private var pairing: HostPairing?
    private var pairingReceived: Date?
    private var hostID: String?
    private var trustedPin: String?
    #if DEBUG
    private var debugDirectOrigin: String?
    #endif
    private var operation: UUID = UUID()
    private var task: Task<Void, Never>?
    private var pendingBusy = false

    init(app: AppleAppModel, namespace: String) {
        self.app = app; self.namespace = namespace; deviceName = app.deviceName
        store = KeychainCredentialStore(service: namespace)
        pins = HostPinStore(store: KeychainCredentialStore(service: namespace + ".pins"))
        if let data = try? store.load(key: "trusted-host"), let ref = try? JSONDecoder().decode([String: String].self, from: data) {
            hostID = ref["hostId"]; trustedPin = ref["pin"]; cloudAddress = ref["cloud"] ?? cloudAddress
            #if DEBUG
            debugDirectOrigin = ref["debugDirectOrigin"]
            #endif
        }
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-testing"), let i = args.firstIndex(of: "--s1c-cloud-url"), args.indices.contains(i + 1) { cloudAddress = args[i + 1] }
        #endif
    }
    private var allowLoopback: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--ui-testing") && (ProcessInfo.processInfo.arguments.contains("--s1c-browser-driver") || ProcessInfo.processInfo.arguments.contains("--lg2-cloud"))
        #else
        false
        #endif
    }
    private func accountClient() throws -> CloudAccountClient {
        if let client { return client }
        let configuration = CloudConfiguration(server: try ServerConfiguration(input: cloudAddress, allowLoopbackHTTP: allowLoopback))
        let deviceKey = try CloudDeviceKey(namespace: namespace)
        let account = CloudAccountClient(configuration: configuration, key: deviceKey, store: store)
        key = deviceKey; client = account; return account
    }
    func restore() async {
        do {
            let account = try accountClient()
            guard try await account.savedSubject() != nil else { return }
            authenticated = true; cloudSignedIn = true
            await refreshDirectory()
            if let hostID, trustedPin != nil, app?.session == nil { await connectHost(id: hostID) }
        } catch { await sessionFailure(error) }
    }
    func changePage(_ page: AppAccountForm.Page) { form.reset(to: page); error = nil; notice = nil }
    func submit() async {
        guard !busy, Date() >= retryAt else { return }
        busy = true; error = nil; notice = nil
        let id = operation
        defer { if id == operation { busy = false } }
        do {
            let account = try accountClient()
            switch form.page {
            case .login:
                try await account.beginAppLogin()
                let reply = try await account.appLogin(email: form.email.trimmingCharacters(in: .whitespacesAndNewlines), password: form.password,
                    name: deviceName, type: ApplePlatform.current.rawValue.lowercased())
                guard operation == id else { return }
                if let challenge = reply.challengeId { form.password = ""; form.page = .deviceConfirmation; form.challenge = challenge; form.code = "" }
                else if let resume = reply.resumeUrl { try await finishLogin(account, resume: resume, id: id) }
                else { throw APIFailure.invalidResponse }
            case .deviceConfirmation:
                let reply = try await account.confirmAppDevice(challenge: form.challenge, code: form.code)
                guard let resume = reply.resumeUrl else { throw APIFailure.invalidResponse }
                try await finishLogin(account, resume: resume, id: id)
            case .registration, .recovery:
                let recovery = form.page == .recovery
                switch form.step {
                case .email:
                    form.challenge = try await account.requestEmail(email: form.email, recovery: recovery)
                    form.resendAt = Date().addingTimeInterval(60); form.step = .code
                case .code:
                    form.ticket = try await account.verifyEmail(challenge: form.challenge, code: form.code, recovery: recovery)
                    form.code = ""; form.step = .password
                case .password:
                    guard form.validPassword else { error = "密码至少 8 位，两次输入需一致。"; return }
                    if !recovery { form.step = .deviceName; return }
                    try await account.completeEmail(ticket: form.ticket, password: form.password, recovery: true)
                    form.reset(to: .login); notice = "密码已更新，请登录。"
                case .deviceName:
                    try await account.completeEmail(ticket: form.ticket, password: form.password, recovery: false)
                    form.ticket = ""; form.page = .login
                    try await account.beginAppLogin()
                    let reply = try await account.appLogin(email: form.email, password: form.password, name: deviceName, type: ApplePlatform.current.rawValue.lowercased())
                    if let challenge = reply.challengeId { form.password = ""; form.page = .deviceConfirmation; form.challenge = challenge }
                    else if let resume = reply.resumeUrl { try await finishLogin(account, resume: resume, id: id) }
                }
            }
        } catch {
            self.error = accountMessage(error)
            if let limited = error as? AppAccountError, limited.code == "RATE_LIMITED" { retryAt = Date().addingTimeInterval(Double(limited.retryAfter ?? 60)) }
        }
    }
    private func finishLogin(_ account: CloudAccountClient, resume: String, id: UUID) async throws {
        try await account.finishAppLogin(resumeURL: resume)
        guard id == operation else { return }
        email = form.email; form.reset(to: .login)
        authenticated = true; cloudSignedIn = true; showLogin = false
        await refreshDirectory()
        waiting = !hosts.isEmpty
    }
    func resend() async {
        guard !busy, form.resendSeconds() == 0, form.page != .deviceConfirmation else { return }
        busy = true; defer { busy = false }
        do {
            form.challenge = try await accountClient().requestEmail(email: form.email, recovery: form.page == .recovery)
            form.resendAt = Date().addingTimeInterval(60); error = nil
        } catch { self.error = accountMessage(error) }
    }
    func refreshDirectory() async {
        guard authenticated else { return }
        do {
            let account = try accountClient()
            let directory = try await account.directory()
            devices = directory.devices; hosts = directory.hosts
            if let current = devices.first(where: { $0.isCurrent }) { deviceName = current.name }
            email = try await account.accountEmail()
        } catch { await sessionFailure(error) }
    }
    private func sessionFailure(_ failure: Error) async {
        if case APIFailure.server(400, "invalid_grant") = failure { await expireSession() }
        else if case APIFailure.notAuthenticated = failure { await expireSession() }
        else if let api = failure as? AppAccountError, api.status == 401 && api.code != "INVALID_CREDENTIALS" { await expireSession() }
        else { error = accountMessage(failure) }
    }
    private func expireSession() async {
        // AppleAppModel saves account-scoped drafts before clearing the host identity.
        await app?.signOut()
        authenticated = false; cloudSignedIn = false; form.reset(to: .login)
        error = "登录已过期，请重新登录。草稿已保留。"
    }
    func connectHost(id: String) async {
        guard !busy else { return }
        busy = true; error = nil; defer { busy = false }
        do {
            let account = try accountClient()
            let connection = try await account.connect(hostID: id)
            guard connection.hostId == id else { throw APIFailure.identityMismatch }
            selectedHost = connection
            if hostID != id {
                directServer = nil
                if let reference = try await account.savedHostReference(hostID: id), reference["cloud"] == cloudAddress {
                    hostID = id; trustedPin = reference["pin"]
                    try store.save(JSONEncoder().encode(reference), key: "trusted-host")
                    #if DEBUG
                    debugDirectOrigin = reference["debugDirectOrigin"]
                    #endif
                }
            }
            guard hostID == id, trustedPin != nil else { showLogin = true; return }
            try await exchange(id: operation, redeem: false)
        } catch { await sessionFailure(error) }
    }
    func connectDirect(address: String) async {
        do {
            directServer = try ServerConfiguration(input: address, allowLoopbackHTTP: allowLoopback)
            guard let hostID, trustedPin != nil else { showLogin = true; return }
            await connectHost(id: hostID)
        } catch { self.error = accountMessage(error) }
    }
    func poll() async {
        await refreshDirectory()
        if waiting && hostID != nil && trustedPin != nil && !busy { retry() }
        await checkPending()
    }
    func changePassword(current: String, password: String, repeatPassword: String) async {
        guard !busy else { return }
        guard password.count >= 8 && password == repeatPassword else { error = "密码至少 8 位，两次输入需一致。"; return }
        busy = true; defer { busy = false }
        do {
            try await accountClient().changePassword(current: current, password: password)
            await app?.signOut(); authenticated = false; form.reset(to: .login); notice = "密码已更新，请重新登录。"
        } catch { await sessionFailure(error) }
    }
    func requestEmailChange(_ address: String) async {
        guard !busy, Date() >= emailResendAt else { return }
        busy = true; defer { busy = false }
        do {
            emailChangeChallenge = try await accountClient().requestEmailChange(email: address)
            emailResendAt = Date().addingTimeInterval(60); error = nil
        } catch { await sessionFailure(error) }
    }
    func confirmEmailChange(_ address: String, code: String) async {
        guard !busy, let challenge = emailChangeChallenge else { return }
        busy = true; defer { busy = false }
        do {
            let confirmedEmail = try await accountClient().confirmEmailChange(challenge: challenge, code: code)
            await app?.signOut(); form.email = confirmedEmail; form.reset(to: .login)
            emailChangeChallenge = nil; notice = "邮箱已更新，请用新邮箱登录。"
        } catch { await sessionFailure(error) }
    }
    func logoutOthers() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do { try await accountClient().logoutOthers(); notice = "其他设备已退出。"; await refreshDirectory() }
        catch { await sessionFailure(error) }
    }
    func renameDevice(_ device: CloudDirectoryDevice, name: String) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do { try await accountClient().renameDevice(id: device.id, name: name); await refreshDirectory() }
        catch { await sessionFailure(error) }
    }
    func removeDevice(_ device: CloudDirectoryDevice) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do {
            try await accountClient().revokeDevice(id: device.id)
            if device.isCurrent { await app?.signOut() } else { await refreshDirectory() }
        } catch { await sessionFailure(error) }
    }
    func deleteAccount(password: String) async {
        guard !busy, let app else { return }
        guard await app.flushDrafts() else { error = "草稿未能保存，请先保存后再注销。"; return }
        busy = true; defer { busy = false }
        do {
            try await accountClient().deleteAccount(password: password)
            await app.signOut(); notice = "账号已注销，本机对话与记忆保留。"
        } catch { await sessionFailure(error) }
    }
    func signOutAccount() async {
        await app?.signOut()
        if !authenticated { showAccount = false; showDevices = false }
    }
    func generatePairing() async {
        guard let app else { return }
        do {
            let pair = try await app.assistantClient.createCloudPairing()
            pairingCode = "wm1." + encodeQR(try JSONEncoder().encode(pair)); error = nil
        } catch { self.error = accountMessage(error) }
    }
    func createTrustDelivery(for device: PendingCloudDevice) async {
        guard let app else { return }
        do {
            let bytes = try await app.assistantClient.trustedHostDelivery(requestID: device.id)
            guard let reply = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  let token = reply["trustToken"] as? String, let anchor = reply["publicJwk"] as? [String: String],
                  let host = reply["hostId"] as? String else { throw APIFailure.invalidResponse }
            let qr = try JSONSerialization.data(withJSONObject: ["trustToken": token, "publicJwk": anchor, "hostId": host])
            pairingCode = "wmtrust1." + encodeQR(qr); showTrustDelivery = true; error = nil
        } catch { self.error = accountMessage(error) }
    }
    private func encodeQR(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    private func receiveTrustQR(_ text: String) async throws {
        let encoded = String(text.dropFirst("wmtrust1.".count)).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        guard let data = Data(base64Encoded: encoded + String(repeating: "=", count: (4 - encoded.count % 4) % 4)),
              let qr = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let anchor = qr["publicJwk"] as? [String: String], let token = qr["trustToken"] as? String,
              let host = qr["hostId"] as? String, let selectedHost, selectedHost.hostId == host,
              let key, let client, let sub = try await client.savedSubject() else { throw CloudLoginFailure.pairing }
        // Explicit physical QR/code input supplies the anchor, never a directory response.
        let pin = try HostTrustDelivery.verify(token: token, trustedPublicJwk: anchor, hostID: host, subject: sub,
            deviceID: "apple-" + key.thumbprint, thumbprint: key.thumbprint)
        try pins.save(pin.tlsSpki, for: pin.origin)
        if let base = pin.relay?.baseUrl { try pins.save(pin.tlsSpki, for: base) }
        hostID = host; trustedPin = pin.tlsSpki
        let reference = ["hostId": host, "pin": pin.tlsSpki, "cloud": cloudAddress]
        try store.save(JSONEncoder().encode(reference), key: "trusted-host")
        try await client.rememberHost(hostID: host, reference: reference)
        try await exchange(id: operation, redeem: false)
    }
    private func accountMessage(_ error: Error) -> String {
        if let error = error as? AppAccountError { return error.localizedDescription }
        if let error = error as? CloudLoginFailure { return error.localizedDescription }
        if let error = error as? APIFailure { return error.localizedDescription }
        return "网络不通，请检查连接后重试。"
    }
    func begin(redeem: Bool = false) {
        guard !busy else { return }
        let id = UUID(); operation = id; busy = true; error = nil
        task = Task {
            defer { if operation == id { busy = false } }
            do {
                if !pairingText.isEmpty { try receivePairing(Data(pairingText.utf8)) }
                let server = try ServerConfiguration(input: cloudAddress, allowLoopbackHTTP: allowLoopback)
                let configuration = CloudConfiguration(server: server)
                let deviceKey = try CloudDeviceKey(namespace: namespace)
                key = deviceKey
                let account = CloudAccountClient(configuration: configuration, key: deviceKey, store: store)
                client = account
                let browser = self.browser
                try await account.authorize(hostID: hostID) { flow, jwk in try await browser.open(flow, publicJwk: jwk) }
                guard operation == id else { return }
                cloudSignedIn = true
                guard hostID != nil else { error = CloudLoginFailure.needsPairing.localizedDescription; return }
                try await exchange(id: id, redeem: redeem)
            } catch { if operation == id { self.error = message(error) } }
        }
    }
    func retry(redeem: Bool = false) {
        guard !busy else { return }
        let id = UUID(); operation = id; busy = true; error = nil
        task = Task {
            defer { if operation == id { busy = false } }
            do { try await exchange(id: id, redeem: redeem) }
            catch { if operation == id { self.error = message(error) } }
        }
    }
    func receivePairing(_ bytes: Data) throws {
        let pair = try HostPairing.parse(bytes, allowLoopbackHTTP: allowLoopback)
        // New QR may renew a challenge, but never silently replace a saved host key.
        if let selectedHost, selectedHost.hostId != pair.hostId { throw CloudLoginFailure.pairing }
        if let base = pair.relay?.baseUrl { try pins.save(pair.tlsSpki, for: base) }
        if pair.origin.hasPrefix("https://") { try pins.save(pair.tlsSpki, for: pair.origin) }
        pairing = pair; pairingReceived = Date(); hostID = pair.hostId; trustedPin = pair.tlsSpki
        var reference = ["hostId": pair.hostId, "pin": pair.tlsSpki, "cloud": cloudAddress]
        #if DEBUG
        if allowLoopback, pair.origin.hasPrefix("http://") { debugDirectOrigin = pair.origin; reference["debugDirectOrigin"] = pair.origin }
        #endif
        try store.save(JSONEncoder().encode(reference), key: "trusted-host")
        pairingText = String(data: bytes, encoding: .utf8) ?? ""; hasPairing = true
    }
    func editPairing() { pairingText = ""; hasPairing = false }
    func scan(_ bytes: Data) {
        showScanner = false
        do {
            let text = String(data: bytes, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if text.hasPrefix("wmtrust1.") {
                task = Task { do { try await receiveTrustQR(text) } catch { self.error = accountMessage(error) } }
                return
            }
            let priorHost = hostID
            try receivePairing(bytes)
            if authenticated, let hostID {
                task = Task {
                    do {
                        let account = try accountClient()
                        if let bytes = try store.load(key: "trusted-host"), let reference = try? JSONDecoder().decode([String: String].self, from: bytes) {
                            try await account.rememberHost(hostID: hostID, reference: reference)
                        }
                        _ = try await account.connect(hostID: hostID); retry(redeem: false)
                    }
                    catch { self.error = accountMessage(error) }
                }
            } else if cloudSignedIn && priorHost == hostID { retry(redeem: true) }
        } catch { self.error = message(error) }
    }
    #if DEBUG && os(iOS)
    func loadSyntheticQR() async {
        let args = ProcessInfo.processInfo.arguments
        guard allowLoopback, let i = args.firstIndex(of: "--s1c-qr-url"), args.indices.contains(i + 1),
              let url = URL(string: args[i + 1]), url.scheme == "http", ["127.0.0.1", "localhost"].contains(url.host) else { return }
        do {
            let (bytes, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw CloudLoginFailure.pairing }
            try receivePairing(PairingQRDecoder.decode(bytes))
        } catch {
            let code = error as NSError
            self.error = "测试二维码读取失败（\(code.domain)/\(code.code)）"
        }
    }
    #endif
    private func exchange(id: UUID, redeem: Bool) async throws {
        guard let client, let key, let hostID, let app else { throw CloudLoginFailure.needsPairing }
        let server: ServerConfiguration
        #if DEBUG
        if let directServer { server = directServer }
        else if allowLoopback, let direct = pairing?.origin ?? debugDirectOrigin, direct.hasPrefix("http://") {
            // Isolated local cloud/host XCTest; no production directory or TLS bypass.
            server = try ServerConfiguration(input: direct, allowLoopbackHTTP: true)
        } else if authenticated, let selectedHost, selectedHost.status == "online", let base = selectedHost.baseUrl {
            server = try ServerConfiguration(input: base)
        } else { server = try await client.relay(hostID: hostID) }
        #else
        if let directServer { server = directServer }
        else if authenticated, let selectedHost, selectedHost.status == "online", let base = selectedHost.baseUrl {
            server = try ServerConfiguration(input: base)
        } else { throw CloudLoginFailure.hostOffline }
        #endif
        guard operation == id else { throw APIFailure.accountChanged }
        // Discover supplies only the route. The pin must already have come from pairing.
        if server.origin.scheme == "https" {
            guard let expected = try pins.pin(for: server.originString), expected == trustedPin else { throw CloudLoginFailure.needsPairing }
        }
        let token = try await client.accessToken(hostID: hostID)
        guard operation == id else { throw APIFailure.accountChanged }
        if redeem {
            guard let pairing, let received = pairingReceived, Date().timeIntervalSince(received) < Double(pairing.expiresIn) else { throw CloudLoginFailure.pairing }
        }
        let result = try await app.assistantClient.exchangeCloudSession(server: server, hostID: hostID, accessToken: token,
            deviceName: cloudDeviceName(deviceName), key: key, pairing: redeem ? pairing : nil)
        guard operation == id else {
            if case .authenticated(let session) = result { await app.assistantClient.discardCloudSession(session) }
            return
        }
        switch result {
        case .pending: waiting = true
        case .authenticated(let session):
            waiting = false; showLogin = false
            await app.acceptCloudSession(session)
        }
    }
    func cancel() {
        operation = UUID(); task?.cancel(); browser.cancel(); busy = false; waiting = false; error = nil; showLogin = false
        if let client { Task { await client.cancel() } }
    }
    func signOut() async throws {
        cancel()
        if let client {
            if authenticated { try? await client.logout() }
            try await client.forget()
        }
        else if let refData = try store.load(key: "trusted-host"),
                let ref = try? JSONDecoder().decode([String: String].self, from: refData), let cloud = ref["cloud"] {
            let config = CloudConfiguration(server: try ServerConfiguration(input: cloud, allowLoopbackHTTP: allowLoopback))
            try store.delete(key: CloudAccountClient.credentialKey(configuration: config))
        }
        client = nil; key = nil; cloudSignedIn = false; authenticated = false; devices = []; hosts = []; email = ""; emailChangeChallenge = nil; showTrustDelivery = false; pairingCode = nil; selectedHost = nil; directServer = nil; form.reset(to: .login)
        pairing = nil; pairingText = ""; hasPairing = false; hostID = nil; trustedPin = nil; pending = []; showPending = false
        try store.delete(key: "trusted-host")
    }
    func checkPending() async {
        guard !pendingBusy, let app, app.session?.verification == .verified else { return }
        pendingBusy = true; defer { pendingBusy = false }
        let epoch = app.accountEpoch
        do {
            let devices = try await app.assistantClient.pendingCloudDevices()
            guard app.accountEpoch == epoch else { return }
            pending = devices; showPending = false
        } catch {
            // Older/unbound hosts may have no cloud device requests. Keep local login available.
        }
    }
    func decide(_ device: PendingCloudDevice, allow: Bool) async {
        guard let app else { return }
        let epoch = app.accountEpoch
        do {
            try await app.assistantClient.decideCloudDevice(id: device.id, allow: allow)
            guard epoch == app.accountEpoch else { return }
            pending.removeAll { $0.id == device.id }; showPending = false; error = nil
            if allow { await createTrustDelivery(for: device) }
        } catch { self.error = message(error) }
    }
    private func message(_ error: Error) -> String {
        if let cloud = error as? CloudLoginFailure { return cloud.localizedDescription }
        if let api = error as? APIFailure {
            if case .server(401, "PAIRING_INVALID") = api { return CloudLoginFailure.pairing.localizedDescription }
            if case .server(403, "DEVICE_NOT_TRUSTED") = api { return "这台设备的授权已被拒绝或撤销，请在电脑上重新配对。" }
            if case .server(400, "invalid_grant") = api { return "云端未能确认此设备，请检查客户端登记与云服务版本后重新登录。" }
            return api.localizedDescription
        }
        return "连接不可用，请检查云端与电脑连接后重试。"
    }
}
