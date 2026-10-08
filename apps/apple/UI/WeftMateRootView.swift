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
                        ProgressView("正在打开 WeftMate…").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Weave.canvas)
                } else if let session = model.session {
                    #if os(macOS)
                    MacWorkspace(model: model).id(session.account.ownerId)
                    #else
                    PhoneWorkspace(model: model).id(session.account.ownerId)
                    #endif
                } else {
                    AccountEntry(app: model, cloud: model.cloudLogin)
                }
            }
        }
        .overlay { CloudAccessPresenter(cloud: model.cloudLogin) }
        .sheet(item: $model.deletionCandidate) { _ in SessionDeleteSheet(app: model) }
        .task(id: "\(scenePhase)-\(model.accountEpoch)-\(model.session?.verification.rawValue ?? "none")") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.cloudLogin.poll()
                do { try await Task.sleep(for: .seconds(model.cloudLogin.waiting ? 3 : 30)) } catch { return }
            }
        }
        .tint(Weave.accent)
        .preferredColorScheme(AppleAppearance(rawValue: model.appearanceMode)?.colorScheme)
        .task {
            await model.start()
            #if DEBUG && os(macOS)
            if ProcessInfo.processInfo.arguments.contains("--ui-testing") && ProcessInfo.processInfo.arguments.contains("--lg2-capture") {
                if ProcessInfo.processInfo.arguments.contains("--a5-review-scene") {
                    NSApplication.shared.setActivationPolicy(.regular)
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    for window in NSApplication.shared.windows { window.makeKeyAndOrderFront(nil) }
                }
                try? await Task.sleep(for: .seconds(ProcessInfo.processInfo.arguments.contains("--a5-review-scene") ? 8 : 1))
                // Capture only this process's own displayed window; never enumerate other apps.
                typealias WindowImages = @convention(c) (CGRect, CFArray, UInt32) -> Unmanaged<CGImage>?
                let settingsCapture = argsForSettingsCapture()
                let windows = NSApplication.shared.windows.filter { $0.isVisible && (!settingsCapture || $0.title != "WeftMate") }
                    .sorted { ($0.sheetParent == nil ? 1 : 0) < ($1.sheetParent == nil ? 1 : 0) }
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

private struct MacWorkspace: View {
    @ObservedObject var model: AppleAppModel
    @Environment(\.openWindow) private var openWindow
    @State private var selected: SidebarSelection?
    @State private var search = ""

    var body: some View {
        GeometryReader { geometry in
            HSplitView {
                sidebar
                    .frame(minWidth: 230, idealWidth: 260, maxWidth: 320)
                    .frame(height: geometry.size.height)
                    .clipped()
                NavigationStack {
                    detail
                }
                .frame(minWidth: 440, maxWidth: .infinity)
                .frame(height: geometry.size.height)
                .clipped()
                .toolbar {
                    ToolbarItem(placement: .navigation) {
                        Button { Task { await model.refresh() } } label: {
                            WeftLabel("刷新", icon: "sync")
                        }.disabled(model.refreshing)
                    }
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        #if DEBUG
        .task(id: model.conversations.count) {
            let args = ProcessInfo.processInfo.arguments
            guard args.contains("--ui-testing"), let index = args.firstIndex(of: "--a5-review-scene"), args.indices.contains(index + 1) else { return }
            switch args[index + 1] {
            case "memory": selected = .memory
            case "appearance", "usage":
                model.settingsRoute = .init(categoryID: args[index + 1]); openWindow(id: "settings")
            case let category where category.hasPrefix("settings-"):
                model.settingsRoute = .init(categoryID: String(category.dropFirst(9))); openWindow(id: "settings")
            case "conversation", "approval", "question", "outputs-sources", "session-menu":
                if let conversation = model.conversations.first(where: { $0.title == "整理项目资料" }) { selected = .conversation(conversation.id) }
            default: selected = nil
            }
        }
        #endif
        .onChange(of: selected) { _, selection in
            if case .conversation = selection {} else { model.closeConversation() }
        }
    }

    private var sidebar: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            HStack(spacing: AppleTokens.Space.p7) {
                WeftIcon("search").foregroundStyle(Weave.muted)
                TextField("搜索对话", text: $search)
                    .textFieldStyle(.plain)
                    .accessibilityLabel("搜索对话")
            }
            .padding(AppleTokens.Space.p7)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r8))
            .padding(.horizontal, AppleTokens.Space.p16).padding(.top, AppleTokens.Space.p12)

            HStack(spacing: AppleTokens.Space.p10) {
                BrandMark(size: 30)
                Text("WeftMate").font(AppleTokens.Fonts.title3.weight(.semibold)).tracking(-0.5)
                Spacer()
            }.padding(.horizontal, AppleTokens.Space.p18).padding(.top, AppleTokens.Space.p18).padding(.bottom, AppleTokens.Space.p14)

            List(selection: $selected) {
                Section(model.showingArchived ? "已归档" : "最近对话") {
                    Button(model.showingArchived ? "返回最近对话" : "已归档") { model.showingArchived.toggle() }
                    if let error = model.lifecycleError { InlineNotice(message: error, isError: true) }
                    ConversationListContent(model: model, search: $search)
                    ForEach(filteredConversations) { conversation in
                        ConversationRow(conversation: conversation, selected: selected == .conversation(conversation.id))
                            .contextMenu { SessionActions(app: model, conversation: conversation) }
                            .tag(SidebarSelection.conversation(conversation.id))
                            .listRowBackground(selected == .conversation(conversation.id) ? Weave.accent : AppleTokens.Colors.clear)
                    }
                }
                Section {
                    WeftLabel("记忆", icon: "memory").tag(SidebarSelection.memory)
                        .accessibilityIdentifier("memoryNavigation")
                    Button { openWindow(id: "settings") } label: { WeftLabel("设置", icon: "settings") }
                        .accessibilityIdentifier("settingsNavigation")
                }
            }
            .listStyle(.sidebar)
            .frame(minHeight: 0, maxHeight: .infinity)
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("conversationList")

            Divider()
            Button { model.settingsRoute = .init(categoryID: "account"); openWindow(id: "settings") } label: {
                HStack(spacing: AppleTokens.Space.p11) {
                    Text(String(model.accountName.prefix(1)).uppercased())
                        .font(AppleTokens.Fonts.body.weight(.medium)).foregroundStyle(Weave.accent)
                        .frame(width: 34, height: 34).background(Weave.accentSoft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r11))
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p3) {
                        Text(model.accountName).font(AppleTokens.Fonts.callout.weight(.medium)).lineLimit(1)
                        if model.verificationPending {
                            Text("重新登录").font(AppleTokens.Fonts.caption2).foregroundStyle(Weave.muted)
                        }
                    }
                    Spacer()
                    WeftIcon("right", size: 16).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                }
                .padding(AppleTokens.Space.p16).contentShape(Rectangle())
            }
            .buttonStyle(.plain).accessibilityLabel("账户与设置")
        }
        .background(Weave.soft)
    }

    @ViewBuilder private var detail: some View {
        switch selected {
        case .conversation(let id):
            if let conversation = model.conversations.first(where: { $0.id == id }) {
                ConversationView(model: model, conversation: conversation).id(conversation.id + (conversation.sessionId ?? model.taskSessionID(for: conversation, accountEpoch: model.accountEpoch) ?? "") + model.accountEpoch.uuidString)
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
private struct PhoneWorkspace: View {
    @ObservedObject var model: AppleAppModel
    @StateObject private var health = HealthSettingsModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var search = ""
    var body: some View {
        NavigationStack {
                List {
                    Section(model.showingArchived ? "已归档" : "最近对话") {
                    Button(model.showingArchived ? "返回最近对话" : "已归档") { model.showingArchived.toggle() }
                    if let error = model.lifecycleError { InlineNotice(message: error, isError: true) }
                        ConversationListContent(model: model, search: $search)
                        ForEach(filteredConversations) { conversation in
                            NavigationLink(value: conversation.id) { ConversationRow(conversation: conversation) }
                                .contextMenu { SessionActions(app: model, conversation: conversation) }
                                .swipeActions { SessionActions(app: model, conversation: conversation) }
                                .accessibilityIdentifier("conversationRow.\(conversation.id)")
                        }
                    }
                }
                .listStyle(.plain).scrollContentBackground(.hidden).background(Weave.canvas)
                .searchable(text: $search, prompt: "搜索对话")
                .navigationTitle("WeftMate")
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(for: String.self) { id in
                    if let conversation = model.conversations.first(where: { $0.id == id }) {
                        ConversationView(model: model, conversation: conversation).id(conversation.id + (conversation.sessionId ?? model.taskSessionID(for: conversation, accountEpoch: model.accountEpoch) ?? "") + model.accountEpoch.uuidString)
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
                .accessibilityIdentifier("conversationList")
        }
        .environmentObject(health)
        .task(id: "\(model.accountEpoch)-\(scenePhase)-\(model.session?.verification.rawValue ?? "none")") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await health.activate(app: model)
                do { try await Task.sleep(for: .seconds(900)) } catch { return }
            }
        }
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
