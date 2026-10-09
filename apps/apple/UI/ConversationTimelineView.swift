import SwiftUI
import WeftMateCore

struct ConversationTimelineView: View {
    @ObservedObject var appModel: AppleAppModel
    let conversation: ConversationSummary
    let sessionID: String
    let openAttachment: (ConversationAttachmentReference) -> Void
    let openArtifact: (TimelineEvent) -> Void
    let openMemory: (TimelineEvent) -> Void
    let openSources: () -> Void
    @ObservedObject var interactions: TaskInteractionModel
    @StateObject private var commands: TaskDirectoryModel
    @Environment(\.scenePhase) private var scenePhase
    init(appModel: AppleAppModel, conversation: ConversationSummary, sessionID: String, interactions: TaskInteractionModel,
         openAttachment: @escaping (ConversationAttachmentReference) -> Void, openArtifact: @escaping (TimelineEvent) -> Void, openMemory: @escaping (TimelineEvent) -> Void, openSources: @escaping () -> Void) {
        self.appModel = appModel; self.conversation = conversation; self.sessionID = sessionID; self.openAttachment = openAttachment; self.openArtifact = openArtifact; self.openMemory = openMemory; self.openSources = openSources
        self.interactions = interactions
        _commands = StateObject(wrappedValue: TaskDirectoryModel(client: appModel.assistantClient, sessionId: sessionID,
            expectedHostId: appModel.session?.hostId ?? "", accountEpoch: appModel.accountEpoch,
            currentEpoch: { [weak appModel] in appModel?.accountEpoch ?? UUID() }, currentSession: { [weak appModel] in appModel?.session }))
    }
    var body: some View {
        ForEach(appModel.messages.filter { !$0.id.hasPrefix("host|") && !$0.pendingContext && !appModel.timelineMessageIDs.values.contains($0.id) }) { message in
            MessageView(model: appModel, message: message, openAttachment: openAttachment).id(message.id)
        }
        ForEach(TimelineProjection.conversationEntries(appModel.timeline.events)) { entry in
            VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                if !entry.steps.isEmpty {
                    TimelineExecutionBlock(client: appModel.assistantClient, sessionID: sessionID, entry: entry, interactions: interactions, openSources: openSources)
                        .id(entry.id + appModel.accountEpoch.uuidString)
                } else if entry.event.type.hasSuffix(".message") {
                    if let message = appModel.messages.first(where: { $0.id == (appModel.timelineMessageIDs[entry.seq] ?? "host|\(sessionID)|\(entry.seq)") }) {
                        MessageView(model: appModel, message: message, openAttachment: openAttachment)
                    }
                    if entry.event.type == "user.message", let receipt = entry.event.data["receiptId"]?.string,
                       appModel.isSupplement(receipt, in: conversation) || commands.supplementReceiptIDs.contains(receipt) {
                        Text("已补充到当前任务").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                            .accessibilityIdentifier("supplementNotice." + receipt)
                    }
                    let memories = UsedMemory.references(in: entry.event)
                    if !memories.isEmpty {
                        Button { openMemory(entry.event) } label: {
                            WeftLabel("用到了 \(memories.count) 条记忆", icon: "memory", size: 16)
                                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        }.buttonStyle(.plain).accessibilityIdentifier("memoryUsed.\(entry.seq)")
                    }

                } else if entry.event.type.hasPrefix("question.") {
                    TimelineInteractionCard(model: interactions, entry: entry, events: appModel.timeline.events)
                } else if entry.event.type == "artifact.created" {
                    TimelineArtifactCard(appModel: appModel, sessionID: sessionID, entry: entry, openPreview: openArtifact)
                        .id(entry.id + appModel.accountEpoch.uuidString)
                } else if entry.event.type == "task.queued" { Text("排队中").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            }.id(entry.id)
        }
        // Original sync messages are outside the DSH sequence space.
        ForEach(appModel.messages.filter { !$0.id.hasPrefix("host|") && $0.pendingContext }) { message in
            MessageView(model: appModel, message: message, openAttachment: openAttachment).id(message.id)
        }
        if commands.hasMore {
            Button("查看更早记录") { Task { await commands.loadMore() } }.font(AppleTokens.Fonts.caption)
        }
        if let error = interactions.approvalError ?? interactions.questionError { Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
        if let error = interactions.persistenceError { Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger) }
        AppleTokens.Colors.clear.frame(height: 0)
            .task(id: "\(scenePhase)|\(appModel.historyCachedAt != nil)|\(appModel.historyBusy)|\(appModel.timeline.events.last?.seq ?? -1)") {
                guard scenePhase == .active, !appModel.historyBusy, appModel.historyCachedAt == nil else { interactions.suspend(); commands.suspend(); return }
                interactions.activate(); commands.activate()
                if appModel.taskControlSessions.contains(sessionID) {
                    await commands.refresh()
                    if appModel.selectedConversation?.id == conversation.id { appModel.timelineRootCommands = commands.rootCommands }
                }
                var policy = ConversationPollingPolicy()
                while !Task.isCancelled {
                    let old = interactions.approvals, oldQuestions = interactions.questions
                    await interactions.refreshTimeline(sessionID: sessionID)
                    do { try await Task.sleep(nanoseconds: policy.delayNanoseconds(madeProgress: old != interactions.approvals || oldQuestions != interactions.questions)) }
                    catch { return }
                }
            }
            .onChange(of: commands.rootCommands) { _, value in
                if appModel.selectedConversation?.id == conversation.id { appModel.timelineRootCommands = value }
            }
            .onDisappear { interactions.suspend(); commands.suspend() }
            .onChange(of: appModel.accountEpoch) { _, _ in interactions.cancel(); commands.cancel() }
    }
}

struct TimelineExecutionBlock: View {
    let client: PersonalClient
    let sessionID: String
    let entry: TimelineEntry
    @ObservedObject var interactions: TaskInteractionModel
    let openSources: () -> Void
    @State private var expanded = false
    @State private var initialized = false
    @StateObject private var progress = ToolProgressModel()
    private var failed: Bool { entry.steps.contains { $0.effectiveState == "failed" } }
    private var summary: String {
        guard entry.running, !failed, let step = entry.steps.last(where: \.running) else { return ToolProgressSummary.text(entry) }
        let pending = interactions.pendingApprovals.contains { $0.callId == step.data["stepId"]?.string }
        return (pending ? "等待批准：" : "正在") + progress.summary(step) + "…"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
            Button { withAnimation(AppleTokens.Motion.disclosure) { expanded.toggle() } } label: {
                HStack {
                    Text(summary)
                    Spacer(minLength: AppleTokens.Space.p4)
                    WeftIcon(expanded ? "chevron" : "right")
                }.font(AppleTokens.Fonts.caption).foregroundStyle(entry.steps.contains { $0.effectiveState == "failed" } ? Weave.danger : Weave.muted).contentShape(Rectangle()).frame(minHeight: 28)
            }.buttonStyle(.plain).accessibilityIdentifier("executionBlock.\(entry.seq)")
                .accessibilityValue(expanded ? "已展开" : "已收起")
            if expanded {
                Button("查看来源") { openSources() }.font(AppleTokens.Fonts.caption).accessibilityIdentifier("executionSources.\(entry.seq)")
                VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                ForEach(entry.steps) { step in
                    TimelineStepView(client: client, sessionID: sessionID, step: step, running: entry.running, decision: interactions.decisionLabel(for: step), progress: progress)
                }
                }.padding(AppleTokens.Space.p10).overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r12).strokeBorder(Weave.line))
                .transition(.opacity)
            }
        }
        .padding(.vertical, AppleTokens.Space.p6)
        .task(id: entry.steps.last(where: \.running)?.detailSeq) {
            if let step = entry.steps.last(where: \.running), entry.running { await progress.read(client: client, sessionID: sessionID, step: step) }
        }
        .onAppear { if !initialized { expanded = failed; initialized = true } }
        .onChange(of: failed) { _, value in if value { expanded = true } }
    }
}
private struct TimelineStepView: View {
    let client: PersonalClient
    let sessionID: String
    let step: TimelineStep
    let running: Bool
    let decision: String?
    @ObservedObject var progress: ToolProgressModel
    @State private var expanded = false
    private var detail: TimelineDetail? { step.detailSeq.flatMap { progress.details[$0] } }
    private var error: String? { step.detailSeq.flatMap { progress.errors[$0] } }
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            Button { withAnimation(AppleTokens.Motion.disclosure) { expanded.toggle() } } label: {
                HStack(alignment: .top) {
                    Text(progress.summary(step) + (decision.map { " · " + $0 } ?? "") + (step.running && running ? " · 运行中" : step.effectiveState == "failed" ? " · 失败" : ""))
                        .font(AppleTokens.Fonts.callout).multilineTextAlignment(.leading)
                    Spacer(minLength: AppleTokens.Space.p4)
                    WeftIcon(expanded ? "chevron" : "right", size: 16).font(AppleTokens.Fonts.caption)
                }.contentShape(Rectangle()).frame(minHeight: 32)
            }.buttonStyle(.plain).accessibilityIdentifier("executionStep.\(step.seq)")
                .accessibilityValue(expanded ? "已展开" : "已收起")
            if expanded {
                if detail == nil && error == nil { ProgressView() }
                if let detail {
                    Text(detail.text + (detail.truncated == true ? "\n[内容已截断]" : ""))
                        .font(AppleTokens.Fonts.caption.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    Button("复制") {
                        #if os(macOS)
                        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(detail.text, forType: .string)
                        #else
                        UIPasteboard.general.string = detail.text
                        #endif
                    }.font(AppleTokens.Fonts.caption)
                }
                if let error { Text(error).font(AppleTokens.Fonts.caption) }
            }
        }
        .onAppear { if step.effectiveState == "failed" { expanded = true } }
        .onChange(of: step.effectiveState) { _, value in if value == "failed" { expanded = true } }
        .task(id: "\(expanded)-\(step.detailSeq ?? -1)") {
            guard expanded else { return }
            await progress.read(client: client, sessionID: sessionID, step: step)
        }
    }
}
