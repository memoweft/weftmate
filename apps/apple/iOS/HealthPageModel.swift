import Foundation
import Combine
import WeftMateCore

@MainActor final class HealthPageModel: ObservableObject {
    @Published var cache = HealthPageCache()
    @Published var offline = false
    @Published var loading = false
    @Published var error: String?
    @Published var analysisEnabled = false
    @Published var analysisSupported = false
    @Published var analyses: [String:HealthAnalysis] = [:]
    @Published var generating: Set<String> = []
    @Published var analysisErrors: [String:String] = [:]
    @Published var notice: String?
    private var account: LocalAccountScope?
    private var epoch = UUID()
    private var file: URL?
    private var requestIDs: [String:String] = [:]
    private func prepare(_ app: AppleAppModel) throws -> Bool {
        guard let session = app.session else { cache = .init(); analyses = [:]; account = nil; file = nil; return false }
        let next = try LocalAccountScope(server:session.server,ownerId:session.account.ownerId)
        if next != account || epoch != app.accountEpoch {
            account = next; epoch = app.accountEpoch; loading=false; offline=false; cache = .init(); analyses = [:]; analysisEnabled = false; generating = []; analysisErrors = [:]; requestIDs = [:]; notice = nil; error = nil
            file = app.healthStateDirectory.appendingPathComponent("health-page-"+next.cacheKey+".json")
            if let file, let data = try? Data(contentsOf:file), let loaded = try? JSONDecoder().decode(HealthPageCache.self,from:data) {
                cache = loaded; analysisEnabled=loaded.itemAnalysisEnabled == true; analysisSupported=loaded.analysisSupported == true
                var calendar=Calendar(identifier:.gregorian); if let zone=loaded.series.values.first?.timeZone,let timeZone=TimeZone(identifier:zone) { calendar.timeZone=timeZone }
                let today=DailyHealthCalendar.key(Date(),calendar:calendar)
                analyses=Dictionary((loaded.cachedAnalyses ?? []).filter { $0.day == today }.map { ($0.scope,$0) },uniquingKeysWith:{ _,b in b })
            }
        }
        return true
    }
    private func matches(_ app: AppleAppModel, _ token: UUID) -> Bool { token == epoch && app.accountEpoch == token && app.session?.account.ownerId == account?.ownerId && app.session?.server.originString == account?.originString }
    private func save() throws {
        guard let file else { return }
        cache.cachedAnalyses=Array(analyses.values); cache.itemAnalysisEnabled=analysisEnabled; cache.analysisSupported=analysisSupported
        try FileManager.default.createDirectory(at:file.deletingLastPathComponent(),withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        try JSONEncoder().encode(cache).write(to:file,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
        var url=file; var v=URLResourceValues(); v.isExcludedFromBackup=true; try url.setResourceValues(v)
    }
    func refresh(app: AppleAppModel) async {
        do { guard try prepare(app), !loading else { return } } catch { self.error="上次的内容暂时打不开，请重试。"; return }
        let token=epoch; loading=true; defer { if matches(app,token) { loading=false } }
        do {
            let overview=try await app.assistantClient.healthOverview()
            guard matches(app,token), !Task.isCancelled else { return }
            if cache.overview?.day != overview.day { analyses=[:]; analysisErrors=[:]; cache.series=[:] }
            cache.overview=overview; cache.fetchedAt=Date(); offline=false; error=nil; try save()
            let month=String(overview.day.prefix(7))
            if let calendar=try? await app.assistantClient.healthCalendar(month:month), matches(app,token) { cache.calendar=calendar; try save() }
            if let settings=try? await app.assistantClient.healthPageSettings(), matches(app,token) { analysisSupported=settings.settings.itemAnalysisEnabled != nil; analysisEnabled=settings.settings.itemAnalysisEnabled == true }
            if let existing=try? await app.assistantClient.healthAnalysisCache(day:overview.day), matches(app,token) {
                analyses=Dictionary(existing.items.filter { $0.day == overview.day }.map { ($0.scope,$0) },uniquingKeysWith: { _,b in b })
            }
            for id in ["recovery","sleep","load","deepMinutes","remMinutes"] {
                if let series=try? await app.assistantClient.healthMetrics(id,days:7), matches(app,token) { cache.series[id+"-7"]=series }
            }
            if matches(app,token) { try save() }
        } catch { if matches(app,token) { offline=true; self.error=cache.overview == nil ? "电脑暂时连不上，请稍后重试。" : nil } }
    }
    func metric(_ id: String, days: Int, app: AppleAppModel) async -> HealthMetricSeries? {
        let token=epoch
        do {
            let result=try await app.assistantClient.healthMetrics(id,days:days)
            guard matches(app,token),!Task.isCancelled else { return nil }
            cache.series[id+"-\(days)"]=result; try save(); return result
        } catch { guard matches(app,token) else { return nil }; offline=true; return cache.series[id+"-\(days)"] }
    }
    func setAI(_ enabled: Bool, app: AppleAppModel) async -> Bool {
        let token=epoch
        do { let result=try await app.assistantClient.healthPageSettings(enabled:enabled); guard matches(app,token) else { return false }; analysisSupported=result.settings.itemAnalysisEnabled != nil; analysisEnabled=result.settings.itemAnalysisEnabled == true; try save(); return analysisEnabled == enabled }
        catch { if matches(app,token) { notice="暂时没能改变设置，连接电脑后再试。" }; return false }
    }
    func analyze(_ scope: String, enable: Bool = false, app: AppleAppModel) async {
        guard let day=cache.overview?.day, analyses[scope]?.day != day, !generating.contains(scope) else { return }
        let token=epoch
        generating.insert(scope); analysisErrors[scope]=nil
        defer { if matches(app,token) { generating.remove(scope) } }
        if enable { let changed = await setAI(true,app:app); if !changed { analysisErrors[scope]="电脑暂时连不上，连接后再试。"; return } }
        guard analysisEnabled, matches(app,token) else { return }
        do { let result=try await app.assistantClient.healthAnalysis(scope:scope,day:day); guard matches(app,token),cache.overview?.day == day else { return }; analyses[scope]=result; try save() }
        catch {
            guard matches(app,token) else { return }
            if case APIFailure.server(409,"AI_ANALYSIS_OFF") = error { analysisEnabled=false; analysisErrors[scope]="AI 分析已关闭，可以重新打开。" }
            else { analysisErrors[scope]=offline || error is URLError ? "电脑不在线，连接后再来看看。" : "这次没能分析好，点一下再试。" }
        }
    }
    func remind(_ suggestion: HealthInsight.Suggestion, app: AppleAppModel) async {
        let token=epoch
        guard let sessionID=app.mainChat.chat?.activeSessionId ?? app.selectedConversation?.sessionId else { notice="先在主对话聊一句，再来设置提醒。"; return }
        let key=(cache.overview?.day ?? "")+suggestion.id
        let requestID=requestIDs[key] ?? UUID().uuidString; requestIDs[key]=requestID
        do { try await app.assistantClient.remindHealthSuggestion(suggestion.id,sessionID:sessionID,requestID:requestID); if matches(app,token) { notice="已经替你记下提醒。" } }
        catch { if matches(app,token) { notice="提醒还没记上，请连接电脑后重试。" } }
    }
    var updatedText: String {
        guard let date=cache.fetchedAt else { return "" }
        let c=Calendar.current, f=DateFormatter(); f.dateFormat="H:mm"
        let day=c.isDateInToday(date) ? "今天" : c.isDateInYesterday(date) ? "昨天" : DeviceDateText.day(DailyHealthCalendar.key(date,calendar:c))
        return "上次更新 "+day+" "+f.string(from:date)
    }
}
