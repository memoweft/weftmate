import Foundation

public struct HealthLocalState: Codable, Sendable {
    public var preferences = HealthPreferences()
    public var summaries: [String: HealthDailySummary] = [:]
    public var pending: [String: HealthDailySummary] = [:]
    public var deleteAllPending = false
    public init() {}
    public mutating func enqueue(_ summaries: [HealthDailySummary]) {
        for summary in summaries { self.summaries[summary.date] = summary; pending[summary.date] = summary }
    }
    public mutating func acknowledge(_ summary: HealthDailySummary) {
        if pending[summary.date] == summary { pending.removeValue(forKey: summary.date) }
    }
    /// Consent applies also to previously queued and uploaded summaries. Replacements propagate the new policy.
    public mutating func applyPreferences(_ preferences: HealthPreferences, now: Date = Date()) {
        let removedInputs = !self.preferences.enabled.subtracting(preferences.enabled).isEmpty
        self.preferences = preferences
        for key in Array(summaries.keys) {
            var summary = summaries[key]!
            summary.summarizedAt = HealthSummaryCalculator.timestamp(now)
            summary.cloudModelAllowed = summary.derived != nil || summary.hourly != nil ? false : preferences.cloudChoiceMade && preferences.cloudModelAllowed
            // Derived values may contain a contribution from any disabled input; discard and recompute locally.
            if removedInputs { summary.derived = nil; summary.hourly = nil; summary.cloudModelAllowed = false }
            summary.selfAssessmentFrequency = preferences.selfAssessmentFrequency
            for category in HealthCategory.allCases where !preferences.enabled.contains(category) {
                summary.metrics.removeValue(forKey: category.rawValue)
                summary.readStates[category.rawValue] = .disabled
                if category == .sleep { summary.sleep = nil }
                if category == .workouts { summary.workoutCount = nil; summary.workoutMinutes = nil }
            }
            summaries[key] = summary; pending[key] = summary
        }
    }
    public mutating func deleteAll() {
        summaries = [:]; pending = [:]; deleteAllPending = true
        preferences.enabled = []
    }
}
/// One atomic, account-scoped document contains summaries/preferences/queue; no raw HealthKit samples.
public struct HealthLocalStore: Sendable {
    public let file: URL
    public init(directory: URL, account: LocalAccountScope) {
        file = directory.appendingPathComponent("health-" + account.cacheKey + ".json")
    }
    public func load() throws -> HealthLocalState {
        guard FileManager.default.fileExists(atPath: file.path) else { return .init() }
        return try JSONDecoder().decode(HealthLocalState.self, from: Data(contentsOf: file))
    }
    public func save(_ state: HealthLocalState) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(state)
        #if os(iOS) || os(watchOS)
        try data.write(to: file, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: file, options: .atomic)
        #endif
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        var protectedFile = file
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try protectedFile.setResourceValues(values)
    }
}
public enum HealthUploadResult: Sendable { case uploaded, deferred }
