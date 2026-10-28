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
private struct HealthReadingAggregation: Sendable {
    var sleep: [String:HealthSleepRecord]
    var variability: [String:Double]
    var hourly: [String:[HealthHeartBucket?]]
    var quarterHourly: [String:[HealthHeartBucket?]]
}
private enum HealthReadingWork {
    nonisolated static func aggregate(sleep: [HealthInputMath.SleepInput],rate: [(Date,Double)],variability: [(Date,Double)],days: [Date],calendar: Calendar) async -> HealthReadingAggregation {
        await Task.detached(priority:.utility) { @Sendable in
            var result=HealthReadingAggregation(sleep:HealthInputMath.sleep(sleep,calendar:calendar),variability:HealthInputMath.representativeVariability(variability,sleep:sleep,calendar:calendar),hourly:[:],quarterHourly:[:])
            for day in days {
                let key=DailyHealthCalendar.key(day,calendar:calendar)
                result.hourly[key]=HealthInputMath.buckets(rate,day:day,calendar:calendar,quarter:false)
                result.quarterHourly[key]=HealthInputMath.buckets(rate,day:day,calendar:calendar,quarter:true)
            }
            return result
        }.value
    }
}
@MainActor final class DailyHealthReader {
    let store = HKHealthStore()
    var available: Bool {
        HKHealthStore.isHealthDataAvailable()
    }
    static var types: Set<HKSampleType> {
        [HKObjectType.quantityType(forIdentifier: .stepCount)!, HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!,
         HKObjectType.quantityType(forIdentifier: .restingHeartRate)!, HKObjectType.quantityType(forIdentifier: .appleExerciseTime)!, HKObjectType.workoutType()]
    }
    private var observers: [HKObserverQuery] = []
    func authorize() async throws { try await store.requestAuthorization(toShare: [], read: Set(Self.types)) }
    static var expandedTypes: Set<HKSampleType> {
        types.union([.activeEnergyBurned, .heartRate, .heartRateVariabilitySDNN, .respiratoryRate,
                     .oxygenSaturation, .appleSleepingWristTemperature, .vo2Max, .height, .bodyMass]
            .compactMap { HKObjectType.quantityType(forIdentifier: $0) }).union([HKSeriesType.heartbeat()])
    }
    func authorizeExpanded() async throws {
        var read = Set<HKObjectType>(Self.expandedTypes)
        read.insert(HKObjectType.characteristicType(forIdentifier: .dateOfBirth)!)
        read.insert(HKObjectType.characteristicType(forIdentifier: .biologicalSex)!)
        try await store.requestAuthorization(toShare: [], read: read)
    }
    func needsExpandedAuthorization() async -> Bool {
        var read = Set<HKObjectType>(Self.expandedTypes)
        read.insert(HKObjectType.characteristicType(forIdentifier: .dateOfBirth)!)
        read.insert(HKObjectType.characteristicType(forIdentifier: .biologicalSex)!)
        return (try? await store.statusForAuthorizationRequest(toShare: [], read: read)) == .shouldRequest
    }
    #if DEBUG && targetEnvironment(simulator)
    var fixtureProfile: HealthProfile?
    var fixtureTemperature: Double?
    #endif
    func profile(now: Date = Date()) async -> HealthProfile {
        let birth = try? store.dateOfBirthComponents().year
        let sex = try? store.biologicalSex().biologicalSex
        func latest(_ id: HKQuantityTypeIdentifier, _ unit: HKUnit) async -> Double? {
            let values = (try? await samples(HKObjectType.quantityType(forIdentifier: id)!, start: .distantPast, end: now, limit: 1)) ?? []
            return (values.sorted { $0.endDate < $1.endDate }.last as? HKQuantitySample)?.quantity.doubleValue(for: unit)
        }
        var result = HealthProfile(birthYear: birth ?? nil, sex: sex == .male ? "male" : sex == .female ? "female" : sex == .other ? "other" : nil,
            heightCm: await latest(.height, .meterUnit(with: .centi)), weightKg: await latest(.bodyMass, .gramUnit(with: .kilo)))
        #if DEBUG && targetEnvironment(simulator)
        // Simulator has no writable birthday/sex API; only these two synthetic characteristics are injected.
        if let fixtureProfile { result.birthYear = fixtureProfile.birthYear; result.sex = fixtureProfile.sex }
        #endif
        return result
    }
    func read(now: Date = Date(), calendar: Calendar, count: Int = 7, version: Int = 2) async throws -> [String: DailyHealth] {
        try Task.checkCancellation()
        let days = DailyHealthCalendar.days(now: now, calendar: calendar, count: count)
        return try await read(days: days, now: now, calendar: calendar, version: version)
    }
    func read(days: [Date], now: Date = Date(), calendar: Calendar, version: Int) async throws -> [String: DailyHealth] {
        guard let first = days.min(), let last = days.max() else { return [:] }
        let until = min(now, calendar.date(byAdding: .day, value: 1, to: last)!)
        let sleepStart = calendar.date(byAdding: .day, value: -2, to: first)!
        let rawSleep = try await samples(HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!, start: sleepStart, end: until)
        let sleepInputs: [HealthInputMath.SleepInput] = rawSleep.compactMap { raw in
            guard let sample = raw as? HKCategorySample, sample.endDate <= until else { return nil }
            let names = [HKCategoryValueSleepAnalysis.inBed.rawValue:"inBed", HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue:"unspecified",
                HKCategoryValueSleepAnalysis.asleepCore.rawValue:"core", HKCategoryValueSleepAnalysis.asleepDeep.rawValue:"deep",
                HKCategoryValueSleepAnalysis.asleepREM.rawValue:"rem", HKCategoryValueSleepAnalysis.awake.rawValue:"awake"]
            return names[sample.value].map { HealthInputMath.SleepInput(sample.startDate,sample.endDate,$0) }
        }
        let workouts = try await samples(HKObjectType.workoutType(), start: first, end: until).compactMap { $0 as? HKWorkout }
        func quantities(_ id: HKQuantityTypeIdentifier, _ unit: HKUnit, from: Date? = nil) async throws -> [(Date, Double)] {
            try await optionalSamples(HKObjectType.quantityType(forIdentifier: id)!, start: from ?? first, end: until).compactMap {
                guard let s = $0 as? HKQuantitySample, s.startDate < until else { return nil }
                return (s.startDate, s.quantity.doubleValue(for: unit))
            }.sorted { $0.0 < $1.0 }
        }
        let rate = try await quantities(.heartRate,.count().unitDivided(by: .minute()))
        let hrv = try await quantities(.heartRateVariabilitySDNN,.secondUnit(with: .milli),from: sleepStart)
        let respiration = try await quantities(.respiratoryRate,.count().unitDivided(by: .minute()))
        let oxygen = try await quantities(.oxygenSaturation,.percent())
        let temperature = try await quantities(.appleSleepingWristTemperature,.degreeCelsius())
        let fitness = try await quantities(.vo2Max,HKUnit(from: "ml/kg*min"))
        let aggregate=await HealthReadingWork.aggregate(sleep:sleepInputs,rate:rate,variability:hrv,days:days,calendar:calendar)
        let sleeping=aggregate.sleep, representative=aggregate.variability
        var variability: [HealthVariabilityRecord] = []
        if version >= 3 {
            let series = try await samples(HKSeriesType.heartbeat(), start: first, end: until).compactMap { $0 as? HKHeartbeatSeriesSample }
            for point in hrv where point.0 >= first {
                var rr: [Double] = []
                // Only match the same measurement interval; never borrow a nearby unrelated series.
                if let sample = series.first(where: { abs($0.startDate.timeIntervalSince(point.0)) < 1 }) {
                    var previous: Double?
                    for try await beat in HKHeartbeatSeriesQueryDescriptor(sample).results(for: store) {
                        if let previous, !beat.precededByGap { rr.append((beat.timeIntervalSinceStart-previous)*1000) }
                        else if previous != nil { rr.append(0) }
                        previous = beat.timeIntervalSinceStart
                    }
                }
                variability.append(.init(time: HealthInputMath.iso(point.0),sdnnMs: point.1,intervalsMs: rr))
            }
        }
        let personal = await profile(now: now)
        let age = personal.birthYear.map { calendar.component(.year, from: now)-$0 }
        // HealthKit has no public physiological maximum-heart-rate quantity. Use the agreed age estimate.
        let maximum = age.map { 211-0.64*Double($0) }
        var result: [String: DailyHealth] = [:]
        for day in days {
            try Task.checkCancellation()
            let end = min(until, calendar.date(byAdding: .day, value: 1, to: day)!)
            let key = DailyHealthCalendar.key(day,calendar: calendar)
            func average(_ values: [(Date,Double)]) -> Double? {
                HealthInputMath.dailyMean(values,day:day,calendar:calendar)
            }
            var value = DailyHealth(steps: try await statistic(.stepCount,day: day,end: end,unit: .count(),options: .cumulativeSum).map { Int($0.rounded()) },
                sleepMinutes: sleeping[key]?.minutes,
                restingHeartRateBpm: try await statistic(.restingHeartRate,day: day,end: end,unit: .count().unitDivided(by: .minute()),options: .discreteAverage),
                exerciseMinutes: try await statistic(.appleExerciseTime,day: day,end: end,unit: .minute(),options: .cumulativeSum).map { min(1440,$0) })
            value.version = version; value.sleep = sleeping[key]
            value.activeEnergyKcal = try await optionalStatistic(.activeEnergyBurned,day: day,end: end,unit: .kilocalorie(),options: .cumulativeSum)
            value.hrvSdnnMs = representative[key]
            value.respiratoryRateBrpm = average(respiration); value.spo2Pct = average(oxygen).map { $0*100 }
            value.wristTempC = average(temperature); value.vo2Max = average(fitness)
            #if DEBUG && targetEnvironment(simulator)
            if let fixtureTemperature, value.steps != nil { value.wristTempC = fixtureTemperature }
            #endif
            value.heartRateHourly = aggregate.hourly[key]
            if version >= 3 {
                value.heartRateQuarterHourly = aggregate.quarterHourly[key]
                value.hrvSamples = Array(variability.filter { $0.time >= HealthInputMath.iso(day) && $0.time < HealthInputMath.iso(end) }.prefix(96))
            }
            var occupied: [DateInterval]=[]
            for workout in workouts.sorted(by:{ $0.startDate == $1.startDate ? $0.endDate < $1.endDate : $0.startDate < $1.startDate }) {
                let start=max(workout.startDate,day), finish=min(workout.endDate,end)
                guard finish > start,workout.endDate > workout.startDate else { continue }
                for interval in HealthInputMath.uncovered(DateInterval(start:start,end:finish),occupied:occupied) {
                let a=interval.start,b=interval.end
                let minutes=min(1440,workout.duration/60*interval.duration/workout.endDate.timeIntervalSince(workout.startDate))
                guard minutes > 0 else { continue }
                occupied.append(interval)
                let heart = rate.filter { $0.0 >= a && $0.0 < b }
                var record = DailyHealth.Workout(type: Self.name(workout.workoutActivityType),minutes: minutes)
                record.start = HealthInputMath.iso(a)
                record.kcal = (workout.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())).map { $0*minutes/(workout.duration/60) }
                record.avgHeartRateBpm = heart.isEmpty ? nil : heart.map(\.1).reduce(0,+)/Double(heart.count)
                record.maxHeartRateBpm = heart.map(\.1).max()
                let spans = heart.enumerated().map { i,p in (bpm:p.1,seconds:max(0,min(b,min(p.0.addingTimeInterval(60),i+1 < heart.count ? heart[i+1].0 : b)).timeIntervalSince(p.0))) }
                record.zoneMinutes = HealthInputMath.zones(spans,maximum: maximum,durationMinutes: minutes)
                value.workouts.append(record)
                }
            }
            result[key] = value
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
    private func optionalSamples(_ type: HKSampleType,start: Date,end: Date) async throws -> [HKSample] {
        do { return try await samples(type,start:start,end:end) }
        catch let error as HKError where [.errorAuthorizationDenied,.errorAuthorizationNotDetermined,.errorNoData].contains(error.code) { return [] }
    }
    private func optionalStatistic(_ id: HKQuantityTypeIdentifier,day: Date,end: Date,unit: HKUnit,options: HKStatisticsOptions) async throws -> Double? {
        do { return try await statistic(id,day:day,end:end,unit:unit,options:options) }
        catch let error as HKError where [.errorAuthorizationDenied,.errorAuthorizationNotDetermined,.errorNoData].contains(error.code) { return nil }
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
    private func samples(_ type: HKSampleType, start: Date, end: Date, limit: Int = HKObjectQueryNoLimit) async throws -> [HKSample] {
        try Task.checkCancellation()
        return try await withCheckedThrowingContinuation { continuation in
            store.execute(HKSampleQuery(sampleType: type, predicate: HKQuery.predicateForSamples(withStart: start, end: end),
                limit: limit, sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)], resultsHandler: DailyHealthCallbacks.samples(continuation)))
        }
    }
    func observe(update: @escaping @Sendable () async -> Void) async {
        guard observers.isEmpty else { return }
        for type in Self.expandedTypes {
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
