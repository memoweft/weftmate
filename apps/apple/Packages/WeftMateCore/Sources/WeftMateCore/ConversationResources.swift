import Foundation

public struct UsedMemory: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let kind: MemoryKind
    public let summary: String
    public static func references(in event: TimelineEvent) -> [Self] {
        guard event.type == "assistant.message", let value = event.data["memoryUsed"],
              let bytes = try? JSONEncoder().encode(value), let rows = try? JSONDecoder().decode([Self].self, from: bytes) else { return [] }
        var seen = Set<String>()
        return rows.filter { seen.insert($0.kind.rawValue + ":" + $0.id).inserted }
    }
}
public struct ConversationOutput: Decodable, Equatable, Sendable, Identifiable {
    public let artifactId: String
    public let fileName: String?
    public let contentType: String?
    public let size: Int?
    public let createdAt: String?
    public var id: String { artifactId }
}
public struct ResourceUse: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let callId: String?
    public let seq: Int?
    public let at: String?
    public let summary: String
    public let path: String
    public let verb: String?
    public var identity: String { callId ?? id }
}
public struct ConversationSource: Decodable, Equatable, Sendable, Identifiable {
    public let key: String
    public let kind: String
    public let name: String
    public let location: String?
    public let url: String?
    public var uses: [ResourceUse]
    public var id: String { key }
    public var displayName: String { kind == "tool" ? (name.range(of: "^[A-Za-z_][A-Za-z0-9_.:-]*$", options: .regularExpression) != nil ? OperationNames.tool(name) : OperationNames.text(name)) : name }
}
public struct ConversationResourcesPage: Decodable, Sendable {
    public let outputs: [ConversationOutput]
    public let sources: [ConversationSource]
    public let nextSeq: Int
    public let hasMore: Bool
}
public struct ConversationResourcesWindow: Sendable {
    public private(set) var outputs: [ConversationOutput] = []
    public private(set) var sources: [ConversationSource] = []
    public private(set) var readOutputs: [ConversationOutput] = []
    public func olderVersions(of output: ConversationOutput) -> [ConversationOutput] {
        readOutputs.filter { $0.id != output.id && $0.fileName != nil && $0.fileName == output.fileName }
            .sorted { ($0.createdAt ?? "", $0.id) > ($1.createdAt ?? "", $1.id) }
    }
    public private(set) var nextSeq = -1
    public init() {}
    public mutating func includeTimelineOutputs(_ events: [TimelineEvent]) throws {
        let collected = events.filter { $0.type == "artifact.created" }.flatMap { event -> [ConversationOutput] in
            let values: [JSONValue]
            if case .array(let array) = event.data["artifacts"] { values = array } else { values = [event.data] }
            return values.compactMap { value in
                guard let id = value["artifactId"]?.string else { return nil }
                return ConversationOutput(artifactId: id, fileName: value["fileName"]?.string,
                    contentType: value["contentType"]?.string, size: value["size"]?.int, createdAt: value["createdAt"]?.string ?? event.at)
            }
        }
        try apply(.init(outputs: collected, sources: [], nextSeq: nextSeq, hasMore: false))
    }
    public mutating func apply(_ page: ConversationResourcesPage) throws {
        guard page.nextSeq >= nextSeq, !page.hasMore || page.nextSeq > nextSeq else { throw APIFailure.invalidResponse }
        for output in page.outputs {
            if let index = readOutputs.firstIndex(where: { $0.id == output.id }) { readOutputs[index] = output }
            else { readOutputs.append(output) }
        }
        var latest: [String: ConversationOutput] = [:]
        for output in outputs + page.outputs {
            let key = output.fileName ?? output.id
            if let prior = latest[key], (prior.createdAt ?? "") > (output.createdAt ?? "") { continue }
            latest[key] = output
        }
        outputs = latest.values.sorted { $0.id < $1.id }
        for source in page.sources {
            let index = sources.firstIndex { $0.key == source.key }
            var merged = index.map { sources[$0] } ?? source
            var uses: [ResourceUse] = index.map { sources[$0].uses } ?? []
            for use in source.uses {
                if let i = uses.firstIndex(where: { $0.identity == use.identity }) {
                    // Prefer the authorized content snapshot over call arguments/results.
                    if !uses[i].path.hasPrefix("/tasks/") || use.path.hasPrefix("/tasks/") { uses[i] = use }
                } else { uses.append(use) }
            }
            merged.uses = uses
            if let index { sources[index] = merged } else { sources.append(merged) }
        }
        nextSeq = page.nextSeq
    }
}
