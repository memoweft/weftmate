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
        // 30 display days + 28 preceding load days; extra day captures sleep crossing the first date.
        let start = calendar.date(byAdding: .day, value: -59, to: today)!
        var days = (-58...0).map { HealthDayInput(day: calendar.date(byAdding: .day, value: $0, to: today)!) }
        var sleep: [HealthInterval] = [], workouts: [HealthInterval] = [], stages: [HealthSleepStage] = []
        var observations: [HealthQuantityObservation] = []
        var failed = Set<HealthCategory>()
        for category in preferences.enabled.intersection(preferences.requested) where available {
            do {
                let type = Self.type(for: category)
                let raw = try await samples(type: type, start: start, end: now)
                for sample in raw {
                    let interval = HealthInterval(start: sample.startDate, end: sample.endDate)
                    if category == .sleep, let sample = sample as? HKCategorySample {
                        let names = [HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue: "unspecified",
                            HKCategoryValueSleepAnalysis.asleepCore.rawValue: "core",
                            HKCategoryValueSleepAnalysis.asleepDeep.rawValue: "deep",
                            HKCategoryValueSleepAnalysis.asleepREM.rawValue: "rem"]
                        if let stage = names[sample.value], sample.endDate <= now {
                            sleep.append(interval); stages.append(.init(interval: interval, stage: stage))
                        }
                    } else if category == .workouts {
                        workouts.append(.init(start: interval.start, end: interval.end,
                            durationMinutes: (sample as? HKWorkout).map { $0.duration / 60 }))
                    } else if category != .activeEnergy, let quantity = sample as? HKQuantitySample {
                        observations.append(.init(category: category, start: interval.start, end: interval.end,
                            value: quantity.quantity.doubleValue(for: Self.unit(category))))
                    }
                    for i in days.indices where sample.startDate < calendar.date(byAdding: .day, value: 1, to: days[i].day)!
                        && sample.endDate >= days[i].day {
                        days[i].sourceDevices.append(Self.source(sample))
                    }
                }
                if category == .steps || category == .activeEnergy {
                    // One native collection query per category reconciles phone/Watch cumulative sources.
                    let daily = try await collection(type: type as! HKQuantityType, start: days[0].day, end: now,
                        calendar: calendar, components: DateComponents(day: 1))
                    for i in days.indices {
                        if let quantity = daily.statistics(for: days[i].day)?.sumQuantity() {
                            days[i].values[category] = quantity.doubleValue(for: Self.unit(category))
                        }
                    }
                    if category == .activeEnergy {
                        let hourly = try await collection(type: type as! HKQuantityType, start: days[0].day, end: now,
                            calendar: calendar, components: DateComponents(hour: 1))
                        hourly.enumerateStatistics(from: days[0].day, to: now) { stats, _ in
                            if let quantity = stats.sumQuantity() {
                                observations.append(.init(category: .activeEnergy, start: stats.startDate,
                                    end: min(now, stats.endDate), value: quantity.doubleValue(for: .kilocalorie())))
                            }
                        }
                    }
                } else if category != .sleep && category != .workouts {
                    for i in days.indices {
                        let end = min(now, calendar.date(byAdding: .day, value: 1, to: days[i].day)!)
                        let values = observations.filter { $0.category == category && $0.start >= days[i].day && $0.start < end }.map(\.value)
                        if !values.isEmpty { days[i].values[category] = values.reduce(0, +) / Double(values.count) }
                    }
                }
            } catch { failed.insert(category) }
        }
        let capturedDays = days, capturedSleep = sleep, capturedWorkouts = workouts
        let capturedObservations = observations, capturedStages = stages, capturedFailures = failed
        let isAvailable = available
        // Calculating historical intervals must not stall the phone / Watch main actor.
        return await Task.detached(priority: .utility) {
            let summaries = HealthSummaryCalculator.summarize(days: capturedDays, sleep: capturedSleep, workouts: capturedWorkouts,
                preferences: preferences, calendar: calendar, deviceId: deviceId, now: now, available: isAvailable, failed: capturedFailures)
            let calculated = HealthDeviceMetricsCalculator.calculate(summaries: summaries, observations: capturedObservations,
                sleepStages: capturedStages, workouts: capturedWorkouts, preferences: preferences, calendar: calendar, now: now)
            return Array(calculated.suffix(30))
        }.value
    }
    private static func unit(_ category: HealthCategory) -> HKUnit {
        switch category {
        case .steps: .count()
        case .activeEnergy: .kilocalorie()
        case .hrv: .secondUnit(with: .milli)
        default: .count().unitDivided(by: .minute())
        }
    }
    private func collection(type: HKQuantityType, start: Date, end: Date, calendar: Calendar,
                            components: DateComponents) async throws -> HKStatisticsCollection {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(quantityType: type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end),
                options: .cumulativeSum, anchorDate: calendar.startOfDay(for: start), intervalComponents: components)
            query.initialResultsHandler = { _, result, error in
                if let error { continuation.resume(throwing: error) }
                else if let result { continuation.resume(returning: result) }
                else { continuation.resume(throwing: CocoaError(.coderReadCorrupt)) }
            }
            store.execute(query)
        }
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
}
#endif
