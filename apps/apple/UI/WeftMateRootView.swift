import SwiftUI
#if os(macOS)
import AppKit
import Darwin
#endif
import WeftMateCore

struct WeftMateRootView: View {
    #if DEBUG && os(macOS)
    private func argsForSettingsCapture() -> Bool {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "--a5-review-scene"), args.indices.contains(index + 1) else { return false }
        return ["appearance", "usage"].contains(args[index + 1]) || args[index + 1].hasPrefix("settings-")
    }
    #endif
    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    #endif
    @ObservedObject var model: AppleAppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            if model.developmentRouteEnabled {
                WeftLabel("局域网开发联调", icon: "cloud", size: 16)
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.secondary)
                    .frame(maxWidth: .infinity).padding(.vertical, AppleTokens.Space.p6)
                    .background(Weave.accentSoft)
                    .accessibilityIdentifier("developmentRouteNotice")
            }
            Group {
                if model.restoring {
                    VStack(spacing: AppleTokens.Space.p20) {
                        BrandMark(size: 48)
                        ProgressView("正在打开 WeftMate…").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted).accessibilityLabel("正在打开 WeftMate…").accessibilityIdentifier("app.loading")
                    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Weave.canvas)
                } else if let session = model.session {
                    OfflineWorkspace(app: model, model: model.offline).id(session.account.ownerId)
                } else {
                    AccountEntry(app: model, cloud: model.cloudLogin)
                }
            }
        }
        #if os(iOS)
        .overlay(alignment: .bottom) { ArchiveUndoBar(app: model) }
        #endif
        .overlay { CloudAccessPresenter(cloud: model.cloudLogin) }
        .sheet(item: Binding(get: { model.deletionInSettings ? nil : model.deletionCandidate }, set: { model.deletionCandidate = $0 })) { _ in SessionDeleteSheet(app: model) }
        #if os(iOS)
        .sheet(item: $model.sessionMenuCandidate) { row in
            NavigationStack {
                List { SessionActions(app: model, conversation: row, onSelect: { model.sessionMenuCandidate = nil }) }
                    .listStyle(.insetGrouped).navigationTitle("对话操作").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button { model.sessionMenuCandidate = nil } label: { WeftIcon("deny") }.accessibilityLabel("关闭对话操作") } }
            }.presentationDetents([.medium, .large])
        }
        #endif
        .sheet(item: $model.projectEditor) { _ in ProjectEditorSheet(app: model) }
        .sheet(item: $model.projectConversation) { _ in ProjectConversationSheet(app: model) }
        .sheet(item: $model.groupCandidate) { _ in SessionGroupSheet(app: model) }
        .task(id: "\(scenePhase)-\(model.accountEpoch)-\(model.session?.verification.rawValue ?? "none")") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.cloudLogin.poll()
                do { try await Task.sleep(for: .seconds(model.cloudLogin.waiting ? 3 : 30)) } catch { return }
            }
        }
        .task(id: "offline-\(scenePhase)-\(model.accountEpoch)-\(model.session?.hostId ?? "none")") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.pollOffline()
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
        .tint(Weave.accent)
        .preferredColorScheme(AppleAppearance(rawValue: model.appearanceMode)?.colorScheme)
        .task {
            #if DEBUG && os(macOS)
            let captureArgs = ProcessInfo.processInfo.arguments
            if captureArgs.contains("--ui-testing"), captureArgs.contains("--lg2-capture"), captureArgs.contains("a17-loading") {
                Task { @MainActor in
                    NSApplication.shared.accessibilitySetValue(true, forAttribute: NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface"))
                    NSApplication.shared.setActivationPolicy(.regular); NSApplication.shared.activate(ignoringOtherApps: true)
                    try? await Task.sleep(for: .seconds(2))
                    A16MacReview.captureVisible("loading", single: true); Darwin.exit(0)
                }
            }
            #endif
            await model.start()
            #if DEBUG && os(macOS)
            if ProcessInfo.processInfo.arguments.contains("--ui-testing") && ProcessInfo.processInfo.arguments.contains("--lg2-capture") {
                NSApplication.shared.accessibilitySetValue(true, forAttribute: NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface"))
                if let index = ProcessInfo.processInfo.arguments.firstIndex(of: "--a5-review-scene"),
                   ProcessInfo.processInfo.arguments[index + 1] != "login", model.session == nil {
                    FileHandle.standardOutput.write(Data(("A5_CAPTURE_FAILED:authentication: " + (model.authError ?? "no session") + "\n").utf8))
                    Darwin.exit(1)
                }
                if ProcessInfo.processInfo.arguments.contains("--a16-driver") {
                    do { try await A16MacReview.runPersistent(model) }
                    catch { try? await A10MacReview.capture("failure", identifier: "weftmateRoot"); FileHandle.standardOutput.write(Data(("A5_CAPTURE_FAILED:" + String(describing: error) + "\n").utf8)); Darwin.exit(1) }
                    Darwin.exit(0)
                }
                if ProcessInfo.processInfo.arguments.contains("--a15-driver") {
                    do { try await A15MacReview.run(model) { openWindow(id: "settings") } }
                    catch { try? await A10MacReview.capture("failure", identifier: "weftmateRoot"); FileHandle.standardOutput.write(Data(("A5_CAPTURE_FAILED:" + String(describing: error) + "\n").utf8)); Darwin.exit(1) }
                    Darwin.exit(0)
                }
                if A14TestSupport.driver != nil {
                    do { try await A14MacReview.run(model) }
                    catch { FileHandle.standardOutput.write(Data(("A5_CAPTURE_FAILED:" + String(describing: error) + "\n").utf8)); Darwin.exit(1) }
                    Darwin.exit(0)
                }
                if let index = ProcessInfo.processInfo.arguments.firstIndex(of: "--a5-review-scene"),
                   ProcessInfo.processInfo.arguments[index + 1] == "a13-all" {
                    do { try await A13MacReview.run(model) { openWindow(id: "settings") } }
                    catch { FileHandle.standardOutput.write(Data(("A5_CAPTURE_FAILED:" + String(describing: error) + "\n").utf8)); Darwin.exit(1) }
                    Darwin.exit(0)
                }
                if let index = ProcessInfo.processInfo.arguments.firstIndex(of: "--a5-review-scene"),
                   ProcessInfo.processInfo.arguments[index + 1] == "a12-login" {
                    do { try await A12MacReview.run(model) { openWindow(id: "settings") } }
                    catch { FileHandle.standardOutput.write(Data(("A5_CAPTURE_FAILED:" + String(describing: error) + "\n").utf8)); Darwin.exit(1) }
                    Darwin.exit(0)
                }
                if let index = ProcessInfo.processInfo.arguments.firstIndex(of: "--a5-review-scene"),
                   ProcessInfo.processInfo.arguments[index + 1] == "a10-all" {
                    do { try await A10MacReview.run(model) { openWindow(id: "settings") } }
                    catch {
                        FileHandle.standardOutput.write(Data(("A5_CAPTURE_FAILED:" + String(describing: error) + "\n").utf8))
                        Darwin.exit(1)
                    }
                    Darwin.exit(0)
                }
                if let index = ProcessInfo.processInfo.arguments.firstIndex(of: "--a5-review-scene"), ["a11-all", "a11-remote"].contains(ProcessInfo.processInfo.arguments[index + 1]) {
                    do { try await A11MacReview.run(model, local: ProcessInfo.processInfo.arguments[index + 1] == "a11-all") }
                    catch { FileHandle.standardOutput.write(Data(("A5_CAPTURE_FAILED:" + String(describing: error) + "\n").utf8)); Darwin.exit(1) }
                    Darwin.exit(0)
                }
                if ProcessInfo.processInfo.arguments.contains("--a5-review-scene") {
                    NSApplication.shared.setActivationPolicy(.regular)
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    for window in NSApplication.shared.windows { window.makeKeyAndOrderFront(nil) }
                }
                try? await Task.sleep(for: .seconds(ProcessInfo.processInfo.arguments.contains("--a5-review-scene") ? 8 : 1))
                if let index = ProcessInfo.processInfo.arguments.firstIndex(of: "--a5-review-scene") {
                    let scene = ProcessInfo.processInfo.arguments[index + 1]
                    let identifier = scene.hasPrefix("settings-") ? "settingsPage." + String(scene.dropFirst(9))
                        : ["appearance", "usage"].contains(scene) ? "settingsPage." + scene
                        : ["conversation", "composer-context", "a9-detail", "a9-send", "approval", "question", "outputs-sources", "session-menu"].contains(scene) ? "conversationDetail" : nil
                    if let identifier {
                        do { _ = try await A10MacReview.wait(identifier) }
                        catch {
                            FileHandle.standardOutput.write(Data(("A5_CAPTURE_FAILED:missing scene: " + identifier + "\n").utf8))
                            Darwin.exit(1)
                        }
                    }
                }
                if let index = ProcessInfo.processInfo.arguments.firstIndex(of: "--a5-review-scene"), (ProcessInfo.processInfo.arguments[index + 1].hasPrefix("a17-") || ProcessInfo.processInfo.arguments[index + 1] == "session-menu") {
                    A16MacReview.captureVisible(ProcessInfo.processInfo.arguments[index + 1], single: true); Darwin.exit(0)
                }
                // Capture only this process's own displayed window; never enumerate other apps.
                typealias WindowImages = @convention(c) (CGRect, CFArray, UInt32) -> Unmanaged<CGImage>?
                let settingsCapture = argsForSettingsCapture()
                let windows = NSApplication.shared.orderedWindows.filter { $0.isVisible && (!settingsCapture || A10MacReview.find("settingsPage." + model.settingsRoute.categoryID, in: $0) != nil) }
                if settingsCapture {
                    // The launch workaround can refocus the main window. Capture the
                    // independent settings window in its actual active appearance.
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    windows.first(where: { $0.sheetParent == nil })?.makeKeyAndOrderFront(nil)
                    try? await Task.sleep(for: .milliseconds(300))
                }
                // Sheets have their own window-server IDs. Include only this app's
                // visible windows so usage and session menus appear over their parent.
                var ids: [UnsafeRawPointer?] = windows.map { UnsafeRawPointer(bitPattern: $0.windowNumber) }
                if !ids.isEmpty, let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImageFromArray") {
                    let array = CFArrayCreate(kCFAllocatorDefault, &ids, ids.count, nil)!
                    let capture = unsafeBitCast(symbol, to: WindowImages.self)
                    if let image = capture(.null, array, 1)?.takeRetainedValue() {
                        let bitmap = NSBitmapImageRep(cgImage: image)
                        if let data = bitmap.representation(using: .png, properties: [:]) {
                            FileHandle.standardOutput.write(Data(("LG2_CAPTURE:" + data.base64EncodedString() + "\n").utf8))
                        }
                    }
                }
                // AppKit defers termination while a review sheet is open. This isolated
                // capture process has already flushed its PNG; the parent removes test state.
                Darwin.exit(0)
            }
            #endif
        }
        .onAppear { model.setForeground(scenePhase == .active) }
        .onChange(of: scenePhase) { _, phase in model.setForeground(phase == .active) }
        .onDisappear { model.setForeground(false) }
        .accessibilityIdentifier("weftmateRoot")
    }
}

private struct AccountEntry: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var cloud: CloudLoginModel
    var body: some View {
        Group {
            if cloud.authenticated { CloudAccountHome(app: app, cloud: cloud) }
            else { AuthView(model: cloud) }
        }.task {
            while !Task.isCancelled {
                await cloud.poll()
                do { try await Task.sleep(for: .seconds(cloud.waiting ? 3 : 30)) } catch { return }
            }
        }
    }
}

#if os(macOS)
private enum SidebarSelection: Hashable {
    case conversation(String), memory
}

struct MacWorkspace: View {
    @ObservedObject var model: AppleAppModel
    @Environment(\.openWindow) private var openWindow
    @State private var selected: SidebarSelection?
    @State private var search = ""
    @State private var showingSidebar = false
    @State private var availableWidth: CGFloat = 1080

    var body: some View {
        Group {
            HSplitView {
                if availableWidth >= 720 { sidebar
                    .frame(minWidth: 230, idealWidth: 260, maxWidth: 320)
                    .frame(maxHeight: .infinity)
                    .clipped() }
                NavigationStack {
                    detail
                }
                .frame(minWidth: 440, maxWidth: .infinity)
                .frame(maxHeight: .infinity)
                .clipped()
                .toolbar {
                    ToolbarItem(placement: .navigation) {
                        if availableWidth < 720 {
                            Button { showingSidebar.toggle() } label: { WeftIcon("sidebar") }
                                .accessibilityLabel("侧栏").accessibilityIdentifier("macSidebarToggle").accessibilityValue(showingSidebar ? "已展开" : "已收起")
                        }
                    }
                    ToolbarItem(placement: .navigation) {
                        Button { Task { await model.refresh() } } label: {
                            WeftLabel("刷新", icon: "sync")
                        }.disabled(model.refreshing)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .overlay(alignment: .topLeading) {
            if showingSidebar && availableWidth < 720 {
                ZStack(alignment: .topLeading) {
                    AppleTokens.Colors.clear.contentShape(Rectangle()).onTapGesture { showingSidebar = false }
                    WeaveCard(padding: AppleTokens.Space.p0) { sidebar }
                        .frame(width: AppleTokens.Space.p28 * 10, height: AppleTokens.Space.p20 * 25)
                        .clipShape(RoundedRectangle(cornerRadius: AppleTokens.Radius.r14))
                        .padding(AppleTokens.Space.p8)
                        .accessibilityElement(children: .contain).accessibilityIdentifier("compactSidebar")
                }
            }
        }
        .onExitCommand { showingSidebar = false }
        .background(MacViewWidthObserver { availableWidth = $0 })
        #if DEBUG
        .task(id: model.conversations.count) {
            let args = ProcessInfo.processInfo.arguments
            guard args.contains("--ui-testing"), let index = args.firstIndex(of: "--a5-review-scene"), args.indices.contains(index + 1) else { return }
            switch args[index + 1] {
            case "a16-all", "a15-all", "a11-all", "a11-remote", "a17-empty", "a17-no-model", "a17-error": break
            case "memory", "memory-forget": selected = .memory
            case "appearance", "usage":
                model.settingsRoute = .init(categoryID: args[index + 1]); openWindow(id: "settings")
            case let category where category.hasPrefix("settings-"):
                model.settingsRoute = .init(categoryID: String(category.dropFirst(9))); openWindow(id: "settings")
            case "conversation-forget":
                if let conversation = model.conversations.first(where: { $0.title == "可遗忘的合成对话" }) { selected = .conversation(conversation.id) }
            case "a13-all", "a10-all", "a9-detail", "a9-send", "conversation", "composer-context", "approval", "question", "outputs-sources", "session-menu":
                if let conversation = model.conversations.first(where: { $0.title == "整理项目资料" }) { selected = .conversation(conversation.id) }
            default: selected = nil
            }
        }
        #endif
        .task(id: model.conversations.first(where: \.isMainChat)?.id) {
            if selected == nil, let main = model.conversations.first(where: \.isMainChat) { selected = .conversation(main.id) }
        }
        .onChange(of: model.openedSessionID) { _, id in
            guard let id else { return }; let epoch = model.accountEpoch
            Task { if let resolved = await model.resolveOpenedConversation(id), model.accountEpoch == epoch, model.openedSessionID == id { selected = .conversation(resolved) } }
        }
        .onChange(of: selected) { _, selection in
            showingSidebar = false
            if case .conversation = selection {} else { model.closeConversation() }
        }
    }

    private var sidebar: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            if let main = model.conversations.first(where: \.isMainChat) {
                Button { selected = .conversation(main.id) } label: {
                    HStack { BrandMark(size: AppleTokens.Space.p24); Text("WeftMate").font(AppleTokens.Fonts.body.weight(.medium)); Spacer() }
                        .padding(AppleTokens.Space.p12).background(selected == .conversation(main.id) ? Weave.accentSoft : Weave.soft)
                }.buttonStyle(.plain).accessibilityIdentifier("mainChat.navigation").accessibilityValue(selected == .conversation(main.id) ? "已选择" : "")
            }
            VStack(spacing: AppleTokens.Space.p4) {
                ForEach([("动态", "bell"), ("目标", "plan"), ("成果库", "outputs")], id: \.0) { title, icon in
                    Button {} label: { WeftLabel(title, icon: icon).frame(maxWidth: .infinity, alignment: .leading) }
                        .buttonStyle(.plain).disabled(true).help("Apple 页面即将支持")
                        .padding(.horizontal, AppleTokens.Space.p12).padding(.vertical, AppleTokens.Space.p6)
                }
            }.padding(.horizontal, AppleTokens.Space.p8)
            HStack(spacing: AppleTokens.Space.p7) {
                WeftIcon("search").foregroundStyle(Weave.muted)
                TextField("搜索对话", text: $search)
                    .textFieldStyle(.plain)
                    .accessibilityLabel("搜索对话")
            }
            .padding(AppleTokens.Space.p7)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r8))
            .padding(.horizontal, AppleTokens.Space.p16).padding(.top, AppleTokens.Space.p12)

            if !model.conversations.contains(where: \.isMainChat) {
            HStack(spacing: AppleTokens.Space.p10) {
                BrandMark(size: 30)
                Text("WeftMate").font(AppleTokens.Fonts.title3.weight(.semibold)).tracking(-0.5)
                Spacer()
            }.padding(.horizontal, AppleTokens.Space.p18).padding(.top, AppleTokens.Space.p18).padding(.bottom, AppleTokens.Space.p14)

            }
            List(selection: $selected) {
                if let error = model.lifecycleError { InlineNotice(message: error, isError: true) }
                ConversationListContent(model: model, search: $search)
                ForEach(model.sections(query: search)) { section in
                    Section {
                        Button { if model.collapsedSessionGroups.contains(section.id) { model.collapsedSessionGroups.remove(section.id) } else { model.collapsedSessionGroups.insert(section.id) } } label: {
                            HStack { Text(section.title).font(AppleTokens.Fonts.caption); Spacer(); WeftIcon(model.collapsedSessionGroups.contains(section.id) ? "right" : "chevron", size: AppleTokens.Space.p12) }.foregroundStyle(Weave.muted)
                        }.buttonStyle(SessionMenuRowStyle()).accessibilityIdentifier("sessionGroup." + section.id)
                        if !model.collapsedSessionGroups.contains(section.id) {
                            ForEach(section.rows) { conversation in
                                EditableSessionRow(app: model, conversation: conversation, selected: selected == .conversation(conversation.id))
                                    .tag(SidebarSelection.conversation(conversation.id))
                                    .listRowBackground(AppleTokens.Colors.clear).listRowSeparator(.hidden)
                            }
                        }
                    }
                }
                Section { ProjectsEmpty(app: model) } header: { ProjectsSectionTitle(app: model) }
                ForEach(model.projects.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || !model.projectRows($0, query: search).isEmpty }) { project in
                    Section {
                        ProjectHeading(app: model, project: project)
                        if !model.collapsedProjects.contains(project.id) || !search.isEmpty {
                            ForEach(model.projectRows(project, query: search)) { conversation in
                                EditableSessionRow(app: model, conversation: conversation, selected: selected == .conversation(conversation.id))
                                    .tag(SidebarSelection.conversation(conversation.id))
                                    .listRowBackground(AppleTokens.Colors.clear).listRowSeparator(.hidden)
                            }
                            ProjectMoreRows(app: model, project: project, search: search)
                        }
                    }
                }

            }
            .listStyle(.sidebar)
            .frame(minHeight: 0, maxHeight: .infinity)
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("conversationList")

            ArchiveUndoBar(app: model)
            Divider()
            MacAccountMenu(app: model)
        }
        .background(Weave.soft)
    }

    @ViewBuilder private var detail: some View {
        switch selected {
        case .conversation(let id):
            if let conversation = model.conversations.first(where: { $0.id == id }) {
                if conversation.isMainChat { MainChatView(app: model) } else {
                ConversationView(model: model, conversation: conversation).id(conversation.id + (conversation.sessionId ?? model.taskSessionID(for: conversation, accountEpoch: model.accountEpoch) ?? "") + model.accountEpoch.uuidString + String(conversation.chatContentRevision ?? 0))
                }
            } else {
                WelcomeView(model: model)
            }
        case .memory: MemoryWorkspaceView(appModel: model).id(model.accountEpoch)
        case nil: WelcomeView(model: model)
        }
    }

    private var filteredConversations: [WeftMateCore.ConversationSummary] {
        search.isEmpty ? model.visibleConversations : model.visibleConversations.filter { $0.title.localizedCaseInsensitiveContains(search) }
    }
}
#else
struct PhoneWorkspace: View {
    @ObservedObject var model: AppleAppModel
    @StateObject private var health = HealthSettingsModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var search = ""
    @State private var path: [String] = []
    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if model.conversations.contains(where: \.isMainChat) {
                    MainChatView(app: model)
                        .toolbar { ToolbarItem(placement: .navigation) { NavigationLink(value: "a16-side-list") { WeftLabel("旁聊与项目", icon: "sidebar") }.accessibilityIdentifier("mainChat.sideList") } }
                } else { sideList }
            }
                .navigationDestination(for: String.self) { id in
                    if id == "a16-side-list" {
                        sideList.toolbar {
                            ToolbarItem(placement: .primaryAction) { PhoneAccountMenu(model: model) }
                            ToolbarItem(placement: .primaryAction) {
                                Button { Task { await model.refresh() } } label: { WeftLabel("刷新会话", icon: "sync") }
                                    .disabled(model.refreshing)
                            }
                        }
                    }
                    else if let conversation = model.conversations.first(where: { $0.id == id }) {
                        if conversation.isMainChat { MainChatView(app: model) } else {
                        ConversationView(model: model, conversation: conversation).id(conversation.id + (conversation.sessionId ?? model.taskSessionID(for: conversation, accountEpoch: model.accountEpoch) ?? "") + model.accountEpoch.uuidString + String(conversation.chatContentRevision ?? 0))
                        }
                    } else {
                        EmptyState(symbol: "chat", title: "会话已变更", message: "返回会话列表后刷新。")
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        PhoneAccountMenu(model: model)
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button { Task { await model.refresh() } } label: {
                            WeftLabel("刷新会话", icon: "sync")
                        }.disabled(model.refreshing)
                    }
                }
                .refreshable { await model.refresh() }
                .accessibilityElement(children: .contain)
        }
        .onChange(of: model.openedSessionID) { _, id in
            guard let id else { return }; let epoch = model.accountEpoch
            Task {
                if let resolved = await model.resolveOpenedConversation(id), model.accountEpoch == epoch, model.openedSessionID == id {
                    if model.conversations.first(where: { $0.id == resolved })?.isMainChat == true { path = [] }
                    else { path = (path.first == "a16-side-list" ? ["a16-side-list"] : []) + [resolved] }
                }
            }
        }
        #if DEBUG
        .task {
            let args = ProcessInfo.processInfo.arguments
            if args.contains("--ui-testing"), let index = args.firstIndex(of: "--a12-live-session"), args.indices.contains(index + 1) {
                for _ in 0..<100 {
                    if let row = model.conversations.first(where: { $0.sessionId == args[index + 1] }) { path = [row.id]; break }
                    try? await Task.sleep(for: .milliseconds(100))
                }
            }
        }
        #endif
        .onChange(of: model.renamingSessionID) { _, id in if id != nil { path = model.conversations.contains(where: \.isMainChat) ? ["a16-side-list"] : [] } }
        .environmentObject(health)
        .task(id: "\(model.accountEpoch)-\(scenePhase)-\(model.session?.verification.rawValue ?? "none")") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await health.activate(app: model)
                do { try await Task.sleep(for: .seconds(900)) } catch { return }
            }
        }
    }

    private var sideList: some View {
                List {
                    Section {
                        ForEach([("动态", "bell"), ("目标", "plan"), ("成果库", "outputs")], id: \.0) { title, icon in
                            Button {} label: { WeftLabel(title, icon: icon) }.disabled(true).accessibilityHint("Apple 页面即将支持")
                        }
                    }

                    if let error = model.lifecycleError { InlineNotice(message: error, isError: true) }
                    ConversationListContent(model: model, search: $search)
                    ForEach(model.sections(query: search)) { section in
                        Section {
                            DisclosureGroup(isExpanded: Binding(get: { !model.collapsedSessionGroups.contains(section.id) }, set: { if $0 { model.collapsedSessionGroups.remove(section.id) } else { model.collapsedSessionGroups.insert(section.id) } })) {
                                ForEach(section.rows) { conversation in
                                    if model.renamingSessionID == conversation.id {
                                        EditableSessionRow(app: model, conversation: conversation)
                                    } else {
                                        NavigationLink(value: conversation.id) { ConversationRow(conversation: conversation) }
                                            .contextMenu { SessionActions(app: model, conversation: conversation) }
                                            .swipeActions(allowsFullSwipe: false) { Button("对话操作") { model.sessionMenuCandidate = conversation }.tint(Weave.accent) }
                                            .accessibilityIdentifier("conversationRow.\(conversation.id)")
                                    }
                                }
                            } label: { Text(section.title) }
                        }
                    }
                    Section {
                        ProjectsEmpty(app: model)
                        ForEach(model.projects.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || !model.projectRows($0, query: search).isEmpty }) { project in
                            ProjectHeading(app: model, project: project)
                            if !model.collapsedProjects.contains(project.id) || !search.isEmpty {
                                ForEach(model.projectRows(project, query: search)) { conversation in
                                    NavigationLink(value: conversation.id) { ConversationRow(conversation: conversation) }
                                        .contextMenu { SessionActions(app: model, conversation: conversation) }
                                        .swipeActions(allowsFullSwipe: false) { Button("对话操作") { model.sessionMenuCandidate = conversation }.tint(Weave.accent) }
                                        .accessibilityIdentifier("conversationRow." + conversation.id)
                                }
                                ProjectMoreRows(app: model, project: project, search: search)
                            }
                        }
                    } header: { ProjectsSectionTitle(app: model) }
                }
                .listStyle(.plain).scrollContentBackground(.hidden).background(Weave.canvas)
                .searchable(text: $search, prompt: "搜索对话")
                .navigationTitle("WeftMate")
                .navigationBarTitleDisplayMode(.inline)
                .accessibilityElement(children: .contain).accessibilityIdentifier("conversationList")
    }

    private var filteredConversations: [WeftMateCore.ConversationSummary] {
        search.isEmpty ? model.visibleConversations : model.visibleConversations.filter { $0.title.localizedCaseInsensitiveContains(search) }
    }
}
#endif

private struct WelcomeView: View {
    @ObservedObject var model: AppleAppModel
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p23) {
            BrandMark(size: 48)
            Text("接着聊吧")
                .font(AppleTokens.Fonts.largeTitle.weight(.medium)).tracking(-1).foregroundStyle(Weave.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("选择对话，接着处理你的目标。")
                .font(AppleTokens.Fonts.body).lineSpacing(AppleTokens.Space.p7).foregroundStyle(Weave.muted)
            if let error = model.conversationsError {
                InlineNotice(message: error, isError: true)
                Button("重新连接") { Task { await model.refresh() } }.buttonStyle(OutlineActionStyle())
                    .disabled(model.refreshing)
            } else if model.refreshing {
                HStack(spacing: AppleTokens.Space.p10) { ProgressView().controlSize(.small); Text("正在读取…") }
                    .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)

            }
        }
        .frame(maxWidth: 440, alignment: .leading).padding(AppleTokens.Space.p40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Weave.surface)
        .navigationTitle("WeftMate")
    }
}
