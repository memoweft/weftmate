import Foundation
import Testing
@testable import WeftMateCore

private func pageOverview(_ extras: String = "") throws -> HealthOverview {
    try JSONDecoder().decode(HealthOverview.self,from:Data(("{\"day\":\"2026-10-12\",\"connected\":true,\"vitals\":[]"+extras+"}").utf8))
}
@Test func health4PageVersionFollowsHostFields() throws {
    let old=try pageOverview()
    #expect(HealthPagePolicy.recordVersion(old.capabilities)==2)
    let current=try pageOverview(",\"capabilities\":{\"record\":3,\"profile\":true},\"stress\":{\"score\":35},\"energy\":{\"score\":72},\"fitnessAge\":{\"fitnessAge\":34}")
    #expect(HealthPagePolicy.recordVersion(current.capabilities)==3)
}
@Test func health4IndependentAnalysisSwitchesAndUnsupportedHost() throws {
    func settings(_ item: String) throws -> HealthPageSettings {
        try JSONDecoder().decode(HealthPageSettings.self,from:Data(("{\"modelInsightsEnabled\":true,\"sleepTargetMinutes\":450,\"retentionDays\":400"+item+"}").utf8))
    }
    let old=HealthPagePolicy.itemAnalysis(try settings(""))
    #expect(!old.supported && !old.enabled)
    let off=try settings(",\"itemAnalysisEnabled\":false")
    #expect(off.modelInsightsEnabled && HealthPagePolicy.itemAnalysis(off).supported && !HealthPagePolicy.itemAnalysis(off).enabled)
    let on=try settings(",\"itemAnalysisEnabled\":true")
    #expect(on.modelInsightsEnabled && HealthPagePolicy.itemAnalysis(on).enabled)
}
@Test func health4AnalysisCacheExpiresByDayAndPreservesStatisticsPresentation() throws {
    func item(_ day: String,_ mode: String,_ text: String) throws -> HealthAnalysis {
        try JSONDecoder().decode(HealthAnalysis.self,from:Data("{\"scope\":\"recovery\",\"day\":\"\(day)\",\"mode\":\"\(mode)\",\"text\":\"\(text)\",\"points\":[],\"basis\":[],\"generatedAt\":\"2026-10-12T00:00:00Z\"}".utf8))
    }
    let values=[try item("2026-10-11","model","old"),try item("2026-10-12","statistics","today")]
    let restored=HealthPagePolicy.restoredAnalysis(values,day:"2026-10-12")
    #expect(restored.count==1 && restored["recovery"]?.text=="today")
    var cache=HealthPageCache();cache.cachedAnalyses=values;cache.itemAnalysisEnabled=false;cache.analysisSupported=true
    let roundTrip=try JSONDecoder().decode(HealthPageCache.self,from:JSONEncoder().encode(cache))
    #expect(HealthPagePolicy.restoredAnalysis(roundTrip.cachedAnalyses!,day:"2026-10-12")["recovery"]?.text=="today")
    #expect(roundTrip.itemAnalysisEnabled==false)
}
@Test func health4AnalysisFailureMapsOffOfflineAndGenerationFailure() {
    let off=HealthPagePolicy.analysisFailure(APIFailure.server(status:409,code:"AI_ANALYSIS_OFF"),offline:false)
    #expect(off.disabled && off.message.contains("已关闭"))
    let offline=HealthPagePolicy.analysisFailure(URLError(.notConnectedToInternet),offline:false)
    #expect(!offline.disabled && offline.message.contains("电脑不在线"))
    let failed=HealthPagePolicy.analysisFailure(APIFailure.server(status:500,code:"UNAVAILABLE"),offline:false)
    #expect(!failed.disabled && failed.message.contains("再试"))
}
@Test func health4DailyMeanAllDiscreteInputsUseNaturalDaysAndDST() {
    var calendar=Calendar(identifier:.gregorian);calendar.timeZone=TimeZone(identifier:"America/New_York")!
    let day=ISO8601DateFormatter().date(from:"2027-03-14T05:00:00Z")!
    let next=calendar.date(byAdding:.day,value:1,to:day)!
    #expect(next.timeIntervalSince(day)==23*3600)
    let points=[(day.addingTimeInterval(-1),999.0),(day,10.0),(next.addingTimeInterval(-1),20.0),(next,999.0)]
    for _ in ["respiratoryRateBrpm","spo2Pct","wristTempC","vo2Max"] {
        #expect(HealthInputMath.dailyMean(points,day:day,calendar:calendar)==15)
    }
    #expect(HealthInputMath.dailyMean([],day:day,calendar:calendar)==nil)
}

@Test func apple3HealthStatusAndScoreRangeRespectHostFacts() throws {
    #expect(HealthPagePolicy.statusTint("normal") == .green)
    #expect(HealthPagePolicy.statusTint("balanced") == .green)
    for state in ["high","low","more","less"] { #expect(HealthPagePolicy.statusTint(state) == .amber) }
    #expect(HealthPagePolicy.statusTint(nil) == .muted)
    #expect(HealthPagePolicy.statusTint("insufficient") == .muted)
    #expect(HealthPagePolicy.scorePosition(78) == 0.78)
    #expect(HealthPagePolicy.scorePosition(-20) == 0)
    #expect(HealthPagePolicy.scorePosition(120) == 1)
    #expect(HealthPagePolicy.scorePosition(nil) == nil)
    #expect(HealthPagePolicy.scorePosition(.nan) == nil)
    let overview=try pageOverview(",\"recovery\":{\"score\":78,\"reasons\":[{\"text\":\"昨晚休息接近平时\",\"inputs\":[\"sleepMinutes\"]}]}")
    #expect(HealthPagePolicy.score("recovery",in:overview)?.reasons?.first?.text == "昨晚休息接近平时")
    #expect(HealthPagePolicy.score("sleep",in:overview) == nil)
}
@Test func apple3HealthHostDisclaimerNeverBecomesRenderedContractContent() throws {
    let bytes=Data(#"{"scope":"recovery","day":"2026-10-12","mode":"statistics","text":"保持自己的节奏","points":[],"basis":[],"generatedAt":"2026-10-12T00:00:00Z","disclaimer":"不是医学结论"}"#.utf8)
    let value=try JSONDecoder().decode(HealthAnalysis.self,from:bytes)
    #expect(value.text == "保持自己的节奏")
    let wire=try #require(JSONSerialization.jsonObject(with:JSONEncoder().encode(value)) as? [String:Any])
    #expect(wire["disclaimer"] == nil)
}
