import Foundation

public enum HealthPagePolicy {
    /// iPhone score cards keep two columns at every supported phone width.
    public static func scoreColumns(width: Double) -> Int { 2 }
    public enum StatusTint: Equatable, Sendable { case green, amber, muted }
    public static func statusTint(_ state: String?) -> StatusTint {
        switch state {
        case "normal", "balanced", "in-range", "within-range": .green
        case "high", "low", "more", "less": .amber
        default: .muted
        }
    }
    public static func score(_ id: String, in overview: HealthOverview) -> HealthPageScore? {
        switch id { case "recovery": overview.recovery; case "sleep": overview.sleep; case "load": overview.load; default: nil }
    }
    public static func scorePosition(_ value: Double?) -> Double? {
        guard let value, value.isFinite else { return nil }
        return min(1, max(0, value / 100))
    }
    public static func recordVersion(_ capabilities: HealthCapabilities?) -> Int { (capabilities?.record ?? 2) >= 3 ? 3 : 2 }
    public static func itemAnalysis(_ settings: HealthPageSettings) -> (supported: Bool, enabled: Bool) {
        (settings.itemAnalysisEnabled != nil, settings.itemAnalysisEnabled == true)
    }
    public static func restoredAnalysis(_ items: [HealthAnalysis], day: String) -> [String:HealthAnalysis] {
        Dictionary(items.filter { $0.day == day }.map { ($0.scope,$0) },uniquingKeysWith:{ _,b in b })
    }
    public static func analysisFailure(_ error: any Error, offline: Bool) -> (message: String, disabled: Bool) {
        if case APIFailure.server(409,"AI_ANALYSIS_OFF") = error { return ("AI 分析已关闭，可以重新打开。",true) }
        if offline || error is URLError { return ("电脑不在线，连接后再来看看。",false) }
        return ("这次没能分析好，点一下再试。",false)
    }
    public static func visibleOptionalCards(_ overview: HealthOverview) -> [String] {
        [("stress",overview.stress),("energy",overview.energy),("fitnessAge",overview.fitnessAge)].compactMap { id,value in value == nil || value == .null ? nil : id }
    }
}
