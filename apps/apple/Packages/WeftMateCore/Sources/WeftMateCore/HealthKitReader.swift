#if os(iOS) || os(watchOS)
import HealthKit
import Foundation

/// HealthKit is the shared source of Watch and phone observations. This adapter never requests write access.
@MainActor public final class HealthKitReader {
    private let store: HKHealthStore
    public init(store: HKHealthStore = HKHealthStore()) { self.store = store }
    public var available: Bool { HKHealthStore.isHealthDataAvailable() }
    public static func type(for category: HealthCategory) -> HKSampleType {
        switch category {
        case .sleep: HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
        case .steps: HKObjectType.quantityType(forIdentifier: .stepCount)!
        case .activeEnergy: HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
        case .heartRate: HKObjectType.quantityType(forIdentifier: .heartRate)!
        case .restingHeartRate: HKObjectType.quantityType(forIdentifier: .restingHeartRate)!
        case .hrv: HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
        case .respiratoryRate: HKObjectType.quantityType(forIdentifier: .respiratoryRate)!
        case .workouts: HKObjectType.workoutType()
        }
    }
    public func requestRead(_ categories: Set<HealthCategory>) async throws {
        guard available else { return }
        try await store.requestAuthorization(toShare: [], read: Set(categories.map { Self.type(for: $0) }))
    }
    public func read(preferences: HealthPreferences, calendar: Calendar, deviceId: String,
                     now: Date = Date()) async -> [HealthDailySummary] {
        let today = calendar.startOfDay(for: now)
        // An extra preceding day captures sleep entering the first baseline date.
        let start = calendar.date(byAdding: .day, value: -15, to: today)!
        var days = (0...14).map { HealthDayInput(day: calendar.date(byAdding: .day, value: $0 - 14, to: today)!) }
        var sleep: [HealthInterval] = [], workouts: [HealthInterval] = []
        var failed = Set<HealthCategory>()
        for category in preferences.enabled.intersection(preferences.requested) where available {
            do {
                if category == .sleep || category == .workouts {
                    let samples = try await samples(type: Self.type(for: category), start: start, end: now)
                    for sample in samples {
                        let interval = HealthInterval(start: sample.startDate, end: sample.endDate)
                        if category == .sleep, let sample = sample as? HKCategorySample {
                            let asleep = [HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                                          HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                                          HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                                          HKCategoryValueSleepAnalysis.asleepREM.rawValue]
                            if asleep.contains(sample.value) { sleep.append(interval) }
                        } else if category == .workouts {
                            workouts.append(.init(start: interval.start, end: interval.end,
                                                  durationMinutes: (sample as? HKWorkout).map { $0.duration / 60 }))
                        }
                        // Include all provenance intersecting a day, including Watch-synced samples.
                        for i in days.indices where sample.startDate < calendar.date(byAdding: .day, value: 1, to: days[i].day)!
                            && sample.endDate >= days[i].day {
                            days[i].sourceDevices.append(Self.source(sample))
                        }
                    }
                } else {
                    let type = Self.type(for: category) as! HKQuantityType
                    let sum = category == .steps || category == .activeEnergy
                    let unit: HKUnit = switch category {
                    case .steps: .count()
                    case .activeEnergy: .kilocalorie()
                    case .hrv: .secondUnit(with: .milli)
                    default: .count().unitDivided(by: .minute())
                    }
                    for i in days.indices {
                        let end = min(now, calendar.date(byAdding: .day, value: 1, to: days[i].day)!)
                        let stats = try await statistics(type: type, start: days[i].day, end: end, sum: sum)
                        if let quantity = sum ? stats?.sumQuantity() : stats?.averageQuantity() {
                            days[i].values[category] = quantity.doubleValue(for: unit)
                            days[i].sourceDevices += stats?.sources?.map { $0.name } ?? []
                        }
                    }
                }
            } catch { failed.insert(category) }
        }
        return HealthSummaryCalculator.summarize(days: days, sleep: sleep, workouts: workouts,
            preferences: preferences, calendar: calendar, deviceId: deviceId, now: now, available: available, failed: failed)
    }
    private static func source(_ sample: HKSample) -> String {
        let device = sample.device?.model ?? sample.sourceRevision.productType ?? "HealthKit"
        return sample.sourceRevision.source.name + " · " + device
    }
    private func samples(type: HKSampleType, start: Date, end: Date) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: type, predicate: HKQuery.predicateForSamples(withStart: start, end: end),
                                      limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: samples ?? []) }
            }
            store.execute(query)
        }
    }
    private func statistics(type: HKQuantityType, start: Date, end: Date, sum: Bool) async throws -> HKStatistics? {
        try await withCheckedThrowingContinuation { continuation in
            // Native cumulative statistics reconcile overlapping phone/Watch step and energy sources.
            let query = HKStatisticsQuery(quantityType: type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate),
                options: sum ? .cumulativeSum : .discreteAverage) { _, result, error in
                if let error = error as? HKError, error.code == .errorNoData {
                    continuation.resume(returning: nil)
                } else if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: result) }
            }
            store.execute(query)
        }
    }
}
#endif
