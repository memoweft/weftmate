import SwiftUI
import HealthKit

// A separate application target built only as a dependency of UI tests.
// No writer source or write-purpose string is added to the production phone target.
@main struct HEALTH1SeedApp: App {
    var body: some Scene { WindowGroup { HealthSeedView() } }
}
private struct HealthSeedView: View {
    @State private var result = "Ready"
    @State private var written: [HKSample] = []
    var body: some View {
        VStack(spacing: 24) {
            Button("写入合成样本") { Task { await seed() } }.accessibilityIdentifier("healthSeedWrite")
            Button("清除合成样本") { Task { try? await HKHealthStore().delete(written); written = []; result = "CLEAN" } }
                .accessibilityIdentifier("healthSeedDelete")
            Text(result).accessibilityIdentifier("healthSeedResult")
        }
    }
    @MainActor private func seed() async {
        guard ProcessInfo.processInfo.arguments.contains("--health1-synthetic"), targetIsSimulator else { result = "UNAVAILABLE"; return }
        let store = HKHealthStore(), phone = Bundle.main.bundleIdentifier!.hasSuffix("phone")
        let steps = HKObjectType.quantityType(forIdentifier: .stepCount)!
        let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
        let resting = HKObjectType.quantityType(forIdentifier: .restingHeartRate)!
        let types: Set<HKSampleType> = phone ? [steps, sleep] : [sleep, resting, HKObjectType.workoutType()]
        do {
            try await store.requestAuthorization(toShare: Set(types), read: [])
            var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone.current
            var samples: [HKSample] = []
            for n in 2...4 {
                let day = c.date(byAdding: .day, value: -n, to: c.startOfDay(for: Date()))!
                samples.append(HKCategorySample(type: sleep, value: HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                    start: day.addingTimeInterval((phone ? -2 : 0)*3600), end: day.addingTimeInterval((phone ? 4 : 6)*3600)))
                if phone {
                    samples.append(HKQuantitySample(type: steps, quantity: HKQuantity(unit: .count(), doubleValue: 1234), start: day.addingTimeInterval(7*3600), end: day.addingTimeInterval(8*3600)))
                } else {
                    samples.append(HKQuantitySample(type: resting, quantity: HKQuantity(unit: .count().unitDivided(by: .minute()), doubleValue: 63), start: day.addingTimeInterval(9*3600), end: day.addingTimeInterval(9*3600)))
                    samples.append(HKWorkout(activityType: .walking, start: day.addingTimeInterval(10*3600), end: day.addingTimeInterval(11*3600), duration: 1800, totalEnergyBurned: nil, totalDistance: nil, metadata: nil))
                }
            }
            try await store.save(samples); written = samples; result = "SAVED"
        } catch { result = "FAILED" }
    }
    private var targetIsSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }
}
