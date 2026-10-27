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
    let onDecisionPosition: (@MainActor (String,CGRect?,CGFloat,Bool) -> Void)?
    @ObservedObject var interactions: TaskInteractionModel
    @StateObject private var commands: TaskDirectoryModel
    @Environment(\.scenePhase) private var scenePhase
    init(appModel: AppleAppModel, conversation: ConversationSummary, sessionID: String, interactions: TaskInteractionModel,
         openAttachment: @escaping (ConversationAttachmentReference) -> Void, openArtifact: @escaping (TimelineEvent) -> Void, openMemory: @escaping (TimelineEvent) -> Void, openSources: @escaping () -> Void, onDecisionPosition: (@MainActor (String,CGRect?,CGFloat,Bool) -> Void)? = nil) {
        self.appModel = appModel; self.conversation = conversation; self.sessionID = sessionID; self.openAttachment = openAttachment; self.openArtifact = openArtifact; self.openMemory = openMemory; self.openSources = openSources; self.onDecisionPosition=onDecisionPosition
        self.interactions = interactions
        _commands = StateObject(wrappedValue: TaskDirectoryModel(client: appModel.assistantClient, sessionId: sessionID,
            expectedHostId: appModel.session?.hostId ?? "", accountEpoch: appModel.accountEpoch,
            currentEpoch: { [weak appModel] in appModel?.accountEpoch ?? UUID() }, currentSession: { [weak appModel] in appModel?.session }))
    }
    private var displayEvents: [TimelineEvent] {
        #if os(iOS)
        if WorkAndChat.mode(conversation) == .chat {
            let calls = WorkAndChat.proposedCallIDs(events: appModel.timeline.events, approvals: interactions.approvals)
            return appModel.timeline.displayEvents.filter { WorkAndChat.showsChatEvent(type: $0.type, data: $0.data, proposedCalls: calls) }
        }
        return appModel.timeline.displayEvents
        #else
        return appModel.timeline.events
        #endif
    }
    private var phoneEntries: [TimelineEntry] {
        #if os(iOS)
        TimelineProjection.entries(displayEvents).filter { $0.event.type != "task.queued" }
        #else
        TimelineProjection.conversationEntries(displayEvents)
        #endif
    }
    var body: some View {
        ForEach(appModel.messages.filter { !$0.id.hasPrefix("host|") && !$0.pendingContext && !appModel.timelineMessageIDs.values.contains($0.id) }) { message in
            MessageView(model: appModel, message: message, openAttachment: openAttachment).id(message.id)
        }
        ForEach(phoneEntries) { entry in
            VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                if !entry.steps.isEmpty {
                    TimelineExecutionBlock(appModel: appModel, client: appModel.assistantClient, sessionID: sessionID, entry: entry, interactions: interactions, openSources: openSources)
                        .id(entry.id + appModel.accountEpoch.uuidString)
                } else if entry.event.type.hasPrefix("assistant.") {
                    #if os(iOS)
                    MessageBodyView(text: entry.event.data["text"]?.string ?? "", messageID: entry.id, streaming: entry.event.type == "assistant.delta")
                        .modifier(MessageActionsPresentation(app:appModel,id:entry.id,text:entry.event.data["text"]?.string ?? "",at:entry.event.at,user:false,enabled:entry.event.type == "assistant.message",latest:entry.id == phoneEntries.last?.id,menuID:"message.actions."+entry.id,quote:{
                            appModel.setDraft(appModel.draftText(for:conversation,accountEpoch:appModel.accountEpoch)+"\n> "+(entry.event.data["text"]?.string ?? ""),for:conversation,accountEpoch:appModel.accountEpoch)
                        },regenerate:{
                            if let message=appModel.messages.first(where: { $0.id == appModel.timelineMessageIDs[entry.seq] }) { Task { await appModel.regenerateReply(message) } }
                        },extra:{AnyView(EmptyView())}))
                    #if os(iOS)
                    if !UsedMemory.references(in:entry.event).isEmpty {
                        Button("查看这条回复的来源") { openMemory(entry.event) }
                            .font(AppleTokens.Fonts.caption).buttonStyle(.plain).foregroundStyle(Weave.muted)
                            .frame(minHeight:AppleTokens.Space.p44).accessibilityIdentifier("memoryUsed.\(entry.seq)")
                    }
                    #endif
                    #else
                    if entry.event.type == "assistant.delta" { MessageBodyView(text:entry.event.data["text"]?.string ?? "",messageID:entry.id) }
                    else if let message=appModel.messages.first(where:{$0.id == (appModel.timelineMessageIDs[entry.seq] ?? "host|\(sessionID)|\(entry.seq)")}) {
                        MessageView(model:appModel,message:message,openAttachment:openAttachment)
                    }
                    let memories=UsedMemory.references(in:entry.event)
                    if !memories.isEmpty {
                        Button { openMemory(entry.event) } label: { WeftLabel("用到了 \(memories.count) 条记忆",icon:"memory",size:16).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                            .buttonStyle(.plain).accessibilityIdentifier("memoryUsed.\(entry.seq)")
                    }
                    #endif
                } else if entry.event.type.hasSuffix(".message") {
                    if let message = appModel.messages.first(where: { $0.id == (appModel.timelineMessageIDs[entry.seq] ?? "host|\(sessionID)|\(entry.seq)") }) {
                        MessageView(model: appModel, message: message, openAttachment: openAttachment)
                    }
                    if entry.event.type == "user.message", let receipt = entry.event.data["receiptId"]?.string,
                       appModel.isSupplement(receipt, in: conversation) || commands.supplementReceiptIDs.contains(receipt) {
                        Text("已补充到当前任务").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                            .accessibilityIdentifier("supplementNotice." + receipt)
                    }
                    #if os(macOS)
                    let memories = UsedMemory.references(in: entry.event)
                    if !memories.isEmpty {
                        Button { openMemory(entry.event) } label: {
                            WeftLabel("用到了 \(memories.count) 条记忆", icon: "memory", size: 16)
                                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        }.buttonStyle(.plain).accessibilityIdentifier("memoryUsed.\(entry.seq)")
                    }

                    #endif
                } else if entry.event.type.hasPrefix("question.") || entry.event.type.hasPrefix("approval.") {
                    TimelineInteractionCard(model: interactions, entry: entry, events: appModel.timeline.events)
                } else if entry.event.type == "artifact.created" {
                    #if os(iOS)
                    if let bundle = ReplyArtifacts.bundles(appModel.timeline.events).first(where: { $0.anchorSeq == entry.seq }) {
                        ReplyArtifactList(app: appModel, sessionID: sessionID, bundle: bundle)
                    }
                    #else
                    TimelineArtifactCard(appModel: appModel, sessionID: sessionID, entry: entry, openPreview: openArtifact)
                        .id(entry.id + appModel.accountEpoch.uuidString)
                    #endif
                } else if entry.event.type == "task.queued" { Text("排队中").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            }.id(entry.id)
                .background {
                    #if os(iOS)
                    if let onDecisionPosition { MainChatEventPosition(eventID:entry.id,onPosition:onDecisionPosition) }
                    #endif
                }
        }
        // Original sync messages are outside the DSH sequence space.
        ForEach(appModel.messages.filter { !$0.id.hasPrefix("host|") && $0.pendingContext }) { message in
            MessageView(model: appModel, message: message, openAttachment: openAttachment).id(message.id)
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
    @ObservedObject var appModel: AppleAppModel
    let client: PersonalClient
    let sessionID: String
    let entry: TimelineEntry
    @ObservedObject var interactions: TaskInteractionModel
    let openSources: () -> Void
    var sourceEvents: [TimelineEvent]? = nil
    @State private var expanded = false
    @State private var initialized = false
    @StateObject private var progress = ToolProgressModel()
    private var outcome: ReplyOutcome { ReplyOutcome.classify(events: sourceEvents ?? appModel.timeline.events, taskID: entry.steps.first?.taskID ?? "") }
    private var lastTaskBlock: Bool {
        TimelineProjection.entries(sourceEvents ?? appModel.timeline.events).last(where: { $0.steps.first?.taskID == entry.steps.first?.taskID })?.id == entry.id
    }
    private var failed: Bool {
        #if os(iOS)
        outcome.prominent && lastTaskBlock
        #else
        entry.steps.contains { $0.effectiveState == "failed" }
        #endif
    }
    private var summary: String {
        #if os(iOS)
        if outcome.state != .running { return lastTaskBlock ? outcome.text : ToolProgressSummary.counts(entry.steps) }
        if outcome.retries > 0 { return outcome.text }
        #endif
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
                }.font(AppleTokens.Fonts.body).foregroundStyle(failed ? Weave.danger : Weave.muted).frame(maxWidth: .infinity, minHeight: AppleTokens.Space.p44, alignment: .leading).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("executionBlock.\(entry.seq)")
                .accessibilityValue(expanded ? "已展开" : "已收起")
            if expanded {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                ForEach(entry.steps) { step in
                    TimelineStepView(client: client, sessionID: sessionID, step: step, running: entry.running, decision: interactions.decisionLabel(for: step), progress: progress, openSources: openSources, targetSeq: appModel.subtaskStepTarget)
                }
                }.padding(AppleTokens.Space.p10).overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r12).strokeBorder(Weave.line))
                .transition(.opacity)
            }
        }
        .padding(.vertical, AppleTokens.Space.p6)
        .task(id: entry.steps.last(where: \.running)?.detailSeq) {
            if let step = entry.steps.last(where: \.running), entry.running { await progress.read(client: client, sessionID: sessionID, step: step) }
        }
        .onAppear { if !initialized { expanded = failed || entry.running
                #if DEBUG && os(macOS)
                let args = ProcessInfo.processInfo.arguments
                if args.contains("--ui-testing"), args.contains("a9-detail") { expanded = true }
                #endif
                initialized = true } }
        .onChange(of: appModel.subtaskStepTarget) { _, seq in if entry.steps.contains(where: { $0.seq == seq }) { expanded = true } }
        .onChange(of: failed) { _, value in if value { expanded = true } }
        #if os(iOS)
        .onChange(of: entry.running) { _, running in expanded = running }
        #endif
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
    let targetSeq: Int?
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
            if step.effectiveState == "failed" || targetSeq == step.seq { expanded = true }
            #if DEBUG && os(macOS)
            let args = ProcessInfo.processInfo.arguments
            if args.contains("--ui-testing"), args.contains("a9-detail"), step.ordinal == 1 { expanded = true }
            #endif
        }
        .onChange(of: targetSeq) { _, seq in if seq == step.seq { expanded = true } }
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
            Button("查看使用的来源", action: openSources).font(AppleTokens.Fonts.callout).buttonStyle(OutlineActionStyle())
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
            Button("复制") { copy(value.readableText) }.font(AppleTokens.Fonts.callout).buttonStyle(OutlineActionStyle())
            DisclosureGroup("查看原始数据", isExpanded: $rawExpanded) {
                Text(value.readableText).font(AppleTokens.Fonts.caption.monospaced()).textSelection(.enabled)
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
