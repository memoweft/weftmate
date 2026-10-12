import Foundation

/// DATA-1's complete wire body. Missing measurements are explicit JSON nulls.
public struct DailyHealth: Codable, Equatable, Sendable {
    public struct Workout: Codable, Equatable, Sendable {
        public var type: String; public var minutes: Double
        public init(type: String, minutes: Double) { self.type = type; self.minutes = minutes }
    }
    public var version = 1
    public var status = "available"
    public var steps: Int?
    public var sleepMinutes: Double?
    public var restingHeartRateBpm: Double?
    public var exerciseMinutes: Double?
    public var workouts: [Workout] = []
    public init(steps: Int? = nil, sleepMinutes: Double? = nil, restingHeartRateBpm: Double? = nil,
                exerciseMinutes: Double? = nil, workouts: [Workout] = []) {
        self.steps = steps; self.sleepMinutes = sleepMinutes; self.restingHeartRateBpm = restingHeartRateBpm
        self.exerciseMinutes = exerciseMinutes; self.workouts = workouts
    }
    public static var unavailable: Self { var value = Self(); value.status = "unavailable"; return value }
    enum CodingKeys: String, CodingKey { case version, status, steps, sleepMinutes, restingHeartRateBpm, exerciseMinutes, workouts }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(version, forKey: .version); try c.encode(status, forKey: .status)
        try c.encode(steps, forKey: .steps); try c.encode(sleepMinutes, forKey: .sleepMinutes)
        try c.encode(restingHeartRateBpm, forKey: .restingHeartRateBpm); try c.encode(exerciseMinutes, forKey: .exerciseMinutes)
        try c.encode(workouts, forKey: .workouts)
    }
}

public enum DailyHealthCalendar {
    public static func days(now: Date, calendar: Calendar, count: Int = 7) -> [Date] {
        let today = calendar.startOfDay(for: now)
        return (0..<count).reversed().compactMap { calendar.date(byAdding: .day, value: -$0, to: today) }
    }
    public static func key(_ date: Date, calendar: Calendar) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.calendar = calendar
        f.timeZone = calendar.timeZone; f.dateFormat = "yyyy-MM-dd"; return f.string(from: date)
    }
    /// Merge overlapping sources before assigning the complete sleep interval to its wake date.
    public static func sleep(_ intervals: [DateInterval], calendar: Calendar, sessions: [DateInterval] = []) -> [String: Double] {
        var asleep: [DateInterval] = []
        for interval in intervals.filter({ $0.duration > 0 }).sorted(by: { $0.start < $1.start }) {
            if let previous = asleep.last, interval.start <= previous.end {
                asleep[asleep.count - 1] = DateInterval(start: previous.start, end: max(previous.end, interval.end))
            } else { asleep.append(interval) }
        }
        var bouts: [DateInterval] = []
        // In-bed/awake segments may bridge stages over midnight, but never add sleeping minutes.
        for interval in (asleep + sessions).filter({ $0.duration > 0 }).sorted(by: { $0.start < $1.start }) {
            if let previous = bouts.last, interval.start <= previous.end {
                bouts[bouts.count - 1] = DateInterval(start: previous.start, end: max(previous.end, interval.end))
            } else { bouts.append(interval) }
        }
        var result: [String: Double] = [:]
        for bout in bouts {
            let minutes = asleep.reduce(0) { $0 + max(0, min($1.end, bout.end).timeIntervalSince(max($1.start, bout.start))) / 60 }
            if minutes > 0 { result[key(bout.end, calendar: calendar), default: 0] += minutes }
        }
        return result.mapValues { min(1440, $0) }
    }
    public static func workoutMinutes(start: Date, end: Date, duration: Double, day: Date, calendar: Calendar) -> Double {
        let next = calendar.date(byAdding: .day, value: 1, to: day)!
        let overlap = max(0, min(end, next).timeIntervalSince(max(start, day)))
        return end > start ? min(1440, max(0, duration / 60) * overlap / end.timeIntervalSince(start)) : 0
    }
}

/// Persists only daily aggregates and delivery state; raw samples remain ephemeral.
public struct DailyHealthState: Codable, Sendable {
    public var enabled = false
    public var connected = false
    public var hintDismissed = false
    public var timeZone: String?
    public var retentionDays = 90
    public var delivered: [String: DailyHealth] = [:]
    public var pending: [String: DailyHealth] = [:]
    public var lastSent: Date?
    public var needsRemoteClear = false
    public init() {}
    public mutating func enqueue(_ values: [String: DailyHealth]) {
        for (day, value) in values {
            if delivered[day] == value { pending.removeValue(forKey: day) }
            else { pending[day] = value }
        }
    }
    public mutating func acknowledge(day: String, value: DailyHealth, now: Date) {
        delivered[day] = value
        if pending[day] == value { pending.removeValue(forKey: day) }
        if value.status == "available" { lastSent = now }
    }
    public mutating func disable() {
        enabled = false; needsRemoteClear = true
        for day in Set(delivered.filter { $0.value.status == "available" }.keys).union(pending.keys) { pending[day] = .unavailable }
    }
    public mutating func clearRemote(_ days: [String]) {
        for day in days { pending[day] = .unavailable }
        needsRemoteClear = false
    }
    public mutating func prune(now: Date, calendar: Calendar) {
        let oldest = DailyHealthCalendar.key(calendar.date(byAdding: .day, value: -retentionDays, to: calendar.startOfDay(for: now))!, calendar: calendar)
        let today = DailyHealthCalendar.key(now, calendar: calendar)
        delivered = delivered.filter { $0.key >= oldest && $0.key <= today }
        pending = pending.filter { $0.key >= oldest && $0.key <= today }
    }
}
public struct DailyHealthStore: Sendable {
    public let file: URL
    public init(directory: URL, account: LocalAccountScope) { file = directory.appendingPathComponent("daily-health-" + account.cacheKey + ".json") }
    public func load() throws -> DailyHealthState {
        guard FileManager.default.fileExists(atPath: file.path) else { return .init() }
        return try JSONDecoder().decode(DailyHealthState.self, from: Data(contentsOf: file))
    }
    public func save(_ state: DailyHealthState) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        #if os(iOS)
        try JSONEncoder().encode(state).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try JSONEncoder().encode(state).write(to: file, options: .atomic)
        #endif
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        var url = file; var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
    }
}
public struct DailySummaryHealth: Decodable, Sendable { public let day: String; public let health: DailyHealth }
public struct DailySummariesReply: Decodable, Sendable { public let items: [DailySummaryHealth] }
public struct DailyReviewSettings: Codable, Sendable { public var reviewEnabled: Bool; public var reviewRetentionDays: Int }
public struct DailyReviewSettingsReply: Decodable, Sendable { public let settings: DailyReviewSettings; public let timeZone: String }
public struct WeeklyHealthInsight: Decodable, Sendable { public let from: String; public let to: String; public let text: String }
public struct HealthActivity: Decodable, Identifiable, Sendable {
    public let id: String; public let title: String; public let summary: String; public let weeklyInsight: WeeklyHealthInsight?
}
public struct HealthActivityReply: Decodable, Sendable { public let items: [HealthActivity]; public let nextCursor: String?; public let hasMore: Bool }
