import SwiftUI
import WeftMateCore

struct TaskDirectoryView: View {
    @ObservedObject private var appModel: AppleAppModel
    @StateObject private var model: TaskDirectoryModel

    init(appModel: AppleAppModel, sessionId: String, expectedHostId: String) {
        self.appModel = appModel
        _model = StateObject(wrappedValue: TaskDirectoryModel(client: appModel.assistantClient,
            sessionId: sessionId, expectedHostId: expectedHostId, accountEpoch: appModel.accountEpoch,
            currentEpoch: { [weak appModel] in appModel?.accountEpoch ?? UUID() },
            currentSession: { [weak appModel] in
                guard let appModel, appModel.taskControlSessions.contains(sessionId) else { return nil }
                return appModel.session
            }))
    }
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                Label("当前会话的任务", systemImage: "checklist").font(.title2.weight(.semibold)).foregroundStyle(Weave.ink)
                Text("读取服务记录，包含其他设备在这段会话中发起的任务。打开任务后查看原目标、来源与成果。")
                    .font(.callout).foregroundStyle(Weave.muted).lineSpacing(4)
                if let error = model.error { InlineNotice(message: error, isError: true).accessibilityIdentifier("taskDirectoryError") }
                if model.unsupportedRootCount > 0 {
                    InlineNotice(message: "还有 \(model.unsupportedRootCount) 条任务记录暂不支持显示，可查看较早记录或稍后刷新。")
                }
                if model.loading { ProgressView("正在读取任务记录…") }
                ForEach(model.rootCommands) { row in
                    NavigationLink {
                        if model.canOpen(row) {
                            TaskWorkspaceView(appModel: appModel, taskId: row.commandId,
                                expectedHostId: row.targetDeviceId, expectedSessionId: model.sessionId, expectedRequestId: row.requestId)
                                .id(row.commandId + ":" + model.accountEpoch.uuidString)
                        } else {
                            EmptyState(symbol: "person.crop.circle.badge.exclamationmark", title: "会话已改变",
                                message: "请从当前会话重新打开任务目录。")
                        }
                    } label: {
                        WeaveCard {
                            HStack(spacing: 14) {
                                Image(systemName: "checklist").foregroundStyle(Weave.accent)
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(displayDate(row.createdAt)).font(.headline).foregroundStyle(Weave.ink)
                                    Text(commandLabel(row.state)).font(.callout).foregroundStyle(Weave.muted)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").foregroundStyle(Weave.muted)
                            }
                        }
                    }
                    .buttonStyle(.plain).disabled(!model.scopeIsCurrent)
                    .accessibilityIdentifier("taskDirectoryRow.\(row.commandId)")
                }
                if model.hasRead && model.rootCommands.isEmpty && !model.loading {
                    EmptyState(symbol: "checklist", title: model.hasMore ? "这一页没有可显示的会话任务"
                        : model.unsupportedRootCount > 0 ? "当前记录暂不支持显示" : "当前没有已记录的任务",
                        message: model.hasMore ? "可继续查看较早记录，寻找其他设备发起的任务。"
                        : model.unsupportedRootCount > 0 ? "当前任务记录的状态暂不支持显示，请稍后刷新。" : "此会话的新任务会出现在这里。")
                }
                if model.hasMore {
                    Button("查看较早任务") { Task { await model.loadMore() } }
                        .buttonStyle(.bordered).disabled(!model.canLoadMore)
                        .accessibilityIdentifier("moreTaskDirectoryButton")
                }
                if let date = model.lastReadAt {
                    Text("上次读取：\(date.formatted(date: .abbreviated, time: .standard))")
                        .font(.caption).foregroundStyle(Weave.muted)
                }
            }
            .padding(24).frame(maxWidth: 820, alignment: .leading).frame(maxWidth: .infinity)
        }
        .background(Weave.canvas).navigationTitle("会话任务")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await model.refresh() } } label: { Label("刷新任务", systemImage: "arrow.clockwise") }
                    .disabled(model.loading || !model.scopeIsCurrent).accessibilityIdentifier("refreshTaskDirectoryButton")
            }
        }
        .task { model.activate(); await model.refresh() }
        .onDisappear { model.suspend() }
        .onChange(of: appModel.accountEpoch) { _, _ in model.cancel() }
        .accessibilityIdentifier("taskDirectory")
    }
    private func displayDate(_ value: String) -> String {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date.formatted(date: .abbreviated, time: .standard) }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)?.formatted(date: .abbreviated, time: .standard) ?? value
    }
    private func commandLabel(_ state: SharedCommandState) -> String {
        switch state {
        case .pending: "等待派发"
        case .dispatching: "正在派发"
        case .acceptedByDSH: "执行端已受理"
        case .acceptedByHost: "宿主已受理"
        case .observed: "执行结果已观察"
        case .uncertain: "执行结果待核对"
        case .rejected: "未受理"
        }
    }
}
