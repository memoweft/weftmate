import Foundation
import HealthKit
import WeftMateCore

// HealthKit explicitly requires the acknowledgement after asynchronous processing.
// The SDK does not annotate its callback Sendable; this immutable holder crosses once.
private final class HealthObserverAcknowledgement: @unchecked Sendable {
    let finish: () -> Void
    init(_ finish: @escaping () -> Void) { self.finish = finish }
}
/// Nonisolated factories prevent HealthKit from inheriting the reader's MainActor executor.
/// Every returned SDK closure is Sendable and touches only its immutable arguments/continuation.
private enum DailyHealthCallbacks {
    nonisolated static func samples(_ continuation: CheckedContinuation<[HKSample], any Error>)
        -> @Sendable (HKSampleQuery, [HKSample]?, (any Error)?) -> Void {
        { @Sendable _, values, error in
            if let error { continuation.resume(throwing: error) }
            else { continuation.resume(returning: values ?? []) }
        }
    }
    nonisolated static func statistic(_ continuation: CheckedContinuation<Double?, any Error>, unit: HKUnit, options: HKStatisticsOptions)
        -> @Sendable (HKStatisticsQuery, HKStatistics?, (any Error)?) -> Void {
        { @Sendable _, result, error in
            if let error = error as? HKError, error.code == .errorNoData { continuation.resume(returning: nil) }
            else if let error { continuation.resume(throwing: error) }
            else { continuation.resume(returning: (options == .discreteAverage ? result?.averageQuantity() : result?.sumQuantity())?.doubleValue(for: unit)) }
        }
    }
    nonisolated static func observer(_ update: @escaping @Sendable () async -> Void)
        -> @Sendable (HKObserverQuery, @escaping HKObserverQueryCompletionHandler, (any Error)?) -> Void {
        { @Sendable _, completion, error in
            let acknowledgement = HealthObserverAcknowledgement(completion)
            let changed = error == nil
            Task {
                // One task owns one acknowledgement. Defer covers successful, skipped and cancelled work.
                defer { acknowledgement.finish() }
                if changed { await update() }
            }
        }
    }
}
@MainActor final class DailyHealthReader {
    let store = HKHealthStore()
    var available: Bool { HKHealthStore.isHealthDataAvailable() }
    static var types: Set<HKSampleType> {
        [HKObjectType.quantityType(forIdentifier: .stepCount)!, HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!,
         HKObjectType.quantityType(forIdentifier: .restingHeartRate)!, HKObjectType.quantityType(forIdentifier: .appleExerciseTime)!, HKObjectType.workoutType()]
    }
    private var observers: [HKObserverQuery] = []
    func authorize() async throws { try await store.requestAuthorization(toShare: [], read: Set(Self.types)) }
    func read(now: Date = Date(), calendar: Calendar) async throws -> [String: DailyHealth] {
        try Task.checkCancellation()
        let days = DailyHealthCalendar.days(now: now, calendar: calendar)
        let first = days[0], sleepStart = calendar.date(byAdding: .day, value: -2, to: first)!
        let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
        let rawSleep = try await samples(sleepType, start: sleepStart, end: now)
        let sleep = rawSleep.compactMap { sample -> DateInterval? in
            guard let sample = sample as? HKCategorySample, sample.endDate <= now,
                  [HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue, HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                   HKCategoryValueSleepAnalysis.asleepDeep.rawValue, HKCategoryValueSleepAnalysis.asleepREM.rawValue].contains(sample.value) else { return nil }
            return DateInterval(start: sample.startDate, end: sample.endDate)
        }
        let sessions = rawSleep.compactMap { sample -> DateInterval? in
            guard let sample = sample as? HKCategorySample, sample.endDate <= now,
                  [HKCategoryValueSleepAnalysis.inBed.rawValue, HKCategoryValueSleepAnalysis.awake.rawValue].contains(sample.value) else { return nil }
            return DateInterval(start: sample.startDate, end: sample.endDate)
        }
        let sleeping = DailyHealthCalendar.sleep(sleep, calendar: calendar, sessions: sessions)
        let workouts = try await samples(HKObjectType.workoutType(), start: first, end: now).compactMap { $0 as? HKWorkout }
        var result: [String: DailyHealth] = [:]
        for day in days {
            let end = min(now, calendar.date(byAdding: .day, value: 1, to: day)!)
            let steps = try await statistic(.stepCount, day: day, end: end, unit: .count(), options: .cumulativeSum)
            let resting = try await statistic(.restingHeartRate, day: day, end: end, unit: .count().unitDivided(by: .minute()), options: .discreteAverage)
            let exercise = try await statistic(.appleExerciseTime, day: day, end: end, unit: .minute(), options: .cumulativeSum)
            var grouped: [String: Double] = [:]
            for workout in workouts {
                let minutes = DailyHealthCalendar.workoutMinutes(start: workout.startDate, end: workout.endDate,
                    duration: workout.duration, day: day, calendar: calendar)
                if minutes > 0 { grouped[Self.name(workout.workoutActivityType), default: 0] += minutes }
            }
            let key = DailyHealthCalendar.key(day, calendar: calendar)
            result[key] = DailyHealth(steps: steps.map { Int($0.rounded()) }, sleepMinutes: sleeping[key],
                restingHeartRateBpm: resting, exerciseMinutes: exercise.map { min(1440, $0) },
                workouts: grouped.keys.sorted().map { .init(type: $0, minutes: min(1440, grouped[$0]!)) })
        }
        return result
    }
    static func name(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .walking, .hiking: "步行"
        case .running: "跑步"
        case .cycling: "骑行"
        case .swimming: "游泳"
        case .traditionalStrengthTraining, .functionalStrengthTraining: "力量训练"
        default: "其它"
        }
    }
    private func statistic(_ id: HKQuantityTypeIdentifier, day: Date, end: Date, unit: HKUnit, options: HKStatisticsOptions) async throws -> Double? {
        try Task.checkCancellation()
        guard end > day else { return nil }
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: HKObjectType.quantityType(forIdentifier: id)!,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: day, end: end, options: .strictStartDate),
                options: options, completionHandler: DailyHealthCallbacks.statistic(continuation, unit: unit, options: options))
            store.execute(query)
        }
    }
    private func samples(_ type: HKSampleType, start: Date, end: Date) async throws -> [HKSample] {
        try Task.checkCancellation()
        return try await withCheckedThrowingContinuation { continuation in
            store.execute(HKSampleQuery(sampleType: type, predicate: HKQuery.predicateForSamples(withStart: start, end: end),
                limit: HKObjectQueryNoLimit, sortDescriptors: nil, resultsHandler: DailyHealthCallbacks.samples(continuation)))
        }
    }
    func observe(update: @escaping @Sendable () async -> Void) async {
        guard observers.isEmpty else { return }
        for type in Self.types {
            guard !Task.isCancelled else { return }
            let query = HKObserverQuery(sampleType: type, predicate: nil, updateHandler: DailyHealthCallbacks.observer(update))
            observers.append(query); store.execute(query)
            // Unsupported signing/background execution quietly falls back to foreground reads.
            try? await store.enableBackgroundDelivery(for: type, frequency: .hourly)
        }
    }
    func stop() {
        observers.forEach { store.stop($0) }; observers = []
        Task { try? await store.disableAllBackgroundDelivery() }
    }
}
