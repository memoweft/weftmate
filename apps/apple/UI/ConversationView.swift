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
        guard !search.isEmpty else { return model.conversations }
        return model.conversations.filter { $0.title.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        Group {
            if let cachedAt = model.conversationsCachedAt {
                Text("本机缓存 · \(cachedAt.formatted(date: .abbreviated, time: .shortened))")
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
        VStack(alignment: .leading, spacing: AppleTokens.Space.p5) {
            HStack(alignment: .firstTextBaseline, spacing: AppleTokens.Space.p8) {
                Text(conversation.title.isEmpty ? "未命名对话" : conversation.title)
                    .font(AppleTokens.Fonts.body.weight(.medium)).foregroundStyle(selected ? Weave.onAccent : Weave.ink).lineLimit(2)
                if conversation.running {
                    Circle().fill(selected ? Weave.onAccent : Weave.status).frame(width: 6, height: 6)
                        .accessibilityLabel("正在处理")
                }
            }
            if conversation.running {
                Text("正在处理").font(AppleTokens.Fonts.caption).foregroundStyle(selected ? Weave.onAccent : Weave.muted)
            }
        }
        .padding(.vertical, AppleTokens.Space.p5)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("conversationRow.\(conversation.id)")
    }
}

struct ConversationView: View {
    @ObservedObject var model: AppleAppModel
    let conversation: ConversationSummary
    @StateObject private var resources: ConversationResourcesModel
    init(model: AppleAppModel, conversation: ConversationSummary) {
        self.model = model; self.conversation = conversation
        _resources = StateObject(wrappedValue: ConversationResourcesModel(app: model,
            sessionID: conversation.sessionId ?? model.taskSessionID(for: conversation, accountEpoch: model.accountEpoch) ?? ""))
    }
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @FocusState private var draftFocused: Bool
    @State private var visibleMessageID: String?
    @State private var previousTailID: String?
    @State private var composerIdentity = UUID()
    @State private var resourcePopover = false
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
        .fileImporter(isPresented: $importingAttachments, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let files) = result {
                let epoch = model.accountEpoch
                Task { await model.addAttachments(files, to: conversation, accountEpoch: epoch) }
            }
        }
        .onChange(of: photoSelection) { _, selection in
            let epoch = model.accountEpoch
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
                    await model.addAttachments(files, to: conversation, accountEpoch: epoch)
                } catch { attachmentInputError = "图片未添加，请重试。" }
            }
        }
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
        .fullScreenCover(isPresented: $showingPreview) { attachmentPreview }
        .fullScreenCover(isPresented: $resources.visible) { ConversationResourcesPanel(app: model, resources: resources) }
        #endif
        .onChange(of: model.accountEpoch) { _, _ in closePreview(); resources.clear(); pendingAdoptionProfile = nil; confirmingLocalTurn = false }
        .onChange(of: conversation.id) { _, _ in closePreview(); resources.clear(); pendingAdoptionProfile = nil; confirmingLocalTurn = false }
        .onChange(of: resources.selected) { _, _ in resourcePopover = false }
        .onDisappear { closePreview() }
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
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: AppleTokens.Space.p22) {
                    if model.timeline.hasOlder {
                        Button(model.olderBusy ? "正在读取…" : "读取更早的记录") {
                            // scrollPosition retains the visible target while records are prepended.
                            Task { await model.loadOlder(conversation) }
                        }.disabled(model.olderBusy).accessibilityIdentifier("loadOlderTimeline")
                        .id("older")
                    }
                    if let cachedAt = model.historyCachedAt {
                        Text("离线记录 · \(cachedAt.formatted(date: .abbreviated, time: .shortened))，等待核对最新状态。")
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
                    if let sessionID = conversation.sessionId ?? model.taskSessionID(for: conversation, accountEpoch: model.accountEpoch) {
                        ConversationTimelineView(appModel: model, conversation: conversation, sessionID: sessionID, openAttachment: openAttachment, openArtifact: openArtifact, openMemory: { event in
                            endDraftFocus(); closePreview(); resources.open(.memory(event.seq, UsedMemory.references(in: event)))
                        }, openSources: { resources.visible = true; resources.showingList = true })
                            .id(sessionID + model.accountEpoch.uuidString)
                    } else {
                        ForEach(model.messages) { message in
                            MessageView(model: model, message: message, openAttachment: openAttachment).id(message.id)
                        }
                    }
                    commandStatusCards
                    adoptionStatusCards
                    AppleTokens.Colors.clear.frame(height: 1).id("latest")
                }
                .scrollTargetLayout()
                .padding(.horizontal, AppleTokens.Space.p24).padding(.vertical, AppleTokens.Space.p26)
                .frame(maxWidth: 760).frame(maxWidth: .infinity)
            }
            .scrollPosition(id: $visibleMessageID, anchor: .bottom)
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .safeAreaInset(edge: .bottom, spacing: AppleTokens.Space.p0) { composer.id(composerIdentity) }
            .onChange(of: model.timeline.events.last?.seq) { _, _ in
                let oldTail = previousTailID
                previousTailID = TimelineProjection.entries(model.timeline.events).last?.id ?? model.messages.last?.id
                // Follow new messages only when already at the end; preserve reading position otherwise.
                if !draftFocused, previousTailID != nil,
                   oldTail == nil || visibleMessageID == "latest" || visibleMessageID == oldTail {
                    proxy.scrollTo("latest", anchor: .bottom)
                }
            }
        }
        .background(Weave.surface)
        .navigationTitle(conversation.title.isEmpty ? "对话" : conversation.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
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
        .task(id: conversation.id) { await model.open(conversation) }
        .task(id: "\(scenePhase)|\(model.historyBusy)") {
            guard scenePhase == .active, !model.historyBusy else { return }
            await model.pollTimeline(conversation)
        }
        .onChange(of: visibleMessageID) { _, value in
            if value == "older", !model.olderBusy { Task { await model.loadOlder(conversation) } }
        }
        // End this view's keyboard focus when navigating away. Retaining the old responder
        // can restore the keyboard without the safe-area composer after a task detail returns.
        .onDisappear { endDraftFocus(); composerIdentity = UUID() }
        .onAppear { endDraftFocus() }
        .onChange(of: conversation.id) { _, _ in
            previousTailID = nil; visibleMessageID = nil
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversationDetail")
    }

    private func endDraftFocus() {
        draftFocused = false
        #if os(iOS)
        // Navigation can restore UIKit's old responder after SwiftUI's focus binding cleared.
        // Resign it as the conversation reappears so the composer and keyboard agree.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        #endif
    }

    private var commandStatusCards: some View {
        let accountEpoch = model.accountEpoch
        let key = AppleAppModel.draftKey(for: conversation)
        let rows = model.commandRows(for: conversation)
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

    private var composer: some View {
        let accountEpoch = model.accountEpoch
        let key = AppleAppModel.draftKey(for: conversation)
        return VStack(alignment: .leading, spacing: AppleTokens.Space.p9) {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                TextField("向 WeftMate 说说你的目标", text: draft, axis: .vertical)
                    .lineLimit(2...6).textFieldStyle(.plain).font(AppleTokens.Fonts.body)
                    .focused($draftFocused).padding(.horizontal, AppleTokens.Space.p9).padding(.top, AppleTokens.Space.p7)
                    .disabled(!model.canEditDraft(for: conversation))
                    .accessibilityIdentifier("conversationDraft")
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
                if dynamicTypeSize.isAccessibilitySize {
                    composerApprovalMode(accountEpoch: accountEpoch)
                }
                HStack(spacing: AppleTokens.Space.p12) {
                    Menu {
                        Button("添加文件或图片") { importingAttachments = true }
                        #if DEBUG
                        if ProcessInfo.processInfo.arguments.contains("--ui-testing") && ProcessInfo.processInfo.arguments.contains("--apple-contract-fixture") {
                            Button("添加测试文件") {
                                if let file = try? AppleContractUIFixture.selectedFile() {
                                    Task { await model.addAttachments([file], to: conversation, accountEpoch: accountEpoch) }
                                }
                            }
                        }
                        #endif
                        PhotosPicker(selection: $photoSelection, maxSelectionCount: 4 - (model.attachmentDrafts[key]?.count ?? 0), matching: .images) {
                            WeftLabel("从照片选择", icon: "image")
                        }
                        #if os(macOS)
                        Button("粘贴图片或文件") { pasteAttachments(accountEpoch: accountEpoch) }
                        #endif
                    } label: { WeftIcon("plus").frame(width: 44, height: 44) }
                    .disabled(!model.canAddAttachments(conversation)).accessibilityLabel("添加附件")
                    .accessibilityIdentifier("addAttachmentButton")
                    if !dynamicTypeSize.isAccessibilitySize {
                        composerApprovalMode(accountEpoch: accountEpoch)
                    }
                    if model.loadingAttachments.contains(key) { ProgressView().controlSize(.small) }
                    Text(model.sendTargets[key]?.modelName ?? conversation.originalModelLabel ?? "当前模型")
                        .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).lineLimit(1)
                        .accessibilityLabel("当前模型")
                    Spacer()
                    Button { Task { await model.send(conversation, accountEpoch: accountEpoch) } } label: {
                        WeftIcon("send")
                            .font(AppleTokens.Fonts.body.weight(.semibold)).frame(width: 20, height: 44)
                    }
                    .buttonStyle(PrimaryActionStyle(fillsWidth: false))
                    .disabled(!model.canSend(conversation)).accessibilityLabel("发送")
                    .accessibilityIdentifier("sendButton")
                }
            }
            .padding(AppleTokens.Space.p9)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r16))
            .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r16).strokeBorder(Weave.line))

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
        if let sessionID = conversation.sessionId ?? model.taskSessionID(for: conversation, accountEpoch: accountEpoch) {
            ApprovalModeControl(model: model, sessionID: sessionID).id(sessionID + accountEpoch.uuidString)
        }
    }

    #if os(macOS)
    private func pasteAttachments(accountEpoch: UUID) {
        let pasteboard = NSPasteboard.general
        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            Task { await model.addAttachments(urls, to: conversation, accountEpoch: accountEpoch) }
        } else if let data = pasteboard.data(forType: .tiff) {
            let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".tiff")
            do {
                try data.write(to: file)
                Task { await model.addAttachments([file], to: conversation, accountEpoch: accountEpoch); try? FileManager.default.removeItem(at: file) }
            } catch { attachmentInputError = "图片未添加，请重试。" }
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
                            .background(Weave.accentSoft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r19))
                    }
                }
            } else {
                MessageBodyView(text: message.text, messageID: message.id)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
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
    }
}
