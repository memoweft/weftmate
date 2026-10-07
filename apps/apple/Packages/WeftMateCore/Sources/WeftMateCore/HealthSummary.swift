import Foundation

public enum HealthCategory: String, Codable, CaseIterable, Sendable {
    case sleep, steps, activeEnergy, heartRate, restingHeartRate, hrv, respiratoryRate, workouts
    public var title: String {
        switch self {
        case .sleep: "睡眠"
        case .steps: "步数"
        case .activeEnergy: "活动能量"
        case .heartRate: "心率"
        case .restingHeartRate: "静息心率"
        case .hrv: "心率变异性（HRV）"
        case .respiratoryRate: "呼吸频率"
        case .workouts: "锻炼"
        }
    }
}
public enum SelfAssessmentFrequency: String, Codable, CaseIterable, Sendable {
    case off, low, moderate
    public var title: String { switch self { case .off: "关闭"; case .low: "少"; case .moderate: "适中" } }
}
public enum HealthReadState: String, Codable, Sendable {
    case disabled, notRequested, dataAvailable, noDataOrReadDenied, unavailable, failed
    public static func resolve(enabled: Bool, available: Bool, requested: Bool, hasData: Bool, failed: Bool = false) -> Self {
        if !available { return .unavailable }
        if !enabled { return .disabled }
        if !requested { return .notRequested }
        if failed { return .failed }
        return hasData ? .dataAvailable : .noDataOrReadDenied
    }
    public var title: String {
        switch self {
        case .disabled: "已关闭，不读取此类数据"
        case .notRequested: "尚未请求读取权限"
        case .dataAvailable: "已读到数据"
        case .noDataOrReadDenied: "无数据，或读取权限已关闭"
        case .unavailable: "此设备不支持健康数据"
        case .failed: "暂时无法读取，请解锁设备后重试"
        }
    }
}
public struct HealthPreferences: Codable, Equatable, Sendable {
    public var enabled: Set<HealthCategory> = Set(HealthCategory.allCases)
    public var requested: Set<HealthCategory> = []
    public var cloudChoiceMade = false
    public var cloudModelAllowed = false
    public var selfAssessmentFrequency: SelfAssessmentFrequency = .low
    public init() {}
}
/// Ephemeral input only; raw intervals are never persisted or encoded for upload.
public struct HealthInterval: Sendable {
    public var start: Date
    public var end: Date
    public var durationMinutes: Double?
    public init(start: Date, end: Date, durationMinutes: Double? = nil) {
        self.start = start; self.end = end; self.durationMinutes = durationMinutes
    }
}
public struct HealthDayInput: Sendable {
    public var day: Date
    public var values: [HealthCategory: Double]
    public var sourceDevices: [String]
    public init(day: Date, values: [HealthCategory: Double] = [:], sourceDevices: [String] = []) {
        self.day = day; self.values = values; self.sourceDevices = sourceDevices
    }
}
public struct HealthMetric: Codable, Equatable, Sendable {
    public var value: Double
    public var unit: String
    public var baselineMean: Double?
    public var baselineDays: Int
    public var deviationPercent: Double?
}
public struct HealthSleepSummary: Codable, Equatable, Sendable {
    public var totalMinutes: Double
    public var fellAsleepAt: String
    public var wokeAt: String
}
public struct HealthDailySummary: Codable, Equatable, Sendable {
    public var schemaVersion = 1
    public var date: String
    public var timeZone: String
    public var sourceDeviceId: String
    public var sourceDevices: [String]
    public var summarizedAt: String
    public var cloudModelAllowed: Bool
    public var selfAssessmentFrequency: SelfAssessmentFrequency
    public var readStates: [String: HealthReadState]
    public var metrics: [String: HealthMetric]
    public var sleep: HealthSleepSummary?
    public var workoutCount: Int?
    public var workoutMinutes: Double?
}
public enum HealthSummaryCalculator {
    public static func dateKey(_ date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
    public static func timestamp(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
    /// Union all asleep phases/sources, excluding in-bed/awake at the adapter. Whole merged episodes belong to wake date.
    public static func mergedSleep(_ intervals: [HealthInterval]) -> [HealthInterval] {
        var merged: [HealthInterval] = []
        for interval in intervals.filter({ $0.end > $0.start }).sorted(by: { $0.start < $1.start }) {
            if let last = merged.last, interval.start <= last.end {
                merged[merged.count - 1].end = max(last.end, interval.end)
            } else { merged.append(interval) }
        }
        return merged
    }
    public static func summarize(days: [HealthDayInput], sleep: [HealthInterval], workouts: [HealthInterval],
                                 preferences: HealthPreferences, calendar: Calendar, deviceId: String,
                                 now: Date, available: Bool = true, failed: Set<HealthCategory> = []) -> [HealthDailySummary] {
        let sleeps = mergedSleep(sleep)
        // Stages separated by brief awakenings stay on the final wake date; awake gaps do not count as sleep.
        var sleepGroups: [[HealthInterval]] = []
        for interval in sleeps {
            if let last = sleepGroups.last?.last, interval.start.timeIntervalSince(last.end) <= 2 * 3600 {
                sleepGroups[sleepGroups.count - 1].append(interval)
            } else { sleepGroups.append([interval]) }
        }
        func nightlySleep(_ key: String) -> [HealthInterval] {
            sleepGroups.filter { dateKey($0.last!.end, calendar: calendar) == key }.flatMap { $0 }
        }
        let ordered = days.sorted { $0.day < $1.day }
        var valuesByDay: [String: [HealthCategory: Double]] = [:]
        for day in ordered {
            let key = dateKey(day.day, calendar: calendar)
            var values = day.values.filter { preferences.enabled.contains($0.key) && $0.value.isFinite && $0.value >= 0 }
            let nightly = nightlySleep(key)
            if preferences.enabled.contains(.sleep), !nightly.isEmpty {
                values[.sleep] = nightly.reduce(0) { $0 + $1.end.timeIntervalSince($1.start) / 60 }
            }
            valuesByDay[key] = values
        }
        return ordered.map { day in
            let key = dateKey(day.day, calendar: calendar)
            let values = valuesByDay[key] ?? [:]
            var metrics: [String: HealthMetric] = [:]
            let baselineStart = calendar.date(byAdding: .day, value: -14, to: calendar.startOfDay(for: day.day))!
            for (category, value) in values {
                let prior = ordered.filter { $0.day >= baselineStart && calendar.startOfDay(for: $0.day) < calendar.startOfDay(for: day.day) }
                    .compactMap { valuesByDay[dateKey($0.day, calendar: calendar)]?[category] }
                let mean = prior.isEmpty ? nil : prior.reduce(0, +) / Double(prior.count)
                let unit: String = switch category {
                case .sleep, .workouts: "min"
                case .steps: "count"
                case .activeEnergy: "kcal"
                case .hrv: "ms"
                case .respiratoryRate: "breaths/min"
                default: "bpm"
                }
                metrics[category.rawValue] = .init(value: value, unit: unit, baselineMean: mean,
                    baselineDays: prior.count, deviationPercent: mean.flatMap { $0 > 0 ? (value - $0) / $0 * 100 : nil })
            }
            let nightly = nightlySleep(key)
            let exercise = workouts.filter { dateKey($0.start, calendar: calendar) == key }
            var states: [String: HealthReadState] = [:]
            for category in HealthCategory.allCases {
                states[category.rawValue] = .resolve(enabled: preferences.enabled.contains(category), available: available,
                    requested: preferences.requested.contains(category), hasData: category == .workouts ? !exercise.isEmpty : values[category] != nil,
                    failed: failed.contains(category))
            }
            let sleepSummary: HealthSleepSummary? = preferences.enabled.contains(.sleep) && !nightly.isEmpty
                ? .init(totalMinutes: values[.sleep]!, fellAsleepAt: timestamp(nightly.first!.start), wokeAt: timestamp(nightly.last!.end)) : nil
            return .init(date: key, timeZone: calendar.timeZone.identifier, sourceDeviceId: deviceId,
                sourceDevices: Array(Set(day.sourceDevices)).sorted(), summarizedAt: timestamp(now),
                cloudModelAllowed: preferences.cloudChoiceMade && preferences.cloudModelAllowed,
                selfAssessmentFrequency: preferences.selfAssessmentFrequency, readStates: states, metrics: metrics,
                sleep: sleepSummary, workoutCount: preferences.enabled.contains(.workouts) && !exercise.isEmpty ? exercise.count : nil,
                workoutMinutes: preferences.enabled.contains(.workouts) && !exercise.isEmpty ? exercise.reduce(0) { $0 + ($1.durationMinutes ?? $1.end.timeIntervalSince($1.start) / 60) } : nil)
        }
    }
}
