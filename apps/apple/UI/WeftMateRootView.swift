import SwiftUI
import WeftMateCore

struct WeftMateRootView: View {
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
                    AuthView(model: model)
                }
            }
        }
        .overlay { CloudAccessPresenter(cloud: model.cloudLogin) }
        .task(id: "\(scenePhase)-\(model.accountEpoch)-\(model.session?.verification.rawValue ?? "none")") {
            if scenePhase == .active { await model.cloudLogin.checkPending() }
        }
        .tint(Weave.accent)
        .preferredColorScheme(AppleAppearance(rawValue: model.appearanceMode)?.colorScheme)
        .task { await model.start() }
        .onAppear { model.setForeground(scenePhase == .active) }
        .onChange(of: scenePhase) { _, phase in model.setForeground(phase == .active) }
        .onDisappear { model.setForeground(false) }
        .accessibilityIdentifier("weftmateRoot")
    }
}

#if os(macOS)
private enum SidebarSelection: Hashable {
    case conversation(String), memory, devices, settings
}

private struct MacWorkspace: View {
    @ObservedObject var model: AppleAppModel
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
                Section("最近对话") {
                    ConversationListContent(model: model, search: $search)
                    ForEach(filteredConversations) { conversation in
                        ConversationRow(conversation: conversation, selected: selected == .conversation(conversation.id))
                            .tag(SidebarSelection.conversation(conversation.id))
                            .listRowBackground(selected == .conversation(conversation.id) ? Weave.accent : AppleTokens.Colors.clear)
                    }
                }
                Section {
                    WeftLabel("记忆", icon: "memory").tag(SidebarSelection.memory)
                        .accessibilityIdentifier("memoryNavigation")
                    WeftLabel("设备", icon: "desktop").tag(SidebarSelection.devices)
                        .accessibilityIdentifier("devicesNavigation")
                    WeftLabel("设置", icon: "settings").tag(SidebarSelection.settings)
                        .accessibilityIdentifier("settingsNavigation")
                }
            }
            .listStyle(.sidebar)
            .frame(minHeight: 0, maxHeight: .infinity)
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("conversationList")

            Divider()
            Button { selected = .settings } label: {
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
        case .devices: DevicesView(model: model)
        case .settings: SettingsView(model: model)
        case nil: WelcomeView(model: model)
        }
    }

    private var filteredConversations: [WeftMateCore.ConversationSummary] {
        search.isEmpty ? model.conversations : model.conversations.filter { $0.title.localizedCaseInsensitiveContains(search) }
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
                    Section("最近对话") {
                        ConversationListContent(model: model, search: $search)
                        ForEach(filteredConversations) { conversation in
                            NavigationLink(value: conversation.id) { ConversationRow(conversation: conversation) }
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
        search.isEmpty ? model.conversations : model.conversations.filter { $0.title.localizedCaseInsensitiveContains(search) }
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
