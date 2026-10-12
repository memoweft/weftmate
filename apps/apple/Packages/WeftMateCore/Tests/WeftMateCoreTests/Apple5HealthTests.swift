import Foundation
import Testing
@testable import WeftMateCore

@Test func apple5FormalHealthFieldsAndMissingValues() throws {
    let data = Data(#"{"day":"2026-10-12","connected":true,"vitals":{},"usage":{"lastUsedAt":"2026-10-12T01:02:03Z"},"load":{"recommendedRange":{"low":30,"high":40,"unit":"relative"}},"stress":{"score":0,"latest":{"value":0,"time":"2026-10-12T09:00:00Z"},"samples":[{"time":"2026-10-12T09:00:00Z","value":0,"method":"stressIndex"}]},"energy":{"current":72,"degraded":true,"nightCharged":20,"dayDrained":28,"sleepPeriods":[{"start":"23:00","end":"07:00"}],"curve":[{"time":"00:00","value":null}]},"fitnessAge":{"fitnessAge":34,"actualAge":38,"difference":-4,"referenceRange":{"low":35.9,"high":49.2},"missing":[]}}"#.utf8)
    let o = try JSONDecoder().decode(HealthOverview.self, from: data)
    #expect(o.stress?.latest?.value == 0 && o.stress?.samples?.first?.method == "stressIndex")
    #expect(o.energy?.curve?.first?.value == nil && o.energy?.degraded == true)
    #expect(o.energy?.nightCharged == 20 && o.energy?.dayDrained == 28)
    #expect(o.energy?.sleepPeriods?.first?.start == "23:00")
    #expect(o.fitnessAge?.fitnessAge == 34 && o.fitnessAge?.difference == -4)
    #expect(o.fitnessAge?.referenceRange?.high == 49.2)
    #expect(o.usage?.lastUsedAt == "2026-10-12T01:02:03Z" && o.load?.recommendedRange?.unit == "relative")
    let legacy = try JSONDecoder().decode(HealthOverview.self, from: Data(#"{"day":"2026-10-12","connected":false,"vitals":{},"stress":{"value":35,"measuredAt":"old"},"fitnessAge":{"value":34},"usage":{"lastActiveAt":"old"}}"#.utf8))
    #expect(legacy.stress?.score == nil && legacy.stress?.latest == nil)
    #expect(legacy.fitnessAge?.fitnessAge == nil && legacy.usage?.lastUsedAt == nil)
}
@Test func apple5AnalysisEnvelopeAndFailureMessages() throws {
    let cache = try JSONDecoder().decode(HealthAnalysisCacheReply.self, from: Data(#"{"day":"2026-10-12","items":[]}"#.utf8))
    #expect(cache.day == "2026-10-12" && cache.items.isEmpty)
    #expect(HealthPagePolicy.analysisFailure(APIFailure.server(status:429,code:"AI_ANALYSIS_LIMIT"),offline:false).message.contains("次数用完"))
    #expect(HealthPagePolicy.analysisFailure(APIFailure.server(status:409,code:"HEALTH_DATA_CHANGED"),offline:false).message.contains("刷新"))
}
@Test func apple5CapabilityDowngradeNeverSendsVersionThreeFields() throws {
    for record in [nil, 1, 2, 3, 4] as [Int?] {
        let cap = try JSONDecoder().decode(HealthCapabilities.self,from:JSONSerialization.data(withJSONObject:record.map { ["record":$0] } ?? [:]))
        #expect(HealthPagePolicy.recordVersion(cap) == ((record ?? 2) >= 3 ? 3 : 2))
    }
}
