import Foundation
import Darwin
@_spi(Acceptance) import WeftMateCore

private struct TestCredential: Codable {
    let server: String
    let username: String
    let password: String
    var conversationID: String?
    var marker: String?
    var conversationTitle: String?
}

@main struct AppleAcceptance {
    static func main() async {
        var stage = "arguments"
        do {
            let args = Array(CommandLine.arguments.dropFirst())
            func option(_ key: String) -> String? {
                guard let i = args.firstIndex(of: key), args.indices.contains(i + 1) else { return nil }
                return args[i + 1]
            }
            let transport: URLSessionTransport
            if args.contains("--development-proxy-port") {
                #if DEBUG
                guard let proxyArgument = option("--development-proxy-port"), let port = Int(proxyArgument) else { throw APIFailure.invalidServer }
                transport = try URLSessionTransport(developmentProxyPort: port)
                #else
                throw APIFailure.invalidServer
                #endif
            } else { transport = URLSessionTransport() }
            let server = try ServerConfiguration(input: option("--server") ?? "https://home.weftmate.com:8443")
            if args.contains("--probe") {
                stage = "native-auth-state"
                var request = URLRequest(url: URL(string: server.originString + "/personal/v1/auth/state")!)
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                let response = try await transport.send(request)
                guard response.status == 200 else { throw APIFailure.server(status: response.status, code: "HTTP_\(response.status)") }
                report(["result": "passed", "stage": stage, "httpStatus": response.status,
                    "route": option("--development-proxy-port") == nil ? "system" : "developmentLoopbackCONNECT"])
                return
            }
            guard let path = option("--credentials-file"), path.hasPrefix("/") else { throw APIFailure.invalidResponse }
            let store = KeychainCredentialStore(service: "com.weftmate.apple.acceptance.\(UUID().uuidString)")
            let mac = PersonalClient(credentialStore: store, transport: transport, platform: .macOS)
            let phone = PersonalClient(credentialStore: store, transport: transport, platform: .iOS)
            let watch = PersonalClient(credentialStore: store, transport: transport, platform: .watchOS)
            var test: TestCredential
            let first: AccountSession
            if args.contains("--create-test-account") {
                stage = "register-isolated-account"
                test = TestCredential(server: server.originString, username: "AppleTest" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16),
                    password: "AppleFixture-" + UUID().uuidString + UUID().uuidString, conversationID: UUID().uuidString.lowercased(),
                    marker: "Apple 原会话读取联调 " + UUID().uuidString, conversationTitle: "Apple 联调测试记录")
                // Create private file before the request. Never overwrite a prior account file.
                try writePrivate(test, path: path, create: true)
                first = try await mac.register(server: server, username: test.username, password: test.password,
                    deviceName: "Mac · Apple acceptance", displayName: "Apple 联调测试")
                stage = "seed-record-only-fixture"
                try await mac.seedAcceptanceConversation(conversationID: test.conversationID!, marker: test.marker!)
            } else {
                stage = "read-private-test-credential"
                test = try readPrivate(path: path)
                guard test.server == server.originString else { throw APIFailure.invalidServer }
                stage = "login-isolated-account"
                first = try await mac.login(server: server, username: test.username, password: test.password, deviceName: "Mac · Apple acceptance")
            }
            stage = "phone-and-watch-account-device-isolation"
            let second = try await phone.login(server: server, username: test.username, password: test.password, deviceName: "iPhone · Apple acceptance")
            let third = try await watch.login(server: server, username: test.username, password: test.password, deviceName: "Apple Watch · Apple acceptance")
            guard first.account.ownerId == second.account.ownerId, second.account.ownerId == third.account.ownerId,
                  Set([first.device.id, second.device.id, third.device.id]).count == 3 else { throw APIFailure.identityMismatch }
            stage = "apple-platform-capabilities"
            try await mac.declareAcceptanceCapabilities()
            try await phone.declareAcceptanceCapabilities()
            try await watch.declareAcceptanceCapabilities()
            stage = "original-conversation-read"
            let macConversations = try await mac.conversations()
            let phoneConversations = try await phone.conversations()
            let watchConversations = try await watch.conversations()
            guard let originalID = test.conversationID, let marker = test.marker,
                  let macOriginal = macConversations.first(where: { $0.id == originalID }),
                  let phoneOriginal = phoneConversations.first(where: { $0.id == originalID }),
                  let watchOriginal = watchConversations.first(where: { $0.id == originalID }) else { throw APIFailure.invalidResponse }
            let macHistory = try await mac.history(conversation: macOriginal)
            let phoneHistory = try await phone.history(conversation: phoneOriginal)
            let watchHistory = try await watch.history(conversation: watchOriginal)
            guard [macHistory, phoneHistory, watchHistory].allSatisfy({ rows in rows.contains(where: { $0.text == marker && $0.role == .user }) }) else { throw APIFailure.invalidResponse }
            stage = "devices-and-keychain-restore"
            let devices = try await phone.devices()
            let restarted = PersonalClient(credentialStore: store, transport: transport, platform: .iOS)
            let restored = try await restarted.restoreSession(server: server)
            guard restored?.device.id == second.device.id, devices.contains(where: { $0.id == third.device.id }),
                  restored?.verification == .verified else { throw APIFailure.identityMismatch }
            stage = "wrong-password"
            // A failed login deliberately clears that client's persisted identity. Keep this probe separate.
            let wrong = PersonalClient(credentialStore: KeychainCredentialStore(service: "com.weftmate.apple.acceptance.wrong.\(UUID().uuidString)"),
                transport: transport, platform: .iOS)
            do {
                _ = try await wrong.login(server: server, username: test.username, password: "wrong-fixture-password", deviceName: "Invalid test")
                throw APIFailure.identityMismatch
            } catch APIFailure.server(401, "INVALID_CREDENTIALS") { /* expected */ }
            let afterWrong = PersonalClient(credentialStore: store, transport: transport, platform: .iOS)
            guard try await afterWrong.restoreSession(server: server)?.device.id == second.device.id else { throw APIFailure.identityMismatch }
            stage = "second-account-isolation"
            let isolated = PersonalClient(credentialStore: KeychainCredentialStore(service: "com.weftmate.apple.acceptance.other.\(UUID().uuidString)"),
                transport: transport, platform: .macOS)
            let otherPath = path + ".second-account.json"
            let other: AccountSession
            if FileManager.default.fileExists(atPath: otherPath) {
                let savedOther = try readPrivate(path: otherPath)
                guard savedOther.server == server.originString else { throw APIFailure.invalidServer }
                other = try await isolated.login(server: server, username: savedOther.username, password: savedOther.password,
                    deviceName: "Mac · Second isolated test")
            } else {
                let newOther = TestCredential(server: server.originString,
                    username: "AppleOther" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16),
                    password: "AppleFixture-" + UUID().uuidString + UUID().uuidString)
                try writePrivate(newOther, path: otherPath, create: true)
                other = try await isolated.register(server: server, username: newOther.username, password: newOther.password,
                    deviceName: "Mac · Second isolated test")
            }
            guard other.account.ownerId != first.account.ownerId,
                  try await isolated.conversations().allSatisfy({ $0.id != originalID }) else { throw APIFailure.identityMismatch }
            try await isolated.logout()
            let afterOther = PersonalClient(credentialStore: store, transport: transport, platform: .macOS)
            guard try await afterOther.restoreSession(server: server)?.device.id == first.device.id else { throw APIFailure.identityMismatch }
            stage = "logout"
            try await mac.logout(); try await phone.logout(); try await watch.logout()
            for platform in ApplePlatform.allCases {
                let loggedOut = PersonalClient(credentialStore: store, transport: transport, platform: platform)
                guard try await loggedOut.restoreSession(server: server) == nil else { throw APIFailure.identityMismatch }
            }
            report(["result": "passed", "stage": "account-original-history", "distinctDevices": 3,
                "macConversationCount": macConversations.count, "phoneConversationCount": phoneConversations.count,
                "watchConversationCount": watchConversations.count, "fixtureMessageVisible": true,
                "accountIsolation": true, "keychainRestoration": true, "persistedLogout": true,
                "appleCapabilities": ["macos", "ios", "watchos"], "modelTransferDeclared": false,
                "route": option("--development-proxy-port") == nil ? "system" : "developmentLoopbackCONNECT", "modelRequests": 0])
        } catch {
            let safe = (error as? APIFailure)?.safeCode ?? "ACCEPTANCE_FAILED"
            report(["result": "failed", "stage": stage, "code": safe])
            exit(1)
        }
    }
    private static func report(_ values: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) { print(text) }
    }
    private static func writePrivate(_ test: TestCredential, path: String, create: Bool) throws {
        let fd = open(path, O_WRONLY | O_CREAT | (create ? O_EXCL : O_TRUNC) | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw APIFailure.credentialStorage }
        let file = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        try file.write(contentsOf: JSONEncoder().encode(test)); try file.synchronize(); try file.close()
    }
    private static func readPrivate(path: String) throws -> TestCredential {
        let fd = open(path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw APIFailure.credentialStorage }
        let file = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? file.close() }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o077 == 0,
              info.st_size > 0, info.st_size <= 16_384 else { throw APIFailure.credentialStorage }
        return try JSONDecoder().decode(TestCredential.self, from: file.readToEnd() ?? Data())
    }
}
