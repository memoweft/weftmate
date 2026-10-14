import Foundation
import Testing
@testable import WeftMateCore

@MainActor private final class RecordingReminderCenter: ReminderNotificationCenter {
    var requests: [String:ReminderNotification]=[:]
    var additions: [ReminderNotification]=[]
    var removed: [String]=[]
    var delivered=Set<String>()
    var other=0
    var suspended: CheckedContinuation<Void,Never>?
    var suspendNext=false
    var failNext=false
    func pending() async -> [ReminderNotification] { Array(requests.values) }
    func otherPendingCount() async -> Int { other }
    func remove(_ identifiers: [String]) { removed += identifiers;for id in identifiers { requests[id]=nil } }
    func removeDeliveredExcept(_ identifiers: Set<String>) async { delivered.formIntersection(identifiers) }
    func add(_ notification: ReminderNotification) async throws {
        if suspendNext { suspendNext=false;await withCheckedContinuation { suspended=$0 } }
        if failNext { failNext=false;throw NSError(domain:"synthetic-add-failure",code:1) }
        additions.append(notification);requests[notification.identifier]=notification
    }
}
struct LocalReminderTests {
    private let now=Date(timeIntervalSince1970:1_800_000_000)
    @Test @MainActor func createThenRescheduleChangedTimeAndText() async throws {
        let center=RecordingReminderCenter(),scheduler=LocalReminderScheduler(center:center,now:{now})
        var row=LocalReminder(id:"water",text:"喝水",fireAt:now.addingTimeInterval(120),sessionID:"chat")
        try await scheduler.reconcile(account:"local",reminders:[row])
        #expect(center.requests.count == 1);#expect(center.additions.count == 1)
        let identifier=try #require(center.requests.keys.first)
        row.fireAt=now.addingTimeInterval(300);row.text="温水"
        try await scheduler.reconcile(account:"local",reminders:[row])
        #expect(center.requests.count == 1);#expect(center.requests[identifier]?.fireAt == row.fireAt)
        #expect(center.requests[identifier]?.text == "温水");#expect(center.additions.count == 2)
        try await scheduler.reconcile(account:"local",reminders:[row])
        #expect(center.additions.count == 2)
    }
    @Test @MainActor func deleteCompleteAndPauseWithdrawPendingAndDelivered() async throws {
        let center=RecordingReminderCenter(),scheduler=LocalReminderScheduler(center:center,now:{now})
        var row=LocalReminder(text:"完成",fireAt:now.addingTimeInterval(300))
        try await scheduler.reconcile(account:"local",reminders:[row])
        center.delivered=Set(center.requests.keys);row.completed=true
        try await scheduler.reconcile(account:"local",reminders:[row])
        #expect(center.requests.isEmpty);#expect(center.delivered.isEmpty)
        row.completed=false;try await scheduler.reconcile(account:"local",reminders:[row])
        try await scheduler.reconcile(account:"local",reminders:[])
        #expect(center.requests.isEmpty);#expect(center.removed.count == 2)
    }
    @Test @MainActor func nearest64AndRefillAfterDelivery() async throws {
        var clock=now
        let center=RecordingReminderCenter(),scheduler=LocalReminderScheduler(center:center,now:{clock})
        let rows=(1...70).reversed().map { LocalReminder(id:"r\($0)",text:"\($0)",fireAt:now.addingTimeInterval(Double($0*60))) }
        try await scheduler.reconcile(account:"local",reminders:rows)
        #expect(center.requests.count == 64)
        #expect(Set(center.requests.values.map(\.text)) == Set((1...64).map(String.init)))
        clock=now.addingTimeInterval(61)
        center.requests=center.requests.filter { $0.value.fireAt > clock }
        try await scheduler.reconcile(account:"local",reminders:rows)
        #expect(center.requests.count == 64)
        #expect(Set(center.requests.values.map(\.text)) == Set((2...65).map(String.init)))
    }
    @Test @MainActor func reservesSlotsForOtherNotificationsAndIgnoresPast() async throws {
        let center=RecordingReminderCenter(),scheduler=LocalReminderScheduler(center:center,now:{now});center.other=4
        let rows=(0...70).map { LocalReminder(text:"\($0)",fireAt:now.addingTimeInterval(Double($0*60))) }
        try await scheduler.reconcile(account:"local",reminders:rows)
        #expect(center.requests.count == 60);#expect(center.requests.values.allSatisfy { $0.fireAt > now })
    }
    @Test @MainActor func rejectionKeepsDataAndRetrySchedulesWithoutBlocking() async throws {
        let center=RecordingReminderCenter(),scheduler=LocalReminderScheduler(center:center,now:{now})
        let row=LocalReminder(text:"喝水",fireAt:now.addingTimeInterval(120))
        try await scheduler.reconcile(account:"local",reminders:[row],authorized:false)
        #expect(center.requests.isEmpty)
        center.failNext=true
        await #expect(throws:(any Error).self) { try await scheduler.reconcile(account:"local",reminders:[row]) }
        try await scheduler.reconcile(account:"local",reminders:[row])
        #expect(center.requests.count == 1)
    }
    @Test @MainActor func accountAndHostScopeAndRestartReconciliation() async throws {
        let center=RecordingReminderCenter(),scheduler=LocalReminderScheduler(center:center,now:{now})
        let a=LocalReminder(id:"same",text:"电脑一",fireAt:now.addingTimeInterval(120),sessionID:"chat",hostID:"a")
        var b=a;b.hostID="b"
        try await scheduler.reconcile(account:"account-a",reminders:[a,b]);#expect(center.requests.count == 2)
        let old=Set(center.requests.keys)
        let restarted=LocalReminderScheduler(center:center,now:{now})
        try await restarted.reconcile(account:"account-b",reminders:[a])
        #expect(center.requests.count == 1);#expect(Set(center.requests.keys).isDisjoint(with:old))
        let route=try #require(center.requests.values.first?.route)
        #expect(route.account == ReminderRoute.accountKey("account-b"));#expect(route.hostID == "a");#expect(route.sessionID == "chat")
    }
    @Test @MainActor func deletionWhileAddSuspendedCannotResurrectNotification() async throws {
        let center=RecordingReminderCenter(),scheduler=LocalReminderScheduler(center:center,now:{now})
        center.suspendNext=true
        let first=Task { try await scheduler.reconcile(account:"local",reminders:[LocalReminder(text:"撤销",fireAt:now.addingTimeInterval(120))]) }
        while center.suspended == nil { await Task.yield() }
        let second=Task { try await scheduler.reconcile(account:"local",reminders:[]) }
        await Task.yield();center.suspended?.resume();center.suspended=nil
        try await first.value;try await second.value
        #expect(center.requests.isEmpty)
    }
    @Test func serverSchedulesCoverTimedGoalsAndPausedCompletedDropOut() throws {
        let json="""
        {"items":[
        {"id":"goal-time","sessionId":"goal-chat","text":"目标安排","kind":"task","state":"scheduled","timeZone":"Asia/Shanghai","nextRunAt":"2027-01-01T01:00:00.000Z"},
        {"id":"reminder","sessionId":"chat","text":"喝水","kind":"reminder","state":"scheduled","timeZone":"Asia/Shanghai","nextRunAt":"2027-01-01T02:00:00Z"},
        {"id":"paused","sessionId":"chat","text":"暂停","kind":"reminder","state":"paused","timeZone":"UTC","nextRunAt":null},
        {"id":"done","sessionId":"chat","text":"完成","kind":"reminder","state":"completed","timeZone":"UTC","nextRunAt":null}]}
        """
        let rows=LocalReminder.schedules(try JSONDecoder().decode(ScheduleList.self,from:Data(json.utf8)).items,hostID:"host")
        #expect(rows.count == 2);#expect(rows[0].id == "goal-chat/goal-time");#expect(rows[0].sessionID == "goal-chat")
    }
    @Test func naturalLanguageRelativeTomorrowAndInvalidTimes() throws {
        var calendar=Calendar(identifier:.gregorian);calendar.timeZone=TimeZone(identifier:"Asia/Shanghai")!
        let now=try #require(ReminderDate.parse("2026-10-14T06:00:00Z"))
        let relative=try #require(PhoneReminderCommand.parse("2 分钟后提醒我 喝水",now:now,calendar:calendar))
        #expect(relative.text == "喝水");#expect(relative.date == now.addingTimeInterval(120))
        #expect(PhoneReminderCommand.parse("明天 9 点提醒我喝水",now:now,calendar:calendar)?.date == ReminderDate.parse("2026-10-15T01:00:00Z"))
        #expect(PhoneReminderCommand.parse("明天下午 3 点半提醒我散步",now:now,calendar:calendar)?.date == ReminderDate.parse("2026-10-15T07:30:00Z"))
        #expect(PhoneReminderCommand.parse("今天 9 点提醒我迟了",now:now,calendar:calendar) == nil)
        #expect(PhoneReminderCommand.parse("明天 25 点提醒我无效",now:now,calendar:calendar) == nil)
        #expect(PhoneReminderCommand.parse("明天 9:75 提醒我无效",now:now,calendar:calendar) == nil)
        #expect(PhoneReminderCommand.parse("2分钟后提醒我",now:now,calendar:calendar) == nil)
        #expect(PhoneReminderCommand.parse("999999999999999999999999999天后提醒我溢出",now:now,calendar:calendar) == nil)
    }
    @Test func erasedSourceConversationWithdrawsItsReminders() {
        var state=PhoneChatState(),thread=PhoneChatThread()
        thread.messages=[.init(role:"user",text:"合成原话")];state.threads=[thread]
        _=state.prepareMigration(host:"host",generation:1)
        state.reminders=[.init(text:"原对话提醒",fireAt:now,sessionID:thread.id),.init(text:"手动提醒",fireAt:now)]
        state.computerReminders=["host":[.init(text:"电脑提醒",fireAt:now,hostID:"host")]]
        state.applyMigrationGeneration(host:"host",generation:2)
        #expect(state.reminders?.count == 1);#expect(state.reminders?.first?.sessionID == nil)
        #expect(state.computerReminders?["host"] == nil)
    }
    @Test func encryptedReminderStorageAndLegacyCompatibility() throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:dir) }
        let keys=MemoryStore(),store=try PhoneChatStore(account:"account",directory:dir,credentials:keys)
        var state=try JSONDecoder().decode(PhoneChatState.self,from:Data("{\"threads\":[]}".utf8))
        #expect(state.reminders == nil)
        let row=LocalReminder(text:"synthetic-reminder-body",fireAt:now.addingTimeInterval(120),sessionID:"chat")
        state.reminders=[row];state.computerReminders=["host":[row]];try store.save(state)
        #expect(try store.load().reminders == [row]);#expect(try store.load().computerReminders?["host"] == [row])
        #expect(try Data(contentsOf:store.file).range(of:Data(row.text.utf8)) == nil)
    }
}
