import Combine
import Foundation
import WeftMateCore

@MainActor final class ToolProgressModel: ObservableObject {
    @Published private(set) var details: [Int: TimelineDetail] = [:]
    @Published private(set) var errors: [Int: String] = [:]
    private var reads: [Int: Task<TimelineDetail, Error>] = [:]
    func read(client: PersonalClient, sessionID: String, step: TimelineStep) async {
        guard let seq = step.detailSeq, details[seq] == nil else { return }
        // Group summaries and expanded steps share the read. A transient view task
        // cancellation must not discard the response or strand the other reader.
        let request = reads[seq] ?? Task { try await client.timelineDetail(sessionID: sessionID, seq: seq) }
        reads[seq] = request; errors[seq] = nil
        defer { reads[seq] = nil }
        do { details[seq] = try await request.value }
        catch { if !(error is CancellationError) { errors[seq] = "暂时无法读取，收起后可重试。" } }
    }
    func presentation(_ step: TimelineStep) -> ToolStepDetail? {
        guard let seq = step.detailSeq, let detail = details[seq] else { return nil }
        return ToolStepDetail(raw: detail.text, truncated: detail.truncated == true, failed: step.effectiveState == "failed")
    }
    func summary(_ step: TimelineStep) -> String {
        guard let seq = step.detailSeq, let detail = details[seq] else { return step.summary }
        return ToolProgressSummary.readable(tool: step.data["toolName"]?.string ?? "", raw: detail.text)
    }
}
