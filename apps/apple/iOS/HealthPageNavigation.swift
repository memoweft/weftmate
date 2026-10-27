import SwiftUI
import WeftMateCore

struct PhoneWorkspace: View {
    @ObservedObject var model: AppleAppModel
    @ObservedObject private var cloud: CloudLoginModel
    @ObservedObject private var phone: PhoneStandaloneModel
    init(model: AppleAppModel, phone: PhoneStandaloneModel? = nil) { self.model = model; cloud = model.cloudLogin; self.phone = phone ?? model.phoneChat }
    @ObservedObject private var reminders = PhoneReminderNotifications.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var tab: PhoneTab = .chat
    @State private var chatPath: [String] = []
    @State private var activityPath: [String] = []
    @State private var healthPath: [String] = []
    @State private var visibleRoots: Set<PhoneTab> = []
    @State private var stackIDs = Dictionary(uniqueKeysWithValues: PhoneTab.allCases.map { ($0, UUID()) })
    @State private var chatRoot = UUID()
    @State private var keyboardVisible = false
    @State private var sidebar = false
    @State private var search = ""
    @State private var settingsOpen = false
    @State private var settingsAccount = false
    @AppStorage("phone.conversationMode") private var savedMode = "chat"
    private var currentPath: Binding<[String]> {
        switch tab { case .chat: $chatPath; case .activity: $activityPath; case .health: $healthPath }
    }
    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            PhoneTranscriptHandoffBanner(model: phone)
            TabView(selection: $tab) {
                stack(.chat, path: $chatPath).tag(PhoneTab.chat)
                stack(.activity, path: $activityPath).tag(PhoneTab.activity)
                stack(.health, path: $healthPath).tag(PhoneTab.health)
            }.toolbar(.hidden, for: .tabBar)
            if !keyboardVisible {
                PhoneBottomTabs(selection: $tab, reselect: resetCurrentTab).background(Weave.canvas)
            }
        }
        .phoneDrawer(open: $sidebar, canOpenFromEdge: visibleRoots.contains(tab) && currentPath.wrappedValue.isEmpty && !keyboardVisible) {
            PhoneSidebar(app: model, phone: phone, search: $search, close: { closeSidebar() }, newConversation: newConversation, newWork: newWork, mainConversation: mainConversation, navigate: navigate, settings: { account in
                closeSidebar(); settingsAccount = account; settingsOpen = true
            })
        }
        .environment(\.phoneSidebar, { openSidebar() })
        .environment(\.phoneOpenConversation, { openConversation($0) })
        .sheet(isPresented: $settingsOpen) {
            SettingsView(model: model, route: settingsAccount ? .init(categoryID: "account") : nil, onClose: { settingsOpen = false })
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { @Sendable _ in Task { @MainActor in keyboardVisible = true } }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { @Sendable _ in Task { @MainActor in keyboardVisible = false } }
        .onChange(of: cloud.subject) { _, _ in
            dismissPhonePreviewKeyboard(); keyboardVisible = false; sidebar = false
            chatPath = []; activityPath = []; healthPath = []; settingsOpen = false; search = ""
        }
        .onChange(of: model.openedSessionID) { _, id in openConversation(id) }
        .onChange(of: reminders.openedReminder) { _, route in navigateReminder(route) }
        .onAppear { openConversation(model.openedSessionID); navigateReminder(reminders.openedReminder) }
        .onChange(of: model.phoneLibrarySelection) { _, id in if id != nil { navigate(.library) } }
        .background(Weave.canvas).tint(Weave.accent).buttonStyle(PhoneActionStyle())
    }
    private func stack(_ item: PhoneTab, path: Binding<[String]>) -> some View {
        NavigationStack(path: path) {
            page(item).onAppear { visibleRoots.insert(item) }.onDisappear { visibleRoots.remove(item) }
                .navigationDestination(for: String.self) { id in
                    destination(id)
                        .toolbar(PhoneSidebarDestination(rawValue: id) != nil || id == "a16-side-list" ? .visible : .automatic, for: .navigationBar)
                        .toolbar {
                            if PhoneSidebarDestination(rawValue: id) != nil || id == "a16-side-list" {
                                ToolbarItem(placement: .topBarTrailing) { PhoneSidebarButton() }
                            }
                        }
                }
                .toolbar {
                    if item != .chat {
                        ToolbarItem(placement: .topBarLeading) {
                            Button { openSidebar() } label: { WeftIcon("sidebar") }.phoneIcon(quiet: true)
                                .accessibilityLabel("打开侧栏").accessibilityIdentifier("phone.sidebar")
                        }
                    }
                }
        }.opacity(tab == item ? 1 : 0.45)
            .offset(y: reduceMotion || tab == item ? 0 : AppleTokens.Space.p6)
            .animation(PhoneMotion.tabs(reduce: reduceMotion), value: tab)
            .id(stackIDs[item])
    }
    @ViewBuilder private func page(_ item: PhoneTab) -> some View {
        switch item {
        case .chat:
            Group {
                if phone.showsLocalConversation(connected: model.session != nil, openedSessionID: model.openedSessionID) { PhoneStandaloneChat(app: model, model: phone) }
                else if model.offline.hostOffline || model.offline.showHistory {
                    OfflineChatView(app: model, model: model.offline).toolbar {
                        ToolbarItem(placement: .topBarLeading) { Button { openSidebar() } label: { WeftIcon("sidebar") }.accessibilityLabel("打开侧栏").accessibilityIdentifier("phone.sidebar") }
                    }
                } else { PhoneChatWorkspace(model: model) }
            }.id(chatRoot)
        case .activity:
            if model.session == nil { PhoneComputerEmptyPage(app: model, title: "动态", explanation: "这里会显示提醒、任务进展和回顾。") }
            else { PhoneActivityView(app: model) }
        case .health:
            if model.session == nil { PhoneLocalHealthView(app: model) }
            else { HealthPageView(app: model, ask: { text in Task { await ask(text) } }).toolbar { PhoneAccountMenu(model: model) } }
        }
    }
    @ViewBuilder private func destination(_ id: String) -> some View {
        if let route = PhoneSidebarDestination(rawValue: id) {
            switch route {
            case .conversations:
                PhoneConversationsPage(app:model,phone:phone,query:$search)
            case .goals: PhoneGoalsView(app: model)
            case .library:
                if model.session == nil { PhoneComputerEmptyPage(app: model, title: "成果库", explanation: "这里会保存电脑完成的文件。") }
                else { PhoneLibraryView(app: model) }
            case .memory: PhoneMemoryWorkspaceView(app: model)
            case .projects: PhoneProjectsPage(app: model)
            }
        } else if id == "shell.work" {
            if model.offline.hostOffline, cloud.offlineWorkAuthorization?.supportsTasks == true, model.offline.workSnapshot?.taskRecipient != nil {
                ScrollView { PhoneOfflineWork(app: model).padding(AppleTokens.Phone.pageInset) }.navigationTitle("新建工作")
            } else {
                PhoneNewConversation(app: model, mode: .work).environment(\.phoneNavigationBack, { if !chatPath.isEmpty { chatPath.removeLast() } })
            }
        } else if id == "a16-side-list" {
            PhoneConversationsPage(app:model,phone:phone,query:$search)
        } else if id == "daily-review" { DailyReviewView(app: model) }
        else if id == "health" { HealthPageView(app: model, ask: { text in Task { await ask(text) } }) }
        else if let row = model.conversations.first(where: { $0.id == id }) {
            if row.isMainChat || model.mainChat.capabilities.supports("workAndChat") && row.logicalHistory == true {
                MainChatView(app: model, chatID: model.mainChat.capabilities.supports("workAndChat") ? row.chatId : nil).id(row.id)
            } else {
                ConversationView(model: model, conversation: row).id(row.id + (row.sessionId ?? model.taskSessionID(for: row, accountEpoch: model.accountEpoch) ?? "") + model.accountEpoch.uuidString + String(row.chatContentRevision ?? 0))
            }
        } else { EmptyState(symbol: "chat", title: "会话已变更", message: "返回会话列表后刷新。") }
    }
    private func openSidebar() {
        dismissPhonePreviewKeyboard()
        withAnimation(PhoneMotion.drawer(reduce: reduceMotion)) { sidebar = true }
    }
    private func resetCurrentTab() {
        if currentPath.wrappedValue.isEmpty {
            // Existing content also uses destination-based NavigationLinks, whose path is opaque.
            // Only an explicit reselect resets their stack; ordinary tab switches keep it mounted.
            stackIDs[tab] = UUID()
        } else { currentPath.wrappedValue = [] }
    }
    private func closeSidebar() { withAnimation(PhoneMotion.drawer(reduce: reduceMotion)) { sidebar = false } }
    private func navigate(_ route: PhoneSidebarDestination) {
        closeSidebar()
        if currentPath.wrappedValue.last != route.rawValue { currentPath.wrappedValue.append(route.rawValue) }
    }
    private func newConversation() {
        closeSidebar(); tab = .chat; chatPath = []; savedMode = "chat"
        if model.session == nil || phone.showsLocalConversation(connected: model.session != nil, openedSessionID: model.openedSessionID) {
            phone.newThread(); model.openedSessionID = phone.state.selected
        } else if model.offline.hostOffline { model.offline.newConversation() }
        else if model.mainChat.capabilities.supports("workAndChat") { model.openedSessionID = nil }
        else { Task { await model.mainChat.createSide() } }
    }
    private func newWork() {
        closeSidebar(); tab = .chat; savedMode = "work"; chatPath = ["shell.work"]
    }
    private func mainConversation() {
        closeSidebar(); tab = .chat; chatPath = []
        if let main = model.conversations.first(where: \.isMainChat) {
            if model.openedSessionID == main.id { openConversation(main.id) } else { model.openedSessionID = main.id }
        }
        else if model.session != nil { savedMode = "chat"; model.openedSessionID = nil }
        else if let id = phone.state.threads.first?.id { phone.select(id); model.openedSessionID = id }
    }
    private func openConversation(_ id: String?) {
        guard let id else { return }; closeSidebar(); tab = .chat
        if phone.state.threads.contains(where: { $0.id == id }) { chatPath = []; return }
        let epoch = model.accountEpoch
        Task {
            if let resolved = await model.resolveOpenedConversation(id), model.accountEpoch == epoch, model.openedSessionID == id {
                if let row = model.conversations.first(where: { $0.id == resolved }) { savedMode = WorkAndChat.mode(row).rawValue }
                chatPath = [resolved]
            }
        }
    }
    private func navigateReminder(_ route: ReminderRoute?) {
        guard route != nil else { return }
        if reminders.opensConversation { tab = .chat; chatPath = []; reminders.openedReminder = nil }
        else { navigate(.goals) }
    }
    private func ask(_ text: String) async {
        if model.session == nil {
            phone.newThread(); phone.draft = text; model.openedSessionID = phone.state.selected; chatPath = []; tab = .chat; return
        }
        let token = model.accountEpoch
        if !model.offline.hostOffline { await model.mainChat.configure() }
        guard token == model.accountEpoch else { return }
        model.openedSessionID = nil
        if model.offline.hostOffline {
            model.offline.newConversation(recent: model.mainChat.chat?.id ?? model.conversations.first(where: \.isMainChat)?.id); model.offline.draft = text
        } else if model.mainChat.capabilities.supports("workAndChat") { model.phoneNewConversationDraft = text }
        else { model.mainChat.setDraft(text) }
        chatPath = []; chatRoot = UUID(); tab = .chat
    }
}
