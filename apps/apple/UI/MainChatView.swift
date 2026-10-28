import SwiftUI
import WeftMateCore
import UniformTypeIdentifiers
import PhotosUI

struct MainChatView: View {
    @ObservedObject var app: AppleAppModel
    @StateObject var model: MainChatModel
    private let initialDate: Date?
    private let initialQuery: String?
    @StateObject private var interactions: TaskInteractionModel
    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    #endif
    @State private var showingModels = false
    @State private var dictationPopover = false
    @State private var showingUsage = false
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var stopping = false
    @State private var latestJump = 0
    @State private var atBottom = true
    @State private var scrollHeight: CGFloat = 0
    @StateObject private var positions = MainChatPositionTracker()
    init(app: AppleAppModel, chatID: String? = nil, initialDate: Date? = nil, initialQuery: String? = nil) {
        self.initialDate=initialDate; self.initialQuery=initialQuery;
        self.app = app; _model = StateObject(wrappedValue: initialDate != nil ? MainChatModel(app:app,chatID:chatID) : chatID == nil ? app.mainChat : MainChatModel(app: app, chatID: chatID))
        _chosenDate = State(initialValue:initialDate ?? Date())
        _interactions = StateObject(wrappedValue: TaskInteractionModel(client: app.assistantClient, account: app.session,
            epoch: app.accountEpoch, stateDirectory: app.assistantStateDirectory,
            currentEpoch: { [weak app] in app?.accountEpoch ?? UUID() }, currentSession: { [weak app] in app?.session }))
    }
    private var days: [ChatDaySection] {
        #if os(iOS)
        ChatDay.sections(model.window.displayEvents, timeZone: model.timeZone)
        #else
        ChatDay.sections(model.window.events, timeZone: model.timeZone)
        #endif
    }
    private var today: String { ChatDay.key(Date(), timeZone: model.timeZone) }
    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            #if os(iOS)
            if initialDate == nil {
            PhoneChatHeader(title: model.capabilities.supports("workAndChat") ? (model.chat?.displayTitle ?? model.chat?.title ?? "对话") : PhonePresentation.title(main:true,assistant:"小纬",conversation:model.chat?.title ?? ""), status: model.capabilities.supports("workAndChat") ? (model.chat.map { WorkAndChat.subtitle($0.summary, computer: app.cloudLogin.selectedComputerName) } ?? app.phoneConnectionStatus) : app.phoneConnectionStatus) {
                Menu {
                    Button("跳日期", image: ImageResource(name: "wm-clock", bundle: .main)) { draftFocused = false; choosingDate = true }.accessibilityIdentifier("mainChat.date")
                    Button("搜索", image: ImageResource(name: "wm-search", bundle: .main)) { draftFocused = false; searching.toggle() }.disabled(!model.capabilities.supports("chatSearch")).accessibilityIdentifier("mainChat.search")
                    Button("输出与来源", image: ImageResource(name: "wm-outputs", bundle: .main)) { draftFocused = false; Task { await model.loadResources() } }.disabled(!model.capabilities.supports("chatResources")).accessibilityIdentifier("mainChat.resources")
                    Button("本对话用量", image: ImageResource(name: "wm-chart", bundle: .main)) { draftFocused = false; showingUsage = true }
                    Button("刷新记录", image: ImageResource(name: "wm-sync", bundle: .main)) { Task { await model.read() } }
                } label: { WeftIcon("more").phoneMenuLabel(circle: true) }.accessibilityLabel("对话菜单").accessibilityIdentifier("mainChat.menu")
            }
            }
            #else
            HStack {
                Button { choosingDate.toggle() } label: { if dynamicTypeSize.isAccessibilitySize { WeftIcon("clock") } else { WeftLabel("跳日期", icon: "clock") } }
                    .buttonStyle(.plain).accessibilityLabel("跳日期").accessibilityIdentifier("mainChat.date")
                Button { searching.toggle() } label: { if dynamicTypeSize.isAccessibilitySize { WeftIcon("search") } else { WeftLabel("搜索", icon: "search") } }
                    .buttonStyle(.plain).disabled(!model.capabilities.supports("chatSearch")).accessibilityLabel("搜索").accessibilityIdentifier("mainChat.search")
                Spacer()
                Button { Task { await model.loadResources() } } label: { WeftIcon("outputs") }
                    .buttonStyle(.plain).disabled(!model.capabilities.supports("chatResources")).accessibilityLabel("输出与来源").accessibilityIdentifier("mainChat.resources")
            }.padding(AppleTokens.Space.p12)
            #endif
            if initialDate != nil {
                #if os(iOS)
                VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                    Text(DeviceDateText.chatDay(ChatDay.key(chosenDate,timeZone:model.timeZone),timeZone:TimeZone(identifier:model.timeZone) ?? .gmt))
                        .font(AppleTokens.Fonts.largeTitle.bold())
                    Text("连续主对话 · 已定位到这一天").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    #if os(iOS)
                    Button { draftFocused=false; choosingDate=true } label: { Text("选择其他日期").frame(maxWidth:.infinity) }
                        .buttonStyle(OutlineActionStyle()).accessibilityIdentifier("mainChat.historyChooseDate")
                    #endif
                }.frame(maxWidth:.infinity,alignment:.leading).padding(.horizontal,AppleTokens.Phone.pageInset)
                    .accessibilityIdentifier("mainChat.historyDate")
                #else
                Text(DeviceDateText.chatDay(ChatDay.key(chosenDate,timeZone:model.timeZone),timeZone:TimeZone(identifier:model.timeZone) ?? .gmt))
                    .font(AppleTokens.Fonts.title2).frame(maxWidth:.infinity,alignment:.leading).padding(.horizontal,AppleTokens.Space.p20)
                    .accessibilityIdentifier("mainChat.historyDate")
                #endif
            }
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
            #if os(macOS)
            composer
            #endif
        }
        #if os(iOS)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if initialDate == nil { composer }
            else {
                Button { Task { await app.mainChat.returnToLatest(); dismiss() } } label: { Text("回到最新对话").frame(maxWidth:.infinity) }
                    .buttonStyle(OutlineActionStyle()).frame(maxWidth:.infinity)
                    .padding(AppleTokens.Phone.pageInset).accessibilityIdentifier("mainChat.historyReturn")
            }
        }
        #endif
        #if os(iOS)
        .toolbar(initialDate == nil ? .hidden : .visible, for: .navigationBar)
        #endif
        .background(Weave.canvas).navigationTitle(initialDate == nil ? "WeftMate" : "")
        .task(id: "\(model.chat?.activeSessionId ?? "")|\(model.modelID)") { await model.refreshThinking() }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .environment(\.phoneWorkApp,app)
        #endif
        .phonePopover(isPresented: $choosingDate) {
            VStack {
                DatePicker("选择日期", selection: $chosenDate, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .environment(\.timeZone, TimeZone(identifier: model.timeZone) ?? .gmt)
                Button("跳到这一天") { choosingDate = false; Task { await model.jump(chosenDate) } }
                    .buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("mainChat.jump")
            }.padding(AppleTokens.Space.p16).frame(minWidth: 300)
                .accessibilityElement(children: .contain).accessibilityIdentifier("mainChat.datePicker").presentationCompactAdaptation(.popover)
        }
        .sheet(isPresented: $showingUsage) { SettingsView(model: app, route: .usage(sessionID: model.chat?.activeSessionId), onClose: { showingUsage = false }) }
        .sheet(isPresented: $showingModels) { SettingsView(model: app, route: .init(categoryID: "models"), onClose: { showingModels = false }) }
        #if os(iOS)
        .navigationDestination(isPresented: $model.resourceVisible) { MainChatResourcesView(app: app, model: model, embedded: true) }
        #else
        .sheet(isPresented: $model.resourceVisible) { MainChatResourcesView(app: app, model: model) }
        #endif
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
            if let initialDate { await model.jump(initialDate) }
            if let initialQuery { model.query=initialQuery; searching=true; await model.search() }
        }
        .task(id: "\(scenePhase)|\(model.chat?.activeSessionId ?? "")|\(model.window.generation)") {
            guard scenePhase == .active else { interactions.suspend(); return }
            interactions.activate()
            var lastDecisionRead = Date.distantPast
            while !Task.isCancelled {
                await model.changes()
                let readDecisions = Date().timeIntervalSince(lastDecisionRead) >= 1.5
                if readDecisions, model.chat?.taskAvailable != false, app.executionAccount != false, let id = model.chat?.activeSessionId {
                    lastDecisionRead = Date(); await interactions.refreshTimeline(sessionID: id)
                }
                #if os(iOS)
                if readDecisions { _ = await app.watchSnapshotBytes() }
                #if DEBUG
                await A16PhoneMeasurement.poll(model)
                #endif
                #endif
                #if os(iOS)
                try? await Task.sleep(for: .seconds(ReplySnapshots.pollDelay(streaming: model.capabilities.supports("replyStreaming"), running: model.chat?.running == true || model.window.liveEvents.contains { $0.data["streaming"]?.bool == true }, failed: model.error != nil)))
                #else
                try? await Task.sleep(for: .seconds(2))
                #endif
            }
        }
        .onChange(of: model.window.generation) { _, _ in interactions.cancel(); positions.frames.removeAll(); restore = nil; searching = false; importing = false; importEpoch = nil; importGeneration = nil }
        #if os(iOS)
        .onChange(of:app.phonePreviewRequest) { _,_ in draftFocused=false }
        #endif
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
                        let rows = section.events.filter { ["user.message", "assistant.message", "assistant.delta", "side.result", "step.started", "artifact.created", "turn.ended", "task.ended"].contains($0.type) }
                        let expanded = day == today || model.window.expandedDays.contains(day)
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                        Button {
                            if expanded { model.window.expandedDays.remove(day) } else { model.window.expandedDays.insert(day) }
                        } label: {
                            HStack {
                                WeftIcon(expanded ? "chevron" : "right", size: AppleTokens.Space.p16)
                                Text(DeviceDateText.chatDay(day, timeZone: TimeZone(identifier: model.timeZone) ?? .gmt)); Spacer()
                                #if os(macOS)
                                Text(model.dayCounts[day].map { "\($0) 条" } ?? "本页 \(rows.count) 条")
                                #endif
                            }
                                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).frame(minHeight: AppleTokens.Space.p44).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("mainChat.day." + day).accessibilityValue(expanded ? "已展开" : "已折叠")
                        if expanded {
                            #if os(iOS)
                            ForEach(PhoneMainRound.group(rows)) { round in
                                PhoneMainRoundView(app:app,model:model,round:round,running:model.chat?.running == true && round.id == PhoneMainRound.group(model.window.displayEvents).last?.id,onPosition:trackPosition)
                            }
                            #else
                            ForEach(rows, id: \.presentationID) { event in
                                MainChatEventRow(app: app, model: model, event: event)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .id(event.id)
                                    .background(MainChatEventPosition(eventID: event.id, onPosition: trackPosition))
                            }
                            #endif

                        }
                        }
                    }
                    if model.loading && !model.window.events.isEmpty { ProgressView() }
                    if model.window.hasNewer {
                        Button("查看后续记录") { Task { await model.read(after: model.window.newerCursor) } }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("mainChat.newer")
                    }
                    #if os(iOS)
                    PhonePendingDecision(model:interactions,events:model.nativeEvents).id("phone.pendingDecision")
                        .background(MainChatEventPosition(eventID:"phone.pendingDecision",onPosition:trackPosition))
                    #endif
                    AppleTokens.Colors.clear.frame(height: 1).id("latest")
                        .background(MainChatEventPosition(eventID:"phone.end",onPosition:trackPosition))
                }.padding(AppleTokens.Space.p20).frame(maxWidth: 760).frame(maxWidth: .infinity)
                .background(MainChatPixelScroll(onReady: { pixelScroll = $0 }).frame(width: 0, height: 0))
            }
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .coordinateSpace(name: "mainChatScroll")
            .accessibilityIdentifier("mainChat.scroll")
             #if os(iOS)
            .onChange(of:latestJump) { _,_ in positions.following=true; Task { await model.returnToLatest(); proxy.scrollTo("latest",anchor:.bottom) } }
            .onChange(of:scrollHeight) { _,_ in
                if positions.following { proxy.scrollTo("latest",anchor:.bottom) }
            }
            .simultaneousGesture(DragGesture().onChanged { value in
                if value.translation.height > 0 { positions.following = false }
            })
            .overlay(alignment: .bottom) {
                if initialDate == nil && !positions.following && (!atBottom || model.target != nil) {
                    PhoneLatestReplyButton { draftFocused=false; latestJump += 1 }
                        .accessibilityIdentifier("mainChat.latest")
                }
            }
            #endif
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
            .onChange(of: model.window.displayEvents.last?.text) { _, _ in if positions.following { proxy.scrollTo("latest", anchor: .bottom) } }
            #if os(macOS)
            .overlay(alignment: .bottomTrailing) {
                if !model.window.events.isEmpty {
                Button {
                    positions.following = true
                    Task { await model.returnToLatest(); proxy.scrollTo("latest", anchor: .bottom) }
                } label: {
                    #if os(iOS)
                    WeftIcon("chevron")
                    #else
                    Text("回到底部")
                    #endif
                }
                    .font(AppleTokens.Fonts.caption).buttonStyle(OutlineActionStyle()).phoneIcon().padding(AppleTokens.Space.p12).accessibilityLabel("回到底部").accessibilityIdentifier("mainChat.latest")
                }
            }
            #endif
        }
    }
    private func trackPosition(_ id: String, _ frame: CGRect?, _ height: CGFloat, _ userScrolling: Bool) {
        #if os(macOS)
        if userScrolling { positions.following = false }
        #endif
        positions.frames[id] = frame
        // Dismantling a UIKit/AppKit marker happens while SwiftUI invalidates its
        // graph. Remove only non-published bookkeeping; writing @State here can
        // reenter GraphHost.invalidate and abort with a Swift access conflict.
        guard frame != nil else { return }
        if let anchor = restore, anchor.eventID == id, let frame {
            restore = nil; pixelScroll?(Double(frame.minY) - anchor.pixelOffset)
        }
        #if os(iOS)
        let height=height>0 ? height : scrollHeight
        if scrollHeight != height { scrollHeight=height }
        let end = positions.frames["phone.end"]
        let distance = end.map { max(0, $0.maxY-height) } ?? .greatestFiniteMagnitude
        if id == "phone.end", userScrolling, let top = end?.minY {
            if let previous = positions.previousEndTop {
                if top > previous { positions.following = false }
                else if top < previous { positions.following = distance <= 48 }
            }
        }
        if id == "phone.end" { positions.previousEndTop = end?.minY }
        if id == "phone.end",positions.following,!userScrolling,let end,end.maxY > height { pixelScroll?(Double(end.maxY-height)) }
        let bottom = distance <= 48
        if atBottom != bottom { atBottom=bottom }
        #endif
        if let first = positions.frames.filter({ $0.value.maxY > 0 && $0.value.minY < height }).min(by: { $0.value.minY < $1.value.minY }) {
            model.visibleAnchor = .init(eventID: first.key, pixelOffset: Double(first.value.minY))
        }
    }
    private var pendingDecisionID: String? { interactions.pendingApprovals.first?.id ?? interactions.pendingQuestions.first?.id }
    private var composerPlaceholder: String {
        if model.models.contains(where: \.configured) { return "接着聊，或者交代一件事…" }
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
            #if os(iOS)
            if let chat = model.chat, WorkAndChat.mode(chat.summary) == .work, model.capabilities.supports("workAndChat") { PhoneWorkDirectoryLine(app: app, row: chat.summary) }
            PhonePendingDecisionNotice(model: interactions, events:model.nativeEvents) { draftFocused=false }
                .padding(.horizontal, AppleTokens.Space.p12)
            if model.chat?.taskAvailable != false, app.executionAccount != false, let sessionID=model.chat?.activeSessionId {
                PhoneMainChatQueue(app:app,chat:model,sessionID:sessionID).id(sessionID+app.accountEpoch.uuidString)
                    .padding(.horizontal,AppleTokens.Space.p12)
            }
            #else
            ConversationApprovalBar(model: interactions, events: model.nativeEvents,computerName:app.cloudLogin.computerName(app.session?.hostId))
            #endif
            if model.chat?.contextOrganizing == true { Text("正在整理上下文，消息将排队发送。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            if model.chat?.relayError != nil { Text("上下文整理未完成，草稿已保留。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            #if os(macOS)
            ForEach(model.attachments) { file in
                HStack { Text(file.original.name); Button("移除") { file.removeTemporaryFiles(); model.attachments.removeAll { $0.id == file.id } } }.buttonStyle(OutlineActionStyle()).font(AppleTokens.Fonts.caption)
            }
            #endif
            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            #if os(iOS)
            if !model.attachments.isEmpty {
                ScrollView(.horizontal) { HStack(alignment:.top,spacing:AppleTokens.Space.p8) {
                    ForEach(model.attachments) { file in PhoneAttachmentBlock(name:file.original.name,image:file.display,isImage:file.original.isImage,status:model.sending ? "正在发送…" : model.error == nil ? nil : "发送未完成",remove:{ file.removeTemporaryFiles(); model.attachments.removeAll { $0.id == file.id } }) }
                } }.scrollIndicators(.hidden).accessibilityIdentifier("mainChat.attachmentBlocks")
            }
            draftInput.frame(minHeight:AppleTokens.Space.p44)
            if dynamicTypeSize.isAccessibilitySize { modelSelection }
            #else
            draftInput
            if dynamicTypeSize.isAccessibilitySize { modelSelection }
            #endif
            composerTools
            }
            #if os(iOS)
            .phoneChatComposer()
            .accessibilityElement(children:.contain).accessibilityIdentifier("mainChat.composer")
            .accessibilityValue("输入区最多五行")
            #endif
        }
        #if os(iOS)
        .padding(.top, AppleTokens.Space.p8)
        #else
        .padding(AppleTokens.Space.p16).background(Weave.soft)
        #endif
    }
    private var composerTools: some View {
            HStack {
                PhoneActionMenu {
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
                } label: { WeftIcon("plus").phoneMenuLabel(circle: true, onCard: true) }
                #if os(macOS)
                .menuStyle(.borderlessButton).fixedSize()
                #endif
                .phoneIcon().phoneComposerControl(circle: true).menuOrder(.fixed).disabled(!model.models.contains(where: \.configured)).accessibilityLabel("添加").accessibilityIdentifier("mainChat.plus")
                #if os(iOS)
                if !dynamicTypeSize.isAccessibilitySize { modelSelection; ApprovalModeControl(model:app,sessionID:model.chat?.activeSessionId,compact:true) }
                #else
                if !dynamicTypeSize.isAccessibilitySize { modelSelection }
                #endif
                Spacer(minLength: AppleTokens.Space.p0)
                #if os(iOS)
                if !model.draft.isEmpty || !model.attachments.isEmpty {
                Button { draftFocused = true; dictationPopover = true } label: { WeftIcon("mic") }.phoneIcon(quiet: true)
                    .accessibilityLabel("语音输入").accessibilityIdentifier("mainChat.dictation")
                }
                #endif
                if model.pending != nil {
                    if model.command?.state == "rejected" {
                        Button("编辑后重试") { model.editRejectedRequest() }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("mainChat.editRejected")
                    }
                    Button("核对原请求") { Task { await model.reconcile() } }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("mainChat.reconcile")
                    Button("继续原请求") { Task { await model.reconcile(submit: true) } }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("mainChat.continue")
                    Text(model.command?.state == "pending" ? "排队中" : "待核对").font(AppleTokens.Fonts.caption)
                }
                let action=PhoneComposerPrimaryAction.resolve(running:model.chat?.running == true,draft:model.draft,attachmentCount:model.attachments.count)
                let stop = action == .stop
                #if os(iOS)
                let voice = action == .voice
                #else
                let voice = false
                #endif
                Button {
                    draftFocused = false
                    if voice { draftFocused=true; dictationPopover=true } else if stop { Task { await stopTask() } } else { Task { await model.send() } }
                } label: { WeftIcon(stop ? "stop" : voice ? "mic" : "send") }.buttonStyle(PrimaryActionStyle(fillsWidth: false)).phoneIcon(primary: true)
                    .disabled(model.sending || stopping || (!stop && !voice && ((model.draft.isEmpty && model.attachments.isEmpty) || model.pending != nil || model.chat?.sendAvailable != true || (model.chat?.activeSessionId == nil && model.modelID.isEmpty) || !model.capabilities.supports("chatSend"))))
                    .accessibilityLabel(stop ? "停止" : voice ? "语音输入" : model.chat?.running == true ? "排队发送" : "发送").accessibilityIdentifier("mainChat.send")
                    #if os(iOS)
                    .popover(isPresented:$dictationPopover) { Text("使用系统听写输入文字").font(AppleTokens.Fonts.caption).padding(AppleTokens.Space.p16).presentationCompactAdaptation(.popover) }
                    #endif
            }
    }
    private var composerLines: ClosedRange<Int> {
        #if os(iOS)
        1...5
        #else
        1...6
        #endif
    }
    private var draftInput: some View {
        TextField(composerPlaceholder, text: Binding(get: { model.draft }, set: { model.setDraft($0) }), axis: .vertical)
            .lineLimit(composerLines).textFieldStyle(.plain).focused($draftFocused)
            .disabled(!model.models.contains(where: \.configured)).accessibilityIdentifier("mainChat.draft")
    }
    @ViewBuilder private var modelSelection: some View {
        if app.modelServicesSupported == true {
            ServiceModelMenuButton(services:app.modelServices,current:model.modelID,label:app.modelServices.flatMap(\.models).first(where: {$0.matches(model.modelID)})?.name ?? "尚未配置",usesImages:model.conversationUsesImages,thinkingSupported:app.modelServices.flatMap(\.models).first(where: {$0.matches(model.modelID)})?.deepThinking?.supported == true,thinkingAvailable:model.chat?.activeSessionId != nil,thinkingUnavailableReason:model.chat?.activeSessionId == nil ? "先发第一条消息，再切换深度思考。" : nil,thinking:Binding(get:{model.thinking?.enabled == true},set:{enabled in Task { await model.refreshThinking(enabled:enabled) }}),select:{service,item in Task { await app.chooseServiceModel(service,item,conversation:model.chat?.summary) }},add:{showingModels=true},refresh:{Task { await app.refreshServiceMenus() }},identifier:"mainChat.model")
            #if os(iOS)
            if !model.capabilities.supports("workAndChat") { ComputerMenuButton(cloud:app.cloudLogin) }
            #else
            ComputerMenuButton(cloud:app.cloudLogin)
            #endif
        } else { legacyModelSelection }
    }
    @ViewBuilder private var legacyModelSelection: some View {
        #if os(iOS)
        if model.models.contains(where: \.configured) {
            Menu {
                if model.chat?.activeSessionId != nil { Label(model.models.first(where: { $0.id == model.chat?.modelProfileId })?.name ?? "当前模型",systemImage:"checkmark") }
                if model.chat?.activeSessionId == nil {
                    Picker("模型", selection: $model.modelID) { ForEach(model.models.filter(\.configured)) { Text($0.name).tag($0.id) } }
                }
                Button("配置模型") { showingModels = true }
            } label: {
                HStack(spacing:AppleTokens.Space.p4) {
                    Text(model.models.first(where: { $0.id == (model.chat?.modelProfileId ?? model.modelID) })?.name ?? "尚未配置")
                        .font(AppleTokens.Fonts.caption).lineLimit(1)
                    WeftIcon("chevron",size:AppleTokens.Space.p12)
                }.frame(minWidth:AppleTokens.Space.p44,maxWidth:AppleTokens.Space.p64 * 2,minHeight:AppleTokens.Space.p44)
                    .contentShape(Rectangle())
            }.buttonStyle(.plain).foregroundStyle(Weave.secondary).accessibilityLabel("模型选择，"+(model.models.first(where: { $0.id == (model.chat?.modelProfileId ?? model.modelID) })?.name ?? "尚未配置")).accessibilityIdentifier("mainChat.model")
        }
        #else
        if model.models.contains(where: \.configured) {
            if model.chat?.activeSessionId == nil {
                Picker("模型", selection: $model.modelID) { ForEach(model.models.filter(\.configured)) { Text($0.name).tag($0.id) } }
                    .frame(maxWidth: AppleTokens.Space.p24 * 8)
            } else {
                Text(model.models.first(where: { $0.id == model.chat?.modelProfileId })?.name ?? "当前模型")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }
        }
        #endif
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

#if os(iOS)
private struct PhoneMainRound: Identifiable {
    var events: [ChatEvent]
    var id: String { events[0].presentationID }
    static func group(_ events: [ChatEvent]) -> [Self] {
        var result: [Self] = []
        for event in events {
            if result.isEmpty || event.type == "user.message" { result.append(.init(events:[event])) }
            else { result[result.count-1].events.append(event) }
        }
        return result
    }
}
private struct PhoneMainRoundView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: MainChatModel
    let round: PhoneMainRound
    let running: Bool
    let onPosition: @MainActor (String,CGRect?,CGFloat,Bool) -> Void
    @State private var expanded=false
    private var steps: [ChatEvent] { round.events.filter { $0.type == "step.started" } }
    private var ended: ChatEvent? { round.events.last { $0.type == "turn.ended" || $0.type == "task.ended" } }
    private var summary: String {
        if running { return steps.last.map { "正在"+OperationNames.text($0.text)+"…" } ?? "正在准备回复…" }
        if ended?.data["reason"]?.string == "aborted" { return "已停止 · 已收到的文字保留" }
        if ended?.data["reason"]?.string == "error" || ended?.data["state"]?.string == "failed" { return "回复未完成" }
        return steps.isEmpty ? "已回复" : "已处理 · \(steps.count) 个步骤"
    }
    var body: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
            ForEach(round.events.filter { $0.type == "user.message" },id:\.presentationID) { event in row(event) }
            if round.events.contains(where: { $0.type != "user.message" }) || running {
                Button { withAnimation { expanded.toggle() } } label: {
                    HStack { WeftIcon(running ? "clock" : "allow",size:16); Text(summary).accessibilityIdentifier(ended == nil ? "mainChat.processLabel."+round.id : "replyOutcome"); Spacer(); WeftIcon(expanded ? "chevron" : "right",size:16) }
                        .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).frame(minHeight:AppleTokens.Space.p44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("mainChat.process."+round.id).accessibilityValue(expanded ? "已展开" : "已收起")
                if expanded {
                    ForEach(steps,id:\.presentationID) { event in row(event) }
                    if let event=ended { row(event) }
                }
            }
            ForEach(round.events.filter { !["user.message","step.started","turn.ended","task.ended"].contains($0.type) },id:\.presentationID) { event in row(event) }
            if let ended,ended.data["reason"]?.string == "error" {
                Button("重试") { Task { await model.regenerate(ended) } }.buttonStyle(OutlineActionStyle())
                    .accessibilityIdentifier("mainChat.retry."+round.id)
            }
        }.onAppear { expanded=running }.onChange(of:running) { _, value in expanded=value }
    }
    private func row(_ event: ChatEvent) -> some View {
        MainChatEventRow(app:app,model:model,event:event).fixedSize(horizontal:false,vertical:true)
            .background(Color.clear.id(event.id))
            .background(MainChatEventPosition(eventID:event.id,onPosition:onPosition))
    }
}
#endif

struct MainChatEventRow: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: MainChatModel
    let event: ChatEvent
    @State private var hovering = false
    @State private var attachmentPreview: ConversationAttachmentReference?
    @State private var detail: TimelineDetail?
    @State private var expanded = false
    private var message: Bool { event.type == "user.message" || event.type == "assistant.message" || event.type == "assistant.delta" }
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
                    if event.type.hasPrefix("assistant."), model.query.isEmpty {
                        MessageBodyView(text: event.text, messageID: event.presentationID, streaming: event.type == "assistant.delta").frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        highlighted(event.text).textSelection(.enabled).font(AppleTokens.Fonts.body).lineSpacing(AppleTokens.Space.p5)
                            .padding(AppleTokens.Space.p12).background(event.type == "user.message" ? Weave.soft : Weave.canvas, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
                    }
                    if event.type != "user.message" { Spacer(minLength: AppleTokens.Space.p0) }
                }

                #if os(iOS)
                if !originals.isEmpty || !images.isEmpty {
                ScrollView(.horizontal) { HStack(alignment:.top,spacing:AppleTokens.Space.p8) {
                ForEach(originals) { file in
                    ConversationAttachmentTile(model: app, reference: .original(file)) { preparePreviewFocus(); attachmentPreview = .original(file) }
                }
                if originals.isEmpty, let session = event.sessionID {
                    ForEach(images, id: \.attachmentId) { image in
                        ConversationAttachmentTile(model: app, reference: .sessionImage(image, session)) { preparePreviewFocus(); attachmentPreview = .sessionImage(image, session) }
                    }
                }
                } }.scrollIndicators(.hidden)
                }
                #else
                ForEach(originals) { file in
                    ConversationAttachmentTile(model: app, reference: .original(file)) { preparePreviewFocus(); attachmentPreview = .original(file) }
                }
                if originals.isEmpty, let session = event.sessionID {
                    ForEach(images, id: \.attachmentId) { image in
                        ConversationAttachmentTile(model: app, reference: .sessionImage(image, session)) { preparePreviewFocus(); attachmentPreview = .sessionImage(image, session) }
                    }
                }
                #endif
            } else if event.type == "artifact.created" {
                #if os(iOS)
                if let sessionID = event.sessionID, let bundle = model.artifactBundle(event) { ReplyArtifactList(app: app, sessionID: sessionID, bundle: bundle) }
                #else
                Button { expanded.toggle(); if expanded { Task { await readDetail() } } } label: {
                    HStack { WeftIcon(expanded ? "chevron" : "right", size: AppleTokens.Space.p16); Text(OperationNames.text(event.data["summary"]?.string ?? event.type)) }
                        .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                }.buttonStyle(.plain)
                if expanded, let detail { Text(detail.text).font(AppleTokens.Fonts.caption).textSelection(.enabled) }
                #endif
            } else if event.type == "turn.ended" || event.type == "task.ended" {
                #if os(iOS)
                if let sessionID = event.sessionID {
                    let outcome = ReplyOutcome.classify(events: model.sessionEvents(sessionID), taskID: event.data["taskId"]?.string ?? "turn-\(event.data["turn"]?.int ?? -1)")
                    Text(outcome.text).font(AppleTokens.Fonts.caption).foregroundStyle(outcome.prominent ? Weave.danger : Weave.muted).accessibilityIdentifier("replyOutcome")
                }
                #endif
            } else if event.type == "step.started" {
                Button { expanded.toggle(); if expanded { Task { await readDetail() } } } label: {
                    HStack { WeftIcon(expanded ? "chevron" : "right", size: AppleTokens.Space.p16); Text(OperationNames.text(event.data["summary"]?.string ?? event.type)) }
                        .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                }.buttonStyle(.plain)
                if expanded, let detail { Text(detail.text).font(AppleTokens.Fonts.caption).textSelection(.enabled) }
            }
        }
        .modifier(MessageActionsPresentation(app: app, id: event.id, text: event.text, at: event.at,
            user: event.type == "user.message", enabled: message && event.type != "assistant.delta",
            latest: event.id == model.window.events.last?.id,
            menuID: "mainChat.messageMenu." + event.id,
            quote: { model.setDraft(model.draft + (model.draft.isEmpty ? "" : "\n\n") + "> " + event.text.replacingOccurrences(of: "\n", with: "\n> ") + "\n") },
            regenerate: { Task { await model.regenerate(event) } },
            extra: { AnyView(messageActions) }))
            .accessibilityElement(children: .contain).accessibilityIdentifier("mainChat.event." + event.id)
            .attachmentCover(isPresented: Binding(get: { attachmentPreview != nil }, set: { if !$0 { attachmentPreview = nil } })) {
                if let reference = attachmentPreview { MainChatAttachmentPreview(app: app, model: model, reference: reference) { attachmentPreview = nil } }
            }
            .onChange(of: model.window.generation) { _, _ in attachmentPreview = nil; detail = nil; expanded = false }

    }
    private func preparePreviewFocus() {
        #if os(iOS)
        app.phonePreviewRequest=UUID()
        #endif
        dismissPhonePreviewKeyboard()
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
