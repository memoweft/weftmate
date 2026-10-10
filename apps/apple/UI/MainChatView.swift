import SwiftUI
import WeftMateCore
import UniformTypeIdentifiers
import PhotosUI

struct MainChatView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: MainChatModel
    @StateObject private var interactions: TaskInteractionModel
    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    #endif
    @State private var showingModels = false
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var choosingDate = false
    @State private var chosenDate = Date()
    @State private var searching = false
    @State private var showingPhotos = false
    @State private var showingCamera = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var importing = false
    @State private var importEpoch: UUID?
    @State private var importGeneration: UUID?
    @State private var restore: ChatAnchor?
    @State private var pixelScroll: ((Double) -> Void)?
    @FocusState private var draftFocused: Bool
    @State private var stopping = false
    @StateObject private var positions = MainChatPositionTracker()
    init(app: AppleAppModel) {
        self.app = app; model = app.mainChat
        _interactions = StateObject(wrappedValue: TaskInteractionModel(client: app.assistantClient, account: app.session,
            epoch: app.accountEpoch, stateDirectory: app.assistantStateDirectory,
            currentEpoch: { [weak app] in app?.accountEpoch ?? UUID() }, currentSession: { [weak app] in app?.session }))
    }
    private var days: [ChatDaySection] { ChatDay.sections(model.window.events, timeZone: model.timeZone) }
    private var today: String { ChatDay.key(Date(), timeZone: model.timeZone) }
    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            HStack {
                Button { choosingDate.toggle() } label: { if dynamicTypeSize.isAccessibilitySize { WeftIcon("clock") } else { WeftLabel("跳日期", icon: "clock") } }
                    .buttonStyle(.plain).accessibilityLabel("跳日期").accessibilityIdentifier("mainChat.date")
                Button { searching.toggle() } label: { if dynamicTypeSize.isAccessibilitySize { WeftIcon("search") } else { WeftLabel("搜索", icon: "search") } }
                    .buttonStyle(.plain).disabled(!model.capabilities.supports("chatSearch")).accessibilityLabel("搜索").accessibilityIdentifier("mainChat.search")
                Spacer()
                Button { Task { await model.loadResources() } } label: { WeftIcon("outputs") }
                    .buttonStyle(.plain).disabled(!model.capabilities.supports("chatResources")).accessibilityLabel("输出与来源").accessibilityIdentifier("mainChat.resources")
            }.padding(AppleTokens.Space.p12)
            if searching { searchBar }
            if model.indexState != "ready" {
                Text(model.indexState == "building" ? "正在整理早期记录，日期和搜索结果暂不完整。" : "早期记录整理失败，重新打开可重试。")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).padding(AppleTokens.Space.p8)
                    .accessibilityIdentifier("mainChat.indexNotice")
            }
            if let error = model.error ?? model.configurationError {
                HStack { InlineNotice(message: error, isError: true); Button("重试") { Task { await model.configure(); await model.read() } }.buttonStyle(OutlineActionStyle()) }
                    .padding(AppleTokens.Space.p12)
            }
            if model.hasLoadedModels && model.hasLoadedHistory && model.window.events.isEmpty && model.error == nil && model.configurationError == nil && !model.models.contains(where: \.configured) {
                ScrollView {
                VStack(spacing: AppleTokens.Space.p16) {
                    WeftIcon("model", size: AppleTokens.Space.p32)
                    Text("添加模型，开始对话").font(AppleTokens.Fonts.title3).fixedSize(horizontal: false, vertical: true)
                    Text("连接一个本地或云端模型，WeftMate 就能开始帮你。").foregroundStyle(Weave.muted).fixedSize(horizontal: false, vertical: true)
                    Button("设置模型") {
                        #if os(macOS)
                        app.settingsRoute = .init(categoryID: "models"); openWindow(id: "settings")
                        #else
                        showingModels = true
                        #endif
                    }.buttonStyle(PrimaryActionStyle(fillsWidth: false))
                }.padding(AppleTokens.Space.p24).frame(maxWidth: .infinity)
                }.defaultScrollAnchor(dynamicTypeSize.isAccessibilitySize ? .top : .center).accessibilityIdentifier("mainChat.noModel")
            } else { timeline }
            composer
        }
        .background(Weave.surface).navigationTitle("WeftMate")
        .task(id: "\(model.chat?.activeSessionId ?? "")|\(model.modelID)") { await model.refreshThinking() }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .popover(isPresented: $choosingDate) {
            VStack {
                DatePicker("选择日期", selection: $chosenDate, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .environment(\.timeZone, TimeZone(identifier: model.timeZone) ?? .gmt)
                Button("跳到这一天") { choosingDate = false; Task { await model.jump(chosenDate) } }
                    .buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("mainChat.jump")
            }.padding(AppleTokens.Space.p16).frame(minWidth: 300)
                .accessibilityElement(children: .contain).accessibilityIdentifier("mainChat.datePicker").presentationCompactAdaptation(.popover)
        }
        .sheet(isPresented: $showingModels) { SettingsView(model: app, route: .init(categoryID: "models"), onClose: { showingModels = false }) }
        .sheet(isPresented: $model.resourceVisible) { MainChatResourcesView(app: app, model: model) }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { @Sendable result in
            Task { @MainActor in
            guard importEpoch == app.accountEpoch, importGeneration == model.window.generation else { return }
            if case .success(let files) = result { model.addFiles(files) }
            }
        }
        .photosPicker(isPresented: $showingPhotos, selection: $photoSelection, maxSelectionCount: 4, matching: .images)
        .onChange(of: photoSelection) { _, selection in
            let epoch = importEpoch, generation = importGeneration
            Task {
                var files: [URL] = []
                defer { files.forEach { try? FileManager.default.removeItem(at: $0) }; photoSelection = [] }
                do {
                    for item in selection {
                        guard let data = try await item.loadTransferable(type: Data.self) else { continue }
                        let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
                        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "." + ext)
                        try data.write(to: file); files.append(file)
                    }
                    guard epoch == importEpoch, generation == importGeneration, epoch == app.accountEpoch, generation == model.window.generation else { return }; model.addFiles(files)
                } catch { if epoch == app.accountEpoch { model.error = "图片未添加，请重试。" } }
            }
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $showingCamera) {
            ComposerCamera { file in
                showingCamera = false
                guard let file else { return }; defer { try? FileManager.default.removeItem(at: file) }
                guard importEpoch == app.accountEpoch, importGeneration == model.window.generation else { return }; model.addFiles([file])
            }.ignoresSafeArea()
        }
        #endif
        .task(id: app.accountEpoch) {
            await model.configure(); model.restoreRequest()
            if model.window.events.isEmpty { await model.read(replace: true) }
        }
        .task(id: "\(scenePhase)|\(model.chat?.activeSessionId ?? "")|\(model.window.generation)") {
            guard scenePhase == .active else { interactions.suspend(); return }
            interactions.activate()
            while !Task.isCancelled {
                await model.changes()
                if let id = model.chat?.activeSessionId { await interactions.refreshTimeline(sessionID: id) }
                #if os(iOS)
                _ = await app.watchSnapshotBytes()
                #if DEBUG
                await A16PhoneMeasurement.poll(model)
                #endif
                #endif
                try? await Task.sleep(for: .seconds(2))
            }
        }
        .onChange(of: model.window.generation) { _, _ in interactions.cancel(); positions.frames.removeAll(); restore = nil; searching = false; importing = false; importEpoch = nil; importGeneration = nil }
        .onChange(of: app.accountEpoch) { _, _ in importing = false; importEpoch = nil; importGeneration = nil }
        .onDisappear {
            interactions.suspend(); showingPhotos = false; showingCamera = false; importEpoch = nil; importGeneration = nil
            #if os(macOS)
            ComposerMedia.cancelScreenshot()
            #endif
        }
        .accessibilityElement(children: .contain).accessibilityIdentifier("mainChat")
    }
    private var searchBar: some View {
        HStack {
            TextField("搜索主对话", text: $model.query).textFieldStyle(.plain).onSubmit { Task { await model.search() } }
                .accessibilityIdentifier("mainChat.query")
            Button { Task { await model.search() } } label: { WeftIcon("search") }.buttonStyle(OutlineActionStyle()).accessibilityLabel("查找").accessibilityIdentifier("mainChat.find")
            Button { Task { await model.moveHit(-1) } } label: { WeftIcon("back") }.buttonStyle(.plain).accessibilityLabel("上一条").accessibilityIdentifier("mainChat.previous")
            Text(model.hits.isEmpty ? "0" : "\(model.hitIndex + 1)/\(model.hits.count)").font(AppleTokens.Fonts.caption)
            Button { Task { await model.moveHit(1) } } label: { WeftIcon("right") }.buttonStyle(.plain).accessibilityLabel("下一条").accessibilityIdentifier("mainChat.next")
        }.padding(AppleTokens.Space.p12)
    }
    private var timeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                    if (!model.hasLoadedModels || !model.hasLoadedHistory) && model.window.events.isEmpty && model.error == nil && model.configurationError == nil {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                            HStack { ProgressView().controlSize(.small); Text("正在读取对话…").foregroundStyle(Weave.muted) }
                            ForEach(0..<3) { _ in
                                VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                                    RoundedRectangle(cornerRadius: AppleTokens.Radius.r8).fill(Weave.soft).frame(height: AppleTokens.Space.p16)
                                    RoundedRectangle(cornerRadius: AppleTokens.Radius.r8).fill(Weave.soft).frame(maxWidth: AppleTokens.Space.p64 * 4).frame(height: AppleTokens.Space.p16)
                                }.accessibilityHidden(true)
                            }
                        }.frame(maxWidth: .infinity).padding(.vertical, AppleTokens.Space.p24)
                    } else if model.window.events.isEmpty && model.error == nil && model.configurationError == nil {
                        EmptyState(symbol: "chat", title: "从这里开始", message: "交代一个目标，或聊聊今天想做的事。")
                    }
                    if model.window.hasOlder {
                        Button("查看更早记录") {
                            let anchor = model.visibleAnchor
                            Task { await model.read(before: model.window.olderCursor); restore = anchor }
                        }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("mainChat.older")
                    }
                    ForEach(days) { section in
                        let day = section.date
                        let rows = section.events.filter { ["user.message", "assistant.message", "side.result", "step.started", "artifact.created"].contains($0.type) }
                        let expanded = day == today || model.window.expandedDays.contains(day)
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                        Button {
                            if expanded { model.window.expandedDays.remove(day) } else { model.window.expandedDays.insert(day) }
                        } label: {
                            HStack { WeftIcon(expanded ? "chevron" : "right", size: AppleTokens.Space.p16); Text(DeviceDateText.chatDay(day, timeZone: TimeZone(identifier: model.timeZone) ?? .gmt)); Spacer(); Text(model.dayCounts[day].map { "\($0) 条" } ?? "本页 \(rows.count) 条") }
                                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).frame(minHeight: AppleTokens.Space.p44).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("mainChat.day." + day).accessibilityValue(expanded ? "已展开" : "已折叠")
                        if expanded {
                            ForEach(rows) { event in
                                MainChatEventRow(app: app, model: model, event: event)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .id(event.id)
                                    .background(MainChatEventPosition(eventID: event.id, onPosition: trackPosition))
                            }
                        }
                        }
                    }
                    if model.loading && !model.window.events.isEmpty { ProgressView() }
                    if model.window.hasNewer {
                        Button("查看后续记录") { Task { await model.read(after: model.window.newerCursor) } }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("mainChat.newer")
                    }
                    AppleTokens.Colors.clear.frame(height: 1).id("latest")
                }.padding(AppleTokens.Space.p20).frame(maxWidth: 760).frame(maxWidth: .infinity)
                .background(MainChatPixelScroll(onReady: { pixelScroll = $0 }).frame(width: 0, height: 0))
            }.coordinateSpace(name: "mainChatScroll")
            .task(id: model.target) {
                guard let anchor = model.target else { return }
                positions.following = false
                // A new search/date target is already aligned by ScrollViewReader. Never
                // apply an old preference frame as a second correction to the new page.
                restore = anchor.pixelOffset == 0 ? nil : anchor
                await Task.yield()
                guard !Task.isCancelled else { return }
                proxy.scrollTo(anchor.eventID, anchor: .top)
            }
            .onChange(of: model.window.events.last?.id) { _, _ in if positions.following { proxy.scrollTo("latest", anchor: .bottom) } }
            .overlay(alignment: .bottomTrailing) {
                if !model.window.events.isEmpty {
                Button("回到底部") {
                    positions.following = true
                    Task { await model.returnToLatest(); proxy.scrollTo("latest", anchor: .bottom) }
                }
                    .font(AppleTokens.Fonts.caption).buttonStyle(OutlineActionStyle()).padding(AppleTokens.Space.p12).accessibilityIdentifier("mainChat.latest")
                }
            }
        }
    }
    private func trackPosition(_ id: String, _ frame: CGRect?, _ height: CGFloat, _ userScrolling: Bool) {
        if userScrolling { positions.following = false }
        positions.frames[id] = frame
        if let anchor = restore, anchor.eventID == id, let frame {
            restore = nil; pixelScroll?(Double(frame.minY) - anchor.pixelOffset)
        }
        if let first = positions.frames.filter({ $0.value.maxY > 0 && $0.value.minY < height }).min(by: { $0.value.minY < $1.value.minY }) {
            model.visibleAnchor = .init(eventID: first.key, pixelOffset: Double(first.value.minY))
        }
    }
    private var composerPlaceholder: String {
        if model.models.contains(where: \.configured) { return "和 WeftMate 聊聊" }
        if model.configurationError != nil { return "模型未就绪" }
        return model.hasLoadedModels ? "先添加模型" : "读取模型中…"
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            if model.hasLoadedModels && !model.models.contains(where: \.configured) && !model.window.events.isEmpty {
                HStack {
                    InlineNotice(message: "先添加一个模型，再继续对话。", isError: false)
                    Button("设置模型") {
                        #if os(macOS)
                        app.settingsRoute = .init(categoryID: "models"); openWindow(id: "settings")
                        #else
                        showingModels = true
                        #endif
                    }.buttonStyle(OutlineActionStyle())
                }
            }
            ConversationApprovalBar(model: interactions, events: model.nativeEvents)
            if model.chat?.contextOrganizing == true { Text("正在整理上下文，消息将排队发送。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            if model.chat?.relayError != nil { Text("上下文整理未完成，草稿已保留。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            ForEach(model.attachments) { file in
                HStack { Text(file.original.name); Button("移除") { file.removeTemporaryFiles(); model.attachments.removeAll { $0.id == file.id } } }.buttonStyle(OutlineActionStyle()).font(AppleTokens.Fonts.caption)
            }
            TextField(composerPlaceholder, text: Binding(get: { model.draft }, set: { model.setDraft($0) }), axis: .vertical).lineLimit(1...6)
                .textFieldStyle(.plain).focused($draftFocused).disabled(!model.models.contains(where: \.configured)).accessibilityIdentifier("mainChat.draft")
            if dynamicTypeSize.isAccessibilitySize { modelSelection }
            HStack {
                Menu {
                    Button("文件", image: ImageResource(name: "wm-file", bundle: .main)) { captureImportScope(); DispatchQueue.main.async { importing = true } }
                    #if os(iOS)
                    Button("相机", image: ImageResource(name: "wm-camera", bundle: .main)) {
                        captureImportScope()
                        if UIImagePickerController.isSourceTypeAvailable(.camera) { showingCamera = true }
                        else { model.error = "相机暂不可用，可从照片或文件添加。" }
                    }
                    Button("照片", image: ImageResource(name: "wm-image", bundle: .main)) { captureImportScope(); showingPhotos = true }
                    #else
                    Button("区域截图", image: ImageResource(name: "wm-desktop", bundle: .main)) { addNativeMedia(screenshot: true) }
                    Button("粘贴剪贴板图片", image: ImageResource(name: "wm-copy", bundle: .main)) { addNativeMedia(screenshot: false) }
                    #endif
                    Button("开旁聊", image: ImageResource(name: "wm-chat", bundle: .main)) { Task { await model.createSide() } }.disabled(!model.capabilities.supports("sideChats"))
                    Toggle(isOn: Binding(get: { false }, set: { enabled in if enabled { Task { await model.createSide(temporary: true) } } })) {
                        Label("这次别记", image: "wm-memory")
                    }.disabled(!model.capabilities.supports("temporaryChats")).accessibilityIdentifier("mainChat.temporary")
                    if model.thinking?.supported == true {
                        Toggle(isOn: Binding(get: { model.thinking?.enabled == true }, set: { value in Task { await model.refreshThinking(enabled: value) } })) {
                            Label("深入思考", image: "wm-model")
                        }.disabled(model.thinkingBusy).accessibilityIdentifier("mainChat.thinking")
                    }
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--a16-driver") {
                        Button { A16TestSupport.addAttachment(model) } label: { Label("添加合成附件", image: "wm-file") }.accessibilityIdentifier("mainChat.syntheticAttachment")
                    }
                    #endif
                } label: { WeftIcon("plus").frame(minWidth: AppleTokens.Space.p44, minHeight: AppleTokens.Space.p44) }
                #if os(macOS)
                .menuStyle(.borderlessButton).fixedSize()
                #endif
                .menuOrder(.fixed).disabled(!model.models.contains(where: \.configured)).accessibilityLabel("添加").accessibilityIdentifier("mainChat.plus")
                Spacer()
                if !dynamicTypeSize.isAccessibilitySize { modelSelection }
                if model.pending != nil {
                    if model.command?.state == "rejected" {
                        Button("编辑后重试") { model.editRejectedRequest() }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("mainChat.editRejected")
                    }
                    Button("核对原请求") { Task { await model.reconcile() } }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("mainChat.reconcile")
                    Button("继续原请求") { Task { await model.reconcile(submit: true) } }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("mainChat.continue")
                    Text(model.command?.state == "pending" ? "排队中" : "待核对").font(AppleTokens.Fonts.caption)
                }
                let stop = model.draft.isEmpty && model.attachments.isEmpty && model.chat?.running == true
                Button {
                    draftFocused = false
                    if stop { Task { await stopTask() } } else { Task { await model.send() } }
                } label: { WeftIcon(stop ? "stop" : "send") }.buttonStyle(PrimaryActionStyle(fillsWidth: false))
                    .disabled(model.sending || stopping || (!stop && ((model.draft.isEmpty && model.attachments.isEmpty) || model.pending != nil || model.chat?.sendAvailable != true || (model.chat?.activeSessionId == nil && model.modelID.isEmpty) || !model.capabilities.supports("chatSend"))))
                    .accessibilityLabel(stop ? "停止" : "发送").accessibilityIdentifier("mainChat.send")
            }
        }.padding(AppleTokens.Space.p16).background(Weave.soft)
    }
    @ViewBuilder private var modelSelection: some View {
        if model.models.contains(where: \.configured) {
            if model.chat?.activeSessionId == nil {
                Picker("模型", selection: $model.modelID) { ForEach(model.models.filter(\.configured)) { Text($0.name).tag($0.id) } }
                    .frame(maxWidth: AppleTokens.Space.p24 * 8)
            } else {
                Text(model.models.first(where: { $0.id == model.chat?.modelProfileId })?.name ?? "当前模型")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }
        }
    }
    private func captureImportScope() { importEpoch = app.accountEpoch; importGeneration = model.window.generation }
    #if os(macOS)
    private func addNativeMedia(screenshot: Bool) {
        captureImportScope(); let epoch = importEpoch, generation = importGeneration
        Task {
            do {
                guard let file = try await (screenshot ? ComposerMedia.screenshot() : ComposerMedia.clipboardImage()) else { return }
                defer { try? FileManager.default.removeItem(at: file) }
                guard epoch == importEpoch, generation == importGeneration, epoch == app.accountEpoch, generation == model.window.generation else { return }; model.addFiles([file])
            } catch { if epoch == app.accountEpoch { model.error = "图片未添加，请重试。" } }
        }
    }
    #endif
    private func stopTask() async {
        guard let session = model.chat?.activeSessionId else { return }; stopping = true; defer { stopping = false }
        do {
            let native = try await app.assistantClient.timelinePage(sessionID: session)
            let receipt = native.events.last(where: { $0.type == "task.started" })?.data["receiptId"]?.string
            var cursor: TaskCommandPageCursor?
            repeat {
                let page = try await app.assistantClient.taskCommands(sessionID: session, before: cursor)
                for root in page.rootCommands where receipt == nil || root.receiptId == receipt {
                    let task = TaskWorkspaceModel(client: app.assistantClient, taskId: root.commandId, expectedHostId: root.targetDeviceId, expectedSessionId: session, expectedRequestId: root.requestId,
                        accountEpoch: app.accountEpoch, stateDirectory: app.assistantStateDirectory, currentEpoch: { app.accountEpoch }, currentSession: { app.session })
                    await task.refresh()
                    guard let snapshot = task.snapshot else { continue }
                    if snapshot.control.canStop, receipt != nil || snapshot.replyEvidence.turn != nil && [.streaming, .waiting].contains(snapshot.replyEvidence.status) {
                        await task.requestStop(); model.error = task.stopError ?? task.error; return
                    }
                }
                cursor = page.nextCursor
            } while cursor != nil
            model.error = "当前任务尚未核对，请稍后再试。"
        } catch { model.error = error.localizedDescription }
    }
}

struct MainChatEventRow: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: MainChatModel
    let event: ChatEvent
    @State private var hovering = false
    @State private var attachmentPreview: ConversationAttachmentReference?
    @State private var detail: TimelineDetail?
    @State private var expanded = false
    private var message: Bool { event.type == "user.message" || event.type == "assistant.message" }
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            if event.type == "side.result" {
                Button {
                    if let id = event.data["sourceChatId"]?.string, event.data["deleted"]?.bool != true { app.openedSessionID = id }
                } label: {
                    HStack {
                        WeftIcon(event.data["state"]?.string == "completed" ? "allow" : event.data["state"]?.string == "stopped" ? "stop" : "warn")
                        Text(event.data["deleted"]?.bool == true ? "来源已删除" : (event.data["state"]?.string == "completed" ? "成功" : event.data["state"]?.string == "stopped" ? "停止" : "失败") + " · " + event.text)
                        Spacer(); WeftIcon("right")
                    }.font(AppleTokens.Fonts.callout).padding(AppleTokens.Space.p12).background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
                }.buttonStyle(.plain).accessibilityIdentifier("mainChat.result." + event.id)
            } else if message {
                HStack {
                    if event.type == "user.message" { Spacer(minLength: AppleTokens.Space.p32) }
                    if event.type == "assistant.message", model.query.isEmpty {
                        MessageBodyView(text: event.text, messageID: event.id).frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        highlighted(event.text).textSelection(.enabled).font(AppleTokens.Fonts.body).lineSpacing(AppleTokens.Space.p5)
                            .padding(AppleTokens.Space.p12).background(event.type == "user.message" ? Weave.accentSoft : Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
                    }
                    if event.type != "user.message" { Spacer(minLength: AppleTokens.Space.p0) }
                }

                ForEach(originals) { file in
                    ConversationAttachmentTile(model: app, reference: .original(file)) { attachmentPreview = .original(file) }
                }
                if originals.isEmpty, let session = event.sessionID {
                    ForEach(images, id: \.attachmentId) { image in
                        ConversationAttachmentTile(model: app, reference: .sessionImage(image, session)) { attachmentPreview = .sessionImage(image, session) }
                    }
                }
            } else if event.type == "step.started" || event.type == "artifact.created" {
                Button { expanded.toggle(); if expanded { Task { await readDetail() } } } label: {
                    HStack { WeftIcon(expanded ? "chevron" : "right", size: AppleTokens.Space.p16); Text(OperationNames.text(event.data["summary"]?.string ?? event.type)) }
                        .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                }.buttonStyle(.plain)
                if expanded, let detail { Text(detail.text).font(AppleTokens.Fonts.caption).textSelection(.enabled) }
            }
        }
        .modifier(MessageActionsPresentation(app: app, id: event.id, text: event.text, at: event.at,
            user: event.type == "user.message", enabled: message,
            latest: event.id == model.window.events.last?.id,
            menuID: "mainChat.messageMenu." + event.id,
            quote: { model.setDraft(model.draft + (model.draft.isEmpty ? "" : "\n\n") + "> " + event.text.replacingOccurrences(of: "\n", with: "\n> ") + "\n") },
            regenerate: { Task { await model.regenerate(event) } },
            extra: { AnyView(messageActions) }))
            .accessibilityElement(children: .contain).accessibilityIdentifier("mainChat.event." + event.id)
            .sheet(isPresented: Binding(get: { attachmentPreview != nil }, set: { if !$0 { attachmentPreview = nil } })) {
                if let reference = attachmentPreview { MainChatAttachmentPreview(app: app, model: model, reference: reference) { attachmentPreview = nil } }
            }
            .onChange(of: model.window.generation) { _, _ in attachmentPreview = nil; detail = nil; expanded = false }

    }
    private var originals: [OriginalAttachment] {
        guard let value = event.data["originalAttachments"], let data = try? JSONEncoder().encode(value) else { return [] }
        return (try? JSONDecoder().decode([OriginalAttachment].self, from: data)) ?? []
    }
    private var images: [SharedHistoryImage] {
        guard let value = event.data["images"], let data = try? JSONEncoder().encode(value) else { return [] }
        return (try? JSONDecoder().decode([SharedHistoryImage].self, from: data)) ?? []
    }
    @ViewBuilder private var messageActions: some View {
        Button("开旁聊", image: ImageResource(name: "wm-chat", bundle: .main)) { Task { await model.createSide(event: event) } }.disabled(!model.capabilities.supports("sideChats"))
        Button("这次别记", image: ImageResource(name: "wm-memory", bundle: .main)) { Task { await model.createSide(temporary: true) } }.disabled(!model.capabilities.supports("temporaryChats"))
    }
    private func highlighted(_ text: String) -> Text {
        guard !model.query.isEmpty else { return Text(text) }
        var value = AttributedString(text)
        var start = value.startIndex
        while start < value.endIndex, let range = value[start...].range(of: model.query, options: .caseInsensitive) {
            value[range].foregroundColor = Weave.accent; value[range].font = AppleTokens.Fonts.body.weight(.semibold); start = range.upperBound
        }
        return Text(value)
    }
    private func readDetail() async {
        guard let session = event.sessionID, let seq = event.data["detailRef"]?["seq"]?.int else { return }
        let generation = model.window.generation, epoch = app.accountEpoch
        let value = try? await app.assistantClient.timelineDetail(sessionID: session, seq: seq)
        guard model.window.generation == generation, app.accountEpoch == epoch else { return }; detail = value
    }
}
#if os(macOS)
private struct MainChatPixelScroll: NSViewRepresentable {
    let onReady: (@escaping (Double) -> Void) -> Void
    final class Coordinator { var connected = false }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> NSView { NSView() }
    func updateNSView(_ view: NSView, context: Context) {
        guard !context.coordinator.connected else { return }
        DispatchQueue.main.async {
            guard let scroll = view.enclosingScrollView else { return }
            context.coordinator.connected = true
            onReady { delta in
                var point = scroll.contentView.bounds.origin; point.y += delta
                scroll.contentView.scroll(to: point); scroll.reflectScrolledClipView(scroll.contentView)
            }
        }
    }
}
#else
private struct MainChatPixelScroll: UIViewRepresentable {
    let onReady: (@escaping (Double) -> Void) -> Void
    final class Coordinator { var connected = false }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> UIView { UIView() }
    func updateUIView(_ view: UIView, context: Context) {
        guard !context.coordinator.connected else { return }
        DispatchQueue.main.async {
            var parent = view.superview
            while parent != nil, !(parent is UIScrollView) { parent = parent?.superview }
            guard let scroll = parent as? UIScrollView else { return }
            context.coordinator.connected = true
            onReady { delta in scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: scroll.contentOffset.y + delta), animated: false) }
        }
    }
}
#endif

#if DEBUG
import QuartzCore
import Darwin
/// Measures native display-link callbacks only during the explicitly requested synthetic scroll run.
@MainActor final class A16FrameSampler: NSObject {
    private var last: Double?
    var frames: [Double] = []
    var link: CADisplayLink?
    var started = ProcessInfo.processInfo.systemUptime
    var residentStart = A16FrameSampler.residentMiB()
    @objc func tick(_ sender: CADisplayLink) {
        if let last { frames.append((sender.timestamp - last) * 1000) }; last = sender.timestamp
    }
    func report(bodyWindow: Int) -> [String: Any] {
        let ordered = frames.sorted()
        let maximum: Double = ordered.last ?? 0
        return ["sampling":"CADisplayLink callback intervals during native scrolling; no GPU presentation-latency claim", "hostHistory":10000, "bodyWindow":bodyWindow,
                "samples":ordered.count, "elapsedSeconds":ProcessInfo.processInfo.systemUptime-started,
                "p95Milliseconds":ordered.isEmpty ? 0 : ordered[Int(Double(ordered.count-1)*0.95)], "maxMilliseconds":maximum,
                "residentStartMiB":residentStart, "residentEndMiB":Self.residentMiB()]
    }
    static func residentMiB() -> Double {
        var info = mach_task_basic_info(), count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
        let status = withUnsafeMutablePointer(to: &info) { $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count) } }
        return status == KERN_SUCCESS ? Double(info.resident_size) / 1048576 : 0
    }
}
#if os(iOS)
@MainActor private enum A16PhoneMeasurement {
    static var sampler: A16FrameSampler?
    static func poll(_ model: MainChatModel) async {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("--ui-testing"), let i = args.firstIndex(of: "--a16-driver"), args.indices.contains(i+1),
              let origin = URL(string: args[i+1]), origin.host == "127.0.0.1", origin.scheme == "http" else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: origin.appendingPathComponent("performance-control"))
            let state = try JSONDecoder().decode([String: Bool].self, from: data)
            if state["active"] == true, sampler == nil {
                let measurement = A16FrameSampler()
                let link = CADisplayLink(target: measurement, selector: #selector(A16FrameSampler.tick(_:)))
                measurement.link = link; link.add(to: .main, forMode: .common); sampler = measurement
            } else if state["active"] != true, let measurement = sampler {
                measurement.link?.invalidate(); measurement.link = nil; sampler = nil
                var request = URLRequest(url: origin.appendingPathComponent("metrics")); request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: measurement.report(bodyWindow: model.window.events.count))
                _ = try await URLSession.shared.data(for: request)
            }
        } catch { /* The isolated driver is optional and never affects product requests. */ }
    }
}
#endif
#endif
