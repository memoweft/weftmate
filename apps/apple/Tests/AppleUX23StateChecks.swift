import Foundation
import WeftMateCore
private struct EmptyCredentials: CredentialStore { func load(key: String) -> Data? { nil }; func save(_ data: Data,key: String) {}; func delete(key: String) {} }
private struct EmptyDrafts: AppleDraftPersisting {
    func loadDrafts(account: LocalAccountScope) async throws -> [String:String] { [:] }
    func saveDraft(account: LocalAccountScope,conversationId: String,text: String) async throws {}
}
private actor UXHTTP: HTTPTransport {
    var owner = "synthetic-A"
    var pause = false
    var wrongZone = false
    var gate: CheckedContinuation<Void,Never>?
    var reads: [String] = []
    func configure(owner: String? = nil,pause: Bool = false,wrongZone: Bool = false) { if let owner { self.owner = owner }; self.pause = pause; self.wrongZone = wrongZone }
    func paused() -> Bool { gate != nil }
    func release() { pause = false; gate?.resume(); gate = nil }
    func readOrder() -> [String] { reads }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        let json: String
        switch path {
        case "/personal/v1/auth/login","/personal/v1/auth/me": json = """
        {"account":{"ownerId":"\(owner)","username":"synthetic","displayName":"合成账户"},"device":{"id":"synthetic-device","name":"合成 Mac"},"csrfToken":"\(String(repeating:"b",count:43))"}
        """
        case "/personal/v1/auth/logout": json = "{}"
        case "/personal/v1/status": json = "{\"ownerId\":\"\(owner)\",\"hostId\":\"synthetic-host\"}"
        case "/personal/v1/sync/events": json = #"{"events":[],"nextSeq":0,"hasMore":false}"#
        case "/personal/v1/sessions": json = #"{"sessions":[]}"#
        case "/personal/v1/auth/devices": json = #"{"devices":[{"id":"synthetic-device","name":"合成 Mac","current":true}]}"#
        case "/personal/v1/session-groups": json = #"{"groups":[]}"#
        case "/personal/v1/projects": json = #"{"projects":[],"canManage":false}"#
        case "/personal/v1/settings/usage":
            reads.append("settings")
            json = #"{"monthlyLimit":100,"canManage":false,"models":[],"timeZone":"Asia/Shanghai"}"#
        case "/personal/v1/usage":
            let query = URLComponents(url: request.url!,resolvingAgainstBaseURL: false)!.queryItems!
            let month = query.first { $0.name == "month" }!.value!, zone = query.first { $0.name == "timeZone" }!.value!
            reads.append("usage:" + zone)
            let cost = owner == "synthetic-A" ? 25 : 50, responseZone = wrongZone ? "UTC" : zone
            if pause { await withCheckedContinuation { gate = $0 } }
            json = """
            {"month":"\(month)","timeZone":"\(responseZone)","total":{"requests":3,"unknownRequests":0,"unpricedRequests":0,"inputTokens":10,"cachedInputTokens":0,"outputTokens":1,"cost":\(cost)},"days":[],"sessions":[],"models":[],"budget":{"effectiveLimit":100,"state":"ok"}}
            """
        default: return .init(status:404,headers:[:],body:Data(#"{"error":{"code":"NOT_FOUND"}}"#.utf8))
        }
        return .init(status:200,headers:["set-cookie":"wm_personal_session=" + String(repeating:"a",count:43)],body:Data(json.utf8))
    }
}
private func check(_ condition: Bool,_ message: String) throws { if !condition { throw NSError(domain:message,code:1) } }
@main private struct AppleUX23StateChecks {
    @MainActor static func main() async throws {
        let http = UXHTTP(), suite = "a15-state-" + UUID().uuidString
        let preferences = UserDefaults(suiteName: suite)!
        defer { preferences.removePersistentDomain(forName: suite) }
        let app = AppleAppModel(client:PersonalClient(credentialStore:EmptyCredentials(),transport:http),draftPersistence:EmptyDrafts(),server:try ServerConfiguration(input:"https://synthetic.example.com"),preferences:preferences)
        await app.authenticate(username:"synthetic",password:"synthetic-test-only",displayName:nil,register:false)
        let usage = AccountUsageModel(app:app)
        await usage.refresh()
        try check(usage.summary?.total.cost == 25,"Initial amount: auth=" + (app.authError ?? "ok") + "; usage=" + (usage.error ?? "nil"))
        let order = await http.readOrder(); try check(order == ["settings","usage:Asia/Shanghai"],"Account time zone must precede statistics")
        await http.configure(pause:true)
        let late = Task { await usage.refresh() }
        while !(await http.paused()) { await Task.yield() }
        await app.signOut(); await http.configure(owner:"synthetic-B")
        await app.authenticate(username:"synthetic",password:"synthetic-test-only",displayName:nil,register:false)
        await http.release(); await late.value
        try check(usage.summary == nil,"Late prior account usage must be dropped")
        await usage.refresh(); try check(usage.summary?.total.cost == 50,"Current account amount")
        await http.configure(wrongZone:true); await usage.refresh(); try check(usage.summary == nil,"Mismatch statistics time zone must be dropped")
        await app.signOut()
        print("PASS A15 actual usage callbacks: settings before statistics, account-zone query, prior-account discard, current-account amount, mismatched-zone discard")
    }
}
