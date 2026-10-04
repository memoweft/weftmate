import Foundation
import Darwin
@_spi(Acceptance) import WeftMateCore

private struct TestCredential: Codable {
    let server: String
    let username: String
    let password: String
    var conversationID: String?
    var marker: String?
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
            let transport = URLSessionTransport()
            let server = try ServerConfiguration(input: option("--server") ?? "https://home.weftmate.com:8443")
            if args.contains("--probe") {
                stage = "native-auth-state"
                var request = URLRequest(url: URL(string: server.originString + "/personal/v1/auth/state")!)
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                let response = try await transport.send(request)
                guard response.status == 200 else { throw APIFailure.server(status: response.status, code: "HTTP_\(response.status)") }
                report(["result": "passed", "stage": stage, "httpStatus": response.status])
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
                    marker: "Apple 原会话读取联调 " + UUID().uuidString)
                // Create private file before the request. Never overwrite a prior account file.
                try writePrivate(test, path: path, create: true)
                first = try await mac.register(server: server, username: test.username, password: test.password,
                    deviceName: "Mac · Apple acceptance", displayName: "Apple 联调测试")
                stage = "seed-record-only-fixture"
                try await mac.seedAcceptanceConversation(conversationID: test.conversationID!, marker: test.marker!)
            } else {
                stage = "read-private-test-credential"
                let attrs = try FileManager.default.attributesOfItem(atPath: path)
                guard attrs[.type] as? FileAttributeType == .typeRegular,
                      let permissions = attrs[.posixPermissions] as? NSNumber, permissions.intValue & 0o077 == 0 else { throw APIFailure.credentialStorage }
                test = try JSONDecoder().decode(TestCredential.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
                guard test.server == server.originString else { throw APIFailure.invalidServer }
                stage = "login-isolated-account"
                first = try await mac.login(server: server, username: test.username, password: test.password, deviceName: "Mac · Apple acceptance")
            }
            stage = "phone-and-watch-account-device-isolation"
            let second = try await phone.login(server: server, username: test.username, password: test.password, deviceName: "iPhone · Apple acceptance")
            let third = try await watch.login(server: server, username: test.username, password: test.password, deviceName: "Apple Watch · Apple acceptance")
            guard first.account.ownerId == second.account.ownerId, second.account.ownerId == third.account.ownerId,
                  Set([first.device.id, second.device.id, third.device.id]).count == 3 else { throw APIFailure.identityMismatch }
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
            let wrong = PersonalClient(credentialStore: store, transport: transport, platform: .iOS)
            do {
                _ = try await wrong.login(server: server, username: test.username, password: "wrong-fixture-password", deviceName: "Invalid test")
                throw APIFailure.identityMismatch
            } catch APIFailure.server(401, "INVALID_CREDENTIALS") { /* expected */ }
            stage = "second-account-isolation"
            let isolated = PersonalClient(credentialStore: store, transport: transport, platform: .macOS)
            let other = try await isolated.register(server: server,
                username: "AppleOther" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16),
                password: "AppleFixture-" + UUID().uuidString + UUID().uuidString, deviceName: "Mac · Second isolated test")
            guard other.account.ownerId != first.account.ownerId,
                  try await isolated.conversations().allSatisfy({ $0.id != originalID }) else { throw APIFailure.identityMismatch }
            try await isolated.logout()
            stage = "logout"
            try await mac.logout(); try await phone.logout(); try await watch.logout()
            report(["result": "passed", "stage": "account-original-history", "distinctDevices": 3,
                "macConversationCount": macConversations.count, "phoneConversationCount": phoneConversations.count,
                "watchConversationCount": watchConversations.count, "fixtureMessageVisible": true,
                "accountIsolation": true, "keychainRestoration": true, "modelRequests": 0])
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
}
