import Combine
import Foundation
import WeftMateCore

@MainActor final class ToolProgressModel: ObservableObject {
    @Published private(set) var details: [Int: TimelineDetail] = [:]
    @Published private(set) var errors: [Int: String] = [:]
    private var loading = Set<Int>()
    func read(client: PersonalClient, sessionID: String, step: TimelineStep) async {
        guard let seq = step.detailSeq, details[seq] == nil, !loading.contains(seq) else { return }
        loading.insert(seq); errors[seq] = nil
        defer { loading.remove(seq) }
        do {
            let detail = try await client.timelineDetail(sessionID: sessionID, seq: seq)
            guard !Task.isCancelled else { return }
            details[seq] = detail
        } catch { if !Task.isCancelled { errors[seq] = "暂时无法读取，收起后可重试。" } }
    }
    func summary(_ step: TimelineStep) -> String {
        guard let seq = step.detailSeq, let detail = details[seq] else { return step.summary }
        return ToolProgressSummary.readable(tool: step.data["toolName"]?.string ?? "", raw: detail.text)
    }
}
