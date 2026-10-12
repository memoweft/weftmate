import SwiftUI
import WeftMateCore

struct PhoneWorkspace: View {
    @ObservedObject var model: AppleAppModel
    @State private var tab: PhoneTab = .chat
    @State private var chatRoot = UUID()
    @State private var keyboardVisible = false
    var body: some View {
        TabView(selection: $tab) {
            Group {
                if model.offline.hostOffline || model.offline.showHistory { OfflineChatView(app: model, model: model.offline) }
                else { PhoneChatWorkspace(model: model, tab: $tab) }
            }.id(chatRoot).tabItem { WeftLabel("聊天", icon: "chat") }.tag(PhoneTab.chat)
            NavigationStack { PhoneActivityView(app:model) }
                .tabItem { WeftLabel("动态", icon: "bell") }.tag(PhoneTab.activity)
            NavigationStack { HealthPageView(app: model, ask: { text in Task { await ask(text) } }).toolbar { PhoneAccountMenu(model: model) } }
                .tabItem { WeftLabel("健康", icon: "health") }.tag(PhoneTab.health)
            NavigationStack { PhoneGoalsView(app:model) }
                .tabItem { WeftLabel("目标", icon: "plan") }.tag(PhoneTab.goals)
            PhoneLibraryView(app:model)
                .tabItem { WeftLabel("成果库", icon: "outputs") }.tag(PhoneTab.resources)
        }
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom, spacing: AppleTokens.Space.p0) {
            if !keyboardVisible { PhoneBottomTabs(selection: $tab).background(Weave.canvas) }
        }
        // UIKit notifications are delivered as values; only the explicit MainActor task changes UI state.
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { @Sendable _ in Task { @MainActor in keyboardVisible = true } }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { @Sendable _ in Task { @MainActor in keyboardVisible = false } }
        .onChange(of:model.openedSessionID) { _,id in if id != nil { tab = .chat } }
        .onChange(of:model.phoneLibrarySelection) { _,id in if id != nil { tab = .resources } }
        .background(Weave.canvas).tint(Weave.accent).buttonStyle(PhoneActionStyle())
    }
    private func ask(_ text: String) async {
        let token = model.accountEpoch
        if !model.offline.hostOffline { await model.mainChat.configure() }
        guard token == model.accountEpoch else { return }
        if model.offline.hostOffline {
            model.offline.newConversation(recent: model.mainChat.chat?.id ?? model.conversations.first(where: \.isMainChat)?.id)
            model.offline.draft = text
        } else { model.mainChat.setDraft(text) }
        chatRoot = UUID(); tab = .chat
    }
}
