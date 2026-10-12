import Foundation

public struct HealthCapabilities: Codable, Sendable { public var record: Int?; public var profile: Bool? }
public struct HealthMetricPoint: Codable, Sendable {
    public var day: String?; public var id: String?; public var value: Double?; public var baseline: Double?; public var low: Double?; public var high: Double?; public var state: String?; public var label: String?
}
public struct HealthPageScore: Codable, Sendable {
    public struct Reason: Codable, Sendable { public var text: String; public var inputs: [String] }
    public var score: Double?; public var state: String?; public var label: String?; public var reasons: [Reason]?
    public var missing: [String]?; public var baseline: Double?; public var low: Double?; public var high: Double?
    public var minutes: Double?; public var targetMinutes: Double?; public var start: String?; public var end: String?
    public var deepMinutes: Double?; public var remMinutes: Double?
}
public struct HealthInsight: Codable, Sendable {
    public struct Suggestion: Codable, Identifiable, Sendable {
        public struct Reminder: Codable, Sendable { public var title: String; public var time: String }
        public var id: String; public var text: String; public var reminder: Reminder?
    }
    public var headline: String; public var text: String; public var suggestions: [Suggestion]
}
public struct HealthOverview: Codable, Sendable {
    public struct Activity: Codable, Sendable { public var steps: Int?; public var activeEnergyKcal: Double?; public var exerciseMinutes: Double?; public var workouts: [DailyHealth.Workout] }
    public struct Usage: Codable, Sendable { public var activeMinutes: Double?; public var lateNightMinutes: Double?; public var lastActiveAt: String? }
    public var day: String; public var connected: Bool; public var updatedAt: String?; public var capabilities: HealthCapabilities?
    public var insight: HealthInsight?; public var recovery: HealthPageScore?; public var sleep: HealthPageScore?; public var load: HealthPageScore?
    public var vitals: [String: HealthMetricPoint]; public var activity: Activity?; public var usage: Usage?
    // HEALTH-5 has names but no wire structure yet; optional data remains owned by the host.
    public var stress: JSONValue?; public var energy: JSONValue?; public var fitnessAge: JSONValue?
}
public struct HealthMetricSeries: Codable, Sendable {
    public var id: String; public var days: Int; public var timeZone: String; public var average: Double?; public var points: [HealthMetricPoint]
}
public struct HealthCalendarReply: Codable, Sendable {
    public struct Day: Codable, Identifiable, Sendable {
        public var id: String { day }; public var day: String; public var hasWorkout: Bool; public var sleepScore: Double?; public var recoveryScore: Double?
    }
    public var month: String; public var days: [Day]
}
public struct HealthBatchItem: Codable, Sendable {
    public var day: String; public var health: DailyHealth
    public init(day: String, health: DailyHealth) { self.day = day; self.health = health }
}
public struct HealthBatchBody: Codable, Sendable { public var items: [HealthBatchItem]; public init(items: [HealthBatchItem]) { self.items = items } }
public struct HealthBatchReply: Codable, Sendable { public var items: [HealthBatchItem]; public var changedDays: [String] }
public struct HealthPageCache: Codable, Sendable {
    public var overview: HealthOverview?; public var calendar: HealthCalendarReply?; public var series: [String: HealthMetricSeries] = [:]; public var fetchedAt: Date?
    public init() {}
}
public struct HealthAnalysis: Codable, Sendable {
    public var scope: String; public var day: String; public var mode: String; public var text: String
    public var points: [String]; public var basis: [String]; public var generatedAt: String
}
public struct HealthAnalysisCacheReply: Codable, Sendable { public var items: [HealthAnalysis] }
public struct HealthPageSettings: Codable, Sendable {
    public var modelInsightsEnabled: Bool; public var itemAnalysisEnabled: Bool?; public var sleepTargetMinutes: Int; public var retentionDays: Int?
}
public struct HealthPageSettingsReply: Codable, Sendable { public var settings: HealthPageSettings; public var updatedAt: String? }
