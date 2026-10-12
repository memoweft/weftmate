import Foundation
import Testing
@testable import WeftMateCore

@Test(.enabled(if: ProcessInfo.processInfo.environment["WEFTMATE_APPLE5_CONFIG"] != nil))
func apple5RealPersonalHostHealthAndFeatureHTTP() async throws {
    struct Config: Decodable { var origin: String; var username: String; var password: String; var day: String; var sessionId: String; var records: [HealthBatchItem]; var profile: HealthProfile }
    let path=try #require(ProcessInfo.processInfo.environment["WEFTMATE_APPLE5_CONFIG"])
    let config=try JSONDecoder().decode(Config.self,from:Data(contentsOf:URL(fileURLWithPath:path)))
    let client=PersonalClient(credentialStore:MemoryStore(),transport:Apple5HTTPTransport(),platform:.iOS)
    let server=try ServerConfiguration(input:config.origin,allowLoopbackHTTP:true)
    let session=try await client.login(server:server,username:config.username,password:config.password,deviceName:"合成 iPhone")
    let account=try LocalAccountScope(server:server,ownerId:session.account.ownerId)
    let overview=try await client.healthOverview()
    #expect(overview.capabilities?.record == 3 && overview.capabilities?.profile == true)
    #expect(overview.stress?.latest?.time != nil && overview.stress?.samples?.first?.method != nil)
    #expect(overview.energy?.curve?.count == 96 && overview.energy?.sleepPeriods?.isEmpty == false)
    #expect(overview.fitnessAge?.fitnessAge != nil && overview.fitnessAge?.referenceRange != nil)
    let batch=try await client.putHealthBatch(config.records,account:account)
    #expect(batch.items.count == config.records.count && batch.changedDays.isEmpty)
    try await client.putHealthProfile(config.profile,account:account)
    for id in ["stress","energy","fitnessAge"] {
        let series=try await client.healthMetrics(id,days:7,to:"2026-10-01")
        #expect(series.points.count == 7 && series.points.last?.day == "2026-10-01")
    }
    let weekly=try await client.healthWeekly(to:config.day)
    #expect(weekly.to == config.day && weekly.health != nil)
    await #expect(throws:APIFailure.server(status:409,code:"AI_ANALYSIS_OFF")) { _=try await client.healthAnalysis(scope:"stress",day:config.day) }
    _=try await client.healthPageSettings(enabled:true)
    let analysis=try await client.healthAnalysis(scope:"stress",day:config.day)
    let cached=try await client.healthAnalysis(scope:"stress",day:config.day)
    #expect(analysis.text == cached.text && analysis.generatedAt == cached.generatedAt)
    _=try await client.healthPageSettings(enabled:false)
    let cache=try await client.healthAnalysisCache(day:config.day)
    #expect(cache.day == config.day && cache.items.contains { $0.scope == "stress" })
    await #expect(throws:APIFailure.server(status:409,code:"AI_ANALYSIS_OFF")) { _=try await client.healthAnalysis(scope:"stress",day:config.day) }
    var today=try #require(config.records.last).health
    today.sleepMinutes=300; var sleep=HealthSleepRecord(); sleep.minutes=300; today.sleep=sleep
    try await client.putDailyHealth(day:config.day,health:today,account:account)
    let changed=try await client.healthOverview()
    let suggestion=try #require(changed.insight?.suggestions.first { $0.reminder != nil })
    try await client.remindHealthSuggestion(suggestion.id,requestID:"apple5-no-conversation")
    try await client.remindHealthSuggestion(suggestion.id,requestID:"apple5-no-conversation")
    // Dynamic read/mark-read is handled by the real account activity store.
    let activity=try await client.phoneActivity()
    let unread=try #require(activity.items.first { !$0.read })
    try await client.phoneMarkRead(unread,requestID:"apple5-read")
    #expect(try await client.phoneActivity().items.first { $0.id == unread.id }?.read == true)
    let tasks=try await client.phoneTasks(); #expect(tasks.timeZone == "UTC")
    let schedule=try #require(try await client.settingsSchedules().items.first { $0.sessionId == config.sessionId })
    try await client.phoneManageSchedule(schedule,action:.pause,requestID:"apple5-pause")
    #expect(try await client.settingsSchedules().items.first { $0.id == schedule.id }?.state == "paused")
    try await client.phoneManageSchedule(schedule,action:.resume,requestID:"apple5-resume")
    #expect(try await client.settingsSchedules().items.first { $0.id == schedule.id }?.state == "active")
    let goals=try await client.phoneGoals(); let goal=try #require(goals.items.first)
    #expect(goal.phase == "active" && goal.source.sessionId == config.sessionId)
    try await client.phoneManageGoal(goal,action:.complete,requestID:"apple5-complete")
    let complete=try #require(try await client.phoneGoals().items.first)
    #expect(complete.phase == "complete")
    try await client.phoneManageGoal(complete,action:.archive,requestID:"apple5-archive")
    #expect(try await client.phoneGoals().items.isEmpty)
    let files=try await client.phoneLibrary(type:"document",search:"计划")
    let file=try #require(files.items.first)
    #expect(file.fileName == "周末计划.md" && file.source.sessionId == config.sessionId)
    let detail=try await client.phoneLibraryDetail(file.id); #expect(detail.item.source.seq == 1)
    let preview=try await client.phoneLibraryPreview(file.id)
    #expect(preview.kind == "markdown" && preview.text?.contains("散步") == true && preview.exportData != nil)
    #expect(try await client.phoneLibrary(type:"image",search:"计划").items.isEmpty)
    try await client.phoneManageSchedule(schedule,action:.delete,requestID:"apple5-delete")
    #expect(try await client.settingsSchedules().items.contains { $0.id == schedule.id } == false)
}

private actor Apple5HTTPTransport: HTTPTransport {
    let base=URLSessionTransport()
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let result=try await base.send(request)
        print("APPLE5_HTTP", request.httpMethod ?? "GET", request.url?.path ?? "", result.status)
        if request.url?.path.hasSuffix("/health/overview") == true { do { _ = try JSONDecoder().decode(HealthOverview.self,from:result.body) } catch { print("APPLE5_DECODE",error) } }
        return result
    }
}
