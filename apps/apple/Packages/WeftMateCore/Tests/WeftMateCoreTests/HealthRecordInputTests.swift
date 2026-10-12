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
private actor Health4ContractTransport: HTTPTransport {
    var requests: [URLRequest]=[]
    var failBatchAt: Int?
    var batchAttempts=0
    func failOnceAtBatch(_ index: Int) { failBatchAt=index }
    func send(_ r: URLRequest) async throws -> HTTPResponse {
        let path=r.url!.path;requests.append(r)
        if path.hasSuffix("/auth/login") || path.hasSuffix("/auth/me") {
            return .init(status:200,headers:["set-cookie":"wm_personal_session="+String(repeating:"a",count:43)],body:Data(("{\"account\":{\"ownerId\":\"synthetic\",\"username\":\"fixture\",\"displayName\":\"Fixture\"},\"device\":{\"id\":\"test-phone\",\"name\":\"Test\"},\"csrfToken\":\""+String(repeating:"b",count:43)+"\"}").utf8))
        }
        if path.hasSuffix("/status") { return .init(status:200,body:Data("{\"ownerId\":\"synthetic\",\"hostId\":\"synthetic-host\"}".utf8)) }
        if path.hasSuffix("/records/batch") {
            batchAttempts += 1
            if failBatchAt == batchAttempts { failBatchAt=nil; return .init(status:503,body:Data("{\"error\":{\"code\":\"UNAVAILABLE\"}}".utf8)) }
            let body=try JSONDecoder().decode(HealthBatchBody.self,from:r.httpBody!)
            let value=HealthBatchReply(items:body.items,changedDays:body.items.map(\.day))
            return .init(status:200,body:try JSONEncoder().encode(value))
        }
        if path.hasSuffix("/settings/health") { return .init(status:200,body:Data("{\"settings\":{\"modelInsightsEnabled\":true,\"itemAnalysisEnabled\":true,\"sleepTargetMinutes\":450,\"retentionDays\":400}}".utf8)) }
        if path.hasSuffix("/health/analysis") {
            if r.httpMethod == "GET" { return .init(status:200,body:Data("{\"items\":[]}".utf8)) }
            return .init(status:409,body:Data("{\"error\":{\"code\":\"AI_ANALYSIS_OFF\"}}".utf8))
        }
        return .init(status:200,body:Data("{}".utf8))
    }
    func all() -> [URLRequest] { requests }
}
@Test func health4RealClientBatchProfileAndAnalysisUseContractBodiesAndAuth() async throws {
    let transport=Health4ContractTransport()
    // Each client uses one authenticated identity, including all subsequent parity requests.
    let tested=PersonalClient(credentialStore:MemoryStore(),transport:transport,platform:.iOS)
    let server=try ServerConfiguration(input:"https://health.example.com")
    let session=try await tested.login(server:server,username:"fixture",password:"synthetic-only",deviceName:"Test")
    let account=try LocalAccountScope(server:server,ownerId:session.account.ownerId)
    var v=DailyHealth(steps:1234);v.version=2
    let reply=try await tested.putHealthBatch([.init(day:"2026-10-11",health:v)],account:account)
    #expect(reply.items.count == 1 && reply.items[0].health == v)
    try await tested.putHealthProfile(.init(birthYear:1986,sex:"male",heightCm:175,weightKg:70),account:account)
    _=try await tested.healthPageSettings(enabled:true)
    _=try await tested.healthAnalysisCache(day:"2026-10-12")
    await #expect(throws:APIFailure.server(status:409,code:"AI_ANALYSIS_OFF")) { _=try await tested.healthAnalysis(scope:"recovery",day:"2026-10-12") }
    let requests=await transport.all()
    let mutations=requests.filter { $0.httpMethod == "PUT" || $0.httpMethod == "PATCH" || $0.url!.path.hasSuffix("/health/analysis") && $0.httpMethod == "POST" }
    #expect(mutations.count == 4 && mutations.allSatisfy { $0.value(forHTTPHeaderField:"X-WeftMate-CSRF") != nil })
    let setting=try JSONSerialization.jsonObject(with:mutations[2].httpBody!) as! [String:Bool]
    #expect(setting == ["itemAnalysisEnabled":true])
    let analysis=try JSONSerialization.jsonObject(with:mutations[3].httpBody!) as! [String:String]
    #expect(analysis == ["scope":"recovery","day":"2026-10-12"])
}
@Test func health4HeartbeatFloatingPointBoundariesDoNotChangeHistogramMode() {
    let rr=(0..<40).map { $0%2 == 0 ? 999.9999999999999 : 1100.0000000000002 }
    #expect(abs(HealthInputMath.beats(rr).stress! - 243.90243902439) < 0.000001)
}
@Test func health4RepresentativeVariabilityExcludesAwakeDaytimeAndNapMeasurements() {
    let start=h4date("2026-10-11T22:00:00Z"), wake=h4date("2026-10-12T06:00:00Z"),nap=h4date("2026-10-12T13:00:00Z")
    let sleep: [HealthInputMath.SleepInput]=[.init(start,wake,"core"),.init(start.addingTimeInterval(3600),start.addingTimeInterval(7200),"awake"),.init(nap,nap.addingTimeInterval(3600),"core")]
    let points=[(start.addingTimeInterval(1800),50.0),(start.addingTimeInterval(5400),200.0),(wake.addingTimeInterval(3600),300.0),(nap.addingTimeInterval(1800),400.0)]
    #expect(HealthInputMath.representativeVariability(points,sleep:sleep,calendar:h4calendar())["2026-10-12"] == 50)
    let shift=[HealthInputMath.SleepInput(nap,nap.addingTimeInterval(8*3600),"core")]
    #expect(HealthInputMath.representativeVariability([(nap.addingTimeInterval(3600),60)],sleep:shift,calendar:h4calendar())["2026-10-12"] == 60)
}
@Test func health4TemporaryHostDowngradeDoesNotRepeatCompletedVersionThreeHistory() {
    var s=DailyHealthState();let now=h4date("2026-10-12T12:00:00Z")
    s.beginHistory(version:2,now:now,calendar:h4calendar());while !s.nextHistoryDays.isEmpty { s.acknowledgeHistory(s.nextHistoryDays) }
    s.beginHistory(version:3,now:now,calendar:h4calendar());s.acknowledgeHistory(s.nextHistoryDays)
    s.beginHistory(version:2,now:now,calendar:h4calendar())
    #expect(s.historyTargetVersion == 3 && s.historyRemaining?.count == 80)
    while !s.nextHistoryDays.isEmpty { s.acknowledgeHistory(s.nextHistoryDays) }
    s.beginHistory(version:2,now:now,calendar:h4calendar());s.beginHistory(version:3,now:now,calendar:h4calendar())
    #expect(s.historyVersion == 3 && s.historyRemaining?.isEmpty == true)
}
@Test func health4HostTimestampsAcceptFractionalSecondsAndOffsets() {
    let expected=h4date("2026-10-12T14:32:00Z")
    #expect(HealthInputMath.parseISO("2026-10-12T14:32:00.000Z") == expected)
    #expect(HealthInputMath.parseISO("2026-10-12T07:32:00-07:00") == expected)
    #expect(HealthInputMath.parseISO("missing") == nil)
}
@Test func health4WorkoutOverlapsAreNotCountedTwice() {
    let a=h4date("2026-10-12T09:00:00Z"), b=a.addingTimeInterval(3600)
    #expect(HealthInputMath.uncovered(DateInterval(start:a,end:b),occupied:[DateInterval(start:a,end:b)]).isEmpty)
    #expect(HealthInputMath.uncovered(DateInterval(start:a.addingTimeInterval(1800),end:b.addingTimeInterval(1800)),occupied:[DateInterval(start:a,end:b)]) == [DateInterval(start:b,end:b.addingTimeInterval(1800))])
    #expect(HealthInputMath.uncovered(DateInterval(start:a,end:b),occupied:[DateInterval(start:a.addingTimeInterval(1200),end:a.addingTimeInterval(2400))]).map(\.duration) == [1200,1200])
}
@Test func health4NinetySyntheticRecordsBatchEncodingAndUpgradeWithoutSimulator() async throws {
    let transport=Health4ContractTransport()
    let tested=PersonalClient(credentialStore:MemoryStore(),transport:transport,platform:.iOS)
    let session=try await tested.login(server:ServerConfiguration(input:"https://health.example.com"),username:"fixture",password:"synthetic-only",deviceName:"Test")
    let account=try LocalAccountScope(server:session.server,ownerId:session.account.ownerId)
    let now=h4date("2026-10-12T12:00:00Z"),calendar=h4calendar()
    var state=DailyHealthState()
    await transport.failOnceAtBatch(2)
    for version in [2,3] {
        state.beginHistory(version:version,now:now,calendar:calendar)
        while !state.nextHistoryDays.isEmpty {
            let days=state.nextHistoryDays
            let items=days.enumerated().map { index,day -> HealthBatchItem in
                var record=DailyHealth(steps:index==0 ? nil : 1234,sleepMinutes:450,restingHeartRateBpm:60,exerciseMinutes:5)
                record.version=version;record.activeEnergyKcal=200;record.hrvSdnnMs=50;record.respiratoryRateBrpm=16;record.spo2Pct=98;record.wristTempC=36.5;record.vo2Max=42
                var sleep=HealthSleepRecord();sleep.minutes=450;sleep.inBedMinutes=480;sleep.deepMinutes=60;sleep.remMinutes=60;sleep.coreMinutes=330;sleep.awakeMinutes=30
                sleep.stages=[.init(start:day+"T00:00:00Z",end:day+"T01:00:00Z",stage:"deep")];record.sleep=sleep
                record.heartRateHourly=Array(repeating:nil,count:24);record.heartRateQuarterHourly=Array(repeating:nil,count:96)
                record.hrvSamples=[.init(time:day+"T02:00:00Z",sdnnMs:50,intervalsMs:(0..<40).map { $0%2==0 ? 1000 : 1100 })]
                var workout=DailyHealth.Workout(type:"跑步",minutes:5);workout.zoneMinutes=[1,1,1,1,1];workout.avgHeartRateBpm=140;workout.maxHeartRateBpm=180;record.workouts=[workout]
                return .init(day:day,health:record)
            }
            let reply: HealthBatchReply
            do { reply=try await tested.putHealthBatch(items,account:account) }
            catch APIFailure.server(503,"UNAVAILABLE") {
                state=try JSONDecoder().decode(DailyHealthState.self,from:JSONEncoder().encode(state))
                #expect(state.nextHistoryDays==days); continue
            }
            #expect(reply.items.count==10)
            state.acknowledgeHistory(days)
        }
        #expect(state.historyVersion==version)
    }
    let batches=await transport.all().filter { $0.url?.path.hasSuffix("/records/batch")==true }
    #expect(batches.count==19)
    var seen: [Int:Set<String>]=[:]
    for (index,request) in batches.enumerated() where index != 1 {
        let raw=try JSONSerialization.jsonObject(with:request.httpBody!) as! [String:Any]
        for item in raw["items"] as! [[String:Any]] {
            let h=item["health"] as! [String:Any],version=h["version"] as! Int,day=item["day"] as! String
            #expect(!seen[version,default:[]].contains(day));seen[version,default:[]].insert(day)
            if version==2 { #expect(h["hrvSamples"]==nil && h["heartRateQuarterHourly"]==nil && (h["sleep"] as! [String:Any])["stages"]==nil) }
            else { #expect((h["heartRateQuarterHourly"] as! [Any]).count==96);#expect(abs(((h["hrvSamples"] as! [[String:Any]])[0]["stressIndex"] as! Double)-243.90243902439)<0.00001) }
        }
    }
    #expect(seen[2]?.count==90 && seen[3]?.count==90)
}
