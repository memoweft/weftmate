import Foundation

public enum HealthPagePolicy {
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
        if case APIFailure.server(429,"AI_ANALYSIS_LIMIT") = error { return ("今天的 AI 分析次数用完了，明天再来看看。",false) }
        if case APIFailure.server(409,"HEALTH_DATA_CHANGED") = error { return ("健康数据刚更新，请刷新后再分析。",false) }
        if offline || error is URLError { return ("电脑不在线，连接后再来看看。",false) }
        return ("这次没能分析好，点一下再试。",false)
    }
}

public enum HealthFieldText {
    public static func name(_ id: String) -> String {
        switch id {
        case "sex": "生理性别"
        case "birthYear": "出生年份"
        case "vo2Max": "最大摄氧量"
        case "sleep", "sleepMinutes": "睡眠"
        case "recovery": "恢复情况"
        case "restingHeartRateBpm": "静息心率"
        case "hrvSdnnMs", "hrvSamples", "stressBaseline": "心率变异性测量与个人基线"
        case "heartRateGaps", "heartRateQuarterHourly", "heartRateHourly": "部分时段的心率"
        default: "相关测量与个人基线"
        }
    }
}

public enum HealthUploadPolicy {
    public static func sendsProfile(_ capabilities: HealthCapabilities?) -> Bool { capabilities?.profile == true }
    public static func wireRecord(_ value: DailyHealth, capabilities: HealthCapabilities?) -> DailyHealth {
        var record=value
        let supported=HealthPagePolicy.recordVersion(capabilities)
        if record.version > supported {
            record.version=supported; record.hrvSamples=nil; record.heartRateQuarterHourly=nil; record.sleep?.stages=nil
        }
        return record
    }
    public static func validBytes(_ data: Data, version: Int) -> Bool { data.count <= (version >= 3 ? 64 : 12)*1024 }
    public static func validBatch(_ items: [HealthBatchItem]) throws -> Bool {
        guard (1...100).contains(items.count), Set(items.map(\.day)).count == items.count else { return false }
        let encoder=JSONEncoder()
        guard try items.allSatisfy({ try validBytes(encoder.encode($0.health),version:$0.health.version) }) else { return false }
        return try encoder.encode(HealthBatchBody(items:items)).count <= 1280*1024
    }
}
