import Combine
import Foundation
import WeftMateCore

@MainActor final class HealthSettingsModel: ObservableObject {
    @Published private(set) var state = HealthLocalState()
    @Published private(set) var busy = false
    @Published private(set) var message: String?
    let reader = HealthKitReader()
    private let calendarOverride: Calendar?
    init(calendar: Calendar? = nil) { calendarOverride = calendar }
    private var local: HealthLocalStore?
    private var scope: LocalAccountScope?
    private var generation = UUID()
    private var accountEpoch: UUID?
    @Published private(set) var uploading = false

    func prepare(app: AppleAppModel) throws {
        guard let session = app.session else { return }
        let account = try LocalAccountScope(server: session.server, ownerId: session.account.ownerId)
        if account != scope || accountEpoch != app.accountEpoch {
            let storage = HealthLocalStore(directory: app.healthStateDirectory, account: account)
            let loaded = try storage.load()
            generation = UUID(); scope = account; accountEpoch = app.accountEpoch
            local = storage; state = loaded
        }
    }
    func activate(app: AppleAppModel) async {
        do { try prepare(app: app) }
        catch { message = "无法读取本地健康设置，请稍后重试。"; return }
        if state.preferences.cloudChoiceMade && !state.preferences.requested.isEmpty { await refresh(app: app) }
        else { await upload(app: app) }
    }
    func setPreferences(_ preferences: HealthPreferences, app: AppleAppModel) async {
        guard !busy, !uploading else { return }
        do {
            try prepare(app: app)
            state.applyPreferences(preferences)
            try local?.save(state)
            await refresh(app: app)
        } catch { message = "健康设置尚未保存，请重试。" }
    }
    func authorize(cloudAllowed: Bool, app: AppleAppModel) async {
        guard !busy, !uploading else { return }
        do {
            try prepare(app: app)
            var preferences = state.preferences
            preferences.cloudChoiceMade = true; preferences.cloudModelAllowed = cloudAllowed
            state.applyPreferences(preferences); try local?.save(state)
            busy = true
            let token = generation
            try await reader.requestRead(preferences.enabled)
            guard token == generation, matches(app) else { busy = false; return }
            preferences.requested.formUnion(preferences.enabled)
            state.applyPreferences(preferences); try local?.save(state)
            busy = false
            await refresh(app: app)
        } catch { busy = false; message = "健康读取授权未完成，请重试或在“健康”中检查权限。" }
    }
    func refresh(app: AppleAppModel) async {
        guard !busy, !uploading, let session = app.session, matches(app) else { return }
        if state.preferences.enabled.isEmpty { await upload(app: app); return }
        busy = true; message = nil
        let token = generation
        let summaries = await reader.read(preferences: state.preferences, calendar: calendarOverride ?? .current, deviceId: session.device.id)
        guard token == generation, matches(app), !Task.isCancelled else { busy = false; return }
        do {
            // Replace recent days so late Watch synchronization and read revocation remove stale values.
            if !state.preferences.requested.isEmpty {
                var preserved = summaries
                // A locked store/query failure is not evidence that a previously read observation vanished.
                for i in preserved.indices {
                    guard let previous = state.summaries[preserved[i].date] else { continue }
                    for category in HealthCategory.allCases where preserved[i].readStates[category.rawValue] == .failed {
                        preserved[i].metrics[category.rawValue] = previous.metrics[category.rawValue]
                        if category == .sleep { preserved[i].sleep = previous.sleep }
                        if category == .workouts { preserved[i].workoutCount = previous.workoutCount; preserved[i].workoutMinutes = previous.workoutMinutes }
                    }
                }
                state.enqueue(preserved); try local?.save(state)
            }
        } catch { message = "摘要尚未保存，请重试。" }
        busy = false
        await upload(app: app)
    }
    func deleteAll(app: AppleAppModel) async {
        guard !busy, !uploading else { return }
        state.deleteAll()
        do { try local?.save(state); await upload(app: app) }
        catch { message = "本地删除尚未保存，请重试。" }
    }
    private func matches(_ app: AppleAppModel) -> Bool {
        guard let session = app.session, let scope else { return false }
        return accountEpoch == app.accountEpoch && session.account.ownerId == scope.ownerId && session.server.originString == scope.originString
    }
    private func upload(app: AppleAppModel) async {
        guard !uploading, let scope, matches(app), app.session?.verification == .verified else { return }
        uploading = true
        defer { uploading = false }
        let token = generation
        do {
            if state.deleteAllPending {
                let result = try await app.deleteHealthSummaries(account: scope)
                guard token == generation, matches(app), !Task.isCancelled else { return }
                if case .deferred = result { return }
                state.deleteAllPending = false; try local?.save(state)
            }
            for summary in state.pending.values.sorted(by: { $0.date < $1.date }) {
                guard token == generation, matches(app), !Task.isCancelled else { return }
                let result = try await app.uploadHealthSummary(summary, account: scope)
                guard token == generation, matches(app) else { return }
                if case .deferred = result { return }
                state.acknowledge(summary); try local?.save(state)
            }
        } catch {
            // Background retry is quiet; retain exact account-scoped queue on offline/auth/server failures.
        }
    }
    var latest: HealthDailySummary? { state.summaries.values.max { $0.date < $1.date } }
    func status(_ category: HealthCategory) -> HealthReadState {
        if !reader.available { return .unavailable }
        if !state.preferences.enabled.contains(category) { return .disabled }
        if !state.preferences.requested.contains(category) { return .notRequested }
        return latest?.readStates[category.rawValue] ?? .noDataOrReadDenied
    }
}
