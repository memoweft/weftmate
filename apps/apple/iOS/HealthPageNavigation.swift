import SwiftUI
import WeftMateCore

struct PhoneWorkspace: View {
    @ObservedObject var model: AppleAppModel
    @ObservedObject private var cloud: CloudLoginModel
    @ObservedObject private var phone: PhoneStandaloneModel
    init(model: AppleAppModel) { self.model=model; cloud=model.cloudLogin;phone=model.phoneChat }
    @ObservedObject private var reminders=PhoneReminderNotifications.shared
    @State private var tab: PhoneTab = .chat
    @State private var chatRoot = UUID()
    @State private var keyboardVisible = false
    @State private var visited: Set<PhoneTab> = [.chat]
    var body: some View {
        VStack(spacing:AppleTokens.Space.p0) {
            PhoneTranscriptHandoffBanner(model:model.phoneChat)
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
        .onChange(of:cloud.subject) { _,_ in dismissPhonePreviewKeyboard(); keyboardVisible=false }
        .onChange(of:model.openedSessionID) { _,id in if id != nil { tab = .chat } }
        .onChange(of:reminders.openedReminder) { _,route in navigateReminder(route) }
        .onAppear { navigateReminder(reminders.openedReminder) }
        .onChange(of:model.phoneLibrarySelection) { _,id in if id != nil { tab = .resources } }
        .background(Weave.canvas).tint(Weave.accent).buttonStyle(PhoneActionStyle())
    }
    @ViewBuilder private func page(_ item: PhoneTab) -> some View {
        switch item {
        case .chat:
            Group {
                if phone.showsLocalConversation(connected:model.session != nil,openedSessionID:model.openedSessionID) { PhoneStandaloneChat(app:model,model:model.phoneChat,tab:$tab) }
                else if model.offline.hostOffline || model.offline.showHistory { OfflineChatView(app:model,model:model.offline) }
                else { PhoneChatWorkspace(model:model,tab:$tab) }
            }.id(chatRoot)
        case .activity: NavigationStack { if model.session == nil { PhoneComputerEmptyPage(app:model,title:"动态",explanation:"这里会显示提醒、任务进展和回顾。") } else { PhoneActivityView(app:model) } }
        case .health: NavigationStack { if model.session == nil { PhoneLocalHealthView(app:model) } else { HealthPageView(app:model,ask:{text in Task { await ask(text) }}).toolbar { PhoneAccountMenu(model:model) } } }
        case .goals: NavigationStack { PhoneGoalsView(app:model) }
        case .resources: if model.session == nil { NavigationStack { PhoneComputerEmptyPage(app:model,title:"成果库",explanation:"这里会保存电脑完成的文件。") } } else { PhoneLibraryView(app:model) }
        }
    }
    private func navigateReminder(_ route: ReminderRoute?) {
        guard route != nil else { return }
        tab=reminders.opensConversation ? .chat : .goals;visited.insert(tab)
        if reminders.opensConversation { reminders.openedReminder=nil }
    }
    private func ask(_ text: String) async {
        if model.session == nil {
            phone.newThread();phone.draft=text;model.openedSessionID=phone.state.selected;chatRoot=UUID();tab = .chat;return
        }
        let token = model.accountEpoch
        if !model.offline.hostOffline { await model.mainChat.configure() }
        guard token == model.accountEpoch else { return }
        model.openedSessionID=nil
        if model.offline.hostOffline {
            model.offline.newConversation(recent: model.mainChat.chat?.id ?? model.conversations.first(where: \.isMainChat)?.id)
            model.offline.draft = text
        } else if model.mainChat.capabilities.supports("workAndChat") { model.phoneNewConversationDraft=text }
        else { model.mainChat.setDraft(text) }
        chatRoot = UUID(); tab = .chat
    }
}
