import Foundation

public struct HealthHeartBucket: Codable, Equatable, Sendable {
    public var avg: Double?; public var min: Double?; public var max: Double?
    public init(_ values: [Double]) { avg = values.isEmpty ? nil : values.reduce(0,+) / Double(values.count); min = values.min(); max = values.max() }
}
public struct HealthSleepRecord: Codable, Equatable, Sendable {
    public var minutes: Double?; public var inBedMinutes: Double?; public var start: String?; public var end: String?
    public var deepMinutes: Double?; public var coreMinutes: Double?; public var remMinutes: Double?; public var awakeMinutes: Double?
    public var stages: [HealthRecordSleepStage]?
    public init() {}
}
public struct HealthRecordSleepStage: Codable, Equatable, Sendable {
    public var start: String; public var end: String; public var stage: String
    public init(start: String, end: String, stage: String) { self.start = start; self.end = end; self.stage = stage }
}
public struct HealthVariabilityRecord: Codable, Equatable, Sendable {
    public var time: String; public var sdnnMs: Double; public var rmssdMs: Double?; public var stressIndex: Double?; public var meanHeartRateBpm: Double?
    public init(time: String, sdnnMs: Double, intervalsMs: [Double] = []) {
        self.time = time; self.sdnnMs = sdnnMs
        let result = HealthInputMath.beats(intervalsMs)
        rmssdMs = result.rmssd; stressIndex = result.stress; meanHeartRateBpm = result.heartRate
    }
    enum CodingKeys: String, CodingKey { case time, sdnnMs, rmssdMs, stressIndex, meanHeartRateBpm }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(time, forKey: .time); try c.encode(sdnnMs, forKey: .sdnnMs)
        try c.encode(rmssdMs, forKey: .rmssdMs); try c.encode(stressIndex, forKey: .stressIndex); try c.encode(meanHeartRateBpm, forKey: .meanHeartRateBpm)
    }
}
public struct HealthProfile: Codable, Equatable, Sendable {
    public var version = 1; public var birthYear: Int?; public var sex: String?; public var heightCm: Double?; public var weightKg: Double?
    public init(birthYear: Int? = nil, sex: String? = nil, heightCm: Double? = nil, weightKg: Double? = nil) {
        self.birthYear = birthYear; self.sex = sex; self.heightCm = heightCm; self.weightKg = weightKg
    }
    enum CodingKeys: String, CodingKey { case version, birthYear, sex, heightCm, weightKg }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(version, forKey: .version); try c.encode(birthYear, forKey: .birthYear); try c.encode(sex, forKey: .sex)
        try c.encode(heightCm, forKey: .heightCm); try c.encode(weightKg, forKey: .weightKg)
    }
}
public enum HealthInputMath {
    public static func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
    public static func parseISO(_ value: String) -> Date? {
        let f=ISO8601DateFormatter()
        if let date=f.date(from:value) { return date }
        f.formatOptions=[.withInternetDateTime,.withFractionalSeconds]; return f.date(from:value)
    }
    /// Compare to the preceding original beat, never join intervals across a recorded gap.
    public static func beats(_ rr: [Double]) -> (rmssd: Double?, stress: Double?, heartRate: Double?) {
        let valid = rr.enumerated().filter { i, v in v.isFinite && v > 0 && (i == 0 || (rr[i-1] > 0 && abs(v-rr[i-1]) / rr[i-1] <= 0.2)) }.map(\.element)
        guard !valid.isEmpty else { return (nil,nil,nil) }
        let differences = rr.indices.dropFirst().compactMap { i -> Double? in
            guard rr[i] > 0, rr[i-1] > 0, abs(rr[i]-rr[i-1]) / rr[i-1] <= 0.2,
                  i == 1 || abs(rr[i-1]-rr[i-2]) / rr[i-2] <= 0.2 else { return nil }
            return pow(rr[i]-rr[i-1],2)
        }
        let rmssd = differences.isEmpty ? nil : sqrt(differences.reduce(0,+) / Double(differences.count))
        let rate = 60000 / (valid.reduce(0,+) / Double(valid.count))
        guard valid.count >= 30, let a = valid.min(), let b = valid.max(), b > a else { return (rmssd,nil,rate) }
        let bins = Dictionary(grouping: valid, by: { Int(floor(($0+0.000001)/50)) }).mapValues(\.count)
        let mode = bins.keys.sorted().max { bins[$0]! < bins[$1]! }! // Equal populations select the lowest bin.
        let mo = (Double(mode)*50+25)/1000
        let amo = Double(bins[mode]!)*100/Double(valid.count)
        return (rmssd, amo / (2*mo*((b-a)/1000)), rate)
    }
    /// Zones: below 60%, 60–70%, 70–80%, 80–90%, 90%+; half-open boundaries.
    public static func uncovered(_ interval: DateInterval, occupied: [DateInterval]) -> [DateInterval] {
        var remaining=[interval]
        for used in occupied {
            remaining=remaining.flatMap { span -> [DateInterval] in
                guard span.start < used.end,span.end > used.start else { return [span] }
                var values: [DateInterval]=[]
                if span.start < used.start { values.append(DateInterval(start:span.start,end:min(span.end,used.start))) }
                if span.end > used.end { values.append(DateInterval(start:max(span.start,used.end),end:span.end)) }
                return values
            }
        }
        return remaining.filter { $0.duration > 0 }
    }
    public static func zones(_ spans: [(bpm: Double, seconds: Double)], maximum: Double?, durationMinutes: Double) -> [Double?]? {
        guard let maximum, maximum > 0 else { return nil }
        var values = [Double](repeating: 0, count: 5)
        for span in spans where span.seconds > 0 && span.bpm.isFinite && span.bpm > 0 {
            let ratio = span.bpm/maximum
            let index = ratio < 0.6 ? 0 : ratio < 0.7 ? 1 : ratio < 0.8 ? 2 : ratio < 0.9 ? 3 : 4
            values[index] += span.seconds/60
        }
        let total = values.reduce(0,+), scale = total > durationMinutes && total > 0 ? durationMinutes/total : 1
        return values.map { $0*scale }
    }
    public static func dailyMean(_ values: [(Date,Double)],day: Date,calendar: Calendar) -> Double? {
        guard let end=calendar.date(byAdding:.day,value:1,to:calendar.startOfDay(for:day)) else { return nil }
        let values=values.filter { $0.0 >= calendar.startOfDay(for:day) && $0.0 < end && $0.1.isFinite }.map(\.1)
        return values.isEmpty ? nil : values.reduce(0,+)/Double(values.count)
    }
    public static func buckets(_ points: [(Date, Double)], day: Date, calendar: Calendar, quarter: Bool) -> [HealthHeartBucket?] {
        let count = quarter ? 96 : 24
        let grouped = Dictionary(grouping: points.filter { calendar.isDate($0.0, inSameDayAs: day) }, by: {
            calendar.component(.hour, from: $0.0)*(quarter ? 4 : 1) + (quarter ? calendar.component(.minute, from: $0.0)/15 : 0)
        })
        // DST fall-back merges the repeated wall-clock slot; spring-forward slots stay null.
        return (0..<count).map { grouped[$0].map { HealthHeartBucket($0.map(\.1)) } }
    }
    public struct SleepInput: Sendable {
        public var start: Date; public var end: Date; public var stage: String
        public init(_ start: Date, _ end: Date, _ stage: String) { self.start = start; self.end = end; self.stage = stage }
    }
    public static func representativeVariability(_ points: [(Date,Double)], sleep: [SleepInput], calendar: Calendar) -> [String:Double] {
        var bouts: [DateInterval]=[]
        for s in sleep.filter({ $0.end > $0.start }).sorted(by:{ $0.start < $1.start }) {
            if let last=bouts.last,s.start <= last.end { bouts[bouts.count-1]=DateInterval(start:last.start,end:max(last.end,s.end)) }
            else { bouts.append(DateInterval(start:s.start,end:s.end)) }
        }
        let groups=Dictionary(grouping:bouts,by:{ DailyHealthCalendar.key($0.end,calendar:calendar) })
        var result: [String:Double]=[:]
        for (day,sessions) in groups {
            // Use the main sleep session, including night shifts; a short daytime nap never widens its window.
            guard let main=sessions.max(by:{ $0.duration < $1.duration }) else { continue }
            let values=points.filter { p in
                guard p.0 >= main.start,p.0 < main.end else { return false }
                let covering=sleep.filter { $0.start <= p.0 && $0.end > p.0 }
                return !covering.contains(where:{ $0.stage == "awake" }) && covering.contains(where:{ ["deep","core","rem","unspecified"].contains($0.stage) })
            }.map(\.1)
            if !values.isEmpty { result[day]=values.reduce(0,+)/Double(values.count) }
        }
        return result
    }
    public static func sleep(_ inputs: [SleepInput], calendar: Calendar) -> [String: HealthSleepRecord] {
        let inputs = inputs.filter { $0.end > $0.start }
        let boundaries = Set(inputs.flatMap { [$0.start,$0.end] }).sorted()
        let priority = ["inBed":0,"unspecified":1,"core":2,"rem":3,"deep":4,"awake":5]
        var segments: [SleepInput] = [], bouts: [[SleepInput]] = []
        for (a,b) in zip(boundaries,boundaries.dropFirst()) {
            guard let best = inputs.filter({ $0.start <= a && $0.end >= b }).max(by: { priority[$0.stage,default:0] < priority[$1.stage,default:0] }) else { continue }
            let next = SleepInput(a,b,best.stage)
            if let last = segments.last, last.end == a, last.stage == best.stage { segments[segments.count-1].end = b }
            else { segments.append(next) }
        }
        for segment in segments {
            if let last = bouts.last?.last, last.end == segment.start { bouts[bouts.count-1].append(segment) } else { bouts.append([segment]) }
        }
        var result: [String: HealthSleepRecord] = [:]
        for bout in bouts {
            let key = DailyHealthCalendar.key(bout.last!.end, calendar: calendar)
            var value = result[key] ?? HealthSleepRecord()
            value.start = value.start ?? iso(bout.first!.start); value.end = iso(bout.last!.end)
            for segment in bout {
                let m = segment.end.timeIntervalSince(segment.start)/60
                value.inBedMinutes = (value.inBedMinutes ?? 0)+m
                if ["deep","core","rem","unspecified"].contains(segment.stage) { value.minutes = (value.minutes ?? 0)+m }
                switch segment.stage {
                case "deep": value.deepMinutes = (value.deepMinutes ?? 0)+m
                case "core": value.coreMinutes = (value.coreMinutes ?? 0)+m
                case "rem": value.remMinutes = (value.remMinutes ?? 0)+m
                case "awake": value.awakeMinutes = (value.awakeMinutes ?? 0)+m
                default: break
                }
                if ["deep","core","rem","awake"].contains(segment.stage) {
                    value.stages = (value.stages ?? []) + [.init(start: iso(segment.start), end: iso(segment.end), stage: segment.stage)]
                }
            }
            value.minutes = value.minutes.map { min(1440,$0) }; value.inBedMinutes = value.inBedMinutes.map { min(1440,$0) }
            if (value.stages?.count ?? 0) > 200 { value.stages = nil }
            result[key] = value
        }
        return result
    }
}
