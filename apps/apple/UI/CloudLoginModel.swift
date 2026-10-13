import SwiftUI
import WeftMateCore

@MainActor
final class CloudLoginModel: ObservableObject {
    @Published var form = AppAccountForm()
    @Published private(set) var emailChangeChallenge: String?
    @Published private(set) var emailResendAt = Date.distantPast
    @Published var deviceName = ""
    @Published private(set) var subject: String?
    @Published private(set) var email = ""
    @Published private(set) var devices: [CloudDirectoryDevice] = []
    @Published private(set) var hosts: [CloudDirectoryDevice] = []
    @Published private(set) var authenticated = false
    @Published private(set) var notice: String?
    @Published private(set) var retryAt = Date.distantPast
    @Published var showAccount = false
    @Published var showDevices = false
    @Published private(set) var newDeviceNotice: String?
    private var directoryLoaded = false
    private var directorySubject: String?
    private var seenDeviceIDs = Set<String>()
    private var selectedHost: CloudHostConnection?
    @Published var showLogin = false
    @Published var useLocalWorkspace = false
    @Published var cloudAddress = "https://api.weftmate.com"
    @Published private(set) var busy = false
    @Published private(set) var waiting = false
    @Published private(set) var cloudSignedIn = false
    @Published private(set) var error: String?
    private weak var app: AppleAppModel?
    private let namespace: String
    private let pins: HostPinStore
    private let store: KeychainCredentialStore
    private var client: CloudAccountClient?
    private var key: CloudDeviceKey?
    private var hostID: String?
    private var operation: UUID = UUID()
    private var task: Task<Void, Never>?

    init(app: AppleAppModel, namespace: String) {
        self.app = app; self.namespace = namespace; deviceName = app.deviceName
        store = KeychainCredentialStore(service: namespace)
        pins = HostPinStore(store: KeychainCredentialStore(service: namespace + ".pins"))
        if let data = try? store.load(key: "trusted-host"), let ref = try? JSONDecoder().decode([String: String].self, from: data) {
            hostID = ref["hostId"]; cloudAddress = ref["cloud"] ?? cloudAddress
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
            subject = try await account.savedSubject()
            #if os(iOS)
            if let app { app.phoneChat.activate(app:app) }
            #endif
            authenticated = true; cloudSignedIn = true
            await refreshDirectory()
            if let hostID, app?.session == nil { await connectHost(id: hostID) }
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
                let address = form.email.trimmingCharacters(in: .whitespacesAndNewlines)
                let reply: AppLoginReply
                if form.loginMethod == .emailCode {
                    reply = try await account.requestLoginCode(email: address, name: deviceName, type: ApplePlatform.current.rawValue.lowercased())
                } else {
                    reply = try await account.appLogin(email: address, password: form.password, name: deviceName, type: ApplePlatform.current.rawValue.lowercased())
                }
                guard operation == id else { return }
                if let challenge = reply.challengeId { form.password = ""; form.page = .deviceConfirmation; form.challenge = challenge; form.code = ""; form.resendAt = Date().addingTimeInterval(60) }
                else if let resume = reply.resumeUrl { try await finishLogin(account, resume: resume, id: id) }
                else { throw APIFailure.invalidResponse }
            case .deviceConfirmation:
                let reply = try await (form.loginMethod == .emailCode ? account.confirmLoginCode(challenge: form.challenge, code: form.code) : account.confirmAppDevice(challenge: form.challenge, code: form.code))
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
                    guard form.validPassword else { error = "密码至少 15 位，两次输入需一致。"; return }
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
        subject = try await account.savedSubject()
        #if os(iOS)
        if let app { app.phoneChat.activate(app:app) }
        #endif
        authenticated = true; cloudSignedIn = true; showLogin = false
        busy = false
        await refreshDirectory()
        await retryConnection()
    }
    func resend() async {
        guard !busy, form.resendSeconds() == 0, Date() >= retryAt else { return }
        busy = true; defer { busy = false }
        do {
            let account = try accountClient()
            if form.page == .deviceConfirmation {
                // A fresh email-only challenge also confirms a new password-login device.
                try await account.beginAppLogin()
                let reply = try await account.requestLoginCode(email: form.email, name: deviceName, type: ApplePlatform.current.rawValue.lowercased())
                guard let challenge = reply.challengeId else { throw APIFailure.invalidResponse }
                form.challenge = challenge; form.loginMethod = .emailCode; form.code = ""
            } else { form.challenge = try await account.requestEmail(email: form.email, recovery: form.page == .recovery) }
            form.resendAt = Date().addingTimeInterval(60); error = nil
        } catch {
            self.error = accountMessage(error)
            if let limited = error as? AppAccountError, limited.code == "RATE_LIMITED" {
                retryAt = Date().addingTimeInterval(Double(limited.retryAfter ?? 60)); form.resendAt = retryAt
            }
        }
    }
    func offlineAuthorization(hostID: String) async throws -> OfflineAuthorization {
        try await accountClient().offlineStatus(hostID: hostID)
    }
    func refreshDirectory() async {
        guard authenticated else { return }
        let ticket=operation
        do {
            let account = try accountClient()
            let subject = try await account.savedSubject()
            guard ticket == operation, authenticated else { return }
            self.subject = subject
            if subject != directorySubject {
                directorySubject = subject
                let saved = try store.load(key: "seen-devices:" + (subject ?? ""))
                seenDeviceIDs = saved.flatMap { try? JSONDecoder().decode(Set<String>.self, from: $0) } ?? []
                directoryLoaded = saved != nil
            }
            let directory = try await account.directory()
            guard ticket == operation, authenticated else { return }
            if directoryLoaded, let newDevice = directory.devices.first(where: { !$0.isCurrent && !seenDeviceIDs.contains($0.id) }) {
                newDeviceNotice = newDevice.name + " 已登录。若不是你使用的设备，可以将它下线。"
            }
            seenDeviceIDs.formUnion(directory.devices.map(\.id)); directoryLoaded = true
            try store.save(JSONEncoder().encode(seenDeviceIDs), key: "seen-devices:" + (subject ?? ""))
            devices = directory.devices; hosts = directory.hosts
            #if os(iOS)
            if let app { app.phoneChat.activate(app:app);app.phoneChat.computerDirectoryChanged(hostIDs:Set(directory.hosts.map { $0.hostId ?? $0.id })) }
            #endif
            if let current = devices.first(where: { $0.isCurrent }) { deviceName = current.name }
            let address=try await account.accountEmail()
            guard ticket == operation, authenticated else { return };email=address
        } catch { if ticket == operation { await sessionFailure(error) } }
    }
    private func sessionFailure(_ failure: Error) async {
        if case APIFailure.server(400, "invalid_grant") = failure { await expireSession() }
        else if case APIFailure.notAuthenticated = failure { await expireSession() }
        else if let api = failure as? AppAccountError, api.status == 401 && api.code != "INVALID_CREDENTIALS" { await expireSession() }
        else { error = accountMessage(failure) }
    }
    private func expireSession() async {
        authenticated = false; cloudSignedIn = false; form.reset(to: .login)
        await app?.retainLocalContentAfterExpiry()
        error = "登录已过期。手机上的内容仍可查看，需要联网时请重新登录。"
    }
    func connectHost(id: String) async {
        guard !busy else { return }
        busy = true; error = nil; defer { busy = false }
        do {
            let account = try accountClient()
            let connection = try await account.connect(hostID: id)
            guard connection.hostId == id else { throw APIFailure.identityMismatch }
            selectedHost = connection
            hostID = id
            try await exchange(id: operation)
        } catch {
            waiting = true
            if case CloudLoginFailure.hostOffline = error { self.error = connectionMessage(error) }
            else if case APIFailure.transport(_) = error { self.error = connectionMessage(error) }
            else { await sessionFailure(error) }
        }
    }
    private func connectionMessage(_ error: Error) -> String {
        if case CloudLoginFailure.hostOffline = error { return "电脑没开或没联网。打开电脑上的 WeftMate 后再试一次。" }
        if case APIFailure.transport(_) = error { return "电脑没开或没联网。请检查后再试一次。" }
        return accountMessage(error)
    }
    func poll() async {
        await refreshDirectory()
        if waiting && authenticated && !busy { await retryConnection() }
    }
    func dismissNewDeviceNotice() { newDeviceNotice = nil }
    func changePassword(current: String, password: String, repeatPassword: String) async {
        guard !busy else { return }
        guard password.count >= 15 && password == repeatPassword else { error = "密码至少 15 位，两次输入需一致。"; return }
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
            if device.isCurrent { await expireSession() } else { await refreshDirectory() }
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
    private func accountMessage(_ error: Error) -> String {
        if let error = error as? AppAccountError { return error.localizedDescription }
        if let error = error as? CloudLoginFailure { return error == .hostOffline ? "电脑没开或没联网。打开电脑上的 WeftMate 后再试一次。" : error.localizedDescription }
        if case APIFailure.server(_, "LOGIN_UPGRADE_REQUIRED") = error { return "请更新电脑上的 WeftMate 后再连接。" }
        if let error = error as? APIFailure { return error.localizedDescription }
        return "网络不通，请检查连接后重试。"
    }
    func retryConnection() async {
        guard !busy, authenticated else { return }
        if let host = hosts.first(where: { $0.hostId == hostID }) ?? hosts.first {
            await connectHost(id: host.hostId ?? host.id)
        } else {
            #if os(iOS)
            waiting=false
            #else
            await refreshDirectory()
            #endif
        }
    }
    func requireLogin() { showLogin = true }
    private func exchange(id: UUID) async throws {
        guard let client, let key, let hostID, let app, let selectedHost,
              selectedHost.status == "online", let base = selectedHost.baseUrl else { throw CloudLoginFailure.hostOffline }
        let server = try ServerConfiguration(input: base, allowLoopbackHTTP: allowLoopback)
        let token = try await client.accessToken(hostID: hostID)
        guard operation == id else { throw APIFailure.accountChanged }
        guard let subject = try await client.savedSubject() else { throw APIFailure.notAuthenticated }
        let result = try await app.assistantClient.exchangeCloudSession(server: server, hostID: hostID, accessToken: token,
            deviceName: cloudDeviceName(deviceName), key: key, trustSubject: subject, hostPins: pins)
        guard operation == id else {
            if case .authenticated(let session) = result { await app.assistantClient.discardCloudSession(session) }
            return
        }
        switch result {
        case .pending: throw APIFailure.server(status: 409, code: "LOGIN_UPGRADE_REQUIRED")
        case .authenticated(let session):
            waiting = false; showLogin = false
            let reference = ["hostId": hostID, "cloud": cloudAddress]
            try store.save(JSONEncoder().encode(reference), key: "trusted-host")
            await app.acceptCloudSession(session)
        }
    }
    func cancel() {
        operation = UUID(); task?.cancel(); busy = false; error = nil; showLogin = false; form.reset(to: .login)
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
        subject = nil; waiting = false
        client = nil; key = nil; cloudSignedIn = false; authenticated = false; devices = []; hosts = []; email = ""; emailChangeChallenge = nil; selectedHost = nil; form.reset(to: .login)
        hostID = nil; newDeviceNotice = nil; directoryLoaded = false; seenDeviceIDs = []
        try store.delete(key: "trusted-host")
    }
    private func message(_ error: Error) -> String { accountMessage(error) }
}
