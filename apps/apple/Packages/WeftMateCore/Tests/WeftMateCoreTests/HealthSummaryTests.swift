import Foundation
import Testing
@testable import WeftMateCore

private let healthNow = ISO8601DateFormatter().date(from: "2026-10-06T12:00:00Z")!
private var healthCalendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(secondsFromGMT: 0)!; return c }
private func at(_ text: String) -> Date { ISO8601DateFormatter().date(from: text)! }
private func summary(_ days: [HealthDayInput], sleep: [HealthInterval] = [], workouts: [HealthInterval] = []) -> [HealthDailySummary] {
    var p = HealthPreferences(); p.requested = Set(HealthCategory.allCases)
    return HealthSummaryCalculator.summarize(days: days, sleep: sleep, workouts: workouts, preferences: p,
                                             calendar: healthCalendar, deviceId: "test-phone", now: healthNow)
}
@Test func healthBaselineExcludesTodayAndMissingDaysAndOlderHistory() {
    let days = (-16...0).map { offset in
        HealthDayInput(day: healthCalendar.date(byAdding: .day, value: offset, to: healthNow)!,
                       values: offset == -3 ? [:] : [.hrv: offset == 0 ? 40 : (offset < -14 ? 1000 : 50)])
    }
    let metric = summary(days).last!.metrics["hrv"]!
    #expect(metric.baselineDays == 13)
    #expect(metric.baselineMean == 50)
    #expect(metric.deviationPercent == -20)
}
@Test func healthCrossMidnightSleepMergesStagesAndOverlappingSources() {
    let sleep = [HealthInterval(start: at("2026-10-05T22:00:00Z"), end: at("2026-10-06T06:00:00Z")),
                 HealthInterval(start: at("2026-10-05T23:00:00Z"), end: at("2026-10-06T04:00:00Z"))]
    let result = summary([.init(day: at("2026-10-05T00:00:00Z")), .init(day: healthNow)], sleep: sleep)
    #expect(result[0].sleep == nil)
    #expect(result[1].sleep?.totalMinutes == 480)
    #expect(result[1].sleep?.fellAsleepAt == "2026-10-05T22:00:00Z")
    #expect(result[1].sleep?.wokeAt == "2026-10-06T06:00:00Z")
}
@Test func healthMissingDayDoesNotInventZeroAndZeroBaselineHasNoDeviation() {
    let days = [HealthDayInput(day: at("2026-10-05T00:00:00Z"), values: [.steps: 0]), .init(day: healthNow, values: [.steps: 100])]
    #expect(summary(days).last!.metrics["steps"]?.deviationPercent == nil)
    let missing = summary([.init(day: healthNow)])[0]
    #expect(missing.metrics.isEmpty && missing.sleep == nil && missing.workoutCount == nil)
    #expect(missing.readStates["heartRate"] == .noDataOrReadDenied)
}
@Test func healthAuthorizationNeverClaimsReadGrantFromAnEmptyQuery() {
    #expect(HealthReadState.resolve(enabled: true, available: true, requested: false, hasData: false) == .notRequested)
    #expect(HealthReadState.resolve(enabled: true, available: true, requested: true, hasData: false) == .noDataOrReadDenied)
    #expect(HealthReadState.resolve(enabled: false, available: true, requested: true, hasData: true) == .disabled)
    #expect(HealthReadState.resolve(enabled: true, available: false, requested: false, hasData: false) == .unavailable)
    #expect(HealthReadState.resolve(enabled: true, available: true, requested: true, hasData: true) == .dataAvailable)
    #expect(HealthReadState.resolve(enabled: true, available: true, requested: true, hasData: false, failed: true) == .failed)
}
@Test func healthConsentChangesRedactQueueAndRequeueUploadedDays() {
    var state = HealthLocalState(); state.enqueue(summary([.init(day: healthNow, values: [.hrv: 40])]))
    let original = state.pending.values.first!; state.acknowledge(original)
    #expect(state.pending.isEmpty)
    var p = state.preferences; p.cloudChoiceMade = true; p.cloudModelAllowed = true; p.selfAssessmentFrequency = .off
    state.applyPreferences(p)
    #expect(state.pending.values.first!.cloudModelAllowed)
    #expect(state.pending.values.first!.selfAssessmentFrequency == .off)
    p.cloudModelAllowed = false; p.enabled.remove(.hrv); state.applyPreferences(p)
    #expect(state.pending.values.first!.metrics["hrv"] == nil)
    #expect(!state.pending.values.first!.cloudModelAllowed)
    state.acknowledge(original)
    #expect(state.pending.count == 1)
    state.deleteAll()
    #expect(state.pending.isEmpty && state.summaries.isEmpty && state.deleteAllPending && state.preferences.enabled.isEmpty)
}
@Test func healthQueuePersistsRestartAndAccountIsolationWithoutRawSamples() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let server = try ServerConfiguration(input: "https://health.invalid")
    let a = HealthLocalStore(directory: directory, account: try LocalAccountScope(server: server, ownerId: "a"))
    let b = HealthLocalStore(directory: directory, account: try LocalAccountScope(server: server, ownerId: "b"))
    var state = HealthLocalState(); state.enqueue(summary([.init(day: healthNow)])); try a.save(state)
    #expect(try a.load().pending.count == 1)
    #expect(try b.load().pending.isEmpty)
    let bytes = try String(contentsOf: a.file, encoding: .utf8)
    #expect(!bytes.contains("samples") && !bytes.contains("intervals"))
    #expect(!state.preferences.cloudModelAllowed)
}
@Test func healthSleepAwakeGapAcrossMidnightBelongsToWakeDayWithoutCountingAwakeTime() {
    let sleep = [HealthInterval(start: at("2026-10-05T22:00:00Z"), end: at("2026-10-05T23:50:00Z")),
                 HealthInterval(start: at("2026-10-06T00:10:00Z"), end: at("2026-10-06T06:00:00Z"))]
    let result = summary([.init(day: at("2026-10-05T00:00:00Z")), .init(day: healthNow)], sleep: sleep)
    #expect(result[0].sleep == nil)
    #expect(result[1].sleep?.totalMinutes == 460)
    #expect(result[1].sleep?.fellAsleepAt == "2026-10-05T22:00:00Z")
}
@Test func healthWorkoutUsesActiveDurationAndCalendarUsesLocalDate() {
    var calendar = healthCalendar; calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    let day = at("2026-10-06T12:00:00Z")
    var p = HealthPreferences(); p.requested = [.workouts]
    let result = HealthSummaryCalculator.summarize(days: [.init(day: day)], sleep: [],
        workouts: [.init(start: at("2026-10-06T08:00:00Z"), end: at("2026-10-06T09:00:00Z"), durationMinutes: 30)],
        preferences: p, calendar: calendar, deviceId: "phone", now: day)[0]
    #expect(result.date == "2026-10-06" && result.workoutMinutes == 30 && result.workoutCount == 1)
}
