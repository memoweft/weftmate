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
    init() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshID, using: nil) { [weak self] task in
            Task { @MainActor in
                guard let self, let app = self.app else { task.setTaskCompleted(success: false); return }
                let work = Task { await self.activate(app: app); task.setTaskCompleted(success: !Task.isCancelled) }
                task.expirationHandler = {
                    work.cancel()
                    Task { @MainActor in self.operation?.cancel() }
                }
            }
        }
    }
    private func prepare(_ app: AppleAppModel) throws -> Bool {
        self.app = app
        guard let session = app.session else {
            operation?.cancel(); reader.stop(); local = nil; scope = nil; epoch = nil; generation = UUID(); state = .init(); return false
        }
        let account = try LocalAccountScope(server: session.server, ownerId: session.account.ownerId)
        if scope != account || epoch != app.accountEpoch {
            operation?.cancel(); reader.stop(); generation = UUID(); scope = account; epoch = app.accountEpoch
            local = DailyHealthStore(directory: app.healthStateDirectory, account: account)
            state = try local!.load(); review = nil
        }
        return true
    }
    private func matches(_ app: AppleAppModel, _ token: UUID) -> Bool {
        generation == token && app.accountEpoch == epoch && app.session?.account.ownerId == scope?.ownerId
            && app.session?.server.originString == scope?.originString
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
    private func run(app: AppleAppModel, token: UUID) async {
        var sent = 0
        do {
            guard app.session?.verification == .verified else { return }
            if state.enabled, state.connected, reader.available {
                await reader.observe { [weak self, weak app] in
                    guard let self, let app, self.state.enabled else { return }
                    await self.activate(app: app)
                }
                guard matches(app, token), state.enabled, !Task.isCancelled else { reader.stop(); return }
            }
            do {
                let reply = try await app.assistantClient.dailyReviewSettings()
                guard matches(app, token), !Task.isCancelled else { return }
                review = reply.settings; state.retentionDays = reply.settings.reviewRetentionDays
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
                let values = try await reader.read(calendar: calendar)
                guard matches(app, token), state.enabled, !Task.isCancelled else { return }
                state.enqueue(values); try save()
                schedule()
            }
            for (day, value) in state.pending.sorted(by: { $0.key < $1.key }) {
                guard matches(app, token), !Task.isCancelled else { return }
                try await app.assistantClient.putDailyHealth(day: day, health: value, account: scope)
                guard matches(app, token), !Task.isCancelled else { return }
                state.acknowledge(day: day, value: value, now: Date()); try save(); sent += 1
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
