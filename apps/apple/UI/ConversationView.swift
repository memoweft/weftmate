import SwiftUI
import WeftMateCore
import UniformTypeIdentifiers
import PhotosUI
#if os(iOS)
import UIKit
#endif

struct ConversationListContent: View {
    @ObservedObject var model: AppleAppModel
    @Binding var search: String

    var filtered: [ConversationSummary] {
        guard !search.isEmpty else { return model.visibleConversations }
        return model.visibleConversations.filter { $0.title.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        Group {
            if let cachedAt = model.conversationsCachedAt {
                Text("本机缓存 · \(DeviceDateText.timestamp(cachedAt))")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }
            if model.refreshing && model.conversations.isEmpty {
                HStack { ProgressView(); Text("正在读取…").foregroundStyle(Weave.muted) }
                    .padding(.vertical, AppleTokens.Space.p18)
            } else if let error = model.conversationsError {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                    InlineNotice(message: error, isError: true)
                    Button("重新连接") { Task { await model.refresh() } }
                        .disabled(model.refreshing)
                }.padding(.vertical, AppleTokens.Space.p10)
            } else if model.conversations.isEmpty {
                Text("还没有对话")
                    .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted).padding(.vertical, AppleTokens.Space.p18)
            } else if filtered.isEmpty {
                Text("没有找到相关对话。")
                    .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted).padding(.vertical, AppleTokens.Space.p18)
            }
        }
    }
}

struct ConversationRow: View {
    let conversation: ConversationSummary
    var selected = false
    var body: some View {
        HStack(spacing: AppleTokens.Space.p8) {
            Text((conversation.temporaryState.notice().isEmpty ? "" : "临时对话 · ") + (conversation.title.isEmpty ? "未命名对话" : conversation.title))
                .font(AppleTokens.Fonts.body).foregroundStyle(Weave.ink).lineLimit(1)
            Spacer(minLength: AppleTokens.Space.p4)
            #if os(iOS)
            if conversation.pinned { WeftIcon("pin", size: AppleTokens.Space.p12).foregroundStyle(Weave.muted).accessibilityLabel("已置顶") }
            #endif
            if conversation.running {
                ProgressView().controlSize(.mini).accessibilityLabel("正在处理")
            } else if conversation.unread {
                Circle().fill(Weave.accent).frame(width: AppleTokens.Space.p6, height: AppleTokens.Space.p6).accessibilityLabel("未读")
            }
        }.padding(.vertical, AppleTokens.Space.p5)
        #if os(iOS)
        .padding(.horizontal, AppleTokens.Space.p8).frame(minHeight: AppleTokens.Space.p44)
        .background(selected ? Weave.soft : AppleTokens.Colors.clear, in: Capsule())
        #endif
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("conversationRow.\(conversation.id)")
    }
}

struct ConversationView: View {
    @ObservedObject var model: AppleAppModel
    let conversation: ConversationSummary
    @StateObject private var interactions: TaskInteractionModel
    @StateObject private var resources: ConversationResourcesModel
    init(model: AppleAppModel, conversation: ConversationSummary) {
        self.model = model; self.conversation = conversation
        _interactions = StateObject(wrappedValue: TaskInteractionModel(client: model.assistantClient, account: model.session,
            epoch: model.accountEpoch, stateDirectory: model.assistantStateDirectory,
            currentEpoch: { [weak model] in model?.accountEpoch ?? UUID() }, currentSession: { [weak model] in model?.session }))
        _resources = StateObject(wrappedValue: ConversationResourcesModel(app: model,
            sessionID: conversation.sessionId ?? model.taskSessionID(for: conversation, accountEpoch: model.accountEpoch) ?? ""))
    }
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @FocusState private var draftFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var visibleMessageID: String?
    @State private var follow = ConversationFollowState()
    @State private var viewportHeight: CGFloat = 0
    @State private var contentHeight: CGFloat = 0
    @State private var waitingSince = Date()
    @State private var contextPopover = false
    @State private var dictationPopover = false
    @State private var previousTailID: String?
    @State private var composerIdentity = UUID()
    @State private var latestJump = 0
    @State private var atBottom = true
    @State private var queueOpen = false
    @StateObject private var phonePositions = MainChatPositionTracker()
    @State private var resourcePopover = false
    @State private var showingUsage = false
    @State private var showingModels = false
    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    #endif
    @State private var importScope: AppleUXScope?
    @State private var showingPhotos = false
    @State private var showingCamera = false
    @State private var expandedSubtasks = false
    @State private var importingAttachments = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var pendingAdoptionProfile: String?
    @State private var confirmingLocalTurn = false
    @State private var artifactPreviewName: String?
    @State private var artifactPreviewType: String?
    @State private var previewReference: ConversationAttachmentReference?
    @State private var previewFile: URL?
    @State private var previewDirectory: URL?
    @State private var attachmentInputError: String?
    @State private var previewError: String?
    @State private var previewBusy = false
    @State private var previewWorker: Task<Void, Never>?
    @State private var showingPreview = false

    private var draft: Binding<String> {
        let accountEpoch = model.accountEpoch
        return Binding(get: { model.draftText(for: conversation, accountEpoch: accountEpoch) },
                       set: { model.setDraft($0, for: conversation, accountEpoch: accountEpoch) })
    }

    var body: some View {
        HStack(spacing: AppleTokens.Space.p0) {
            conversationContent
            #if os(macOS)
            if resources.visible { ConversationResourcesPanel(app: model, resources: resources) }
            if showingPreview { Divider(); attachmentPreview.frame(minWidth: 320, idealWidth: 400, maxWidth: 480) }
            #endif
        }
        .sheet(isPresented: $showingModels) { SettingsView(model: model, route: .init(categoryID: "models"), onClose: { showingModels = false }) }
        .sheet(isPresented: $showingUsage) {
            SettingsView(model: model, route: .usage(sessionID: conversation.sessionId), onClose: { showingUsage = false })
        }
        .fileImporter(isPresented: $importingAttachments, allowedContentTypes: [.item], allowsMultipleSelection: true) { @Sendable result in
            Task { @MainActor in
            if case .success(let files) = result {
                guard let scope = importScope, scope == model.uxScope else { return }
                await model.addAttachments(files, to: conversation, accountEpoch: scope.epoch)
            }
            }
        }
        .onChange(of: photoSelection) { _, selection in
            guard let scope = importScope, scope == model.uxScope else { photoSelection = []; return }
            let epoch = scope.epoch
            Task {
                var files: [URL] = []
                defer { files.forEach { try? FileManager.default.removeItem(at: $0) }; photoSelection = [] }
                do {
                    for photo in selection {
                        guard let data = try await photo.loadTransferable(type: Data.self) else { continue }
                        let ext = photo.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
                        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "." + ext)
                        try data.write(to: file); files.append(file)
                    }
                    guard scope == model.uxScope else { return }
                    await model.addAttachments(files, to: conversation, accountEpoch: epoch)
                } catch { if scope == model.uxScope { attachmentInputError = "图片未添加，请重试。" } }
            }
        }
        .photosPicker(isPresented: $showingPhotos, selection: $photoSelection, maxSelectionCount: 4, matching: .images)
        .confirmationDialog("上一条本地消息是否已送达无法确定。确认后继续。", isPresented: $confirmingLocalTurn, titleVisibility: .visible) {
            Button("确认并继续") {
                guard let profile = pendingAdoptionProfile else { return }
                let epoch = model.accountEpoch
                Task { await model.adopt(conversation, profileID: profile, accountEpoch: epoch, acknowledgeUncertainLocalTurn: true) }
                pendingAdoptionProfile = nil
            }
            Button("取消", role: .cancel) { pendingAdoptionProfile = nil }
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $showingCamera) {
            ComposerCamera { file in
                showingCamera = false
                guard let file else { return }
                guard let scope = importScope, scope == model.uxScope else { try? FileManager.default.removeItem(at: file); return }
                Task { await model.addAttachments([file], to: conversation, accountEpoch: scope.epoch); try? FileManager.default.removeItem(at: file) }
            }.ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $showingPreview) { attachmentPreview }
        .navigationDestination(isPresented: $resources.visible) { PhoneConversationResourcesPage(app: model, resources: resources) }
        #endif
        .onChange(of: model.accountEpoch) { _, _ in importingAttachments = false; showingCamera = false; showingPhotos = false; importScope = nil; cancelScreenshot(); closePreview(); resources.clear(); pendingAdoptionProfile = nil; confirmingLocalTurn = false }
        .onChange(of: conversation.id) { _, _ in cancelScreenshot(); closePreview(); resources.clear(); pendingAdoptionProfile = nil; confirmingLocalTurn = false }
        .onChange(of: resources.selected) { _, _ in resourcePopover = false }
        .onDisappear { closePreview(); cancelScreenshot() }
    }

    private func cancelScreenshot() {
        #if os(macOS)
        ComposerMedia.cancelScreenshot()
        #endif
    }

    private var attachmentPreview: some View {
        ConversationAttachmentPreview(file: previewFile, name: artifactPreviewName ?? previewReference?.name ?? "附件",
            contentType: artifactPreviewType ?? previewReference?.contentType ?? "application/octet-stream", loading: previewBusy,
            error: previewError, close: closePreview)
    }
    private func closePreview() {
        previewWorker?.cancel(); previewWorker = nil; showingPreview = false
        artifactPreviewName = nil; artifactPreviewType = nil
        previewReference = nil; previewFile = nil; previewError = nil; previewBusy = false
        if let previewDirectory { try? FileManager.default.removeItem(at: previewDirectory) }; previewDirectory = nil
    }
    private func openAttachment(_ reference: ConversationAttachmentReference) {
        draftFocused=false; dismissPhonePreviewKeyboard()
        closePreview(); previewReference = reference; showingPreview = true; previewBusy = true
        let epoch = model.accountEpoch
        previewWorker = Task {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-preview-" + UUID().uuidString)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let file = folder.appendingPathComponent(reference.name)
                try await reference.download(using: model.assistantClient, to: file)
                guard !Task.isCancelled, model.accountEpoch == epoch, previewReference == reference else {
                    try? FileManager.default.removeItem(at: folder); return
                }
                previewDirectory = folder; previewFile = file; previewBusy = false
            } catch {
                try? FileManager.default.removeItem(at: folder)
                guard !Task.isCancelled, model.accountEpoch == epoch, previewReference == reference else { return }
                previewError = "附件未下载，请关闭后重试。"; previewBusy = false
            }
        }
    }

    private func openArtifact(_ event: TimelineEvent) {
        guard let id = event.data["artifactId"]?.string else { return }
        endDraftFocus(); closePreview()
        resources.open(.output(id, event.data["fileName"]?.string ?? "成果"))
    }

    private var conversationContent: some View {
        VStack(spacing: AppleTokens.Space.p0) {
        #if os(iOS)
        PhoneChatHeader(title: PhonePresentation.title(main: false, conversation: conversation.title), status: model.phoneConnectionStatus) {
            Menu {
                Button { showingUsage = true } label: { Label("本对话用量", image: "wm-chart") }.accessibilityIdentifier("conversationUsage")
                Button { endDraftFocus(); resources.showingList = true; resources.visible = true } label: { Label("输出与来源", image: "wm-outputs") }.accessibilityIdentifier("openConversationResources")
                Button { Task { await model.open(conversation) } } label: { Label("刷新记录", image: "wm-sync") }.disabled(model.historyBusy)
                SessionActions(app: model, conversation: conversation)
            } label: { WeftIcon("more").phoneMenuLabel(circle: true) }.accessibilityLabel("对话菜单").accessibilityIdentifier("conversationMenu")
        }
        #endif
        ScrollViewReader { proxy in
            VStack(spacing:AppleTokens.Space.p0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: AppleTokens.Space.p22) {
                    SideChatSourceView(app: model, conversation: conversation)
                    if !conversation.temporaryState.notice().isEmpty { Text(conversation.temporaryState.notice()).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("temporaryChat.title") }

                    if model.timeline.hasOlder {
                        Button(model.olderBusy ? "正在读取…" : "读取更早的记录") {
                            // Keep the current named record in view when earlier history is prepended.
                            Task { await readOlder(proxy: proxy) }
                        }.disabled(model.olderBusy).accessibilityIdentifier("loadOlderTimeline")
                        .id("older")
                    }
                    if let cachedAt = model.historyCachedAt {
                        Text("离线记录 · \(DeviceDateText.timestamp(cachedAt))，等待核对最新状态。")
                            .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                            .accessibilityIdentifier("cachedHistoryNotice")
                    }
                    if model.historyBusy && model.messages.isEmpty {
                        HStack(spacing: AppleTokens.Space.p10) {
                            ProgressView().controlSize(.small)
                            Text("正在读取…").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                        }.padding(.vertical, AppleTokens.Space.p24).frame(maxWidth: .infinity)
                    }
                    if let error = model.historyError {
                        InlineNotice(message: error, isError: true)
                        Button("重新读取") { Task { await model.open(conversation) } }
                            .buttonStyle(OutlineActionStyle())
                    }
                    if !model.historyBusy && model.messages.isEmpty {
                        EmptyState(symbol: "chat", title: "还没有消息",
                                   message: "说说你想完成什么。")
                            .frame(minHeight: 240)
                    }
                    if model.tasksAvailable(conversation), let sessionID = conversation.sessionId ?? model.taskSessionID(for: conversation, accountEpoch: model.accountEpoch) {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p22) {
                        ConversationTimelineView(appModel: model, conversation: conversation, sessionID: sessionID, interactions: interactions, openAttachment: openAttachment, openArtifact: openArtifact, openMemory: { event in
                            endDraftFocus(); closePreview(); resources.open(.memory(event.seq, UsedMemory.references(in: event)))
                        }, openSources: { resources.visible = true; resources.showingList = true },onDecisionPosition:trackPhonePosition)
                            .id(sessionID + model.accountEpoch.uuidString)
                        }
                    } else {
                        ForEach(model.messages) { message in
                            MessageView(model: model, message: message, openAttachment: openAttachment).id(message.id)
                        }
                    }
                    optimisticMessages
                    if ConversationProcessing.visible(events: model.timeline.events, running: conversation.running, phase: conversation.processing?.phase) {
                        TimelineView(.periodic(from: waitingSince, by: 1)) { clock in
                            Text((conversation.processing ?? .init(phase: "waiting")).label + " · \(max(0, Int(clock.date.timeIntervalSince(waitingSince)))) 秒")
                                .font(AppleTokens.Fonts.body).foregroundStyle(Weave.muted).accessibilityIdentifier("processingLine")
                        }
                    }
                    #if os(iOS)
                    if !model.timeline.events.contains(where: { $0.type.hasPrefix("approval.") || $0.type.hasPrefix("question.") }) { PhonePendingDecision(model:interactions,events:model.timeline.events).id("phone.pendingDecision")
                        .background(MainChatEventPosition(eventID:"phone.pendingDecision",onPosition:trackPhonePosition)) }
                    #endif
                    commandStatusCards
                    adoptionStatusCards
                    AppleTokens.Colors.clear.frame(height: 1).id("latest")
                        .background(MainChatEventPosition(eventID:"phone.end",onPosition:trackPhonePosition))
                }
                .background(MainChatEventPosition(eventID: "conversation-content") { _, rect, height, _ in
                    guard let rect, contentHeight != rect.height || viewportHeight != height else { return }
                    contentHeight = rect.height; viewportHeight = height
                    if follow.contentChanged() { proxy.scrollTo("latest", anchor: .bottom) }
                })
                .scrollTargetLayout()
                .padding(.horizontal, AppleTokens.Space.p24).padding(.vertical, AppleTokens.Space.p26)
                .frame(maxWidth: 760).frame(maxWidth: .infinity)
            }
              .modifier(ConversationScrollTracking(visibleID: $visibleMessageID, follow: $follow))
        .onChange(of: model.subtaskStepTarget) { _, seq in
            if let seq, let entry = TimelineProjection.conversationEntries(model.timeline.events).first(where: { $0.steps.contains { $0.seq == seq } }) { proxy.scrollTo(entry.id, anchor: .center) }
        }
            .onChange(of: model.preparingMessages) { _, _ in if follow.contentChanged() { proxy.scrollTo("latest", anchor: .bottom) } }
            .onChange(of: conversation.processing) { _, _ in waitingSince = Date() }
            #if os(macOS)
            .overlay(alignment: .bottomTrailing) {
                if !follow.following {
                    Button { follow.returnToBottom(); proxy.scrollTo("latest", anchor: .bottom) } label: {
                        #if os(iOS)
                        WeftIcon("chevron")
                        #else
                        Text(follow.hasNewContent ? "有新内容 · 回到底部" : "回到底部")
                        #endif
                    }.accessibilityLabel(follow.hasNewContent ? "有新内容 · 回到底部" : "回到底部")
                        .buttonStyle(OutlineActionStyle()).phoneIcon().padding(AppleTokens.Space.p12).accessibilityIdentifier("returnToBottom")
                }
            }
            #endif
            #if os(iOS)
            .onChange(of:latestJump) { _,_ in follow.returnToBottom(); proxy.scrollTo("latest",anchor:.bottom) }
            .onChange(of:viewportHeight) { _,_ in if follow.following { proxy.scrollTo("latest",anchor:.bottom) } }
            .simultaneousGesture(DragGesture().onChanged { value in
                if value.translation.height > 0 { follow.userScrolled(distanceFromBottom: 49) }
            })
            .overlay(alignment: .bottom) {
                if !follow.following && !atBottom {
                    PhoneLatestReplyButton { draftFocused=false; latestJump += 1 }.accessibilityIdentifier("returnToBottom")
                }
            }
            #endif
            .onChange(of: model.sourceMessageTarget) { _, seq in
                if let seq { follow.userScrolled(distanceFromBottom: 100); proxy.scrollTo("event-\(seq)", anchor: .center) }
            }
            .onChange(of: visibleMessageID) { _, value in
                if value == "older", !model.olderBusy, !model.historyBusy { Task { await readOlder(proxy: proxy) } }
            }
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            #if os(macOS)
            .safeAreaInset(edge: .bottom, spacing: AppleTokens.Space.p0) { composer.id(composerIdentity) }
            #endif
            #if DEBUG
            .onChange(of: model.timeline.events.count) { _, _ in
                let args = ProcessInfo.processInfo.arguments
                if args.contains("--ui-testing"), !args.contains("--a8-flow"), let index = args.firstIndex(of: "--a5-review-scene"), args.indices.contains(index + 1) {
                    let type = args[index + 1] == "approval" ? "approval.requested" : args[index + 1] == "question" ? "question.asked" : "step.started"
                    if let entry = TimelineProjection.entries(model.timeline.events).first(where: { $0.event.type == type || (type == "step.started" && !$0.steps.isEmpty) }) {
                        proxy.scrollTo(entry.id, anchor: .top)
                    }
                }
            }
            #endif
            .onChange(of: model.timeline.events.last?.seq) { _, _ in
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--ui-testing") && ProcessInfo.processInfo.arguments.contains("--a5-review-scene") && !ProcessInfo.processInfo.arguments.contains("--a8-flow") { return }
                #endif
                previousTailID = TimelineProjection.entries(model.timeline.events).last?.id ?? model.messages.last?.id
                if follow.contentChanged() { proxy.scrollTo("latest", anchor: .bottom) }
            }
            }
        }
        }
        .background(Weave.canvas)
        #if os(iOS)
        .safeAreaInset(edge: .bottom, spacing: 0) { composer.id(composerIdentity) }
        .environment(\.phoneWorkApp,model)
        #endif
        .navigationTitle(conversation.temporaryState.notice().isEmpty ? (conversation.title.isEmpty ? "对话" : conversation.title) : "临时对话")
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        #if os(macOS)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                #if os(macOS)
                MacSessionMenuButton(app: model, conversation: conversation) {
                    model.settingsRoute = .usage(sessionID: conversation.sessionId); openWindow(id: "settings")
                }.frame(width: AppleTokens.Space.p32, height: AppleTokens.Space.p28)
                #else
                Menu {
                    Section {
                        Button { showingUsage = true } label: { Label("本对话用量", image: "wm-chart") }
                            .accessibilityIdentifier("conversationUsage")
                    }
                    SessionActions(app: model, conversation: conversation)
                } label: { WeftIcon("more") }
                    .accessibilityLabel("对话菜单").accessibilityIdentifier("conversationMenu")
                #endif
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    endDraftFocus()
                        #if os(iOS)
                        resources.showingList = true; resources.visible = true
                        #else
                        resourcePopover = true
                        #endif
                    } label: { WeftIcon("outputs") }
                    .accessibilityLabel("输出与来源")
                    .accessibilityIdentifier("openConversationResources")
                    #if os(macOS)
                    .popover(isPresented: $resourcePopover) {
                        ConversationResourceList(resources: resources,
                            memories: model.timeline.events.filter { !UsedMemory.references(in: $0).isEmpty }, onOpen: { resourcePopover = false })
                    }
                    #endif
            }
            #if os(iOS)
            ToolbarItem(placement: .primaryAction) {
                PhoneAccountMenu(model: model)
            }
            #endif
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await model.open(conversation) }
                } label: { WeftLabel("刷新记录", icon: "sync") }
                .disabled(model.historyBusy)
                .accessibilityIdentifier("refreshHistoryButton")
            }
        }
        #endif
        .task(id: conversation.id) {
            await model.open(conversation)
            await model.refreshThinking(conversation)
            #if DEBUG
            let args = ProcessInfo.processInfo.arguments
            if args.contains("--ui-testing"), let index = args.firstIndex(of: "--a5-review-scene"), args.indices.contains(index + 1) {
                if args[index + 1] == "composer-context" { contextPopover = true }
                if args[index + 1] == "a9-send" { model.setDraft("合成待发送消息", for: conversation, accountEpoch: model.accountEpoch) }
                if args[index + 1] == "outputs-sources" { resources.showingList = true; resources.visible = true }
                if args[index + 1] == "session-menu" {
                    #if os(macOS)
                    Task { try? await Task.sleep(for: .milliseconds(600)); try? await A10MacReview.press("conversationMenu") }
                    #endif
                }
                if args[index + 1] == "conversation-forget" { model.askToDelete(conversation); await model.setConversationForget(true) }
            }
            #endif
        }
        .task(id: "\(scenePhase)|\(model.historyBusy)") {
            guard scenePhase == .active, !model.historyBusy else { return }
            await model.pollTimeline(conversation)
        }
        // End this view's keyboard focus when navigating away. Retaining the old responder
        // can restore the keyboard without the safe-area composer after a task detail returns.
        .onDisappear { endDraftFocus(); composerIdentity = UUID() }
        .onAppear { endDraftFocus() }
        .onChange(of: conversation.id) { _, _ in
            previousTailID = nil; visibleMessageID = nil; follow.returnToBottom(); waitingSince = Date()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversationDetail")
    }

    private func readOlder(proxy: ScrollViewProxy) async {
        let epoch = model.accountEpoch
        let anchor = visibleMessageID == "older" ? TimelineProjection.entries(model.timeline.events).first?.id : visibleMessageID
        await model.loadOlder(conversation)
        guard model.accountEpoch == epoch, model.selectedConversation?.id == conversation.id else { return }
        if let anchor { proxy.scrollTo(anchor, anchor: .top) }
    }

    private func endDraftFocus() {
        draftFocused = false
        #if os(iOS)
        // Navigation can restore UIKit's old responder after SwiftUI's focus binding cleared.
        // Resign it as the conversation reappears so the composer and keyboard agree.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        #endif
    }

    private var optimisticMessages: some View {
        VStack(alignment: .trailing, spacing: AppleTokens.Space.p12) {
            if let message = model.preparingMessages[AppleAppModel.draftKey(for: conversation)] {
                MessageView(model: model, message: message, openAttachment: openAttachment).opacity(AppleTokens.Opacity.disabled)
                Text("发送中").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }
            ForEach(model.optimisticRows(for: conversation)) { row in
                OptimisticMessageRow(model: model, row: row, openAttachment: openAttachment)
            }
        }.accessibilityIdentifier("optimisticMessages")
    }

    private var commandStatusCards: some View {
        let accountEpoch = model.accountEpoch
        let key = AppleAppModel.draftKey(for: conversation)
        let rows = model.commandStatusRows(for: conversation).filter { $0.observationPaused || $0.lookupNotFound }
        return ForEach(rows) { row in
            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                HStack {
                    Text(row.status).font(AppleTokens.Fonts.caption.weight(.semibold))
                    if model.reconcilingRequests.contains(row.id) { ProgressView().controlSize(.small) }
                }
                if row.progress == nil || row.progress == .pending || row.progress == .accepted || row.progress == .unknown {
                    Text(row.record.intent.text ?? "").font(AppleTokens.Fonts.caption).lineLimit(4).textSelection(.enabled)
                }
                if let note = row.note {
                    Text(note).font(AppleTokens.Fonts.caption).fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                        Button("重新确认") {
                        Task { await model.reconcileSavedRequest(row.id, accountEpoch: accountEpoch) }
                    }.disabled(model.reconcilingRequests.contains(row.id))
                    if row.lookupNotFound {
                            Button("继续发送") {
                            Task { await model.continueSavedRequest(row.id, accountEpoch: accountEpoch) }
                        }.disabled(model.reconcilingRequests.contains(row.id) || model.sendTargets[key] == nil)
                    }
                }.buttonStyle(OutlineActionStyle()).font(AppleTokens.Fonts.caption)
            }
            .padding(AppleTokens.Space.p12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
            .foregroundStyle(Weave.secondary)
            .accessibilityIdentifier("commandStatus.\(row.id)")
        }
    }

    private func editQueued(_ task:QueuedTask) async {
        let epoch=model.accountEpoch,key=AppleAppModel.draftKey(for:conversation)
        guard draft.wrappedValue.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,(model.attachmentDrafts[key] ?? []).isEmpty else {
            model.queueNotice="先发送或清空当前草稿，再修改排队消息。"; return
        }
        await model.cancelQueued(task,conversation:conversation)
        guard model.accountEpoch == epoch,model.queueNotice == nil,!model.queuedTasks(for:conversation).contains(where:{$0.id == task.id}) else { return }
        if draft.wrappedValue.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,(model.attachmentDrafts[key] ?? []).isEmpty {
            draft.wrappedValue=task.text; queueOpen=false
        } else { model.queueNotice="已经撤回。当前草稿保留，原消息："+task.text }
    }

    private var composerTools: some View {
        let accountEpoch=model.accountEpoch
        let key=AppleAppModel.draftKey(for:conversation)
        return
                HStack(spacing: AppleTokens.Space.p4) {
                    Menu {
                        if model.mainChat.capabilities.supports("sideChats") {
                            Button("开旁聊", image: ImageResource(name: "wm-chat", bundle: .main)) { Task { await model.mainChat.createSide(sourceConversation: conversation) } }
                                .disabled(conversation.temporaryState.hasTemporaryContent)
                        }
                        if model.mainChat.capabilities.supports("temporaryChats") {
                            Toggle(isOn: Binding(get: { conversation.temporaryState.memoryMode == "off" }, set: { enabled in
                                Task {
                                    if enabled { await model.mainChat.createSide(temporary: true, sourceConversation: conversation) }
                                    else { await model.mainChat.temporarySetting(conversation, fields: ["memoryMode": .string("on")]) }
                                }
                            })) { Label("这次别记", image: "wm-memory") }
                        }
                        #if os(macOS)
                        Button("添加文件", image: ImageResource(name: "wm-file", bundle: .main)) { importScope = model.uxScope; importingAttachments = true }.accessibilityIdentifier("composer.file")
                        Button("区域截图", image: ImageResource(name: "wm-desktop", bundle: .main)) { addNativeMedia(screenshot: true) }.accessibilityIdentifier("composer.screenshot")
                        Button("粘贴剪贴板图片", image: ImageResource(name: "wm-copy", bundle: .main)) { addNativeMedia(screenshot: false) }.accessibilityIdentifier("composer.clipboard")
                        #else
                        Button("相机", image: ImageResource(name: "wm-camera", bundle: .main)) {
                            importScope = model.uxScope
                            if UIImagePickerController.isSourceTypeAvailable(.camera) { showingCamera = true }
                            else { attachmentInputError = "相机暂不可用，可从照片或文件添加。" }
                        }.accessibilityIdentifier("composer.camera")
                        Button("照片", image: ImageResource(name: "wm-image", bundle: .main)) { importScope = model.uxScope; showingPhotos = true }.accessibilityIdentifier("composer.photos")
                        Button("文件", image: ImageResource(name: "wm-file", bundle: .main)) { importScope = model.uxScope; importingAttachments = true }.accessibilityIdentifier("composer.file")
                        if let usage=conversation.contextUsage {
                            Button(usage.label) { contextPopover=true }.accessibilityIdentifier("contextUsage")
                        }
                        #endif
                        #if DEBUG
                        if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--a15-synthetic-media") {
                            Button("添加合成文件", image: ImageResource(name: "wm-file", bundle: .main)) {
                                let scope = model.uxScope
                                if let file = try? AppleContractUIFixture.selectedFile() { Task { await model.addAttachments([file], to: conversation, accountEpoch: scope.epoch) } }
                            }.accessibilityIdentifier("composer.syntheticFile")
                        }
                        #endif
                        if model.thinking.confirmed?.supported == true {
                            Toggle(isOn: Binding(get: { model.thinking.confirmed?.enabled == true }, set: { value in
                                Task { await model.refreshThinking(conversation, enabled: value) }
                            })) { Label("深入思考", image: "wm-model") }
                                .disabled(model.thinking.pending).accessibilityValue(model.thinking.confirmed?.enabled == true ? "已开启" : "已关闭")
                                .accessibilityIdentifier("composer.thinking")
                        }
                    } label: { WeftIcon("plus").frame(width: 44, height: 44).phoneMenuLabel(circle: true, onCard: true) }
                    #if os(macOS)
                    .menuIndicator(.hidden).menuStyle(.borderlessButton)
                    #endif
                    .phoneIcon().phoneComposerControl(circle: true).disabled(!model.canAddAttachments(conversation)).accessibilityLabel("添加附件")
                    .accessibilityIdentifier("addAttachmentButton")
                    #if os(iOS)
                    .phonePopover(isPresented:$contextPopover) { if let usage=conversation.contextUsage { Text(usage.label).padding(AppleTokens.Space.p16) } }
                    #endif
                    if !dynamicTypeSize.isAccessibilitySize { composerApprovalMode(accountEpoch: accountEpoch) }
                    if model.loadingAttachments.contains(key) { ProgressView().controlSize(.small) }
                    Spacer(minLength: AppleTokens.Space.p4)
                    #if os(macOS)
                    if let usage = conversation.contextUsage {
                        Button { contextPopover.toggle() } label: {
                            ZStack {
                                Circle().stroke(Weave.line, lineWidth: AppleTokens.Space.p2)
                                if let value = usage.fraction { Circle().trim(from: 0, to: min(1, value)).stroke(usage.warning ? Weave.danger : Weave.muted, style: StrokeStyle(lineWidth: AppleTokens.Space.p2, lineCap: .round)).rotationEffect(.degrees(-90)) }
                            }.frame(width: AppleTokens.Space.p18, height: AppleTokens.Space.p18).frame(minWidth: AppleTokens.Space.p28, minHeight: AppleTokens.Space.p44)
                        }.buttonStyle(.plain).accessibilityLabel(usage.label).accessibilityIdentifier("contextUsage")
                            .help(usage.label).popover(isPresented: $contextPopover) { Text(usage.label).font(AppleTokens.Fonts.caption).padding(AppleTokens.Space.p16).presentationCompactAdaptation(.popover) }
                    }
                    #endif
                    Group {
                    if model.modelServicesSupported == true {
                        ServiceModelMenuButton(services:model.modelServices,current:model.sendTargets[key]?.modelProfileID,label:model.sendTargets[key]?.modelName ?? "当前模型",usesImages:(model.attachmentDrafts[key] ?? []).contains(where: {$0.original.isImage}) || model.messages.contains(where: {!$0.images.isEmpty || $0.originalAttachments.contains(where: \.isImage)}),thinkingSupported:model.modelServices.flatMap(\.models).first(where: {$0.matches(model.sendTargets[key]?.modelProfileID)})?.deepThinking?.supported == true,thinking:Binding(get:{model.thinking.confirmed?.enabled == true},set:{value in Task { await model.refreshThinking(conversation,enabled:value) }}),select:{service,item in Task { await model.chooseServiceModel(service,item,conversation:conversation) }},add:{showingModels=true},refresh:{Task { await model.refreshServiceMenus() }},identifier:"composerModel")
                        if !model.mainChat.capabilities.supports("workAndChat") { ComputerMenuButton(cloud:model.cloudLogin) }

                    } else {
                    Menu {
                        Label(model.sendTargets[key]?.modelName ?? conversation.originalModelLabel ?? "当前模型",systemImage:"checkmark")
                        Button("配置模型") {
                            #if os(macOS)
                            model.settingsRoute = .init(categoryID: "models"); openWindow(id: "settings")
                            #else
                            showingModels = true
                            #endif
                        }
                    } label: {
                        #if os(macOS)
                        Text(model.sendTargets[key]?.modelName ?? "模型").lineLimit(1)
                        #else
                        WeftIcon("model").phoneMenuLabel(circle:true,onCard:true)
                        #endif
                    }
                    #if os(macOS)
                    .menuStyle(.borderlessButton)
                    #endif
                    #if os(iOS)
                    .phoneIcon().phoneComposerControl(circle:true)
                    #endif
                    .font(AppleTokens.Fonts.caption).accessibilityLabel("模型选择，"+(model.sendTargets[key]?.modelName ?? "当前模型")).accessibilityIdentifier("composerModel")
                    }
                    }
                    if showsSmallMic {
                    Button { draftFocused = true; dictationPopover = true } label: { WeftIcon("mic", size: AppleTokens.Space.p16).frame(minWidth: AppleTokens.Space.p28, minHeight: AppleTokens.Space.p44) }
                        .buttonStyle(.plain).phoneIcon(quiet: true).accessibilityLabel("语音输入")
                    }

                    let action = ComposerAction.resolve(running: model.tasksAvailable(conversation) && conversation.running, text: draft.wrappedValue, attachments: !(model.attachmentDrafts[key] ?? []).isEmpty)
                    #if os(iOS)
                    let voice=PhoneComposerPrimaryAction.resolve(running:conversation.running,draft:draft.wrappedValue,attachmentCount:(model.attachmentDrafts[key] ?? []).count) == .voice
                    #else
                    let voice=false
                    #endif
                    Button {
                        if voice { draftFocused=true; dictationPopover=true } else if action == .stop { Task { await model.stopActiveTask() } }
                        else { Task { await model.send(conversation, accountEpoch: accountEpoch) } }
                    } label: { WeftIcon(action == .stop ? "stop" : voice ? "mic" : "send").frame(width: AppleTokens.Space.p20, height: AppleTokens.Space.p44) }
                        .buttonStyle(PrimaryActionStyle(fillsWidth: false)).phoneIcon(primary: true).tint(Weave.accent)
                        .disabled(action == .stop ? model.stoppingActiveTask || model.timelineRootCommands.isEmpty || model.historyCachedAt != nil : !voice && !model.canSend(conversation))
                        .accessibilityLabel(action == .stop ? "停止" : voice ? "语音输入" : conversation.running ? "排队发送" : "发送").accessibilityIdentifier("sendButton")
                        .popover(isPresented:$dictationPopover) { Text("使用系统听写输入文字").font(AppleTokens.Fonts.caption).padding(AppleTokens.Space.p16).presentationCompactAdaptation(.popover) }
                    #if os(macOS)
                    if model.tasksAvailable(conversation) { Button("停止") { Task { await model.stopActiveTask() } }.keyboardShortcut(.escape, modifiers: []).hidden().frame(width: 0, height: 0) }
                    #endif
                }
    }
    private var showsSmallMic: Bool {
        #if os(iOS)
        false
        #else
        true
        #endif
    }
    private var pendingDecisionID: String? { interactions.pendingApprovals.first?.id ?? interactions.pendingQuestions.first?.id }
    private func trackPhonePosition(_ id: String,_ frame: CGRect?,_ height: CGFloat,_ userScrolling: Bool) {
        #if os(iOS)
        phonePositions.frames[id]=frame
        let actualHeight=height>0 ? height : viewportHeight
        if actualHeight != viewportHeight { viewportHeight=actualHeight }
        let end=phonePositions.frames["phone.end"]
        let distance=end.map { max(0,$0.maxY-actualHeight) } ?? .greatestFiniteMagnitude
        if id == "phone.end",userScrolling,let top=end?.minY,let before=phonePositions.previousEndTop {
            if top > before { follow.userScrolled(distanceFromBottom:49) }
            else if top < before { follow.userScrolled(distanceFromBottom:Double(distance)) }
        }
        if id == "phone.end" { phonePositions.previousEndTop=end?.minY }
        if atBottom != (distance <= 48) { atBottom=distance <= 48 }
        if let first=phonePositions.frames.filter({ $0.key != "phone.end" && $0.value.maxY > 0 && $0.value.minY < actualHeight }).min(by:{ $0.value.minY < $1.value.minY }),visibleMessageID != first.key { visibleMessageID=first.key }
        #endif
    }
    private var phoneDraftInput: some View {
        TextField(conversation.running ? (model.runningMessageMode == .queue ? "排队到下一条…" : "引导当前回复…") : "向 WeftMate 说说你的目标",
            text: draft, axis: .vertical)
            .lineLimit(1...5).textFieldStyle(.plain).font(AppleTokens.Fonts.body)
            .focused($draftFocused).disabled(!model.canEditDraft(for: conversation)).accessibilityIdentifier("conversationDraft")
    }
    private var composer: some View {
        let accountEpoch = model.accountEpoch
        let key = AppleAppModel.draftKey(for: conversation)
        return VStack(alignment: .leading, spacing: AppleTokens.Space.p9) {
            if conversation.archived {
                HStack { Text("已归档，恢复后可以发送消息"); Button("恢复对话") { Task { await model.archive(conversation, archived: false) } } }
                    .font(AppleTokens.Fonts.callout)
            }
            let queued = model.queuedTasks(for: conversation)
            #if os(iOS)
            if model.tasksAvailable(conversation), !queued.isEmpty {
                Button("\(queued.count) 条消息排队中") { draftFocused=false; queueOpen=true }
                    .font(AppleTokens.Fonts.caption).accessibilityIdentifier("conversation.queue")
                    .sheet(isPresented:$queueOpen) {
                        ScrollView {
                            VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                                ForEach(model.queuedTasks(for:conversation)) { task in
                                    VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                                        Text(task.text).fixedSize(horizontal:false,vertical:true)
                                        HStack {
                                            Button("修改") { Task { await editQueued(task) } }
                                            Spacer()
                                            Button("撤回",role:.destructive) { Task { await model.cancelQueued(task,conversation:conversation) } }
                                        }.frame(minHeight:AppleTokens.Space.p44)
                                    }.disabled(model.queueBusy.contains(task.id) || model.historyCachedAt != nil)
                                        .accessibilityIdentifier("queuedTask."+task.id)
                                    Divider()
                                }
                                if let notice=model.queueNotice { Text(notice).foregroundStyle(Weave.muted) }
                            }.padding(AppleTokens.Phone.pageInset)
                        }.phoneSheet("排队消息",close:{queueOpen=false})
                    }
            }
            #else
            if model.tasksAvailable(conversation), !queued.isEmpty {
                DisclosureGroup("\(queued.count) 个排队中") {
                    ScrollView {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p10) {
                            ForEach(queued) { task in
                                HStack {
                                    Text(task.text).font(AppleTokens.Fonts.callout).lineLimit(3)
                                    Spacer()
                                    Button("编辑后重排") { Task { await model.cancelQueued(task, conversation: conversation, edit: true) } }
                                        .accessibilityLabel("编辑排队任务 " + task.text)
                                    Button("取消") { Task { await model.cancelQueued(task, conversation: conversation) } }
                                        .accessibilityLabel("取消排队任务 " + task.text)
                                }.disabled(model.queueBusy.contains(task.id) || model.historyCachedAt != nil)
                                    .accessibilityIdentifier("queuedTask.\(task.id)")
                            }
                        }
                    }.frame(maxHeight: 180)
                }.font(AppleTokens.Fonts.caption)
            }
            #endif
            if let notice = model.queueNotice { Text(notice).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            let subtasks = ComposerSubtasks.merge(model.timeline.events)
            if subtasks.contains(where: { $0.state == "running" }) {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                    Button { expandedSubtasks.toggle() } label: {
                        WeftLabel("\(subtasks.count) 个子任务", icon: expandedSubtasks ? "collapse" : "right", size: 16)
                            .frame(minHeight: AppleTokens.Space.p44).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("composerSubtasks")
                        .accessibilityValue(expandedSubtasks ? "已展开" : "已收起")
                    if expandedSubtasks {
                        ScrollView {
                            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                                ForEach(subtasks, id: \.stepSeq) { row in
                                    Button { model.subtaskStepTarget = row.stepSeq } label: {
                                        HStack { Text(row.name); Spacer(); Text(row.stateLabel); TimelineView(.periodic(from: Date(), by: 1)) { clock in Text(row.duration(at: clock.date)).foregroundStyle(Weave.muted) } }
                                        .frame(minHeight: AppleTokens.Space.p44).contentShape(Rectangle())
                                    }.buttonStyle(.plain).accessibilityIdentifier("subtask." + row.id)
                                }
                            }
                        }.frame(maxHeight: AppleTokens.Space.p28 * 6)
                    }
                }.font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }
            if model.thinking.confirmed?.enabled == true {
                WeftLabel("深入思考已开启", icon: "model", size: 16).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("thinkingMarker")
            }
            if let error = model.thinkingError { Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger) }
            if model.tasksAvailable(conversation) {
                #if os(iOS)
                PhonePendingDecisionNotice(model:interactions,events:model.timeline.events) { draftFocused=false }
                #else
                ConversationApprovalBar(model: interactions, events: model.timeline.events,computerName:model.cloudLogin.computerName(model.session?.hostId))
                #endif
            }
            else { Text(ProjectPresentation.restrictedNotice).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("restrictedSessionNotice") }
            #if os(iOS)
            if model.mainChat.capabilities.supports("workAndChat"), WorkAndChat.mode(conversation) == .work { PhoneWorkDirectoryLine(app: model, row: conversation) }
            #endif
            if let notice = conversation.projectNotice ?? model.sessionProjectNotices[conversation.id] ?? conversation.projectName.map({ "项目：" + $0 }) {
                Text(notice).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("projectNotice")
            }
            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                #if os(iOS)
                if let files=model.attachmentDrafts[key],!files.isEmpty {
                    ScrollView(.horizontal) { HStack(alignment:.top,spacing:AppleTokens.Space.p8) {
                        ForEach(files) { file in PhoneAttachmentBlock(name:file.original.name,image:file.display,isImage:file.original.isImage,status:model.preparingConversations.contains(key) ? "正在发送…" : attachmentInputError == nil ? nil : "发送未完成",remove:{ model.removeAttachment(file.id,from:conversation,accountEpoch:accountEpoch) }) }
                    } }.scrollIndicators(.hidden).accessibilityIdentifier("sideChat.attachmentBlocks")
                }
                phoneDraftInput.frame(minHeight:AppleTokens.Space.p44)
                #else
                HStack(alignment: .top, spacing: AppleTokens.Space.p8) {
                TextField(conversation.running ? (model.runningMessageMode == .queue ? "排队到下一条…" : "引导当前回复…") : "向 WeftMate 说说你的目标", text: draft, axis: .vertical)
                    .lineLimit(2...6).textFieldStyle(.plain).font(AppleTokens.Fonts.body)
                    .focused($draftFocused).padding(.horizontal, AppleTokens.Space.p9).padding(.top, AppleTokens.Space.p7)
                    .disabled(!model.canEditDraft(for: conversation))
                    .accessibilityIdentifier("conversationDraft")
                    .onSubmit { Task { await model.send(conversation, accountEpoch: accountEpoch) } }
                    #if os(macOS)
                    .onKeyPress(.return, phases: .down) { press in
                        if press.modifiers.contains(.shift) { return .ignored }
                        Task { await model.send(conversation, accountEpoch: accountEpoch) }
                        return .handled
                    }
                    #endif
                #if os(iOS)
                    if let usage = conversation.contextUsage {
                        Button { contextPopover.toggle() } label: {
                            ZStack {
                                Circle().stroke(Weave.line, lineWidth: AppleTokens.Space.p2)
                                if let value = usage.fraction { Circle().trim(from: 0, to: min(1, value)).stroke(usage.warning ? Weave.danger : Weave.muted, style: StrokeStyle(lineWidth: AppleTokens.Space.p2, lineCap: .round)).rotationEffect(.degrees(-90)) }
                            }.frame(width: AppleTokens.Space.p18, height: AppleTokens.Space.p18).phoneMenuLabel(circle: true, onCard: true)
                        }.buttonStyle(.plain).phoneIcon(quiet: true).accessibilityLabel(usage.label).accessibilityIdentifier("contextUsage")
                            .help(usage.label).popover(isPresented: $contextPopover) { Text(usage.label).font(AppleTokens.Fonts.caption).padding(AppleTokens.Space.p16).presentationCompactAdaptation(.popover) }
                    }
                #endif
                }
                #endif
                #if os(macOS)
                if let files = model.attachmentDrafts[key], !files.isEmpty {
                    ScrollView(.horizontal) {
                        HStack(spacing: AppleTokens.Space.p10) {
                            ForEach(files) { file in
                                VStack(spacing: AppleTokens.Space.p4) {
                                    AttachmentThumbnail(file: file.display, isImage: file.original.isImage)
                                    Text(file.original.name).font(AppleTokens.Fonts.caption).lineLimit(1).frame(width: 90)
                                    Button("移除") { model.removeAttachment(file.id, from: conversation, accountEpoch: accountEpoch) }
                                        .font(AppleTokens.Fonts.caption).disabled(model.preparingConversations.contains(key))
                                }
                            }
                        }
                    }
                }
                #endif
                if dynamicTypeSize.isAccessibilitySize {
                    composerApprovalMode(accountEpoch: accountEpoch)
                }
                composerTools
            }
            #if os(iOS)
            .phoneChatComposer()
            .accessibilityElement(children:.contain).accessibilityIdentifier("sideChat.composer")
            .accessibilityValue("输入区最多五行")
            #else
            .padding(AppleTokens.Space.p9)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r16))
            .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r16).strokeBorder(Weave.line))
            #endif

            if !conversation.temporaryState.notice().isEmpty { Text(conversation.temporaryState.notice()).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("temporaryChat.composer") }
            if let attachmentInputError { Text(attachmentInputError).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger) }
            if let error = model.draftError {
                InlineNotice(message: error, isError: true).accessibilityIdentifier("draftStorageError")
            }
            if let error = model.cacheError {
                Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let notice = model.continuationNotices[key] {
                Text(notice).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let choice = model.modelsToConfirm[key] {
                Button("确认使用会话已绑定的模型：\(choice.name)") {
                    Task { await model.confirmBoundModel(for: conversation, accountEpoch: accountEpoch) }
                }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("confirmBoundModelButton")
            }
            if let choices = model.adoptionChoices[key], !choices.isEmpty {
                Menu("选择模型并接通原会话") {
                    ForEach(choices) { choice in
                        Button("\(choice.name) · \(choice.model)") {
                            if model.adoptionNeedsConfirmation(conversation) {
                                pendingAdoptionProfile = choice.id; confirmingLocalTurn = true
                            } else {
                                Task { await model.adopt(conversation, profileID: choice.id, accountEpoch: accountEpoch) }
                            }
                        }
                    }
                }
                .disabled(!model.canAdopt(conversation))
                .accessibilityIdentifier("chooseAdoptionModelButton")
            }
            if let error = model.adoptionError {
                Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard model.canAddAttachments(conversation) else { return false }
            Task { await model.addAttachments(urls, to: conversation, accountEpoch: accountEpoch) }; return true
        }
        .padding(.horizontal, AppleTokens.Space.p20).padding(.top, AppleTokens.Space.p12).padding(.bottom, AppleTokens.Space.p12)
        .frame(maxWidth: 792).frame(maxWidth: .infinity)
        .background(Weave.surface)
    }

    @ViewBuilder private func composerApprovalMode(accountEpoch: UUID) -> some View {
        if model.tasksAvailable(conversation), let sessionID = conversation.sessionId ?? model.taskSessionID(for: conversation, accountEpoch: accountEpoch) {
            ApprovalModeControl(model: model, sessionID: sessionID, compact: true).id(sessionID + accountEpoch.uuidString)
        }
    }

    #if os(macOS)
    private func addNativeMedia(screenshot: Bool) {
        let scope = model.uxScope
        Task {
            do {
                let file = try await (screenshot ? ComposerMedia.screenshot() : ComposerMedia.clipboardImage())
                guard let file else { if !screenshot, scope == model.uxScope { attachmentInputError = "剪贴板中没有图片。" }; return }
                defer { try? FileManager.default.removeItem(at: file) }
                guard scope == model.uxScope else { return }
                await model.addAttachments([file], to: conversation, accountEpoch: scope.epoch)
            } catch { if scope == model.uxScope { attachmentInputError = "图片未添加，请重试。" } }
        }
    }
    #endif

    private var adoptionStatusCards: some View {
        let accountEpoch = model.accountEpoch
        return ForEach(model.adoptionRows(for: conversation)) { row in
            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                HStack {
                    Text(row.status).font(AppleTokens.Fonts.caption.weight(.semibold))
                    if model.adoptingRequests.contains(row.id) { ProgressView().controlSize(.small) }
                }
                if let note = row.note { Text(note).font(AppleTokens.Fonts.caption).fixedSize(horizontal: false, vertical: true) }
                if row.record.receipt?.projection.binding?.truncated == true {
                    Text("采用的原上下文有截断，原始记录仍保留。").font(AppleTokens.Fonts.caption)
                }
                if let count = row.record.receipt?.projection.binding?.omittedImages, count > 0 {
                    Text("采用上下文未包含 \(count) 张图片。").font(AppleTokens.Fonts.caption)
                }
                HStack {
                    Button("重新确认接通") {
                        Task { await model.reconcileAdoptionRequest(row.id, accountEpoch: accountEpoch) }
                    }.disabled(model.adoptingRequests.contains(row.id))
                    if row.lookupNotFound {
                        Button("继续接通") {
                            Task { await model.continueAdoptionRequest(row.id, accountEpoch: accountEpoch) }
                        }.disabled(model.adoptingRequests.contains(row.id))
                    }
                }.buttonStyle(OutlineActionStyle()).font(AppleTokens.Fonts.caption)
            }
            .padding(AppleTokens.Space.p12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
            .foregroundStyle(Weave.secondary)
            .accessibilityIdentifier("adoptionStatus.\(row.id)")
        }
    }
}

struct MessageView: View {
    @ObservedObject var model: AppleAppModel
    let message: ChatMessage
    let openAttachment: (ConversationAttachmentReference) -> Void
    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: AppleTokens.Space.p7) {
            if message.role == .user {
                if !message.text.isEmpty {
                    HStack {
                        Spacer(minLength: AppleTokens.Space.p32)
                        Text(message.text).textSelection(.enabled).lineSpacing(AppleTokens.Space.p5)
                            .padding(.horizontal, AppleTokens.Space.p16).padding(.vertical, AppleTokens.Space.p12)
                            .background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r19))
                    }
                }
            } else {
                MessageBodyView(text: message.text, messageID: message.id)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            #if os(iOS)
            if !message.originalAttachments.isEmpty || !message.images.isEmpty {
            ScrollView(.horizontal) { HStack(alignment:.top,spacing:AppleTokens.Space.p8) {
            ForEach(message.originalAttachments) { attachment in
                ConversationAttachmentTile(model: model, reference: .original(attachment)) { openAttachment(.original(attachment)) }
            }
            if message.originalAttachments.isEmpty,
               let sessionID = message.id.split(separator: "|").dropFirst().first.map(String.init), message.id.hasPrefix("host|") {
                ForEach(message.images, id: \.attachmentId) { image in
                    ConversationAttachmentTile(model: model, reference: .sessionImage(image, sessionID)) {
                        openAttachment(.sessionImage(image, sessionID))
                    }
                }
            }
            } }.scrollIndicators(.hidden)
            }
            #else
            ForEach(message.originalAttachments) { attachment in
                ConversationAttachmentTile(model: model, reference: .original(attachment)) { openAttachment(.original(attachment)) }
            }
            if message.originalAttachments.isEmpty,
               let sessionID = message.id.split(separator: "|").dropFirst().first.map(String.init), message.id.hasPrefix("host|") {
                ForEach(message.images, id: \.attachmentId) { image in
                    ConversationAttachmentTile(model: model, reference: .sessionImage(image, sessionID)) {
                        openAttachment(.sessionImage(image, sessionID))
                    }
                }
            }
            #endif
            let remainingAttachments = max(0, message.attachmentCount - max(message.originalAttachments.count, message.images.count))
            if remainingAttachments > 0 {
                WeftLabel("\(remainingAttachments) 个附件 · 此版本尚未展开", icon: "attach", size: 16)
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }
            if message.truncated {
                Text("这条记录仅显示部分内容。")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }
            if message.pendingContext {
                Text("已保存记录，尚未进入原模型上下文。")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }
        }
        .font(AppleTokens.Fonts.body).foregroundStyle(Weave.ink)
        .padding(.vertical, AppleTokens.Space.p2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("message.\(message.id)")
        .modifier(MessageActionsPresentation(app: model, id: message.id, text: message.text, at: message.occurredAt,
            user: message.role == .user, enabled: true, latest: model.messages.last?.id == message.id && model.selectedConversation?.running != true, menuID: "message.actions." + message.id,
            quote: {
                if let conversation = model.selectedConversation {
                    model.setDraft(model.draftText(for: conversation, accountEpoch: model.accountEpoch) + "\n> " + message.text.replacingOccurrences(of: "\n", with: "\n> ") + "\n", for: conversation, accountEpoch: model.accountEpoch)
                }
            }, regenerate: { Task { await model.regenerateReply(message) } }, extra: {
                AnyView(Group {
                    if let conversation = model.selectedConversation, model.mainChat.capabilities.supports("sideChats"), !conversation.temporaryState.hasTemporaryContent {
                        Button("开旁聊", image: ImageResource(name: "wm-chat", bundle: .main)) { Task { await model.mainChat.createSideFromMessage(message, conversation: conversation) } }
                    }
                })
            }))
    }
}

/// Track visibility without feeding a changing LazyStack target back into its layout on iOS 18+.
/// Older systems retain their existing position binding.
private struct ConversationScrollTracking: ViewModifier {
    @Binding var visibleID: String?
    @Binding var follow: ConversationFollowState
    @State private var userScrolling = false
    func body(content: Content) -> some View {
        #if os(iOS)
        content
        #else
        if #available(macOS 15, *) {
            content
                .onScrollTargetVisibilityChange(idType: String.self) { @Sendable ids in Task { @MainActor in visibleID = ids.contains("older") ? "older" : ids.contains("latest") ? "latest" : ids.first } }
                .onScrollPhaseChange { @Sendable _, phase in Task { @MainActor in userScrolling = phase == .interacting || phase == .decelerating } }
                .onScrollGeometryChange(for: Double.self) { @Sendable geometry in
                    Double(geometry.contentSize.height + geometry.contentInsets.bottom - geometry.contentOffset.y - geometry.containerSize.height)
                } action: { @Sendable _, distance in Task { @MainActor in if userScrolling { follow.userScrolled(distanceFromBottom: distance) } } }
        } else {
            #if os(iOS)
            content
            #else
            content.scrollPosition(id: $visibleID, anchor: .bottom).onChange(of: visibleID) { _, value in follow.userScrolled(distanceFromBottom: value == "latest" ? 0 : 100) }
            #endif
        }
        #endif
    }
}
