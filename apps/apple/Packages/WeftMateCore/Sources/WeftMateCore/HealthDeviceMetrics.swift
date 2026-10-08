import Foundation

/// Ephemeral HealthKit observations. Neither this type nor sleep stages are Codable.
public struct HealthQuantityObservation: Sendable {
    public var category: HealthCategory
    public var start: Date
    public var end: Date
    public var value: Double
    public init(category: HealthCategory, start: Date, end: Date? = nil, value: Double) {
        self.category = category; self.start = start; self.end = end ?? start; self.value = value
    }
}
public struct HealthSleepStage: Sendable {
    public var interval: HealthInterval
    public var stage: String // core / deep / rem / unspecified, never awake or inBed
    public init(interval: HealthInterval, stage: String) { self.interval = interval; self.stage = stage }
}
public struct HealthScore: Codable, Equatable, Sendable {
    public var value: Double
    public var inputs: [String]
    public var baselineDays: Int
}
public struct HealthStressRange: Codable, Equatable, Sendable {
    public var lower: Double
    public var upper: Double
    public var sampleCount: Int
    public var latestSampleAt: String
    public var confidence: String // sparse / sampled; neither means continuous measurement
}
public struct HealthHourlySummary: Codable, Equatable, Sendable {
    public var start: String
    public var end: String
    public var bodyBattery: Double?
    public var stress: HealthStressRange?
}
public struct HealthLoadSummary: Codable, Equatable, Sendable {
    public var value: Double
    public var inputs: [String]
    public var elevatedHeartRateMinutes: Double?
    public var acute7Mean: Double?
    public var chronic28Mean: Double?
    public var ratio: Double?
    public var acuteDays: Int
    public var chronicDays: Int
}
public struct HealthSleepInsights: Codable, Equatable, Sendable {
    public var stageMinutes: [String: Double]
    public var continuityPercent: Double
    public var durationScore: Double?
    public var midpointDeviationMinutes: Double?
    public var baselineDays: Int
}
public struct HealthDerivedMetrics: Codable, Equatable, Sendable {
    public var algorithmVersion = "weftmate-h3-v1"
    public var recovery: HealthScore?
    public var load: HealthLoadSummary?
    public var sleep: HealthSleepInsights?
}

/// Transparent companion estimates, NOT PeakWatch's proprietary algorithm. See docs/COMPANION.md 4b.
/// Uses HealthKit SDNN (not RMSSD). No population norms, assumed max HR, inferred missing zeroes or medical advice.
public enum HealthDeviceMetricsCalculator {
    private static func clamp(_ x: Double, _ lower: Double = 0, _ upper: Double = 100) -> Double { min(upper, max(lower, x)) }
    private static func rounded(_ x: Double) -> Double { (x * 100).rounded() / 100 }
    private static func mean(_ values: [Double]) -> Double? { values.isEmpty ? nil : values.reduce(0, +) / Double(values.count) }
    private static func overlap(_ a: Date, _ b: Date, _ c: Date, _ d: Date) -> Double { max(0, min(b, d).timeIntervalSince(max(a, c))) }
    private static func groups(_ intervals: [HealthInterval]) -> [[HealthInterval]] {
        var result: [[HealthInterval]] = []
        for interval in HealthSummaryCalculator.mergedSleep(intervals) {
            if let last = result.last?.last, interval.start.timeIntervalSince(last.end) <= 7200 {
                result[result.count - 1].append(interval)
            } else { result.append([interval]) }
        }
        return result
    }
    /// Midnight is not a sleep boundary: the longest completed episode on the wake date anchors recovery.
    /// Daytime sleep and night shifts use exactly the same rule. Each baseline excludes the evaluated local day.
    public static func calculate(summaries: [HealthDailySummary], observations: [HealthQuantityObservation],
                                 sleepStages: [HealthSleepStage], workouts: [HealthInterval],
                                 preferences: HealthPreferences, calendar: Calendar, now: Date) -> [HealthDailySummary] {
        let enabled = preferences.enabled.intersection(preferences.requested)
        let samples = observations.filter { enabled.contains($0.category) && $0.value.isFinite && $0.value >= 0 && $0.start <= now }
        let stages = enabled.contains(.sleep) ? sleepStages.filter { $0.interval.end <= now } : []
        let episodes = groups(stages.map(\.interval))
        let exercise = enabled.contains(.workouts) ? workouts : []
        let ordered = summaries.sorted { $0.date < $1.date }
        let formatter = DateFormatter(); formatter.calendar = calendar; formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        let starts = Dictionary(uniqueKeysWithValues: ordered.map { ($0.date, formatter.date(from: $0.date)!) })
        let episodesByDate = Dictionary(grouping: episodes) { HealthSummaryCalculator.dateKey($0.last!.end, calendar: calendar) }
        let primaryByDate = episodesByDate.mapValues { list in
            list.max { a, b in a.reduce(0) { $0 + $1.end.timeIntervalSince($1.start) } < b.reduce(0) { $0 + $1.end.timeIntervalSince($1.start) } }!
        }
        let allSleep = episodes.flatMap { $0 }
        let samplesByCategory = Dictionary(grouping: samples, by: \.category)
        func dayStart(_ summary: HealthDailySummary) -> Date { starts[summary.date]! }
        func primary(_ summary: HealthDailySummary) -> [HealthInterval]? { primaryByDate[summary.date] }
        var nightValues: [String: [HealthCategory: Double]] = [:]
        for summary in ordered {
            guard let sleep = primary(summary) else { continue }
            for category in [HealthCategory.hrv, .respiratoryRate] {
                nightValues[summary.date, default: [:]][category] = mean((samplesByCategory[category] ?? []).filter { s in
                    sleep.contains { s.start >= $0.start && s.start < $0.end }
                }.map(\.value))
            }
        }
        func nightly(_ summary: HealthDailySummary, _ category: HealthCategory) -> Double? { nightValues[summary.date]?[category] }
        func recent(_ summary: HealthDailySummary, _ days: Int) -> [HealthDailySummary] {
            let start = calendar.date(byAdding: .day, value: -days, to: dayStart(summary))!
            return ordered.filter { $0.date < summary.date && dayStart($0) >= start }
        }
        var baselines: [String: [HealthCategory: (Double, Int)]] = [:]
        for summary in ordered {
            for category in [HealthCategory.hrv, .respiratoryRate, .restingHeartRate, .sleep] {
                let night = category == .hrv || category == .respiratoryRate
                let values = recent(summary, 14).compactMap { night ? nightly($0, category) : $0.metrics[category.rawValue]?.value }
                if let avg = mean(values), avg > 0 { baselines[summary.date, default: [:]][category] = (avg, values.count) }
            }
        }
        func baseline(_ summary: HealthDailySummary, _ category: HealthCategory) -> (Double, Int)? {
            baselines[summary.date]?[category]
        }
        func metric(_ summary: HealthDailySummary, _ category: HealthCategory) -> Double? {
            guard enabled.contains(category), summary.readStates[category.rawValue] == .dataAvailable else { return nil }
            return summary.metrics[category.rawValue]?.value
        }
        func clockMinute(_ date: Date) -> Double {
            let c = calendar.dateComponents([.hour, .minute, .second], from: date)
            return Double(c.hour! * 60 + c.minute!) + Double(c.second!) / 60
        }
        // Circular local-clock deviation handles 23:xx / 00:xx and avoids penalizing daytime sleepers.
        func midpoint(_ sleep: [HealthInterval]) -> Date { sleep.first!.start.addingTimeInterval(sleep.last!.end.timeIntervalSince(sleep.first!.start) / 2) }
        var loads: [String: HealthLoadSummary] = [:]
        for summary in ordered {
            let start = dayStart(summary), end = min(now, calendar.date(byAdding: .day, value: 1, to: start)!)
            var total = 0.0, inputs: [String] = [], elevated: Double?
            if let energy = metric(summary, .activeEnergy) { total += energy / 100; inputs.append("activeEnergy") }
            if enabled.contains(.workouts), summary.readStates["workouts"] == .dataAvailable, let minutes = summary.workoutMinutes {
                total += minutes / 10; inputs.append("workouts")
            }
            if let rhr = metric(summary, .restingHeartRate), rhr > 0 {
                let hr = samples.filter { $0.category == .heartRate && $0.start >= start && $0.start < end }
                if !hr.isEmpty {
                    // Only actual sample spans; point samples represent one second. Overlaps use max zone weight.
                    // No bridging between sparse samples. Zones are multiples of own RHR, not max-HR zones.
                    var events: [Date: [Int: Int]] = [:]
                    for s in hr {
                        let ratio = s.value / rhr
                        let weight = ratio < 1.2 ? 0 : ratio < 1.5 ? 1 : ratio < 1.8 ? 2 : ratio < 2.1 ? 3 : 4
                        events[s.start, default: [:]][weight, default: 0] += 1
                        let finish = min(end, max(s.end, s.start.addingTimeInterval(1)))
                        events[finish, default: [:]][weight, default: 0] -= 1
                    }
                    var active: [Int: Int] = [:], previous: Date?, minutes = 0.0, weighted = 0.0
                    for boundary in events.keys.sorted() {
                        let weight = active.filter { $0.value > 0 }.keys.max() ?? 0
                        if let previous, weight > 0 {
                            let span = boundary.timeIntervalSince(previous) / 60
                            minutes += span; weighted += span * Double(weight)
                        }
                        for (zone, delta) in events[boundary]! { active[zone, default: 0] += delta }
                        previous = boundary
                    }
                    elevated = rounded(minutes); total += weighted / 10; inputs.append("heartRate")
                }
            }
            if !inputs.isEmpty { loads[summary.date] = .init(value: rounded(total), inputs: inputs, elevatedHeartRateMinutes: elevated,
                acute7Mean: nil, chronic28Mean: nil, ratio: nil, acuteDays: 0, chronicDays: 0) }
        }
        var battery: Double?
        return ordered.map { original in
            var summary = original
            let start = dayStart(summary), end = min(now, calendar.date(byAdding: .day, value: 1, to: start)!)
            let mainSleep = primary(summary)
            var sleepInsights: HealthSleepInsights?
            if let mainSleep, let sleep = summary.sleep, enabled.contains(.sleep) {
                let prior = recent(summary, 14).compactMap(primary)
                let deviations = prior.map { old -> Double in
                    let delta = abs(clockMinute(midpoint(mainSleep)) - clockMinute(midpoint(old)))
                    return min(delta, 1440 - delta)
                }
                // Stage union is de-duplicated across sources; stage precedence prevents total > asleep minutes.
                let dayEpisodes = episodes.filter { HealthSummaryCalculator.dateKey($0.last!.end, calendar: calendar) == summary.date }.flatMap { $0 }
                let selected = stages.filter { s in dayEpisodes.contains { overlap(s.interval.start, s.interval.end, $0.start, $0.end) > 0 } }
                let boundaries = Array(Set(selected.flatMap { [$0.interval.start, $0.interval.end] })).sorted()
                var totals: [String: Double] = [:]
                for (a, b) in zip(boundaries, boundaries.dropFirst()) {
                    let covering = selected.filter { $0.interval.start <= a && $0.interval.end >= b }.map(\.stage)
                    if let stage = ["deep", "rem", "core", "unspecified"].first(where: { covering.contains($0) }) {
                        totals[stage, default: 0] += b.timeIntervalSince(a) / 60
                    }
                }
                let asleep = mainSleep.reduce(0) { $0 + $1.end.timeIntervalSince($1.start) }
                let continuity = clamp(asleep / mainSleep.last!.end.timeIntervalSince(mainSleep.first!.start) * 100)
                let durationScore = baseline(summary, .sleep).map { clamp(sleep.totalMinutes / $0.0 * 100) }
                sleepInsights = .init(stageMinutes: totals.mapValues(rounded), continuityPercent: rounded(continuity),
                    durationScore: durationScore.map(rounded), midpointDeviationMinutes: mean(deviations).map(rounded), baselineDays: prior.count)
            }
            // Neutral baseline = 70. HRV improves with positive deviation, RHR / respiration with negative deviation.
            // Weights (.40/.25/.25/.10) renormalize over available inputs; basis is explicit, never invented.
            var components: [(String, Double, Double, Int)] = []
            for (category, weight, sign, night) in [(HealthCategory.hrv, 0.40, 1.0, true), (.restingHeartRate, 0.25, -1.0, false), (.respiratoryRate, 0.10, -1.0, true)] {
                if enabled.contains(category), summary.readStates[category.rawValue] == .dataAvailable,
                   let current = night ? nightly(summary, category) : metric(summary, category),
                   let (avg, count) = baseline(summary, category) {
                    components.append((category.rawValue, clamp(70 + sign * 100 * (current / avg - 1)), weight, count))
                }
            }
            if let sleepInsights, let score = sleepInsights.durationScore {
                components.append(("sleep", clamp(70 + (score - 100) + (sleepInsights.continuityPercent - 100)), 0.25, sleepInsights.baselineDays))
            }
            let recovery: HealthScore? = components.isEmpty ? nil : .init(
                value: rounded(components.reduce(0) { $0 + $1.1 * $1.2 } / components.reduce(0) { $0 + $1.2 }),
                inputs: components.map { $0.0 }, baselineDays: components.map { $0.3 }.min()!)
            var load = loads[summary.date]
            if load != nil {
                let acute = recent(summary, 7).compactMap { loads[$0.date].flatMap { $0.inputs == load!.inputs ? $0.value : nil } }
                let chronic = recent(summary, 28).compactMap { loads[$0.date].flatMap { $0.inputs == load!.inputs ? $0.value : nil } }
                load!.acuteDays = acute.count; load!.chronicDays = chronic.count
                // Complete windows only: do not interpret missing/denied days as zero activity.
                if acute.count == 7 { load!.acute7Mean = mean(acute).map(rounded) }
                if chronic.count == 28 { load!.chronic28Mean = mean(chronic).map(rounded) }
                if let a = mean(acute), acute.count == 7, let c = mean(chronic), chronic.count == 28, c > 0 { load!.ratio = rounded(a / c) }
            }
            var hourly: [HealthHourlySummary] = []
            var cursor = start
            while cursor < end {
                let finish = min(end, calendar.date(byAdding: .hour, value: 1, to: cursor)!)
                // Rest = no recorded movement / workout / sleep near the paired HR + HRV sample.
                // Pair within five minutes, use each HRV once, don't extrapolate into empty hours.
                var stressValues: [(Date, Double)] = []
                if let (hrBase, _) = baseline(summary, .restingHeartRate), let (hrvBase, _) = baseline(summary, .hrv),
                   enabled.contains(.steps), enabled.contains(.workouts), enabled.contains(.sleep),
                   summary.readStates["hrv"] == .dataAvailable, summary.readStates["heartRate"] == .dataAvailable {
                    for hrv in samples where hrv.category == .hrv && hrv.start >= cursor && hrv.start < finish && hrv.value > 0 {
                        let a = hrv.start.addingTimeInterval(-300), b = hrv.start.addingTimeInterval(300)
                        let moving = samples.contains { $0.category == .steps && $0.value > 0 && overlap(a, b, $0.start, max($0.end, $0.start.addingTimeInterval(1))) > 0 }
                        let asleep = allSleep.contains { hrv.start >= $0.start && hrv.start < $0.end }
                        let exercising = exercise.contains { overlap(a, b, $0.start, $0.end) > 0 }
                        guard !moving, !asleep, !exercising,
                              let hr = samples.filter({ $0.category == .heartRate && abs($0.start.timeIntervalSince(hrv.start)) <= 300 })
                                .min(by: { abs($0.start.timeIntervalSince(hrv.start)) < abs($1.start.timeIntervalSince(hrv.start)) }) else { continue }
                        stressValues.append((hrv.start, clamp(30 + 100 * (hr.value / hrBase - 1) + 100 * (1 - hrv.value / hrvBase))))
                    }
                }
                let stress: HealthStressRange?
                if !stressValues.isEmpty {
                    let margin = stressValues.count < 3 ? 20.0 : 10.0
                    stress = .init(lower: rounded(clamp(stressValues.map { $0.1 }.min()! - margin)),
                        upper: rounded(clamp(stressValues.map { $0.1 }.max()! + margin)), sampleCount: stressValues.count,
                        latestSampleAt: HealthSummaryCalculator.timestamp(stressValues.map { $0.0 }.max()!),
                        confidence: stressValues.count < 3 ? "sparse" : "sampled")
                } else { stress = nil }
                // Reset on actual primary wake, including afternoon for night shifts. A nap charges without resetting.
                let wake = mainSleep?.last?.end
                let reset = wake.map { $0 > cursor && $0 <= finish || $0 == cursor } ?? false
                if reset { battery = recovery?.value }
                let integrationStart = reset ? max(cursor, wake!) : cursor
                let asleepSeconds = allSleep.reduce(0) { $0 + overlap(integrationStart, finish, $1.start, $1.end) }
                let awakeHours = max(0, finish.timeIntervalSince(integrationStart) - asleepSeconds) / 3600
                let energy = samples.filter { $0.category == .activeEnergy }.reduce(0.0) { total, s in
                    let duration = s.end.timeIntervalSince(s.start)
                    return total + (duration > 0 ? s.value * overlap(integrationStart, finish, s.start, s.end) / duration :
                        (s.start >= integrationStart && s.start < finish ? s.value : 0))
                }
                let workoutMinutes = exercise.reduce(0.0) { total, w in
                    let duration = w.end.timeIntervalSince(w.start)
                    return total + (duration > 0 ? overlap(integrationStart, finish, w.start, w.end) / duration * (w.durationMinutes ?? duration / 60) : 0)
                }
                if let value = battery {
                    let stressMean = mean(stressValues.map { $0.1 })
                    let restCharge = (stressMean.map { $0 < 20 } ?? false) ? 2 * awakeHours : 0
                    battery = rounded(clamp(value + asleepSeconds / 3600 * 8 + restCharge - awakeHours * 1.5 - (stressMean ?? 0) / 20 * awakeHours - energy / 100 - workoutMinutes / 30))
                }
                if battery != nil || stress != nil {
                    hourly.append(.init(start: HealthSummaryCalculator.timestamp(cursor), end: HealthSummaryCalculator.timestamp(finish), bodyBattery: battery, stress: stress))
                }
                cursor = finish
            }
            // Query failures must not leave an apparently current composite based on partially failed inputs.
            if summary.readStates.values.contains(.failed) { summary.derived = nil; summary.hourly = nil; battery = nil }
            else {
                summary.derived = .init(recovery: recovery, load: load, sleep: sleepInsights)
                summary.hourly = hourly.isEmpty ? nil : hourly
            }
            // H3 aggregates stay on the personal host even when older H1 consent allowed cloud models.
            summary.cloudModelAllowed = false
            return summary
        }
    }
}
