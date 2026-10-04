import Combine
import Foundation
import WeftMateCore

/// Keeps every visible record and draft within one authenticated account epoch.
@MainActor
final class AppleAppModel: ObservableObject {
    @Published var serverInput: String
    @Published private(set) var session: AccountSession?
    @Published private(set) var restoring = true
    @Published private(set) var authBusy = false
    @Published var authError: String?
    @Published private(set) var conversations: [ConversationSummary] = []
    @Published private(set) var devices: [DeviceRecord] = []
    @Published private(set) var refreshing = false
    @Published private(set) var conversationsError: String?
    @Published private(set) var devicesError: String?
    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var historyBusy = false
    @Published private(set) var historyError: String?
    @Published private(set) var selectedConversation: ConversationSummary?
    @Published var drafts: [String: String] = [:]
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var verificationPending = false

    let developmentRouteEnabled: Bool

    private let client: PersonalClient
    private let defaults: UserDefaults?
    private let launchConfigurationError: String?
    private var epoch = UUID()
    private var historyRequest = UUID()
    private var started = false

    init() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        let uiTesting = args.contains("--ui-testing")
        #else
        let args: [String] = []
        let uiTesting = false
        #endif
        var configurationError: String?
        var testNamespace = "default"
        if uiTesting, let index = args.firstIndex(of: "--ui-testing-namespace") {
            if args.indices.contains(index + 1),
               args[index + 1].range(of: "^[A-Za-z0-9._-]{1,64}$", options: .regularExpression) != nil {
                testNamespace = args[index + 1]
            } else {
                configurationError = "测试存储命名空间无效，请检查启动参数。"
            }
        }
        let testService = "com.weftmate.apple.ui-tests.\(testNamespace)"
        let preferences = uiTesting
            ? UserDefaults(suiteName: testService) : UserDefaults.standard
        if preferences == nil { configurationError = "无法打开测试存储，请检查启动参数。" }
        defaults = preferences
        let store = KeychainCredentialStore(service: uiTesting
            ? "\(testService).credentials" : "com.weftmate.apple.credentials")
        var transport = URLSessionTransport()
        var routeEnabled = false
        #if DEBUG
        if let index = args.firstIndex(of: "--development-proxy-port") {
            if args.indices.contains(index + 1), let port = Int(args[index + 1]), (1024...65535).contains(port) {
                do {
                    transport = try URLSessionTransport(developmentProxyPort: port)
                    routeEnabled = true
                } catch {
                    configurationError = "局域网开发联调参数无效，请检查启动参数。"
                }
            } else {
                configurationError = "局域网开发联调端口无效，请检查启动参数。"
            }
        }
        #endif
        developmentRouteEnabled = routeEnabled
        launchConfigurationError = configurationError
        client = PersonalClient(credentialStore: store, transport: transport)
        serverInput = preferences?.string(forKey: "weftmate.server")
            ?? (uiTesting ? "https://127.0.0.1:1" : "https://home.weftmate.com:8443")
        if let index = args.firstIndex(of: "--server-url"), args.indices.contains(index + 1) {
            serverInput = args[index + 1]
        }
    }

    var serverDisplayName: String {
        guard let components = URLComponents(string: serverInput), let host = components.host else {
            return "设置服务器地址"
        }
        return components.port.map { "\(host):\($0)" } ?? host
    }

    var accountName: String {
        guard let account = session?.account else { return "账户" }
        return account.displayName.isEmpty ? account.username : account.displayName
    }

    var deviceName: String {
        #if os(macOS)
        return Host.current().localizedName ?? "我的 Mac"
        #else
        return "我的 iPhone"
        #endif
    }

    func start() async {
        guard !started else { return }
        started = true
        defer { restoring = false }
        if let launchConfigurationError {
            authError = launchConfigurationError
            return
        }
        do {
            let server = try ServerConfiguration(input: serverInput)
            session = try await client.restoreSession(server: server)
            if session != nil { await refresh() }
        } catch {
            // A valid stored account can survive a temporary network outage.
            session = await client.currentSession()
            if session != nil {
                verificationPending = true
                conversationsError = friendly(error)
                devicesError = friendly(error)
            } else {
                authError = friendly(error)
            }
        }
    }

    func authenticate(username: String, password: String, displayName: String?, register: Bool) async {
        guard !authBusy else { return }
        if let launchConfigurationError {
            authError = launchConfigurationError
            return
        }
        authBusy = true
        authError = nil
        let actionEpoch = epoch
        defer { if actionEpoch == epoch { authBusy = false } }
        do {
            let server = try ServerConfiguration(input: serverInput)
            let name = username.trimmingCharacters(in: .whitespacesAndNewlines)
            let result: AccountSession
            if register {
                let nickname = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
                result = try await client.register(server: server, username: name, password: password,
                                                    deviceName: deviceName,
                                                    displayName: nickname?.isEmpty == false ? nickname : nil)
            } else {
                result = try await client.login(server: server, username: name, password: password,
                                                 deviceName: deviceName)
            }
            guard actionEpoch == epoch else { return }
            session = result
            verificationPending = false
            defaults?.set(server.originString, forKey: "weftmate.server")
            serverInput = server.originString
            await refresh()
        } catch {
            guard actionEpoch == epoch else { return }
            authError = friendly(error)
        }
    }

    func refresh() async {
        guard session != nil, !refreshing else { return }
        refreshing = true
        conversationsError = nil
        devicesError = nil
        let actionEpoch = epoch
        defer { if actionEpoch == epoch { refreshing = false } }
        if verificationPending, let server = session?.server {
            do {
                let verified = try await client.restoreSession(server: server)
                guard actionEpoch == epoch else { return }
                guard let verified else {
                    clearVisibleAccount()
                    authError = "请重新登录。"
                    return
                }
                session = verified
                verificationPending = false
            } catch {
                guard actionEpoch == epoch else { return }
                if await expireSessionIfNeeded(error) { return }
                conversationsError = friendly(error)
                devicesError = friendly(error)
                return
            }
        }
        do {
            let result = try await client.conversations()
            guard actionEpoch == epoch else { return }
            conversations = result
            lastRefresh = Date()
        } catch {
            guard actionEpoch == epoch else { return }
            if await expireSessionIfNeeded(error) { return }
            conversationsError = friendly(error)
        }
        do {
            let result = try await client.devices()
            guard actionEpoch == epoch else { return }
            devices = result
        } catch {
            guard actionEpoch == epoch else { return }
            if await expireSessionIfNeeded(error) { return }
            devicesError = friendly(error)
        }
    }

    func open(_ conversation: ConversationSummary) async {
        selectedConversation = conversation
        messages = []
        historyError = nil
        historyBusy = true
        let actionEpoch = epoch
        let request = UUID()
        historyRequest = request
        do {
            let result = try await client.history(conversation: conversation)
            guard actionEpoch == epoch, historyRequest == request else { return }
            messages = result
            historyBusy = false
        } catch {
            guard actionEpoch == epoch, historyRequest == request else { return }
            historyBusy = false
            if await expireSessionIfNeeded(error) { return }
            historyError = friendly(error)
        }
    }

    func closeConversation() {
        historyRequest = UUID()
        selectedConversation = nil
        messages = []
        historyBusy = false
        historyError = nil
    }

    func signOut() async {
        guard !authBusy else { return }
        clearVisibleAccount()
        authBusy = true
        do { try await client.logout() }
        catch let failure as APIFailure {
            switch failure {
            case .logoutIncomplete:
                authError = failure.errorDescription
            case .credentialStorage:
                authError = "当前页面已退出，但钥匙串中的登录凭据未能清除。重新打开可能恢复原账户，请检查钥匙串访问后再试。"
            default:
                authError = "退出结果尚未确认，请重新检查连接后再试。"
            }
        }
        catch { authError = "已在这台设备退出。服务器暂不可达，远端退出结果尚未确认。" }
        authBusy = false
    }

    private func clearVisibleAccount() {
        epoch = UUID()
        historyRequest = UUID()
        session = nil
        conversations = []
        devices = []
        messages = []
        selectedConversation = nil
        drafts = [:]
        refreshing = false
        historyBusy = false
        historyError = nil
        conversationsError = nil
        devicesError = nil
        lastRefresh = nil
        verificationPending = false
        authError = nil
    }

    private func expireSessionIfNeeded(_ error: Error) async -> Bool {
        guard let failure = error as? APIFailure else { return false }
        switch failure {
        case .notAuthenticated, .server(401, _), .identityMismatch:
            clearVisibleAccount()
            // The client forgets local credentials even if the server is offline.
            try? await client.logout()
            authError = failure == .identityMismatch
                ? "服务器返回的账户或设备身份不一致，请重新登录。"
                : "登录已过期或设备已撤权，请重新登录。"
            return true
        default: return false
        }
    }

    private func friendly(_ error: Error) -> String {
        guard let failure = error as? APIFailure else { return "操作未完成，请稍后重试。" }
        switch failure {
        case .server(_, "INVALID_REQUEST"):
            return "请检查账户名、密码和昵称。注册密码需要 15–128 个字符。"
        case .server(let status, _) where status >= 500:
            return "服务器暂时无法完成操作，请稍后重试。"
        default: return failure.errorDescription ?? "操作未完成，请稍后重试。"
        }
    }
}
