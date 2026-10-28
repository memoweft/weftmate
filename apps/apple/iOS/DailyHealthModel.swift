import Combine
import Foundation
import BackgroundTasks
import WeftMateCore

@MainActor final class DailyHealthModel: ObservableObject {
    @Published private(set) var state = DailyHealthState()
    @Published private(set) var busy = false
    @Published private(set) var review: DailyReviewSettings?
    let reader = DailyHealthReader()
    private var local: DailyHealthStore?
    private var scope: LocalAccountScope?
    private var epoch: UUID?
    private weak var app: AppleAppModel?
    private var generation = UUID()
    private var operation: Task<Void, Never>?
    private var activationPending = false
    static let refreshID = "com.weftmate.apple.daily-health"
    func runBackgroundRefresh() async -> Bool {
        guard let app else { return false }
        await activate(app:app); return !Task.isCancelled
    }
    func cancelBackgroundRead() { operation?.cancel() }
    private func prepare(_ app: AppleAppModel) throws -> Bool {
        self.app = app; DailyHealthBackground.attach(self)
        let account: LocalAccountScope
        if let session=app.session { account=try LocalAccountScope(server:session.server,ownerId:session.account.ownerId) }
        else { account=try LocalAccountScope(server:ServerConfiguration(input:"https://phone.weftmate.invalid"),ownerId:app.phoneAccountIdentity) }
        if scope != account || epoch != app.accountEpoch {
            operation?.cancel(); reader.stop(); generation = UUID(); scope = account; epoch = app.accountEpoch
            local = DailyHealthStore(directory: app.healthStateDirectory, account: account)
            state = try local!.load(); review = nil
        }
        return true
    }
    private func matches(_ app: AppleAppModel, _ token: UUID) -> Bool {
        generation == token && app.accountEpoch == epoch && (app.session.map { $0.account.ownerId == scope?.ownerId && $0.server.originString == scope?.originString } ?? (app.phoneAccountIdentity == scope?.ownerId))
    }
    private func save() throws { try local?.save(state) }
    func connect(app: AppleAppModel) async {
        guard !busy, reader.available else { return }
        do {
            guard try prepare(app) else { return }
            busy = true; let token = generation
            try await reader.authorize()
            guard matches(app, token) else { busy = false; return }
            state.connected = true; state.enabled = true; try save(); busy = false
            await activate(app: app)
        } catch { busy = false; log(0, success: false, category: "api") }
    }
    var needsExpansion: Bool { state.connected && state.enabled && state.expandedAuthorization != true }
    func checkExpansion(app: AppleAppModel) async -> Bool {
        guard needsExpansion else { return false }
        if await reader.needsExpandedAuthorization() { return true }
        do { guard try prepare(app) else { return false }; state.expandedAuthorization = true; try save(); await activate(app: app) } catch { }
        return false
    }
    func expand(app: AppleAppModel) async {
        do {
            guard try prepare(app) else { return }
            let token = generation
            try await reader.authorizeExpanded()
            guard matches(app, token) else { return }
            // HealthKit deliberately does not reveal read denial. An attempted request is sufficient;
            // absent measurements remain missing and existing authorized content still works.
            state.expandedAuthorization = true; state.connected = true; state.enabled = true; try save()
            await activate(app: app)
        } catch { log(0, success: false, category: "api") }
    }
    func setEnabled(_ enabled: Bool, app: AppleAppModel) async {
        do {
            guard try prepare(app) else { return }
            // Immediately invalidate an in-flight read/send. Its server write is covered by clearRemote.
            generation = UUID(); operation?.cancel()
            if enabled { state.enabled = true } else {
                state.disable(); reader.stop(); BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshID)
            }
            try save()
            if !busy { await activate(app: app) }
        } catch { log(0, success: false, category: "storage") }
    }
    func dismissHint(app: AppleAppModel) {
        do { guard try prepare(app) else { return }; state.hintDismissed = true; try save() }
        catch { log(0, success: false, category: "storage") }
    }
    func setReview(_ enabled: Bool, app: AppleAppModel) async {
        let token = generation
        do { let value = try await app.assistantClient.setDailyReview(enabled); if matches(app, token) { review = value.settings } }
        catch { log(0, success: false, category: "network") }
    }
    func activate(app: AppleAppModel) async {
        do { guard try prepare(app) else { return } }
        catch { log(0, success: false, category: "storage"); return }
        guard !busy else { activationPending = true; return }
        let token = generation
        busy = true
        let task = Task { await run(app: app, token: token) }; operation = task
        await task.value; operation = nil; busy = false
        // Coalesce actual foreground/observer triggers received during a suspended read or send.
        // This is driven by an event, never a timer or an automatic loop on network failure.
        let requestedAgain = activationPending; activationPending = false
        if (token != generation || requestedAgain), app.session != nil { await activate(app: app) }
    }
    /// Created only after the owner explicitly navigates to Health.
    func enteredHealthPage(app: AppleAppModel) async {
        #if DEBUG && targetEnvironment(simulator)
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-testing"), args.contains("--health4-render-only") { return }
        #endif
        do { guard try prepare(app) else { return } }
        catch { log(0, success: false, category: "storage"); return }
        if !state.connected { await connect(app: app) }
        else { await activate(app: app) }
    }
    /// The SDK-facing callback has no inherited UI executor; UI references are dereferenced only after the hop.
    nonisolated private static func makeObserverUpdate(model: DailyHealthModel, app: AppleAppModel) -> @Sendable () async -> Void {
        { @Sendable [weak model, weak app] in
            await Task { @MainActor in
                guard let model, let app, model.state.enabled else { return }
                await model.activate(app: app)
            }.value
        }
    }
    private func run(app: AppleAppModel, token: UUID) async {
        var sent = 0
        do {
            if app.session == nil {
                if state.enabled, state.connected, reader.available {
                    var calendar=Calendar(identifier:.gregorian); calendar.timeZone = .current
                    let values=try await reader.read(calendar:calendar,version:3)
                    guard matches(app,token), state.enabled, !Task.isCancelled else { return }
                    state.timeZone=calendar.timeZone.identifier; state.enqueue(values); state.prune(now:Date(),calendar:calendar); try save()
                }
                return
            }
            guard app.session?.verification == .verified else { return }
            if state.enabled, state.connected, reader.available {
                await reader.observe(update: Self.makeObserverUpdate(model: self, app: app))
                guard matches(app, token), state.enabled, !Task.isCancelled else { reader.stop(); return }
            }
            do {
                let reply = try await app.assistantClient.dailyReviewSettings()
                guard matches(app, token), !Task.isCancelled else { return }
                review = reply.settings; state.retentionDays = 90
                state.timeZone = reply.timeZone
                try save()
            } catch {
                guard matches(app, token), !Task.isCancelled else { return }
                // Read against the last verified account timezone while its computer is offline.
                if state.timeZone == nil { log(0, success: false, category: "network"); return }
            }
            guard matches(app, token), !Task.isCancelled else { return }
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: state.timeZone!) ?? .current
            state.prune(now: Date(), calendar: calendar); try save()
            if state.needsRemoteClear {
                let remote = try await app.assistantClient.dailySummaries()
                guard matches(app, token), !Task.isCancelled else { return }
                state.clearRemote(remote.items.filter { $0.health.status == "available" }.map(\.day)); state.prune(now: Date(), calendar: calendar); try save()
            }
            // Clear operations take precedence even if the user has already re-enabled reading.
            guard let scope else { return }
            for (day, value) in state.pending.filter({ $0.value.status == "unavailable" }).sorted(by: { $0.key < $1.key }) {
                guard matches(app, token), !Task.isCancelled else { return }
                try await app.assistantClient.putDailyHealth(day: day, health: value, account: scope)
                guard matches(app, token), !Task.isCancelled else { return }
                state.acknowledge(day: day, value: value, now: Date()); try save(); sent += 1
            }
            if state.enabled, state.connected, reader.available {
                let overview = try? await app.assistantClient.healthOverview()
                guard matches(app, token), !Task.isCancelled else { return }
                let version = HealthPagePolicy.recordVersion(overview?.capabilities)
                if state.expandedAuthorization == true { state.beginHistory(version: version, now: Date(), calendar: calendar); try save() }
                let values = try await reader.read(calendar: calendar,version: version)
                guard matches(app, token), state.enabled, !Task.isCancelled else { return }
                state.enqueue(values); try save(); schedule()
                // Persist one small batch at a time. iOS may suspend this task at any await.
                while state.historyTargetVersion == version, !state.nextHistoryDays.isEmpty {
                    let keys = state.nextHistoryDays
                    let dates = keys.compactMap { key -> Date? in
                        let f = DateFormatter(); f.calendar = calendar; f.timeZone = calendar.timeZone; f.dateFormat = "yyyy-MM-dd"; return f.date(from: key)
                    }
                    let history = try await reader.read(days: dates,calendar: calendar,version: version)
                    guard matches(app, token), state.enabled, !Task.isCancelled else { return }
                    state.enqueue(history); try save()
                    let items = keys.compactMap { key in state.pending[key].map { HealthBatchItem(day:key,health:$0) } }
                    if !items.isEmpty {
                        let reply = try await app.assistantClient.putHealthBatch(items,account: scope)
                        guard matches(app, token), state.enabled, !Task.isCancelled else { return }
                        guard Set(reply.items.map(\.day)) == Set(items.map(\.day)) else { throw APIFailure.invalidResponse }
                        for item in items { state.acknowledge(day:item.day,value:item.health,now:Date()) }; sent += items.count
                    }
                    state.acknowledgeHistory(keys); try save()
                    await Task.yield()
                }
                if HealthUploadPolicy.sendsProfile(overview?.capabilities) {
                    let profile = await reader.profile()
                    guard matches(app, token), state.enabled, !Task.isCancelled else { return }
                    if state.profileDelivered != profile {
                        try await app.assistantClient.putHealthProfile(profile,account: scope)
                        guard matches(app, token), state.enabled, !Task.isCancelled else { return }
                        state.profileDelivered = profile; try save()
                    }
                }
            }
            // A downgraded computer must never receive persisted v3 fields.
            let current = try? await app.assistantClient.healthOverview()
            guard matches(app, token), !Task.isCancelled else { return }
            for (day, queued) in state.pending.sorted(by: { $0.key < $1.key }) {
                let value = HealthUploadPolicy.wireRecord(queued,capabilities:current?.capabilities)
                guard matches(app, token), !Task.isCancelled else { return }
                try await app.assistantClient.putDailyHealth(day: day, health: value, account: scope)
                guard matches(app, token), !Task.isCancelled else { return }
                state.acknowledge(day: day, value: queued, now: Date()); try save(); sent += 1
            }
            if sent > 0 { log(sent, success: true) }
        } catch {
            guard matches(app, token) else { return }
            log(sent, success: false, category: error is APIFailure ? "api" : error is URLError ? "network" : "storage")
        }
    }
    private func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshID); request.earliestBeginDate = Date().addingTimeInterval(3600)
        try? BGTaskScheduler.shared.submit(request)
    }
    private func log(_ days: Int, success: Bool, category: String = "unknown") {
        RunLogRuntime.shared.record(.state, ["phase": "health_delivery", "dayCount": String(days), "result": success ? "success" : "failure", "errorType": category])
    }
    var status: String {
        if !reader.available { return "这台设备不支持" }
        guard state.connected && state.enabled else { return "还没接上" }
        if let last = state.lastSent {
            let calendar = Calendar.current
            let time = DateFormatter(); time.locale = Locale(identifier: "zh_CN"); time.timeZone = calendar.timeZone; time.dateFormat = "H:mm"
            let day = calendar.isDateInToday(last) ? "今天" : calendar.isDateInYesterday(last) ? "昨天" : DeviceDateText.day(DailyHealthCalendar.key(last, calendar: calendar))
            return "已接上 · 最近一次送出 " + day + " " + time.string(from: last)
        }
        return "已接上"
    }
    var showsHint: Bool { reader.available && !state.connected && !state.hintDismissed }
}
