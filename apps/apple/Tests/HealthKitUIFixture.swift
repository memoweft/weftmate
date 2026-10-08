#if DEBUG && os(iOS) && targetEnvironment(simulator)
import SwiftUI
import HealthKit
import WeftMateCore

/// XCTest-only writers, compiled out of device/release builds. H1 is offline; H3 uses an isolated host.
struct HealthKitUIFixture: View {
    @State private var result = "Ready"
    var body: some View {
        if ProcessInfo.processInfo.arguments.contains("--h3-health-metrics-fixture") {
            H3HealthKitUIFixture()
        } else { VStack(spacing: 24) {
            Button("Write synthetic health samples") { Task { await run() } }.accessibilityIdentifier("healthFixtureStart")
            Text(result).accessibilityIdentifier("healthFixtureResult")
        }
    }
    }
    @MainActor private func run() async {
        guard HKHealthStore.isHealthDataAvailable() else { result = "UNAVAILABLE"; return }
        let store = HKHealthStore()
        let categories: Set<HealthCategory> = [.sleep, .steps, .hrv, .workouts]
        let types = Set(categories.map { HealthKitReader.type(for: $0) })
        do {
            try await store.requestAuthorization(toShare: types, read: Set(types))
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
            let today = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: Date()))!
            let now = today.addingTimeInterval(12 * 3600)
            let yesterday = today.addingTimeInterval(-86400)
            let sleep = HKCategorySample(type: HealthKitReader.type(for: .sleep) as! HKCategoryType,
                value: HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                start: today.addingTimeInterval(-2 * 3600), end: today.addingTimeInterval(6 * 3600))
            let steps = HKQuantitySample(type: HealthKitReader.type(for: .steps) as! HKQuantityType,
                quantity: HKQuantity(unit: .count(), doubleValue: 1234), start: today.addingTimeInterval(7 * 3600), end: today.addingTimeInterval(8 * 3600))
            let hrvType = HealthKitReader.type(for: .hrv) as! HKQuantityType
            let oldHRV = HKQuantitySample(type: hrvType, quantity: HKQuantity(unit: .secondUnit(with: .milli), doubleValue: 50), start: yesterday, end: yesterday)
            let hrv = HKQuantitySample(type: hrvType, quantity: HKQuantity(unit: .secondUnit(with: .milli), doubleValue: 40), start: today, end: today)
            let workout = HKWorkout(activityType: .walking, start: today.addingTimeInterval(9 * 3600),
                end: today.addingTimeInterval(10 * 3600), duration: 1800, totalEnergyBurned: nil, totalDistance: nil, metadata: nil)
            let samples: [HKSample] = [sleep, steps, oldHRV, hrv, workout]
            try await store.save(samples)
            var p = HealthPreferences(); p.enabled = categories; p.requested = categories
            let summaries = await HealthKitReader(store: store).read(preferences: p, calendar: calendar, deviceId: "synthetic-phone", now: now)
            let latest = summaries.last!
            let ok = latest.sleep?.totalMinutes == 480 && latest.metrics["steps"]?.value == 1234
                && latest.metrics["hrv"]?.baselineMean == 50 && latest.metrics["hrv"]?.deviationPercent == -20
                && latest.workoutCount == 1 && latest.workoutMinutes == 30 && !latest.sourceDevices.isEmpty
            try await store.delete(samples)
            result = ok ? "PASS: sleep 480 min, steps 1234, HRV -20%, workout 30 min" : "FAIL: " + String(data: try JSONEncoder().encode(latest), encoding: .utf8)!
        } catch { result = "FAIL: \(error.localizedDescription)" }
    }
}
/// Isolated simulator only: real HealthKit and real personal-host HTTP, with a synthetic account.
/// The host is supplied by the test, not production. No raw samples enter the queue or requests.
private struct H3HealthKitUIFixture: View {
    @StateObject private var app = AppleAppModel()
    @StateObject private var health = HealthSettingsModel(calendar: {
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(secondsFromGMT: 0)!; return c
    }())
    @State private var result = "Ready"
    @State private var running = false
    @State private var syntheticSamples: [HKSample] = []
    var body: some View {
        NavigationStack {
            VStack {
                if app.session != nil, result.hasPrefix("PASS:") {
                    Text(result).accessibilityIdentifier("healthFixtureResult")
                    Button("清理合成样本") { Task { try? await HKHealthStore().delete(syntheticSamples); syntheticSamples = [] } }.accessibilityIdentifier("healthFixtureCleanup")
                    HealthSettingsView(model: health, app: app)
                } else {
                    Button("授权并计算合成健康指标") { Task { await run() } }
                        .disabled(running).accessibilityIdentifier("healthFixtureStart")
                    Text(result).accessibilityIdentifier("healthFixtureResult")
                }
            }
        }
    }
    @MainActor private func run() async {
        running = true
        let store = HKHealthStore()
        var written: [HKSample] = []
        do {
            let types = Set(HealthCategory.allCases.map { HealthKitReader.type(for: $0) })
            try await store.requestAuthorization(toShare: types, read: types)
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
            let now = Date(), wake = now.addingTimeInterval(-2 * 3600)
            for offset in -58...0 {
                let end = calendar.date(byAdding: .day, value: offset, to: wake)!
                written.append(HKCategorySample(type: HealthKitReader.type(for: .sleep) as! HKCategoryType,
                    value: HKCategoryValueSleepAnalysis.asleepCore.rawValue, start: end.addingTimeInterval(-8 * 3600), end: end))
                func quantity(_ category: HealthCategory, _ unit: HKUnit, _ value: Double, _ a: Date, _ b: Date) {
                    written.append(HKQuantitySample(type: HealthKitReader.type(for: category) as! HKQuantityType,
                        quantity: HKQuantity(unit: unit, doubleValue: value), start: a, end: b))
                }
                let sleeping = end.addingTimeInterval(-3600)
                quantity(.hrv, .secondUnit(with: .milli), 50, sleeping, sleeping)
                quantity(.respiratoryRate, .count().unitDivided(by: .minute()), 16, sleeping, sleeping)
                quantity(.restingHeartRate, .count().unitDivided(by: .minute()), 60, sleeping, sleeping)
                quantity(.heartRate, .count().unitDivided(by: .minute()), 60, sleeping, sleeping.addingTimeInterval(60))
                quantity(.steps, .count(), 1000, end.addingTimeInterval(600), end.addingTimeInterval(1200))
                quantity(.activeEnergy, .kilocalorie(), 200, end.addingTimeInterval(600), end.addingTimeInterval(1200))
                let resting = end.addingTimeInterval(90 * 60)
                quantity(.hrv, .secondUnit(with: .milli), 40, resting, resting)
                quantity(.heartRate, .count().unitDivided(by: .minute()), 72, resting, resting.addingTimeInterval(60))
                written.append(HKWorkout(activityType: .walking, start: end.addingTimeInterval(600),
                    end: end.addingTimeInterval(1200), duration: 600, totalEnergyBurned: nil, totalDistance: nil, metadata: nil))
            }
            try await store.save(written)
            await app.authenticate(username: "h3_synthetic_" + UUID().uuidString.prefix(8).lowercased(),
                password: UUID().uuidString + "aA1!", displayName: "H3 合成账号", register: true)
            guard app.session != nil else { throw NSError(domain: "H3", code: 1, userInfo: [NSLocalizedDescriptionKey: app.authError ?? "Login failed"]) }
            try health.prepare(app: app)
            await health.authorize(cloudAllowed: false, app: app)
            guard let latest = health.latest, latest.derived?.recovery != nil, latest.derived?.load != nil,
                  latest.sleep != nil, latest.hourly?.contains(where: { $0.stress != nil }) == true,
                  health.state.pending.isEmpty, !latest.cloudModelAllowed else {
                throw NSError(domain: "H3", code: 2, userInfo: [NSLocalizedDescriptionKey: "Calculation/upload incomplete; pending=\(health.state.pending.count), \(health.message ?? "")"])
            }
            // Queue acknowledgement follows actual authenticated host POST; runner verifies private host storage.
            result = "PASS: 本地计算 · 本人隔离宿主已保存 · 仅摘要"
            syntheticSamples = written; written = []
        } catch {
            if !written.isEmpty { try? await store.delete(written) }
            result = "FAIL: " + error.localizedDescription
        }
        running = false
    }

}
#endif
