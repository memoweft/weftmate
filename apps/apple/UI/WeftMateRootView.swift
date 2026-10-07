import SwiftUI
import WeftMateCore

struct WeftMateRootView: View {
    @ObservedObject var model: AppleAppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            if model.developmentRouteEnabled {
                Label("局域网开发联调", systemImage: "network")
                    .font(.caption).foregroundStyle(Weave.secondary)
                    .frame(maxWidth: .infinity).padding(.vertical, 6)
                    .background(Weave.accentSoft)
                    .accessibilityIdentifier("developmentRouteNotice")
            }
            Group {
                if model.restoring {
                    VStack(spacing: 20) {
                        BrandMark(size: 48)
                        ProgressView("正在打开 WeftMate…").font(.callout).foregroundStyle(Weave.muted)
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
        .tint(Weave.accent)
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
                            Label("刷新", systemImage: "arrow.clockwise")
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
        VStack(spacing: 0) {
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").foregroundStyle(Weave.muted)
                TextField("搜索原会话", text: $search)
                    .textFieldStyle(.plain)
                    .accessibilityLabel("搜索原会话")
            }
            .padding(7)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal, 16).padding(.top, 12)

            HStack(spacing: 10) {
                BrandMark(size: 30)
                Text("WeftMate").font(.title3.weight(.semibold)).tracking(-0.5)
                Spacer()
            }.padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 14)

            List(selection: $selected) {
                Section("最近对话") {
                    ConversationListContent(model: model, search: $search)
                    ForEach(filteredConversations) { conversation in
                        ConversationRow(conversation: conversation)
                            .tag(SidebarSelection.conversation(conversation.id))
                    }
                }
                Section {
                    Label("记忆", systemImage: "brain.head.profile").tag(SidebarSelection.memory)
                        .accessibilityIdentifier("memoryNavigation")
                    Label("设备", systemImage: "laptopcomputer.and.iphone").tag(SidebarSelection.devices)
                        .accessibilityIdentifier("devicesNavigation")
                    Label("设置", systemImage: "slider.horizontal.3").tag(SidebarSelection.settings)
                        .accessibilityIdentifier("settingsNavigation")
                }
            }
            .listStyle(.sidebar)
            .frame(minHeight: 0, maxHeight: .infinity)
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("conversationList")

            Divider()
            Button { selected = .settings } label: {
                HStack(spacing: 11) {
                    Text(String(model.accountName.prefix(1)).uppercased())
                        .font(.body.weight(.medium)).foregroundStyle(Weave.accent)
                        .frame(width: 34, height: 34).background(Weave.accentSoft, in: RoundedRectangle(cornerRadius: 11))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(model.accountName).font(.callout.weight(.medium)).lineLimit(1)
                        Text(model.verificationPending ? "等待重新验证登录" : model.serverDisplayName)
                            .font(.caption2).foregroundStyle(Weave.muted).lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Weave.muted)
                }
                .padding(16).contentShape(Rectangle())
            }
            .buttonStyle(.plain).accessibilityLabel("账户与设置")
        }
        .background(Weave.soft)
    }

    @ViewBuilder private var detail: some View {
        switch selected {
        case .conversation(let id):
            if let conversation = model.conversations.first(where: { $0.id == id }) {
                ConversationView(model: model, conversation: conversation)
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
    @State private var search = ""
    var body: some View {
        NavigationStack {
                List {
                    Section {
                        NavigationLink {
                            SpiritProfileView()
                        } label: {
                            HStack(spacing: 12) {
                                SpiritView(size: 48)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("接上之前的话题").font(.headline).foregroundStyle(Weave.ink)
                                    Text(model.accountName).font(.caption).foregroundStyle(Weave.muted)
                                }
                            }.padding(.vertical, 6)
                        }
                        .accessibilityLabel("小纬，接上之前的话题")
                        .accessibilityIdentifier("spiritNavigation")
                    }.listRowBackground(Weave.surface)
                    Section("最近对话") {
                        ConversationListContent(model: model, search: $search)
                        ForEach(filteredConversations) { conversation in
                            NavigationLink(value: conversation.id) { ConversationRow(conversation: conversation) }
                                .accessibilityIdentifier("conversationRow.\(conversation.id)")
                        }
                    }
                }
                .listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Weave.canvas)
                .searchable(text: $search, prompt: "搜索对话")
                .navigationTitle("对话")
                .navigationDestination(for: String.self) { id in
                    if let conversation = model.conversations.first(where: { $0.id == id }) {
                        ConversationView(model: model, conversation: conversation)
                    } else {
                        EmptyState(symbol: "text.bubble", title: "会话已变更", message: "返回会话列表后刷新。")
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        PhoneAccountMenu(model: model)
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button { Task { await model.refresh() } } label: {
                            Label("刷新会话", systemImage: "arrow.clockwise")
                        }.disabled(model.refreshing)
                    }
                }
                .refreshable { await model.refresh() }
                .accessibilityIdentifier("conversationList")
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
        VStack(alignment: .leading, spacing: 23) {
            SpiritView(size: 108)
            HStack(spacing: 9) {
                BrandMark(size: 25)
                Text("WeftMate").font(.callout.weight(.medium)).foregroundStyle(Weave.muted)
            }
            Text("\(model.accountName)，\n接着聊吧。")
                .font(.system(size: 34, weight: .medium)).tracking(-1).foregroundStyle(Weave.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("从侧栏选择一段原会话。\n你在其他设备上的记录，会在同一个账户中接续。")
                .font(.body).lineSpacing(7).foregroundStyle(Weave.muted)
            if let error = model.conversationsError {
                InlineNotice(message: error, isError: true)
                Button("重新连接") { Task { await model.refresh() } }.buttonStyle(.bordered)
                    .disabled(model.refreshing)
            } else if model.refreshing {
                HStack(spacing: 10) { ProgressView().controlSize(.small); Text("正在读取原会话…") }
                    .font(.callout).foregroundStyle(Weave.muted)
            } else if model.lastRefresh != nil {
                Label("已读取 \(model.conversations.count) 段原会话", systemImage: "checkmark.circle")
                    .font(.callout).foregroundStyle(Weave.secondary)
            }
        }
        .frame(maxWidth: 440, alignment: .leading).padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Weave.surface)
        .navigationTitle("WeftMate")
    }
}
