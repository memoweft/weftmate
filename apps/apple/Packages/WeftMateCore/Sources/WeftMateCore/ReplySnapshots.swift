import Foundation

/// Cumulative snapshots are presentation data only. History remains authoritative.
public enum ReplySnapshots {
    public static func timeline(history: [TimelineEvent], live: [TimelineEvent]) -> [TimelineEvent] {
        let finished = Set(history.filter { $0.type == "assistant.message" }.compactMap { $0.data["streamSeq"]?.int })
        return (history + live.filter { $0.type == "assistant.delta" && !finished.contains($0.seq) }).sorted { $0.seq < $1.seq }
    }
    public static func chat(history: [ChatEvent], live: [ChatEvent]) -> [ChatEvent] {
        let finished = Set(history.filter { $0.type == "assistant.message" }.map(\.presentationID))
        return (history + live.filter { $0.type == "assistant.delta" && !finished.contains($0.presentationID) }).sorted { $0.orderKey < $1.orderKey }
    }
    public static func pollDelay(streaming: Bool, running: Bool, failed: Bool = false) -> Double {
        if failed { return 1.5 }
        return streaming && running ? 0.25 : 1.5
    }
}
