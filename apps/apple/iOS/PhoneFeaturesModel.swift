import Foundation
import Combine
import WeftMateCore

@MainActor final class PhoneFeaturesModel: ObservableObject {
    @Published var activity: [PhoneActivity] = []
    @Published var tasks: [PhoneTask] = []
    @Published var recent: [PhoneTask] = []
    @Published var schedules: [ManagedSchedule] = []
    @Published var goals: [PhoneGoal] = []
    @Published var files: [PhoneLibraryItem] = []
    @Published var loading = false
    @Published var errors: [String:String] = [:]
    @Published var busy: Set<String> = []
    @Published var type = ""
    @Published var search = ""
    @Published var filter = "all"
    @Published var weekly: HealthWeeklyReply?
    @Published var capabilities: [String:Int] = [:]
    var nextActivity: String?
    var nextLibrary: String?
    private var epoch: UUID?
    private var generation = UUID()
    private var requestIDs: [String:String] = [:]
    private var queries: [String:String] = [:]
    func prepare(_ app: AppleAppModel) {
        guard epoch != app.accountEpoch else { return }
        epoch=app.accountEpoch; generation=UUID(); loading=false; busy=[]; errors=[:]; requestIDs=[:]; queries=[:]
        activity=[]; tasks=[]; recent=[]; schedules=[]; goals=[]; files=[]; weekly=nil; capabilities=[:]
        type=""; search=""; filter="all"; nextActivity=nil; nextLibrary=nil
    }
    func read(_ page: String, app: AppleAppModel, more: Bool = false) async {
        prepare(app)
        let query=page == "library" ? type+"|"+search : page == "activity" ? filter : ""
        if queries[page] != query {
            generation=UUID(); loading=false; queries[page]=query
            if page == "library" { files=[]; nextLibrary=nil }
            if page == "activity" { activity=[]; nextActivity=nil }
        }
        guard !loading, app.session != nil else { return }
        let token=app.accountEpoch, version=UUID(); generation=version; loading=true
        defer { if token == app.accountEpoch && generation == version { loading=false } }
        do {
            let status=try await app.assistantClient.nativeUpdateStatus()
            guard token == app.accountEpoch, generation == version, !Task.isCancelled else { return }
            capabilities=(status.personalCapabilities ?? [:]).compactMapValues(\.int)
        } catch { if token == app.accountEpoch { errors[page]=PhoneFeaturePolicy.failure(error) }; return }
        let parts = page == "goals" ? ["tasks","schedules","goals"] : [page]
        for part in parts {
            let cap = part == "tasks" ? "taskOverview" : part == "schedules" ? "scheduleEditing" : part
            guard PhoneFeaturePolicy.supported(capabilities,cap) else { errors[part]="更新电脑上的 WeftMate 后可使用这项功能。"; continue }
            do {
                switch part {
                case "activity":
                    let page=try await app.assistantClient.phoneActivity(filter:filter,cursor:more ? nextActivity : nil)
                    guard token == app.accountEpoch, generation == version, !Task.isCancelled else { return }
                    activity=more ? activity+page.items : page.items; nextActivity=page.nextCursor
                    // HEALTH-5 owns weekly health; it is independent from the activity summary.
                    let week=try? await app.assistantClient.healthWeekly()
                    guard token == app.accountEpoch, generation == version, !Task.isCancelled else { return }; weekly=week
                case "tasks":
                    let page=try await app.assistantClient.phoneTasks(); guard token == app.accountEpoch, generation == version else { return }; tasks=page.items; recent=page.recent
                case "schedules":
                    let page=try await app.assistantClient.settingsSchedules(); guard token == app.accountEpoch, generation == version else { return }; schedules=page.items
                case "goals":
                    let page=try await app.assistantClient.phoneGoals(); guard token == app.accountEpoch, generation == version else { return }; goals=page.items
                default:
                    let page=try await app.assistantClient.phoneLibrary(type:type,search:search,cursor:more ? nextLibrary : nil)
                    guard token == app.accountEpoch, generation == version, !Task.isCancelled else { return }; files=more ? files+page.items : page.items; nextLibrary=page.nextCursor
                }
                errors[part]=nil
            } catch {
                guard token == app.accountEpoch, generation == version else { return }
                errors[part]=PhoneFeaturePolicy.failure(error)
                if case APIFailure.server(409,"CURSOR_RESET_REQUIRED") = error {
                    if part == "activity" { activity=[]; nextActivity=nil } else if part == "library" { files=[]; nextLibrary=nil }
                }
            }
        }
    }
    func write(_ key: String, page: String, app: AppleAppModel, operation: (String) async throws -> Void) async {
        prepare(app); guard !busy.contains(key) else { return }
        let token=app.accountEpoch; busy.insert(key)
        let id=requestIDs[key] ?? UUID().uuidString; requestIDs[key]=id
        defer { if token == app.accountEpoch { busy.remove(key) } }
        do { try await operation(id); guard token == app.accountEpoch else { return }; requestIDs[key]=nil; errors[page]=nil; await read(page,app:app) }
        catch { if token == app.accountEpoch { errors[page]=PhoneFeaturePolicy.failure(error) } }
    }
    func open(_ source: PhoneSource, app: AppleAppModel) async {
        guard let session=source.sessionId else { return }
        app.openedSessionID=source.chatId ?? session
        if let chat=source.chatId, let event=source.eventId {
            await app.mainChat.returnToSource(.object(["chatId":.string(chat),"eventId":.string(event),"seq":.number(Double(source.seq ?? 0))]))
        } else if let seq=source.seq, let row=app.conversations.first(where: { $0.sessionId == session }) {
            await app.locateNativeSource(row,sequence:seq)
        }
    }
}
