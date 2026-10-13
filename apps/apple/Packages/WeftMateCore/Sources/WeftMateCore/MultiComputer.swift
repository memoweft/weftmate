import Foundation

public struct ComputerConversation: Identifiable, Sendable {
    public var id: String { hostId+"|"+conversation.id }
    public let hostId: String
    public let name: String
    public let online: Bool
    public let conversation: ConversationSummary
    public init(hostId: String,name: String,online: Bool,conversation: ConversationSummary) { self.hostId=hostId;self.name=name;self.online=online;self.conversation=conversation }
}
public enum ComputerSelection {
    public static func target(hosts: [CloudDirectoryDevice],lastUsed: String?,source: String? = nil) -> String? {
        // An existing conversation belongs to its source, even when another computer is online.
        if let source,hosts.contains(where: {($0.hostId ?? $0.id) == source}) { return source }
        let online=hosts.filter(\.online)
        if online.count == 1 { return online.first.map {$0.hostId ?? $0.id} }
        if let lastUsed,online.contains(where: {($0.hostId ?? $0.id) == lastUsed}) { return lastUsed }
        return online.first.map {$0.hostId ?? $0.id} ?? lastUsed ?? hosts.first.map {$0.hostId ?? $0.id}
    }
}
