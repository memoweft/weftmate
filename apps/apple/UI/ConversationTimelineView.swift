import SwiftUI
import WeftMateCore

struct ConversationTimelineView: View {
    @ObservedObject var appModel: AppleAppModel
    let conversation: ConversationSummary
    let sessionID: String
    let openAttachment: (ConversationAttachmentReference) -> Void
    let openArtifact: (TimelineEvent) -> Void
    @StateObject private var interactions: TaskInteractionModel
    @StateObject private var commands: TaskDirectoryModel
    @Environment(\.scenePhase) private var scenePhase
    init(appModel: AppleAppModel, conversation: ConversationSummary, sessionID: String,
         openAttachment: @escaping (ConversationAttachmentReference) -> Void, openArtifact: @escaping (TimelineEvent) -> Void) {
        self.appModel = appModel; self.conversation = conversation; self.sessionID = sessionID; self.openAttachment = openAttachment; self.openArtifact = openArtifact
        _interactions = StateObject(wrappedValue: TaskInteractionModel(client: appModel.assistantClient, account: appModel.session,
            epoch: appModel.accountEpoch, stateDirectory: appModel.assistantStateDirectory,
            currentEpoch: { [weak appModel] in appModel?.accountEpoch ?? UUID() }, currentSession: { [weak appModel] in appModel?.session }))
        _commands = StateObject(wrappedValue: TaskDirectoryModel(client: appModel.assistantClient, sessionId: sessionID,
            expectedHostId: appModel.session?.hostId ?? "", accountEpoch: appModel.accountEpoch,
            currentEpoch: { [weak appModel] in appModel?.accountEpoch ?? UUID() }, currentSession: { [weak appModel] in appModel?.session }))
    }
    var body: some View {
        ForEach(appModel.messages.filter { !$0.id.hasPrefix("host|") && !$0.pendingContext && !appModel.timelineMessageIDs.values.contains($0.id) }) { message in
            MessageView(model: appModel, message: message, openAttachment: openAttachment).id(message.id)
        }
        ForEach(TimelineProjection.entries(appModel.timeline.events)) { entry in
            VStack(alignment: .leading, spacing: 12) {
                if !entry.steps.isEmpty {
                    TimelineExecutionBlock(client: appModel.assistantClient, sessionID: sessionID, entry: entry)
                        .id(entry.id + appModel.accountEpoch.uuidString)
                } else if entry.event.type.hasSuffix(".message") {
                    if let message = appModel.messages.first(where: { $0.id == (appModel.timelineMessageIDs[entry.seq] ?? "host|\(sessionID)|\(entry.seq)") }) {
                        MessageView(model: appModel, message: message, openAttachment: openAttachment)
                    }
                    if appModel.taskControlSessions.contains(sessionID), let receipt = entry.event.data["receiptId"]?.string,
                       let command = commands.rootCommands.first(where: { $0.receiptId == receipt }) {
                        TimelineTaskControl(appModel: appModel, command: command).id(command.id + appModel.accountEpoch.uuidString)
                    }
                } else if entry.event.type.hasPrefix("approval.") || entry.event.type.hasPrefix("question.") {
                    TimelineInteractionCard(model: interactions, entry: entry, events: appModel.timeline.events)
                } else if entry.event.type == "artifact.created" {
                    TimelineArtifactCard(appModel: appModel, sessionID: sessionID, entry: entry, openPreview: openArtifact)
                        .id(entry.id + appModel.accountEpoch.uuidString)
                } else { Text("排队中").font(.caption).foregroundStyle(Weave.muted) }
            }.id(entry.id)
        }
        // Original sync messages are outside the DSH sequence space.
        ForEach(appModel.messages.filter { !$0.id.hasPrefix("host|") && $0.pendingContext }) { message in
            MessageView(model: appModel, message: message, openAttachment: openAttachment).id(message.id)
        }
        if commands.hasMore {
            Button("读取更早记录的来源与控制") { Task { await commands.loadMore() } }.font(.caption)
        }
        if let error = interactions.approvalError ?? interactions.questionError { Text(error).font(.caption).foregroundStyle(Weave.muted) }
        if let error = interactions.persistenceError { Text(error).font(.caption).foregroundStyle(Weave.danger) }
        Color.clear.frame(height: 0)
            .task(id: "\(scenePhase)|\(appModel.historyCachedAt != nil)|\(appModel.historyBusy)") {
                guard scenePhase == .active, !appModel.historyBusy, appModel.historyCachedAt == nil else { interactions.suspend(); commands.suspend(); return }
                interactions.activate(); commands.activate(); await commands.refresh()
                var policy = ConversationPollingPolicy()
                while !Task.isCancelled {
                    let old = interactions.approvals, oldQuestions = interactions.questions
                    await interactions.refreshTimeline(sessionID: sessionID)
                    do { try await Task.sleep(nanoseconds: policy.delayNanoseconds(madeProgress: old != interactions.approvals || oldQuestions != interactions.questions)) }
                    catch { return }
                }
            }
            .onDisappear { interactions.suspend(); commands.suspend() }
            .onChange(of: appModel.accountEpoch) { _, _ in interactions.cancel(); commands.cancel() }
    }
}

struct TimelineExecutionBlock: View {
    let client: PersonalClient
    let sessionID: String
    let entry: TimelineEntry
    @State private var expanded = false
    @State private var initialized = false
    #if os(macOS)
    private let desktop = true
    #else
    private let desktop = false
    #endif
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() } } label: {
                HStack {
                    Label(entry.running ? "正在执行 \(entry.steps.count) 步" : "执行了 \(entry.steps.count) 步 · 用时 \(entry.elapsed)",
                          systemImage: entry.running ? "gearshape" : "checkmark.circle")
                    Spacer(minLength: 4)
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                }.font(.callout).foregroundStyle(Weave.secondary).contentShape(Rectangle()).frame(minHeight: 28)
            }.buttonStyle(.plain).accessibilityIdentifier("executionBlock.\(entry.seq)")
                .accessibilityValue(expanded ? "已展开" : "已收起")
            if expanded {
                ForEach(entry.steps) { step in
                    TimelineStepView(client: client, sessionID: sessionID, step: step, running: entry.running)
                }.transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(14).background(Weave.soft, in: RoundedRectangle(cornerRadius: 14))
        .onAppear { if !initialized { expanded = entry.running && desktop; initialized = true } }
        .onChange(of: entry.running) { _, running in withAnimation(.easeInOut(duration: 0.2)) { expanded = running && desktop } }
    }
}
private struct TimelineStepView: View {
    let client: PersonalClient
    let sessionID: String
    let step: TimelineStep
    let running: Bool
    @State private var expanded = false
    @State private var detail: TimelineDetail?
    @State private var error: String?
    @State private var loading = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() } } label: {
                HStack(alignment: .top) {
                    Text(step.summary + (step.running && running ? " · 运行中" : step.data["state"]?.string == "failed" ? " · 未完成" : ""))
                        .font(.callout).multilineTextAlignment(.leading)
                    Spacer(minLength: 4)
                    Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.caption)
                }.contentShape(Rectangle()).frame(minHeight: 32)
            }.buttonStyle(.plain).accessibilityIdentifier("executionStep.\(step.seq)")
                .accessibilityValue(expanded ? "已展开" : "已收起")
            if expanded {
                if loading { ProgressView() }
                if let detail {
                    Text(detail.text + (detail.truncated == true ? "\n[内容已截断]" : ""))
                        .font(.caption.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    Button("复制") {
                        #if os(macOS)
                        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(detail.text, forType: .string)
                        #else
                        UIPasteboard.general.string = detail.text
                        #endif
                    }.font(.caption)
                }
                if let error { Text(error).font(.caption) }
            }
        }
        .task(id: "\(expanded)-\(step.detailSeq ?? -1)") {
            guard expanded, detail?.seq != step.detailSeq, let seq = step.detailSeq else { return }
            loading = true; error = nil
            do { let value = try await client.timelineDetail(sessionID: sessionID, seq: seq); if !Task.isCancelled { detail = value } }
            catch { if !Task.isCancelled { self.error = "暂时无法读取，收起后可重试。" } }
            loading = false
        }
    }
}
