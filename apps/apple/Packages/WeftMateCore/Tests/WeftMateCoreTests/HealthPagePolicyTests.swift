import Foundation
import Testing
@testable import WeftMateCore

private func pageOverview(_ extras: String = "") throws -> HealthOverview {
    try JSONDecoder().decode(HealthOverview.self,from:Data(("{\"day\":\"2026-10-12\",\"connected\":true,\"vitals\":{}"+extras+"}").utf8))
}
@Test func health4PageVersionAndOptionalCardsFollowHostFields() throws {
    let old=try pageOverview()
    #expect(HealthPagePolicy.recordVersion(old.capabilities)==2)
    #expect(HealthPagePolicy.visibleOptionalCards(old).isEmpty)
    let current=try pageOverview(",\"capabilities\":{\"record\":3,\"profile\":true},\"stress\":{\"score\":35},\"energy\":{\"score\":72},\"fitnessAge\":{\"value\":34}")
    #expect(HealthPagePolicy.recordVersion(current.capabilities)==3)
    #expect(HealthPagePolicy.visibleOptionalCards(current)==["stress","energy","fitnessAge"])
    #expect(HealthPagePolicy.visibleOptionalCards(try pageOverview(",\"stress\":null,\"energy\":null,\"fitnessAge\":null")).isEmpty)
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
