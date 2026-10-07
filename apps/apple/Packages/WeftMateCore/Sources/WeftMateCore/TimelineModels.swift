import Foundation

public enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null
    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let x = try? c.decode(Bool.self) { self = .bool(x) }
        else if let x = try? c.decode(String.self) { self = .string(x) }
        else if let x = try? c.decode(Double.self) { self = .number(x) }
        else if let x = try? c.decode([JSONValue].self) { self = .array(x) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    public subscript(_ key: String) -> JSONValue? { if case .object(let x) = self { x[key] } else { nil } }
    public var string: String? { if case .string(let x) = self { x } else { nil } }
    public var int: Int? { if case .number(let x) = self, x.isFinite, x >= 0, x <= 9_007_199_254_740_991, x.rounded() == x { Int(x) } else { nil } }
    public var count: Int { if case .array(let x) = self { x.count } else { 0 } }
    public var bool: Bool { if case .bool(let x) = self { x } else { false } }
    public func encode(to encoder: any Encoder) throws {
        var box = encoder.singleValueContainer()
        switch self {
        case .object(let value): try box.encode(value)
        case .array(let value): try box.encode(value)
        case .string(let value): try box.encode(value)
        case .number(let value): try box.encode(value)
        case .bool(let value): try box.encode(value)
        case .null: try box.encodeNil()
        }
    }
}

public struct TimelineEvent: Codable, Equatable, Sendable, Identifiable {
    public let seq: Int
    public let type: String
    public let at: String?
    public let data: JSONValue
    public var id: Int { seq }
    public init(seq: Int, type: String, at: String? = nil, data: JSONValue) {
        self.seq = seq; self.type = type; self.at = at; self.data = data
    }
}
public struct TimelineDetail: Decodable, Equatable, Sendable {
    public let seq: Int
    public let text: String
    public let truncated: Bool?
}
public struct TimelinePage: Codable, Equatable, Sendable {
    public let events: [TimelineEvent]
    public let nextSeq: Int
    public let hasMore: Bool
    public let nextBeforeSeq: Int?
    public let hasOlder: Bool?
    public let latestSeq: Int?
    public static func query(beforeSeq: Int?, afterSeq: Int?, limit: Int) throws -> String {
        guard (1...200).contains(limit), beforeSeq == nil || afterSeq == nil,
              beforeSeq.map({ (0...SharedValidation.maximumSequence).contains($0) }) ?? true,
              afterSeq.map({ (-1...SharedValidation.maximumSequence).contains($0) }) ?? true else { throw APIFailure.invalidResponse }
        return (beforeSeq.map { "beforeSeq=\($0)&" } ?? afterSeq.map { "afterSeq=\($0)&" } ?? "") + "limit=\(limit)"
    }
    public static func decode(_ bytes: Data, beforeSeq: Int? = nil, afterSeq: Int? = nil, limit: Int = 100) throws -> Self {
        _ = try query(beforeSeq: beforeSeq, afterSeq: afterSeq, limit: limit)
        let page: Self
        do { page = try JSONDecoder().decode(Self.self, from: bytes) } catch { throw APIFailure.invalidResponse }
        guard page.events.count <= limit, page.nextSeq >= -1, page.nextSeq <= SharedValidation.maximumSequence,
              page.latestSeq.map({ $0 >= page.nextSeq && $0 <= SharedValidation.maximumSequence }) ?? true,
              page.nextBeforeSeq.map({ (0...SharedValidation.maximumSequence).contains($0) }) ?? true else { throw APIFailure.invalidResponse }
        var prior = afterSeq ?? -1
        for event in page.events {
            guard event.seq > prior, event.seq <= page.nextSeq,
                  beforeSeq.map({ event.seq < $0 }) ?? true else { throw APIFailure.invalidResponse }
            prior = event.seq
        }
        if let afterSeq {
            guard page.nextSeq >= afterSeq, !page.hasMore || page.nextSeq > afterSeq else { throw APIFailure.invalidResponse }
        }
        if page.hasOlder == true {
            guard let boundary = page.nextBeforeSeq, boundary == page.events.first?.seq,
                  beforeSeq.map({ boundary < $0 }) ?? true else { throw APIFailure.invalidResponse }
        }
        return page
    }
}
/// Forward watermarks and backward boundaries belong to different reads.
public struct TimelineWindow: Codable, Equatable, Sendable {
    public private(set) var events: [TimelineEvent] = []
    public private(set) var nextSeq = -1
    public private(set) var beforeSeq: Int?
    public private(set) var hasOlder = false
    public init() {}
    public mutating func apply(_ page: TimelinePage, older: Bool = false, replace: Bool = false) {
        var bySeq = Dictionary(uniqueKeysWithValues: (replace ? [] : events).map { ($0.seq, $0) })
        for event in page.events { bySeq[event.seq] = event }
        events = bySeq.values.sorted { $0.seq < $1.seq }
        if !older { nextSeq = page.nextSeq }
        if older || replace {
            beforeSeq = page.nextBeforeSeq ?? page.events.first?.seq
            hasOlder = page.hasOlder ?? false
        }
    }

}
public struct TimelineStep: Equatable, Sendable, Identifiable {
    public let id: String
    public let taskID: String
    public let seq: Int
    public var data: JSONValue
    public let at: String?
    public var endAt: String?
    public var summary: String { data["summary"]?.string ?? "工具执行" }
    public var running: Bool { data["state"]?.string == "running" }
    public var detailSeq: Int? { data["detailRef"]?["seq"]?.int }
}
public struct TimelineEntry: Equatable, Sendable, Identifiable {
    public let id: String
    public let seq: Int
    public var event: TimelineEvent
    public var steps: [TimelineStep] = []
    public var resolved: TimelineEvent?
    public var running = false
    public var elapsed: String {
        func date(_ value: String?) -> Date? {
            guard let value else { return nil }
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: value)
        }
        let starts = steps.compactMap { date($0.at) }, ends = steps.compactMap { date($0.endAt) }
        guard starts.count == steps.count, ends.count == steps.count,
              let start = starts.min(), let end = ends.max() else { return "时间待确认" }
        let seconds = max(0, Int(end.timeIntervalSince(start)))
        return seconds < 60 ? "\(seconds) 秒" : "\(seconds / 60) 分 \(seconds % 60) 秒"
    }
}
public enum TimelineProjection {
    public static func taskRunning(_ events: [TimelineEvent], fallback: Bool) -> Bool {
        events.last(where: { ["task.started", "turn.started", "task.ended", "turn.ended"].contains($0.type) })
            .map { $0.type.hasSuffix("started") } ?? fallback
    }
    public static func entries(_ events: [TimelineEvent]) -> [TimelineEntry] {
        let ordered = events.sorted { $0.seq < $1.seq }
        var result: [TimelineEntry] = [], steps: [String: (Int, Int)] = [:], cards: [String: Int] = [:]
        var group: Int?
        let terminal = Set(ordered.compactMap { event -> String? in
            if event.type == "task.ended" { return event.data["taskId"]?.string }
            if event.type == "turn.ended", let turn = event.data["turn"]?.int { return "turn-\(turn)" }
            return nil
        })
        for raw in ordered {
            let event = raw.type == "artifact.created" && raw.data["completedStep"] != nil
                ? TimelineEvent(seq: raw.seq, type: "step.completed", at: raw.at, data: raw.data["completedStep"]!) : raw
            if event.type.hasPrefix("step."), let task = event.data["taskId"]?.string, let step = event.data["stepId"]?.string {
                let key = task + "/" + step
                if let (row, index) = steps[key] {
                    result[row].steps[index].data = event.data
                    if event.type == "step.completed" { result[row].steps[index].endAt = event.at }
                } else {
                    if group == nil || result[group!].steps.first?.taskID != task {
                        result.append(.init(id: "steps-\(event.seq)", seq: event.seq, event: event)); group = result.count - 1
                    }
                    let row = group!
                    steps[key] = (row, result[row].steps.count)
                    result[row].steps.append(.init(id: key, taskID: task, seq: event.seq, data: event.data,
                        at: event.type == "step.started" ? event.at : nil, endAt: event.type == "step.completed" ? event.at : nil))
                }
                if raw.type != "artifact.created" { continue }
            }
            if ["task.started", "task.ended", "turn.started", "turn.ended"].contains(event.type) { continue }
            group = nil
            let family = raw.type.components(separatedBy: ".").first ?? ""
            if family == "approval" || family == "question" {
                let key = family + ":" + (raw.data[family == "approval" ? "approvalId" : "callId"]?.string ?? raw.data["stepId"]?.string ?? String(raw.seq))
                if let index = cards[key] { result[index].resolved = raw }
                else { cards[key] = result.count; result.append(.init(id: key, seq: raw.seq, event: raw,
                    resolved: raw.type.hasSuffix("resolved") || raw.type.hasSuffix("answered") ? raw : nil)) }
            } else if ["user.message", "assistant.message", "artifact.created", "task.queued"].contains(raw.type) {
                result.append(.init(id: "event-\(raw.seq)", seq: raw.seq, event: raw))
            }
        }
        for index in result.indices where !result[index].steps.isEmpty {
            result[index].running = result[index].steps.contains { $0.running && !terminal.contains($0.taskID) }
        }
        return result.sorted { $0.seq < $1.seq }
    }
}
