import SwiftUI
import WeftMateCore

@MainActor
final class CloudLoginModel: ObservableObject {
    @Published var showLogin = false
    @Published var cloudAddress = "https://weftmate.com"
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
        self.app = app; self.namespace = namespace
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
        ProcessInfo.processInfo.arguments.contains("--ui-testing") && ProcessInfo.processInfo.arguments.contains("--s1c-browser-driver")
        #else
        false
        #endif
    }
    func restore() async {
        guard let hostID, let app, app.session == nil, !busy else { return }
        do {
            let configuration = CloudConfiguration(server: try ServerConfiguration(input: cloudAddress, allowLoopbackHTTP: allowLoopback))
            let deviceKey = try CloudDeviceKey(namespace: namespace)
            let account = CloudAccountClient(configuration: configuration, key: deviceKey, store: store)
            guard try await account.hasSavedSession(hostID: hostID) else { return }
            key = deviceKey; client = account; cloudSignedIn = true
            busy = true; defer { busy = false }
            try await exchange(id: operation, redeem: false)
            if waiting { showLogin = true }
        } catch { self.error = message(error); showLogin = true }
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
        if let base = pair.relay?.baseUrl { try pins.save(pair.tlsSpki, for: base) }
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
            let priorHost = hostID
            try receivePairing(bytes)
            if cloudSignedIn && priorHost == hostID { retry(redeem: true) } else { begin(redeem: true) } // Grant the selected host resource in the system browser.
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
        if allowLoopback, let direct = pairing?.origin ?? debugDirectOrigin, direct.hasPrefix("http://") {
            // Isolated local cloud/host XCTest; no production directory or TLS bypass.
            server = try ServerConfiguration(input: direct, allowLoopbackHTTP: true)
        } else { server = try await client.relay(hostID: hostID) }
        #else
        server = try await client.relay(hostID: hostID)
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
            deviceName: String((ApplePlatform.current.deviceLabel + " · " + app.deviceName).prefix(128)), key: key, pairing: redeem ? pairing : nil)
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
        if let client { try await client.forget() }
        else if let refData = try store.load(key: "trusted-host"),
                let ref = try? JSONDecoder().decode([String: String].self, from: refData), let cloud = ref["cloud"] {
            let config = CloudConfiguration(server: try ServerConfiguration(input: cloud, allowLoopbackHTTP: allowLoopback))
            try store.delete(key: CloudAccountClient.credentialKey(configuration: config))
        }
        client = nil; key = nil; cloudSignedIn = false
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
            pending = devices; showPending = !devices.isEmpty
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
            pending.removeAll { $0.id == device.id }; showPending = !pending.isEmpty; error = nil
        } catch { self.error = message(error) }
    }
    private func message(_ error: Error) -> String {
        if let cloud = error as? CloudLoginFailure { return cloud.localizedDescription }
        if let api = error as? APIFailure {
            if case .server(403, "DEVICE_NOT_TRUSTED") = api { return "这台设备的授权已被拒绝或撤销，请在电脑上重新配对。" }
            if case .server(400, "invalid_grant") = api { return "云端尚未确认此设备公钥，请完成云端原生登录接线后重试。" }
            return api.localizedDescription
        }
        return "连接不可用，请检查云端与电脑连接后重试。"
    }
}
