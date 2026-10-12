import Foundation

public enum HealthPagePolicy {
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
