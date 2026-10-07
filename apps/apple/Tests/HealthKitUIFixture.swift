#if DEBUG && os(iOS) && targetEnvironment(simulator)
import SwiftUI
import HealthKit
import WeftMateCore

/// XCTest-only writer. Compiled out of device/release builds; no credentials, host or real health store is used.
struct HealthKitUIFixture: View {
    @State private var result = "Ready"
    var body: some View {
        VStack(spacing: 24) {
            Button("Write synthetic health samples") { Task { await run() } }.accessibilityIdentifier("healthFixtureStart")
            Text(result).accessibilityIdentifier("healthFixtureResult")
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
#endif
