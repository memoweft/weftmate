import SwiftUI

struct PhoneWorkspace: View {
    @ObservedObject var model: AppleAppModel
    @State private var tab="chat"
    @State private var chatRoot=UUID()
    var body: some View {
        TabView(selection:$tab) {
            Group {
                if model.offline.hostOffline || model.offline.showHistory { OfflineChatView(app:model,model:model.offline) }
                else { PhoneChatWorkspace(model:model) }
            }.id(chatRoot).tabItem { WeftLabel("聊天",icon:"chat") }.tag("chat")
            NavigationStack { DailyReviewView(app:model) }.tabItem { WeftLabel("动态",icon:"bell") }.tag("activity")
            NavigationStack { HealthPageView(app:model,ask:{ text in Task { await ask(text) } }) }.tabItem { WeftLabel("健康",icon:"health") }.tag("health")
            NavigationStack { Text("目标会出现在这里。") .navigationTitle("目标") }.tabItem { WeftLabel("目标",icon:"plan") }.tag("goals")
            NavigationStack { MainChatResourcesView(app:model,model:model.mainChat) }.tabItem { WeftLabel("成果库",icon:"outputs") }.tag("resources")
        }
    }
    private func ask(_ text: String) async {
        let token=model.accountEpoch
        if !model.offline.hostOffline { await model.mainChat.configure() }
        guard token == model.accountEpoch else { return }
        if model.offline.hostOffline {
            model.offline.newConversation(recent:model.mainChat.chat?.id ?? model.conversations.first(where: \.isMainChat)?.id)
            model.offline.draft=text
        } else { model.mainChat.setDraft(text) }
        chatRoot=UUID(); tab="chat"
    }

}
