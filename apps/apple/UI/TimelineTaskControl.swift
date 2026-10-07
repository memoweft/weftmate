import SwiftUI
import WeftMateCore

/// Sources and stop belong to the root user message, never to a turn-N execution key.
struct TimelineTaskControl: View {
    @ObservedObject var appModel: AppleAppModel
    let command: TaskRootCommandMetadata
    @StateObject private var model: TaskWorkspaceModel
    @Environment(\.scenePhase) private var scenePhase
    init(appModel: AppleAppModel, command: TaskRootCommandMetadata) {
        self.appModel = appModel; self.command = command
        _model = StateObject(wrappedValue: TaskWorkspaceModel(client: appModel.assistantClient, taskId: command.commandId,
            expectedHostId: command.targetDeviceId, expectedSessionId: command.sessionId, expectedRequestId: command.requestId,
            accountEpoch: appModel.accountEpoch, stateDirectory: appModel.assistantStateDirectory,
            currentEpoch: { [weak appModel] in appModel?.accountEpoch ?? UUID() }, currentSession: { [weak appModel] in appModel?.session }))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let task = model.snapshot {
                if task.control.canStop {
                    Button("停止") { Task { await model.requestStop() } }
                        .buttonStyle(.bordered).disabled(model.stopBusy || !model.canRequestStop || appModel.historyCachedAt != nil)
                        .accessibilityIdentifier("stopTask.\(task.taskId)")
                }
                if let record = model.stopRecord {
                    Text(record.state == .acknowledged ? "停止已确认" : "已请求停止，等待执行回执。")
                        .font(.caption).foregroundStyle(Weave.muted)
                    if record.state != .acknowledged {
                        Button("核对停止状态") { Task { await model.reconcileStop() } }.font(.caption).disabled(model.stopBusy)
                    }
                }
                ForEach(task.sources) { source in
                    TimelineSourceCard(model: model, source: source)
                }
            }
            if let error = model.error {
                Text(error).font(.caption).foregroundStyle(Weave.muted)
                Button("核对来源与控制") { Task { await model.refresh() } }.font(.caption)
            }
            if let error = model.stopError { Text(error).font(.caption).foregroundStyle(Weave.danger) }
        }
        .task(id: "\(scenePhase)|\(appModel.historyCachedAt != nil)") {
            guard scenePhase == .active, appModel.historyCachedAt == nil else { model.cancel(); return }
            model.activate(); var policy = ConversationPollingPolicy()
            while !Task.isCancelled, model.scopeIsCurrent {
                let old = model.snapshot; await model.refresh()
                guard model.error == nil, let value = model.snapshot, TaskPresentation.needsObservation(value) else { return }
                do { try await Task.sleep(nanoseconds: policy.delayNanoseconds(madeProgress: old != value)) } catch { return }
            }
        }
        .onDisappear { model.cancel() }
        .onChange(of: appModel.accountEpoch) { _, _ in model.cancel() }
    }
}
private struct TimelineSourceCard: View {
    @ObservedObject var model: TaskWorkspaceModel
    let source: TaskSourceMetadata
    @State private var expanded = false
    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            if model.loadingSources.contains(source.snapshotId) { ProgressView() }
            if let preview = model.sourcePreviews[source.snapshotId] {
                Text(preview.text).font(.caption.monospaced()).textSelection(.enabled)
                Text(preview.verification == .deliveredTextSHA256Verified ? "当前网页文字已校验。" : "原文件片段，片段未独立校验。")
                    .font(.caption).foregroundStyle(Weave.muted)
            }
            if let error = model.sourceErrors[source.snapshotId] { Text(error).font(.caption) }
        } label: { Label(source.title ?? source.relativePath ?? "来源", systemImage: "doc.text.magnifyingglass").font(.caption) }
        .task(id: expanded) { if expanded { await model.loadSource(source.snapshotId) } else { model.closeSource(source.snapshotId) } }
        .animation(.easeInOut(duration: 0.2), value: expanded)
    }
}
