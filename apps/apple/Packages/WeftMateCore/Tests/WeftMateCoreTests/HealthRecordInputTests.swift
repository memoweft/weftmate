import Foundation
import Testing
@testable import WeftMateCore

private func h4date(_ s: String) -> Date { ISO8601DateFormatter().date(from:s)! }
private func h4calendar(_ zone: String = "UTC") -> Calendar { var c = Calendar(identifier:.gregorian); c.timeZone = TimeZone(identifier:zone)!; return c }
@Test func health4KnownBeatsUseMillisecondsAndFiftyMillisecondBins() {
    let rr = (0..<40).map { $0 % 2 == 0 ? 1000.0 : 1100.0 }
    let v = HealthInputMath.beats(rr)
    #expect(v.rmssd == 100)
    #expect(abs(v.heartRate! - 60000/1050) < 0.00001)
    // Tie goes to the lowest bin: 1025ms; 50 percent / (2*1.025*0.1).
    #expect(abs(v.stress! - 243.90243902439) < 0.000001)
    #expect(HealthInputMath.beats([1000,1000,1000]).stress == nil)
    #expect(HealthInputMath.beats(Array(repeating:1000,count:40)).stress == nil)
    #expect(HealthInputMath.beats([1000,1100,2000,1000,1100]).rmssd == 100)
    #expect(HealthInputMath.beats([0,.nan]).heartRate == nil)
}
@Test func health4ZonesHaveExactBoundariesAndMissingMaximum() {
    let values = [59.0,60,70,80,90].map { (bpm:$0,seconds:60.0) }
    #expect(HealthInputMath.zones(values,maximum:100,durationMinutes:5) == [1,1,1,1,1])
    #expect(HealthInputMath.zones(values,maximum:nil,durationMinutes:5) == nil)
    #expect(HealthInputMath.zones(values,maximum:100,durationMinutes:2.5) == [0.5,0.5,0.5,0.5,0.5])
}
@Test func health4SleepWakeDateDedupAndStagePrecedence() {
    let a=h4date("2026-10-10T22:00:00Z"), b=a.addingTimeInterval(3600), c=b.addingTimeInterval(3600), end=a.addingTimeInterval(8*3600)
    let inputs: [HealthInputMath.SleepInput] = [.init(a,end,"inBed"),.init(a,end,"core"),.init(a,end,"core"),.init(a,b,"deep"),.init(b,c,"rem"),.init(c,c.addingTimeInterval(600),"awake")]
    let value = HealthInputMath.sleep(inputs,calendar:h4calendar())["2026-10-11"]!
    #expect(value.minutes == 470 && value.inBedMinutes == 480)
    #expect(value.deepMinutes == 60 && value.remMinutes == 60 && value.awakeMinutes == 10 && value.coreMinutes == 350)
    #expect(value.stages?.count == 4)
}
@Test func health4SleepDSTUsesElapsedMinutesAndHourlySlotsStayFixed() {
    let c = h4calendar("America/New_York")
    let start=h4date("2026-11-01T02:00:00Z"), end=h4date("2026-11-01T12:00:00Z")
    #expect(HealthInputMath.sleep([.init(start,end,"deep")],calendar:c)["2026-11-01"]?.minutes == 600)
    let day=c.startOfDay(for:h4date("2027-03-14T12:00:00Z"))
    let p=[(h4date("2027-03-14T06:30:00Z"),60.0),(h4date("2027-03-14T07:30:00Z"),70.0)]
    let hourly=HealthInputMath.buckets(p,day:day,calendar:c,quarter:false)
    #expect(hourly.count == 24 && hourly[2] == nil && hourly[1]?.avg == 60 && hourly[3]?.avg == 70)
    #expect(HealthInputMath.buckets(p,day:day,calendar:c,quarter:true).count == 96)
}
@Test func health4WireVersionGatesAllV3KeysAndRawBeatsNeverEncode() throws {
    var v = DailyHealth(steps:0); v.version=3
    v.hrvSamples=[.init(time:"2026-10-12T00:00:00Z",sdnnMs:50,intervalsMs:(0..<40).map { $0%2 == 0 ? 1000 : 1100 })]
    v.sleep=HealthSleepRecord(); v.sleep?.stages=[.init(start:"2026-10-11T22:00:00Z",end:"2026-10-12T06:00:00Z",stage:"core")]
    v.heartRateQuarterHourly=Array(repeating:nil,count:96)
    let encoder=JSONEncoder()
    let three=try JSONSerialization.jsonObject(with:encoder.encode(v)) as! [String:Any]
    #expect(three["hrvSamples"] != nil && three["heartRateQuarterHourly"] != nil)
    #expect(Set((three["hrvSamples"] as! [[String:Any]])[0].keys) == ["time","sdnnMs","rmssdMs","stressIndex","meanHeartRateBpm"])
    v.version=2
    let two=try JSONSerialization.jsonObject(with:encoder.encode(v)) as! [String:Any]
    #expect(two["hrvSamples"] == nil && two["heartRateQuarterHourly"] == nil)
    #expect((two["sleep"] as! [String:Any])["stages"] == nil)
    #expect(Set(two.keys) == ["version","status","steps","sleepMinutes","restingHeartRateBpm","exerciseMinutes","workouts","activeEnergyKcal","sleep","hrvSdnnMs","respiratoryRateBrpm","spo2Pct","wristTempC","vo2Max","heartRateHourly"])
}
@Test func health4HistoryResumesBatchesAndUpgradesExactlyOnce() throws {
    var s=DailyHealthState(); let now=h4date("2026-10-12T12:00:00Z")
    s.beginHistory(version:2,now:now,calendar:h4calendar()); #expect(s.historyRemaining?.count == 90)
    let first=s.nextHistoryDays; #expect(first.count == 10)
    s.acknowledgeHistory(first)
    s=try JSONDecoder().decode(DailyHealthState.self,from:JSONEncoder().encode(s))
    s.beginHistory(version:2,now:now,calendar:h4calendar())
    #expect(s.historyRemaining?.count == 80 && Set(first).isDisjoint(with:s.nextHistoryDays))
    while !s.nextHistoryDays.isEmpty { s.acknowledgeHistory(s.nextHistoryDays) }
    s.beginHistory(version:2,now:now,calendar:h4calendar()); #expect(s.historyRemaining?.isEmpty == true)
    s.beginHistory(version:3,now:now,calendar:h4calendar()); #expect(s.historyRemaining?.count == 90)
    while !s.nextHistoryDays.isEmpty { s.acknowledgeHistory(s.nextHistoryDays) }
    s.beginHistory(version:3,now:now,calendar:h4calendar()); #expect(s.historyRemaining?.isEmpty == true)
}
@Test func health4Health1StoreMigratesWithoutNewConsentAtStartup() throws {
    let original = "{\"enabled\":true,\"connected\":true,\"hintDismissed\":false,\"retentionDays\":90,\"delivered\":{},\"pending\":{},\"needsRemoteClear\":false}"
    let s=try JSONDecoder().decode(DailyHealthState.self,from:Data(original.utf8))
    #expect(s.enabled && s.connected && s.expandedAuthorization == nil && s.historyVersion == nil)
}
