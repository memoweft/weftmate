import SwiftUI
import UniformTypeIdentifiers
import WeftMateCore

struct TaskWorkspaceView: View {
    @ObservedObject private var appModel: AppleAppModel
    @StateObject private var model: TaskWorkspaceModel
    @State private var expandedSources = Set<String>()
    @State private var preparedExport: TaskVerifiedExport?
    @State private var exportDocument: TaskArtifactDocument?
    @State private var showingExporter = false

    init(appModel: AppleAppModel, taskId: String, expectedHostId: String,
         expectedSessionId: String, expectedRequestId: String? = nil) {
        self.appModel = appModel
        _model = StateObject(wrappedValue: TaskWorkspaceModel(client: appModel.assistantClient, taskId: taskId,
            expectedHostId: expectedHostId, expectedSessionId: expectedSessionId, expectedRequestId: expectedRequestId,
            accountEpoch: appModel.accountEpoch, stateDirectory: appModel.assistantStateDirectory,
            currentEpoch: { [weak appModel] in appModel?.accountEpoch ?? UUID() },
            currentSession: { [weak appModel] in
                guard let appModel, appModel.taskControlSessions.contains(expectedSessionId) else { return nil }
                return appModel.session
            }))
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 12) {
                    Image(systemName: "checklist").font(.title2).foregroundStyle(Weave.accent)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("原会话中的任务").font(.title2.weight(.semibold)).foregroundStyle(Weave.ink)
                        Text("回复、执行、来源与成果分别核对。")
                            .font(.callout).foregroundStyle(Weave.muted)
                    }
                    Spacer(minLength: 0)
                }
                if let error = model.error { InlineNotice(message: error, isError: true).accessibilityIdentifier("taskWorkspaceError") }
                if model.loading {
                    HStack(spacing: 10) { ProgressView(); Text("正在读取任务…").foregroundStyle(Weave.muted) }
                }
                if let task = model.snapshot {
                    taskState(task)
                    WeaveCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("原目标", systemImage: "text.bubble").font(.headline).foregroundStyle(Weave.ink)
                            Text(task.sourceText).textSelection(.enabled).lineSpacing(5).foregroundStyle(Weave.ink)
                            Text("来自原会话 · \(task.source.createdAt)")
                                .font(.caption).foregroundStyle(Weave.muted)
                        }
                    }
                    TaskInteractionView(appModel: appModel, snapshot: task)
                        .id(task.taskId + ":" + model.accountEpoch.uuidString)
                    if !task.steps.isEmpty || !task.supplements.isEmpty || !task.resumes.isEmpty {
                        commandHistory(task)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        sectionTitle("来源", symbol: "doc.text.magnifyingglass", count: task.sources.count)
                        if task.sources.isEmpty { Text("当前任务没有已记录的来源。") .font(.callout).foregroundStyle(Weave.muted) }
                        ForEach(task.sources) { source in sourceCard(source) }
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        sectionTitle("成果", symbol: "doc.badge.checkmark", count: task.artifacts.count)
                        if task.artifacts.isEmpty { Text("当前还没有可查看的文件成果。") .font(.callout).foregroundStyle(Weave.muted) }
                        ForEach(task.artifacts) { artifact in artifactCard(artifact) }
                    }
                    if let date = model.lastReadAt {
                        Text("上次读取：\(date.formatted(date: .abbreviated, time: .standard))")
                            .font(.caption).foregroundStyle(Weave.muted)
                    }
                } else if !model.loading && model.error == nil {
                    EmptyState(symbol: "checklist", title: "等待读取原任务", message: "刷新后查看服务器记录的状态。")
                }
            }
            .padding(24).frame(maxWidth: 820, alignment: .leading).frame(maxWidth: .infinity)
        }
        .background(Weave.canvas)
        .navigationTitle("任务")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await model.refresh() } } label: { Label("刷新任务", systemImage: "arrow.clockwise") }
                    .disabled(model.loading || model.stopBusy || !model.scopeIsCurrent).accessibilityIdentifier("refreshTaskButton")
            }
        }
        .task { model.activate(); await model.refresh() }
        .onDisappear { model.cancel(); preparedExport = nil; exportDocument = nil; showingExporter = false }
        .onChange(of: appModel.accountEpoch) { _, _ in
            model.cancel(); preparedExport = nil; exportDocument = nil; showingExporter = false; expandedSources = []
        }
        .onChange(of: model.scopeInvalidated) { _, invalid in
            if invalid { preparedExport = nil; exportDocument = nil; showingExporter = false; expandedSources = [] }
        }
        .onChange(of: model.contentVersion) { _, _ in
            preparedExport = nil; exportDocument = nil; showingExporter = false; expandedSources = []
        }
        .fileExporter(isPresented: $showingExporter, document: exportDocument,
                      contentType: exportType, defaultFilename: preparedExport?.fileName ?? "WeftMate成果.txt") { result in
            if let preparedExport { model.recordExportResult(result, export: preparedExport) }
            preparedExport = nil; exportDocument = nil
        }
        .accessibilityIdentifier("taskWorkspace")
    }

    private var exportType: UTType {
        preparedExport?.contentType ?? .utf8PlainText
    }
    private func taskState(_ task: TaskSnapshot) -> some View {
        WeaveCard {
            VStack(alignment: .leading, spacing: 15) {
                Label(TaskPresentation.replyLabel(task.replyEvidence.status), systemImage: "bubble.left.and.text.bubble.right")
                    .font(.title3.weight(.semibold)).foregroundStyle(Weave.ink)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(TaskPresentation.replyLabel(task.replyEvidence.status))
                    .accessibilityIdentifier("taskReplyStatus")
                Text(TaskPresentation.controlLabel(task.control)).font(.callout).foregroundStyle(Weave.secondary)
                    .accessibilityIdentifier("taskControlStatus")
                if task.replyEvidence.toolSaveObserved {
                    Label("已观察到保存文件的回执", systemImage: "doc.badge.checkmark")
                        .font(.callout).foregroundStyle(Weave.secondary)
                }
                if task.replyEvidence.status == .unconfirmed || task.control.state == .uncertain {
                    Text("当前结果仍待核对。文件可查看与回复结束是两个状态。")
                        .font(.caption).foregroundStyle(Weave.muted).lineSpacing(4)
                }
                if let notice = model.localStopNotice {
                    Text(notice).font(.callout).foregroundStyle(Weave.secondary).lineSpacing(4)
                        .accessibilityIdentifier("taskLocalStopNotice")
                }
                if let error = model.stopError { InlineNotice(message: error, isError: true) }
                if model.stopBusy { ProgressView("正在核对停止操作…") }
                HStack(spacing: 12) {
                    if task.control.canStop || model.stopRecord?.state == .prepared {
                        Button(model.stopActionLabel) { Task { await model.requestStop() } }
                            .buttonStyle(.borderedProminent).disabled(!model.canRequestStop)
                            .accessibilityIdentifier("stopTaskButton")
                    }
                    if model.stopRecord != nil {
                        Button("核对停止状态") { Task { await model.reconcileStop() } }
                            .buttonStyle(.bordered)
                            .disabled(model.loading || model.stopBusy || !model.scopeIsCurrent)
                            .accessibilityIdentifier("reconcileTaskStopButton")
                    }
                }
            }
        }
    }
    private func commandHistory(_ task: TaskSnapshot) -> some View {
        WeaveCard {
            VStack(alignment: .leading, spacing: 13) {
                Label("已记录的执行与接续", systemImage: "list.bullet.rectangle").font(.headline).foregroundStyle(Weave.ink)
                ForEach(task.steps + task.supplements + task.resumes) { row in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: row.taskAction == nil ? "gearshape" : "text.bubble").foregroundStyle(Weave.accent)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(TaskPresentation.commandTitle(row))
                                .font(.callout.weight(.medium)).foregroundStyle(Weave.ink)
                            Text(TaskPresentation.commandLabel(row)).font(.caption).foregroundStyle(Weave.muted)
                            if !row.kind.isKnown {
                                Text("工具结果仍按服务记录核对。")
                                    .font(.caption).foregroundStyle(Weave.muted)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .accessibilityIdentifier("taskStep.\(row.commandId)")
                }
            }
        }
    }
    private func sourceCard(_ source: TaskSourceMetadata) -> some View {
        WeaveCard {
            DisclosureGroup(isExpanded: sourceBinding(source.snapshotId)) {
                VStack(alignment: .leading, spacing: 12) {
                    if model.loadingSources.contains(source.snapshotId) { ProgressView("正在读取来源…") }
                    if let error = model.sourceErrors[source.snapshotId] { InlineNotice(message: error, isError: true) }
                    if let preview = model.sourcePreviews[source.snapshotId] {
                        InlineNotice(message: preview.verification == .deliveredTextSHA256Verified
                            ? "当前网页文字已校验。"
                            : "这是原文件片段，片段未独立校验。")
                        Text(preview.text).font(.body.monospaced()).textSelection(.enabled)
                            .lineSpacing(4).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if source.kind == "webpage", let value = source.url, let url = URL(string: value) {
                        Link("打开来源网页", destination: url).font(.callout)
                    }
                    Text(sourceDescription(source)).font(.caption).foregroundStyle(Weave.muted).lineSpacing(4)
                    if model.sourceErrors[source.snapshotId] != nil {
                        Button("重新读取来源") { Task { await model.loadSource(source.snapshotId) } }
                            .buttonStyle(.bordered).disabled(model.loadingSources.contains(source.snapshotId))
                    }
                }.padding(.top, 14)
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    Text(source.title ?? source.relativePath ?? "来源")
                        .font(.headline).foregroundStyle(Weave.ink).lineLimit(3)
                    Text(source.kind == "webpage" ? "网页来源 · 查看来源" : "项目片段 · 查看来源")
                        .font(.caption).foregroundStyle(Weave.muted)
                }
            }
            .accessibilityIdentifier("taskSource.\(source.snapshotId)")
        }
    }
    private func artifactCard(_ artifact: TaskCommandRecord) -> some View {
        let id = artifact.artifactId ?? ""
        let sizeLabel = artifact.size.map { "\($0) 字节" } ?? "文件大小待确认"
        return WeaveCard {
            VStack(alignment: .leading, spacing: 14) {
                Label(artifact.fileName ?? "文件成果", systemImage: "doc.text")
                    .font(.headline).foregroundStyle(Weave.ink)
                Text("\(sizeLabel) · \(model.canExport(id) ? "服务已确认保存" : "保存待确认")")
                    .font(.caption).foregroundStyle(Weave.muted)
                if let error = model.artifactErrors[id] { InlineNotice(message: error, isError: true) }
                if model.loadingArtifacts.contains(id) { ProgressView("正在校验预览…") }
                if let preview = model.artifactPreviews[id] {
                    Text(preview.text).font(.body.monospaced()).textSelection(.enabled).lineSpacing(4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("taskArtifactPreview.\(id)")
                }
                HStack(spacing: 12) {
                    Button("预览成果") { Task { await model.previewArtifact(id) } }
                        .buttonStyle(.bordered)
                        .disabled(!model.canExport(id) || model.loadingArtifacts.contains(id))
                        .accessibilityIdentifier("previewTaskArtifact.\(id)")
                    Button(model.exportingArtifacts.contains(id) ? "正在校验…" : "保存文件") {
                        Task {
                            guard let export = await model.prepareArtifactExport(id), model.scopeIsCurrent else { return }
                            preparedExport = export; exportDocument = TaskArtifactDocument(data: export.data); showingExporter = true
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.canExport(id) || model.exportingArtifacts.contains(id))
                    .accessibilityIdentifier("saveTaskArtifact.\(id)")
                }
                if let note = model.exportNotes[id] { Text(note).font(.caption).foregroundStyle(Weave.secondary) }
                Text("完整文件校验后，由你选择保存位置。")
                    .font(.caption).foregroundStyle(Weave.muted).lineSpacing(4)
            }
        }
        .accessibilityIdentifier("taskArtifact.\(id)")
    }
    private func sourceBinding(_ id: String) -> Binding<Bool> {
        .init(get: { expandedSources.contains(id) }, set: { value in
            if value { expandedSources.insert(id); Task { await model.loadSource(id) } }
            else { expandedSources.remove(id); model.closeSource(id) }
        })
    }
    private func sectionTitle(_ title: String, symbol: String, count: Int) -> some View {
        HStack { Label(title, systemImage: symbol).font(.title3.weight(.semibold)); Spacer(); Text("\(count)").font(.caption) }
            .foregroundStyle(Weave.secondary)
    }
    private func sourceDescription(_ source: TaskSourceMetadata) -> String {
        if source.kind == "webpage" {
            let segment = source.segmentIndex.map { "第 \($0 + 1) / \(source.segmentCount ?? 1) 段 · " } ?? ""
            return segment + "读取时间：\(source.readAt)" + ((source.truncated == true || source.captureTruncated == true) ? "\n记录未覆盖全文。" : "")
        }
        return "第 \(source.lineStart ?? 0)–\(source.lineEnd ?? 0) 行 / 共 \(source.totalLines ?? 0) 行 · 项目修订 \(source.projectRevision ?? 0)"
            + (source.hasMore == true ? "\n还有未展示的内容。" : "")
    }
}

/// Discovers a task from one bounded server metadata page, including requests made on another device.
/// Earlier pages remain explicit reads in the existing task directory.
struct ConversationTaskOverviewView: View {
    @ObservedObject private var appModel: AppleAppModel
    @StateObject private var directory: TaskDirectoryModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var refreshRevision = 0
    private let conversation: ConversationSummary
    private let epoch: UUID

    init(appModel: AppleAppModel, conversation: ConversationSummary, hostId: String, sessionId: String) {
        self.appModel = appModel; self.conversation = conversation; epoch = appModel.accountEpoch
        let capturedEpoch = epoch
        _directory = StateObject(wrappedValue: TaskDirectoryModel(client: appModel.assistantClient, sessionId: sessionId,
            expectedHostId: hostId, accountEpoch: capturedEpoch,
            currentEpoch: { [weak appModel] in appModel?.accountEpoch ?? UUID() },
            currentSession: { [weak appModel] in
                guard let appModel, appModel.taskSessionID(for: conversation, accountEpoch: capturedEpoch) == sessionId else { return nil }
                return appModel.session
            }))
    }

    private var latestLocalCommand: String {
        appModel.commandRows(for: conversation).last(where: { $0.record.intent.kind == .message })?.record.receipt?.commandId ?? "none"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let row = directory.rootCommands.first, directory.canOpen(row) {
                WeaveCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("会话任务进度").font(.caption.weight(.semibold)).foregroundStyle(Weave.muted)
                        ConversationTaskProgressView(appModel: appModel, conversation: conversation, taskId: row.commandId,
                            hostId: row.targetDeviceId, sessionId: row.sessionId, requestId: row.requestId)
                            .id(row.commandId + ":" + epoch.uuidString)
                    }
                }
            } else if directory.error != nil {
                VStack(alignment: .leading, spacing: 8) {
                    Text(directory.error == nil ? "本页还有待核对的任务，请打开会话任务继续查看。" : "任务进度暂未读取，原对话和草稿保留。")
                        .font(.caption).foregroundStyle(Weave.muted)
                    Button("重新读取任务") { refreshRevision += 1 }.font(.caption).buttonStyle(.bordered)
                        .disabled(directory.loading)
                }
            }
            if directory.unsupportedRootCount > 0 {
                Text("本页另有 \(directory.unsupportedRootCount) 条任务状态待核对，请打开会话任务查看。")
                    .font(.caption).foregroundStyle(Weave.muted)
                    .accessibilityIdentifier("inlineTaskUnsupportedNotice")
            }
            if directory.hasMore {
                Text("还有更早的记录，可在会话任务中继续读取。")
                    .font(.caption).foregroundStyle(Weave.muted)
                    .accessibilityIdentifier("inlineTaskPageNotice")
            }
        }
        .task(id: "\(scenePhase)-\(latestLocalCommand)-\(refreshRevision)") {
            guard scenePhase == .active else { directory.suspend(); return }
            // Retire the previous task generation before replacing it. Its delayed callback cannot
            // keep loading=true or publish the old page after a new command/foreground transition.
            directory.suspend(); directory.activate(); await directory.refresh()
        }
        .onDisappear { directory.suspend() }
        .onChange(of: appModel.accountEpoch) { _, _ in directory.cancel() }
    }
}

/// A frozen root/request projection with the same task's explicit interaction cards.
struct ConversationTaskProgressView: View {
    @ObservedObject private var appModel: AppleAppModel
    @StateObject private var model: TaskWorkspaceModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var refreshRevision = 0

    init(appModel: AppleAppModel, conversation: ConversationSummary, taskId: String,
         hostId: String, sessionId: String, requestId: String) {
        self.appModel = appModel
        let epoch = appModel.accountEpoch
        _model = StateObject(wrappedValue: TaskWorkspaceModel(client: appModel.assistantClient, taskId: taskId,
            expectedHostId: hostId, expectedSessionId: sessionId, expectedRequestId: requestId,
            accountEpoch: epoch, stateDirectory: appModel.assistantStateDirectory,
            currentEpoch: { [weak appModel] in appModel?.accountEpoch ?? UUID() },
            currentSession: { [weak appModel] in
                guard let appModel, appModel.taskSessionID(for: conversation, accountEpoch: epoch) == sessionId else { return nil }
                return appModel.session
            }))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.scopeIsCurrent, let task = model.snapshot {
                Text(task.sourceText).font(.callout).lineLimit(3).foregroundStyle(Weave.ink)
                    .accessibilityIdentifier("inlineTaskOriginalGoal")
                Label(TaskPresentation.replyLabel(task.replyEvidence.status), systemImage: "waveform.path")
                    .font(.callout.weight(.semibold)).foregroundStyle(Weave.ink)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(TaskPresentation.replyLabel(task.replyEvidence.status))
                    .accessibilityIdentifier("inlineTaskReplyStatus")
                Text(TaskPresentation.controlLabel(task.control))
                    .font(.caption).foregroundStyle(Weave.secondary)
                    .accessibilityIdentifier("inlineTaskControlStatus")
                if let step = task.steps.last {
                    Text("\(TaskPresentation.commandTitle(step)) · \(TaskPresentation.commandLabel(step))")
                        .font(.caption).foregroundStyle(Weave.secondary)
                        .accessibilityIdentifier("inlineTaskLatestStep")
                }
                if !task.steps.isEmpty || !task.artifacts.isEmpty {
                    Text("\(task.steps.count) 条执行记录 · \(task.artifacts.count) 个文件记录")
                        .font(.caption).foregroundStyle(Weave.muted)
                }
                if task.replyEvidence.status == .blocked {
                    Text("查看原对话中的说明后继续。")
                        .font(.caption).foregroundStyle(Weave.secondary)
                }
                if task.steps.contains(where: { !$0.kind.isKnown || $0.hasUnknownState }) {
                    Text("部分执行记录尚待核对。")
                        .font(.caption).foregroundStyle(Weave.muted)
                }
                TaskInteractionView(appModel: appModel, snapshot: task)
                    .id(task.taskId + ":" + model.accountEpoch.uuidString)
            }
            if let error = model.error {
                Text("进度读取暂未完成。\(error)").font(.caption).foregroundStyle(Weave.muted)
                    .accessibilityIdentifier("inlineTaskError")
            }
            HStack(spacing: 12) {
                NavigationLink {
                    if model.contextIsCurrent {
                        TaskWorkspaceView(appModel: appModel, taskId: model.taskId,
                            expectedHostId: model.expectedHostId, expectedSessionId: model.expectedSessionId,
                            expectedRequestId: model.expectedRequestId)
                            .id(model.taskId + ":" + model.accountEpoch.uuidString)
                    } else {
                        EmptyState(symbol: "checklist", title: "会话已变更", message: "返回当前会话后重新打开任务。")
                    }
                } label: { Label("进度、停止与成果", systemImage: "checklist") }
                .accessibilityIdentifier("inlineTaskDetailsButton")
                Button { refreshRevision += 1 } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("核对原任务进度")
                    .accessibilityIdentifier("refreshInlineTaskButton")
                    .disabled(model.loading || !model.scopeIsCurrent)
                if model.loading { ProgressView().controlSize(.small) }
            }
            .font(.caption).buttonStyle(.bordered)
            if let date = model.lastReadAt {
                Text("上次核对 \(date.formatted(date: .omitted, time: .shortened))")
                    .font(.caption2).foregroundStyle(Weave.muted)
            }
        }
        .task(id: "\(scenePhase)-\(refreshRevision)") {
            guard scenePhase == .active else { model.cancel(); return }
            model.activate()
            var policy = ConversationPollingPolicy()
            while !Task.isCancelled && model.scopeIsCurrent {
                let before = model.snapshot
                await model.refresh()
                guard !Task.isCancelled, model.scopeIsCurrent, model.error == nil,
                      let task = model.snapshot, TaskPresentation.needsObservation(task) else { return }
                do { try await Task.sleep(nanoseconds: policy.delayNanoseconds(madeProgress: before != task)) }
                catch { return }
            }
        }
        .onDisappear { model.cancel() }
        .onChange(of: appModel.accountEpoch) { _, _ in model.cancel() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversationTaskProgress.\(model.taskId)")
    }
}

enum TaskPresentation {
    static func commandTitle(_ row: TaskCommandRecord) -> String {
        if row.taskAction == "supplement" { return "补充" }
        if row.taskAction == "resume" { return "恢复" }
        return row.kind == .openApp ? "打开应用" : "执行步骤"
    }
    static func needsObservation(_ task: TaskSnapshot) -> Bool {
        if [.requested, .cancelRequested, .unconfirmed].contains(task.control.stopStatus) { return true }
        if task.source.state == .rejected { return false }
        if [.waiting, .streaming, .unconfirmed].contains(task.replyEvidence.status) { return true }
        return (task.steps + task.artifacts).contains { [.pending, .dispatching, .acceptedByDSH, .acceptedByHost, .uncertain].contains($0.state) }
    }
    static func replyLabel(_ state: TaskReplyStatus) -> String {
        switch state {
        case .waiting: "等待回复"
        case .streaming: "正在回复"
        case .completed: "回复已结束"
        case .aborted: "回复已中止"
        case .blocked: "回复需要处理"
        case .failed: "回复失败"
        case .unconfirmed: "回复结果待核对"
        }
    }
    static func controlLabel(_ control: TaskControlSnapshot) -> String {
        if let status = control.stopStatus {
            switch status {
            case .requested: return "已请求停止，等待执行回执。"
            case .cancelRequested: return "正在请求取消，尚未确认停止。"
            case .unconfirmed: return "停止结果仍待核对。"
            case .stopped: return "服务已确认停止。"
            case .completed: return "服务已确认任务结束。"
            }
        }
        return control.state == .uncertain ? "任务状态待核对。" : "任务处于服务记录的活动状态。"
    }
    static func commandLabel(_ row: TaskCommandRecord) -> String {
        if row.hasUnknownState { return "状态待核对" }
        return switch row.state {
        case .pending: "等待派发"
        case .dispatching: "正在派发"
        case .acceptedByDSH: "执行端已受理"
        case .acceptedByHost: "宿主已受理"
        case .observed: "服务已记录观察回执"
        case .uncertain: "执行结果待核对"
        case .rejected: "未受理"
        }
    }
}

private struct TaskArtifactDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.plainText, .text] }
    let data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents, data.count <= 131_072,
              !data.contains(0), String(data: data, encoding: .utf8) != nil else { throw APIFailure.invalidResponse }
        self.data = data
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
