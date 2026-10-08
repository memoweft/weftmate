import Foundation
import Testing
@testable import WeftMateCore

private func h3Date(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
private func h3Calendar(_ zone: String = "UTC") -> Calendar {
    var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: zone)!; return c
}
private struct H3Data {
    var preferences: HealthPreferences
    var summaries: [HealthDailySummary]
    var observations: [HealthQuantityObservation]
    var stages: [HealthSleepStage]
    var workouts: [HealthInterval]
    var calendar: Calendar
    var now: Date
    init(now: Date = h3Date("2026-10-06T12:00:00Z"), calendar: Calendar = h3Calendar(), wakeHour: Int = 6, days: Int = 30) {
        self.now = now; self.calendar = calendar
        preferences = HealthPreferences(); preferences.requested = preferences.enabled
        preferences.cloudChoiceMade = true; preferences.cloudModelAllowed = true
        observations = []; stages = []; workouts = []
        var daily: [HealthDayInput] = []
        for offset in (-days...0) {
            let day = calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: now))!
            let wake = calendar.date(bySettingHour: wakeHour, minute: 0, second: 0, of: day)!
            let asleep = HealthInterval(start: wake.addingTimeInterval(-8 * 3600), end: wake)
            stages.append(.init(interval: asleep, stage: "core"))
            observations.append(.init(category: .hrv, start: wake.addingTimeInterval(-3600), value: 50))
            observations.append(.init(category: .respiratoryRate, start: wake.addingTimeInterval(-3600), value: 16))
            observations.append(.init(category: .heartRate, start: wake.addingTimeInterval(-3600), end: wake.addingTimeInterval(-3540), value: 60))
            observations.append(.init(category: .activeEnergy, start: day, end: day.addingTimeInterval(3600), value: 200))
            daily.append(.init(day: day, values: [.hrv: 50, .restingHeartRate: 60, .heartRate: 60, .respiratoryRate: 16, .activeEnergy: 200, .steps: 0]))
        }
        summaries = HealthSummaryCalculator.summarize(days: daily, sleep: stages.map(\.interval), workouts: [], preferences: preferences,
            calendar: calendar, deviceId: "synthetic-phone", now: now)
    }
    func compute() -> [HealthDailySummary] {
        HealthDeviceMetricsCalculator.calculate(summaries: summaries, observations: observations, sleepStages: stages,
            workouts: workouts, preferences: preferences, calendar: calendar, now: now)
    }
}
@Test func h3NormalPersonalBaselineRecoveryLoadAndLocalOnlyHourlyPayload() throws {
    var data = H3Data()
    let at = h3Date("2026-10-06T10:05:00Z")
    data.observations += [.init(category: .hrv, start: at, value: 40), .init(category: .heartRate, start: at, value: 72)]
    let results = data.compute(), latest = results.last!
    #expect(latest.derived?.recovery?.value == 70)
    #expect(latest.derived?.recovery?.inputs.count == 4)
    #expect(latest.derived?.recovery?.baselineDays == 14)
    #expect(latest.derived?.load?.ratio == 1)
    #expect(latest.derived?.load?.acuteDays == 7 && latest.derived?.load?.chronicDays == 28)
    let hour = latest.hourly!.first { $0.stress != nil }!
    #expect(hour.stress?.lower == 50 && hour.stress?.upper == 90)
    #expect(hour.stress?.confidence == "sparse")
    #expect(latest.hourly!.last!.bodyBattery! < 70)
    #expect(!latest.cloudModelAllowed)
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    let bytes = try encoder.encode(latest)
    #expect(bytes.count <= 12 * 1024)
    let text = String(decoding: bytes, as: UTF8.self)
    #expect(!text.contains("observations") && !text.contains("intervals"))
    #expect(try JSONDecoder().decode(HealthDailySummary.self, from: bytes) == latest)
}
@Test func h3MissingDataAndNoBaselineNeverInventScoresOrLoadRatio() {
    var data = H3Data(days: 0)
    let first = data.compute().last!
    #expect(first.derived?.recovery == nil && first.hourly == nil)
    #expect(first.derived?.load?.ratio == nil)
    data.summaries[0].metrics = [:]; data.summaries[0].sleep = nil
    data.stages = []; data.observations = []
    let missing = data.compute().last!
    #expect(missing.derived?.load == nil && missing.derived?.sleep == nil && missing.derived?.recovery == nil)
    #expect(missing.hourly == nil)
}
@Test func h3NightShiftUsesActualAfternoonWakeAndPersonalSchedule() {
    let data = H3Data(now: h3Date("2026-10-06T20:00:00Z"), wakeHour: 16)
    let latest = data.compute().last!
    #expect(latest.derived?.recovery?.value == 70)
    #expect(latest.derived?.sleep?.midpointDeviationMinutes == 0)
    #expect(latest.sleep?.wokeAt == "2026-10-06T16:00:00Z")
    // Prior-day battery can exist before wake, but the wake-hour resets to personal recovery.
    #expect(latest.hourly?.first { $0.start == "2026-10-06T15:00:00Z" }?.bodyBattery == 70)
    #expect(latest.hourly?.last?.bodyBattery == 64)
}
@Test func h3TimeZoneRebucketUsesAbsoluteHoursAndHandlesBothDSTTransitions() {
    for (now, expected) in [("2026-11-02T08:30:00Z", 25), ("2026-03-09T07:30:00Z", 23)] {
        let data = H3Data(now: h3Date(now), calendar: h3Calendar("America/Los_Angeles"))
        let results = data.compute()
        let previous = results[results.count - 2]
        let intervals = previous.hourly ?? []
        #expect(intervals.count == expected)
        #expect(Set(intervals.map(\.start)).count == expected)
        #expect(intervals.allSatisfy { h3Date($0.end).timeIntervalSince(h3Date($0.start)) == 3600 })
    }
    let now = h3Date("2026-10-06T12:00:00Z")
    let utc = H3Data(now: now), tokyo = H3Data(now: now, calendar: h3Calendar("Asia/Tokyo"))
    #expect(utc.compute().last!.timeZone == utc.calendar.timeZone.identifier && tokyo.compute().last!.timeZone == "Asia/Tokyo")
    #expect(tokyo.compute().last!.hourly?.allSatisfy { HealthSummaryCalculator.dateKey(h3Date($0.start), calendar: tokyo.calendar) == "2026-10-06" } == true)
}
@Test func h3StressExcludesMovementWorkoutSleepAndDoesNotCarryIntoUnsampledHour() {
    var data = H3Data()
    let at = h3Date("2026-10-06T10:05:00Z")
    data.observations += [.init(category: .hrv, start: at, value: 50), .init(category: .heartRate, start: at, value: 60)]
    #expect(data.compute().last!.hourly?.filter { $0.stress != nil }.count == 1)
    data.observations.append(.init(category: .steps, start: at, value: 10))
    #expect(data.compute().last!.hourly?.allSatisfy { $0.stress == nil } == true)
    data.observations.removeLast()
    data.workouts.append(.init(start: at.addingTimeInterval(-60), end: at.addingTimeInterval(60)))
    #expect(data.compute().last!.hourly?.allSatisfy { $0.stress == nil } == true)
}
@Test func h3StagesDeduplicateAndAwakeGapsReduceContinuity() {
    var data = H3Data()
    let start = h3Date("2026-10-05T22:00:00Z"), end = h3Date("2026-10-06T06:00:00Z")
    data.stages.removeLast()
    data.stages += [.init(interval: .init(start: start, end: start.addingTimeInterval(4 * 3600)), stage: "core"),
        .init(interval: .init(start: start.addingTimeInterval(4.5 * 3600), end: end), stage: "deep"),
        .init(interval: .init(start: start, end: start.addingTimeInterval(4 * 3600)), stage: "unspecified")]
    data.summaries[data.summaries.count - 1].sleep?.totalMinutes = 450
    let sleep = data.compute().last!.derived!.sleep!
    #expect(sleep.stageMinutes.values.reduce(0, +) == 450)
    #expect(sleep.continuityPercent == 93.75)
}
@Test func h3DisabledInputsAndQueryFailureInvalidateDerivedQueueAndCloudConsent() {
    var data = H3Data(), state = HealthLocalState()
    let summaries = data.compute(); state.enqueue(summaries)
    var p = data.preferences; state.applyPreferences(p)
    #expect(state.pending.values.allSatisfy { !$0.cloudModelAllowed })
    p.enabled.remove(.hrv); state.applyPreferences(p)
    #expect(state.pending.values.allSatisfy { $0.derived == nil && $0.hourly == nil && $0.metrics["hrv"] == nil })
    data.summaries[data.summaries.count - 1].readStates["hrv"] = .failed
    #expect(data.compute().last!.derived == nil && data.compute().last!.hourly == nil)
}
@Test func h3MissingLoadDayLeavesRatioAbsentAndOverlappingHeartRateIsNotDoubleCounted() {
    var data = H3Data()
    data.summaries[4].metrics.removeValue(forKey: "activeEnergy")
    data.summaries[4].metrics.removeValue(forKey: "restingHeartRate")
    #expect(data.compute().last!.derived?.load?.ratio == nil)
    let at = h3Date("2026-10-06T10:00:00Z")
    let observation = HealthQuantityObservation(category: .heartRate, start: at, end: at.addingTimeInterval(60), value: 120)
    data.observations += [observation, observation]
    #expect(data.compute().last!.derived?.load?.elevatedHeartRateMinutes == 1)
}

@Test func h3SameAbsoluteObservationsKeepRecoveryAndBatteryAcrossTimeZones() {
    let utc = H3Data()
    var tokyo = utc; tokyo.calendar = h3Calendar("Asia/Tokyo")
    tokyo.summaries = tokyo.summaries.map { s in var copy = s; copy.timeZone = "Asia/Tokyo"; return copy }
    let a = utc.compute().last!, b = tokyo.compute().last!
    #expect(a.derived?.recovery == b.derived?.recovery)
    for hour in a.hourly!.filter({ $0.start >= "2026-10-06T06:00:00Z" }) {
        #expect(b.hourly?.first { $0.start == hour.start }?.bodyBattery == hour.bodyBattery)
    }
    let wake = h3Date("2026-10-06T23:00:00Z")
    let interval = HealthInterval(start: wake.addingTimeInterval(-8 * 3600), end: wake)
    let shifted = HealthSummaryCalculator.summarize(days: [.init(day: wake)], sleep: [interval], workouts: [],
        preferences: utc.preferences, calendar: tokyo.calendar, deviceId: "synthetic", now: wake.addingTimeInterval(3600))
    #expect(shifted[0].date == "2026-10-07" && shifted[0].sleep?.wokeAt == "2026-10-06T23:00:00Z")
}
@Test func h3PartialInputsAreExplicitAndRenormalizedAndLegacyH1StillDecodes() throws {
    var data = H3Data(); data.preferences.enabled.remove(.hrv); data.preferences.enabled.remove(.respiratoryRate)
    let latest = data.compute().last!
    #expect(latest.derived?.recovery?.inputs == ["restingHeartRate", "sleep"])
    #expect(latest.derived?.recovery?.value == 70)
    #expect(latest.hourly?.allSatisfy { $0.stress == nil } == true)
    var legacy = latest; legacy.derived = nil; legacy.hourly = nil
    let bytes = try JSONEncoder().encode(legacy)
    #expect(try JSONDecoder().decode(HealthDailySummary.self, from: bytes) == legacy)
}

@Test func h3PartialWakeHourIntegratesOnlyAfterWakeAndNapChargesWithoutReset() {
    var data = H3Data(now: h3Date("2026-10-06T06:45:00Z"))
    let wake = h3Date("2026-10-06T06:30:00Z")
    data.stages[data.stages.count - 1].interval = .init(start: wake.addingTimeInterval(-8 * 3600), end: wake)
    data.summaries[data.summaries.count - 1].sleep?.fellAsleepAt = "2026-10-05T22:30:00Z"
    data.summaries[data.summaries.count - 1].sleep?.wokeAt = "2026-10-06T06:30:00Z"
    let latest = data.compute().last!
    #expect(latest.hourly?.last?.end == "2026-10-06T06:45:00Z")
    #expect(latest.hourly?.last?.bodyBattery == 69.63) // 70 - 0.25 h * 1.5, rounded to 2 decimals.
    data.now = h3Date("2026-10-06T12:00:00Z")
    let awakeBattery = data.compute().last!.hourly!.last!.bodyBattery!
    data.stages.append(.init(interval: .init(start: h3Date("2026-10-06T10:00:00Z"), end: h3Date("2026-10-06T11:00:00Z")), stage: "core"))
    data.summaries[data.summaries.count - 1].sleep?.totalMinutes = 540
    let withNap = data.compute().last!
    #expect(withNap.hourly!.last!.bodyBattery! == awakeBattery + 9.5) // +8 sleep, instead of -1.5 awake.
}
@Test func h3MultipleRestingPairsUseSampledRangeWithoutExtrapolation() {
    var data = H3Data()
    for minute in [5, 20, 40] {
        let at = h3Date("2026-10-06T10:00:00Z").addingTimeInterval(Double(minute) * 60)
        data.observations += [.init(category: .hrv, start: at, value: 40), .init(category: .heartRate, start: at, value: 72)]
    }
    let hours = data.compute().last!.hourly!
    let stress = hours.first { $0.stress != nil }!.stress!
    #expect(stress.sampleCount == 3 && stress.confidence == "sampled")
    #expect(stress.lower == 60 && stress.upper == 80)
    #expect(hours.last!.stress == nil)
}
