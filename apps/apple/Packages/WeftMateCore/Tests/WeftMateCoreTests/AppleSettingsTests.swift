import Foundation
import Testing
@testable import WeftMateCore

@Test func a6RegistryMatchesD31OrderAndPlatformScope() {
    #expect(AppleSettingsRegistry.list(desktop: true).map(\.name) == ["常规", "外观", "账户", "设备", "用量", "模型", "审批", "记忆", "提醒与定时任务", "系统状态", "备份与恢复", "关于"])
    #expect(AppleSettingsRegistry.list(desktop: false).count == 10)
    #expect(AppleSettingsRegistry.list(desktop: false).allSatisfy { !$0.desktopOnly })
    #expect(Set(AppleSettingsRegistry.categories.map(\.id)).count == 12)
    #expect(AppleSettingsRegistry.category("appearance")?.icon == "palette")
    #expect(AppleSettingsRegistry.category("usage")?.icon == "chart")
}
@Test func a6SearchMatchesKeywordsAndAllTerms() {
    #expect(AppleSettingsRegistry.list(desktop: true, query: "  月度 上限  ").map(\.id) == ["usage"])
    #expect(AppleSettingsRegistry.list(desktop: true, query: "API").map(\.id) == ["models"])
    #expect(AppleSettingsRegistry.list(desktop: false, query: "备份").isEmpty)
    #expect(AppleSettingsRegistry.list(desktop: true, query: "不存在").isEmpty)
    #expect(AppleSettingsRegistry.list(desktop: true, query: "设置 深色").map(\.id) == ["appearance"])
}
@Test func a6DeepLinkPreservesConversationOnlyForUsage() {
    #expect(AppleSettingsRoute.usage(sessionID: "synthetic-session").sessionID == "synthetic-session")
    #expect(AppleSettingsRoute(categoryID: "account", sessionID: "synthetic-session").sessionID == nil)
    #expect(AppleSettingsRoute(categoryID: "usage").sessionID == nil)
    #expect(AppleSettingsRoute.usage(sessionID: "synthetic-session") != .usage(sessionID: nil))
}
@Test func a6ScheduleIdentityIsConversationScoped() throws {
    let data = Data(#"{"items":[{"id":"same","sessionId":"one","text":"合成提醒","kind":"reminder","state":"paused","timeZone":"UTC"},{"id":"same","sessionId":"two","text":"合成任务","kind":"task","state":"scheduled","timeZone":"UTC","nextRunAt":"2026-10-09T00:00:00Z"}]}"#.utf8)
    let items = try JSONDecoder().decode(ScheduleList.self, from: data).items
    #expect(Set(items.map(\.identity)).count == 2)
    #expect(items[0].nextRunAt == nil)
}

private actor SettingsTransport: HTTPTransport {
    private var requests: [URLRequest] = []
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        let json: String
        if path.hasSuffix("/auth/login") || path.hasSuffix("/auth/me") {
            json = #"{"account":{"ownerId":"owner","username":"synthetic","displayName":"合成","profileRevision":0},"device":{"id":"device","name":"iPhone","expiresAt":"2027-01-01T00:00:00Z"},"csrfToken":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}"#
        } else if path.hasSuffix("/status") { json = #"{"ownerId":"owner","hostId":"host"}"# }
        else {
            requests.append(request)
            if path.hasSuffix("/schedules"), request.httpMethod == "GET" { json = #"{"items":[]}"# }
            else if path.contains("/schedules/") { json = #"{"ok":true}"# }
            else if path.hasSuffix("/backups/settings") { json = #"{"settings":{"enabled":false,"directory":"/synthetic/Backups","dailyDays":14,"weeklyCopies":8}}"# }
            else if request.httpMethod == "POST" { json = #"{"state":"pending","restartsHost":true,"requiresLogin":true}"# }
            else { json = #"{"settings":{"enabled":true,"directory":"/synthetic/Backups","dailyDays":7,"weeklyCopies":4},"status":null,"backups":[],"excludedCredentials":true,"localUnencrypted":true}"# }
        }
        return .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)], body: Data(json.utf8))
    }
    func recorded() -> [URLRequest] { requests }
}
@Test func a6SchedulesUseScopedAuthenticatedWritesWithoutRetryingRun() async throws {
    let transport = SettingsTransport(), client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
    _ = try await client.login(server: ServerConfiguration(input: "https://settings.example.com"), username: "synthetic", password: "synthetic-password-long", deviceName: "iPhone")
    #expect(try await client.settingsSchedules().items.isEmpty)
    for action in [ScheduleAction.pause, .resume, .run, .delete] {
        try await client.manageSchedule(sessionID: "session", id: "reminder", action: action)
    }
    let requests = await transport.recorded()
    #expect(requests.map { $0.url!.path } == ["/personal/v1/schedules", "/personal/v1/schedules/session/reminder/pause", "/personal/v1/schedules/session/reminder/resume", "/personal/v1/schedules/session/reminder/run", "/personal/v1/schedules/session/reminder"])
    #expect(requests.map(\.httpMethod) == ["GET", "POST", "POST", "POST", "DELETE"])
    #expect(requests.dropFirst().allSatisfy { $0.value(forHTTPHeaderField: "X-WeftMate-CSRF") != nil && $0.value(forHTTPHeaderField: "Cookie") != nil })
    do {
        try await client.manageSchedule(sessionID: "../other", id: "reminder", action: .run)
        Issue.record("Path traversal should be rejected")
    } catch { }
    #expect(await transport.recorded().count == 5)
}
@Test func a6BackupsPreserveUnencryptedScopeAndExplicitRestoreConfirmation() async throws {
    let transport = SettingsTransport(), client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
    _ = try await client.login(server: ServerConfiguration(input: "https://settings.example.com"), username: "synthetic", password: "synthetic-password-long", deviceName: "Mac")
    let backups = try await client.settingsBackups()
    #expect(backups.localUnencrypted && backups.excludedCredentials)
    var preferences = backups.settings; preferences.enabled = false; preferences.dailyDays = 14; preferences.weeklyCopies = 8
    try await client.setBackupPreferences(preferences)
    _ = try await client.createBackup()
    let restored = try await client.restoreBackup(id: "synthetic-backup")
    #expect(restored.restartsHost && restored.requiresLogin)
    let requests = await transport.recorded()
    #expect(requests.map(\.httpMethod) == ["GET", "PATCH", "POST", "POST"])
    let body = try JSONSerialization.jsonObject(with: requests.last!.httpBody!) as! [String: Any]
    #expect(body["confirm"] as? Bool == true)
    #expect(body["id"] as? String == "synthetic-backup")
}
