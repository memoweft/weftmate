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
            Button("查看更早记录") { Task { await commands.loadMore(); publishRootCommands() } }.font(AppleTokens.Fonts.caption)
        }
        if let error = interactions.approvalError ?? interactions.questionError { Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
        if let error = interactions.persistenceError { Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger) }
        AppleTokens.Colors.clear.frame(height: 0)
            .task(id: "\(scenePhase)|\(appModel.historyCachedAt != nil)|\(appModel.historyBusy)|\(appModel.taskControlSessions.contains(sessionID))|\(conversation.running)") {
                guard scenePhase == .active, !appModel.historyBusy, appModel.historyCachedAt == nil else { interactions.suspend(); commands.suspend(); return }
                commands.suspend(); commands.activate(); interactions.activate()
                var policy = ConversationPollingPolicy()
                while !Task.isCancelled {
                    let old = interactions.approvals, oldQuestions = interactions.questions, oldRoots = commands.rootCommands
                    if appModel.taskControlSessions.contains(sessionID) {
                        await commands.refresh()
                        guard !Task.isCancelled else { return }
                        publishRootCommands()
                    }
                    await interactions.refreshTimeline(sessionID: sessionID)
                    do { try await Task.sleep(nanoseconds: policy.delayNanoseconds(madeProgress: conversation.running || old != interactions.approvals || oldQuestions != interactions.questions || oldRoots != commands.rootCommands)) }
                    catch { return }
                }
            }
            .onDisappear { interactions.suspend(); commands.suspend() }
            .onChange(of: appModel.accountEpoch) { _, _ in interactions.cancel(); commands.cancel() }
    }
    private func publishRootCommands() {
        guard commands.scopeIsCurrent, !commands.loading, commands.error == nil,
              appModel.selectedConversation?.id == conversation.id else { return }
        appModel.timelineRootCommands = commands.rootCommands
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
                    WeftIcon(expanded ? "chevron" : "right", size: AppleTokens.Space.p16)
                }.font(AppleTokens.Fonts.body).foregroundStyle(entry.steps.contains { $0.effectiveState == "failed" } ? Weave.danger : Weave.muted).frame(maxWidth: .infinity, minHeight: AppleTokens.Space.p44, alignment: .leading).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("executionBlock.\(entry.seq)")
                .accessibilityValue(expanded ? "已展开" : "已收起")
            if expanded {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                ForEach(entry.steps) { step in
                    TimelineStepView(client: client, sessionID: sessionID, step: step, running: entry.running, decision: interactions.decisionLabel(for: step), progress: progress, openSources: openSources)
                }
                }.padding(AppleTokens.Space.p10).overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r12).strokeBorder(Weave.line))
                .transition(.opacity)
            }
        }
        .padding(.vertical, AppleTokens.Space.p6)
        .task(id: entry.steps.last(where: \.running)?.detailSeq) {
            if let step = entry.steps.last(where: \.running), entry.running { await progress.read(client: client, sessionID: sessionID, step: step) }
        }
        .onAppear { if !initialized { expanded = failed
                #if DEBUG && os(macOS)
                let args = ProcessInfo.processInfo.arguments
                if args.contains("--ui-testing"), args.contains("a9-detail") { expanded = true }
                #endif
                initialized = true } }
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
    let openSources: () -> Void
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
                if let value = progress.presentation(step) {
                    ToolStepDetailView(value: value, openSources: openSources)
                }
                if let error { Text(error).font(AppleTokens.Fonts.caption) }
            }
        }
        .onAppear {
            if step.effectiveState == "failed" { expanded = true }
            #if DEBUG && os(macOS)
            let args = ProcessInfo.processInfo.arguments
            if args.contains("--ui-testing"), args.contains("a9-detail"), step.ordinal == 1 { expanded = true }
            #endif
        }
        .onChange(of: step.effectiveState) { _, value in if value == "failed" { expanded = true } }
        .task(id: "\(expanded)-\(step.detailSeq ?? -1)") {
            guard expanded else { return }
            await progress.read(client: client, sessionID: sessionID, step: step)
        }
    }
}

/// The parser owns interpretation; this view only presents its fields and disclosures.
private struct ToolStepDetailView: View {
    let value: ToolStepDetail
    let openSources: () -> Void
    @State private var fullOutput = false
    @State private var rawExpanded = false
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            Button("查看使用的来源", action: openSources).font(AppleTokens.Fonts.callout)
            if !value.parameters.isEmpty {
                Text("参数").font(AppleTokens.Fonts.callout.weight(.medium))
                ForEach(value.parameters) { parameter in
                    Text(parameter.name + "：" + parameter.value).font(AppleTokens.Fonts.callout).textSelection(.enabled)
                }
            }
            if let error = value.error {
                Text("错误").font(AppleTokens.Fonts.callout.weight(.medium)).foregroundStyle(Weave.danger)
                Text(error).font(AppleTokens.Fonts.callout.monospaced()).foregroundStyle(Weave.danger).textSelection(.enabled)
            }
            if !value.output.isEmpty {
                Text("输出").font(AppleTokens.Fonts.callout.weight(.medium))
                Text(fullOutput ? value.output : value.outputPreview).font(AppleTokens.Fonts.callout.monospaced()).textSelection(.enabled)
                if value.hasFullOutput {
                    Button(fullOutput ? "收起全文" : "展开全文") { fullOutput.toggle() }.font(AppleTokens.Fonts.callout)
                }
            }
            if value.truncated { Text("内容已截断").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted) }
            Button("复制") { copy(value.readableText) }.font(AppleTokens.Fonts.callout)
            DisclosureGroup("查看原始数据", isExpanded: $rawExpanded) {
                Text(value.raw).font(AppleTokens.Fonts.caption.monospaced()).textSelection(.enabled)
                Button("复制原始数据") { copy(value.raw) }.font(AppleTokens.Fonts.callout)
            }.font(AppleTokens.Fonts.callout)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func copy(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }
}
