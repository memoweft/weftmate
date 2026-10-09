import Foundation
import WeftMateCore

private struct NoCredentials: CredentialStore {
    func load(key: String) -> Data? { nil }
    func save(_ data: Data, key: String) {}
    func delete(key: String) {}
}
private actor SummaryHTTP: HTTPTransport {
    var archives = 0
    func setArchives(_ count: Int) { archives = count }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let json: String
        switch request.url!.path {
        case "/personal/v1/auth/login", "/personal/v1/auth/me":
            json = #"{"account":{"ownerId":"synthetic-owner","username":"synthetic","displayName":"合成账户"},"device":{"id":"synthetic-device","name":"合成 Mac"},"csrfToken":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}"#
        case "/personal/v1/status": json = #"{"ownerId":"synthetic-owner","hostId":"synthetic-host"}"#
        case "/personal/v1/sync/events": json = #"{"events":[],"nextSeq":0,"hasMore":false}"#
        case "/personal/v1/session-groups": json = #"{"groups":[]}"#
        case "/personal/v1/auth/devices": json = #"{"devices":[{"id":"synthetic-device","name":"合成 Mac","current":true}]}"#
        case "/personal/v1/sessions":
            let rows = (0...archives).map { ["sessionId": "synthetic-\($0)", "title": "合成对话", "archived": $0 > 0, "running": false, "sendAvailable": $0 == 0] as [String: Any] }
            json = String(data: try JSONSerialization.data(withJSONObject: ["sessions": rows]), encoding: .utf8)!
        default: throw SummaryFailure(category: "Unexpected HTTP route")
        }
        return .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)], body: Data(json.utf8))
    }
}
private struct NoDrafts: AppleDraftPersisting {
    func loadDrafts(account: LocalAccountScope) async throws -> [String: String] { [:] }
    func saveDraft(account: LocalAccountScope, conversationId: String, text: String) async throws {}
}
private struct SummaryFailure: Error { let category: String }
@main private struct AppleSettingsSummaryChecks {
    @MainActor static func main() async throws {
        let http = SummaryHTTP()
        let app = AppleAppModel(client: PersonalClient(credentialStore: NoCredentials(), transport: http),
                                draftPersistence: NoDrafts(), server: try ServerConfiguration(input: "https://synthetic.example.com"))
        let model = AppleSettingsModel(app: app)
        let expected = ["general": "简体中文", "appearance": "跟随系统", "account": "账户", "devices": "0 台设备",
                        "usage": "本月费用与上限", "archived": "无", "models": "主模型与单价", "approvals": "新对话默认模式",
                        "memory": "记忆与来源", "schedules": "提醒与任务", "system": "已连接", "backups": "电脑本地备份",
                        "about": model.installedVersion + " / " + model.installedBuild]
        guard Set(expected.keys) == Set(AppleSettingsRegistry.categories.map(\.id)) else { throw SummaryFailure(category: "registry coverage") }
        for category in AppleSettingsRegistry.categories {
            guard model.summary(category.id) == expected[category.id] else { throw SummaryFailure(category: category.id) }
        }
        for mode in AppleAppearance.allCases {
            app.appearanceMode = mode.rawValue
            guard model.summary("appearance") == mode.title else { throw SummaryFailure(category: "appearance") }
        }
        await app.authenticate(username: "synthetic", password: "synthetic-password-long", displayName: nil, register: false)
        guard app.session != nil, model.summary("account") == "合成账户" else { throw SummaryFailure(category: "local account: " + (app.authError ?? "missing session")) }
        guard model.summary("devices") == "1 台设备" else { throw SummaryFailure(category: "local devices") }
        for count in [1, 2, 0] {
            await http.setArchives(count); await app.refresh()
            guard model.summary("archived") == (count == 0 ? "无" : "\(count) 条") else { throw SummaryFailure(category: "archive count \(count)") }
        }
        guard model.summary("unknown") == "" else { throw SummaryFailure(category: "unknown") }
        print("PASS: all 13 registered summaries; appearance modes, local account, archive 0/1/2, unknown category")
    }
}
