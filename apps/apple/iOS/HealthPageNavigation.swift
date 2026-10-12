import SwiftUI
import WeftMateCore

struct PhoneWorkspace: View {
    @ObservedObject var model: AppleAppModel
    @State private var tab: PhoneTab = .chat
    @State private var chatRoot = UUID()
    @State private var keyboardVisible = false
    @State private var visited: Set<PhoneTab> = [.chat]
    var body: some View {
        VStack(spacing:AppleTokens.Space.p0) {
            ZStack {
                ForEach(PhoneTab.allCases.filter { visited.contains($0) }) { item in
                    page(item).opacity(tab == item ? 1 : 0).allowsHitTesting(tab == item).accessibilityHidden(tab != item)
                }
            }.frame(maxWidth:.infinity,maxHeight:.infinity)
            if !keyboardVisible { PhoneBottomTabs(selection:$tab).background(Weave.canvas) }
        }
        .onChange(of:tab) { _,value in visited.insert(value) }
        // UIKit notifications are delivered as values; only the explicit MainActor task changes UI state.
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { @Sendable _ in Task { @MainActor in keyboardVisible = true } }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { @Sendable _ in Task { @MainActor in keyboardVisible = false } }
        .onChange(of:model.openedSessionID) { _,id in if id != nil { tab = .chat } }
        .onChange(of:model.phoneLibrarySelection) { _,id in if id != nil { tab = .resources } }
        .background(Weave.canvas).tint(Weave.accent).buttonStyle(PhoneActionStyle())
    }
    @ViewBuilder private func page(_ item: PhoneTab) -> some View {
        switch item {
        case .chat:
            Group {
                if model.offline.hostOffline || model.offline.showHistory { OfflineChatView(app:model,model:model.offline) }
                else { PhoneChatWorkspace(model:model,tab:$tab) }
            }.id(chatRoot)
        case .activity: NavigationStack { PhoneActivityView(app:model) }
        case .health: NavigationStack { HealthPageView(app:model,ask:{text in Task { await ask(text) }}).toolbar { PhoneAccountMenu(model:model) } }
        case .goals: NavigationStack { PhoneGoalsView(app:model) }
        case .resources: PhoneLibraryView(app:model)
        }
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
