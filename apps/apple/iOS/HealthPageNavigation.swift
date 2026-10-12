import SwiftUI

struct PhoneWorkspace: View {
    @ObservedObject var model: AppleAppModel
    @State private var tab="chat"
    var body: some View {
        TabView(selection:$tab) {
            Group {
                if model.offline.hostOffline || model.offline.showHistory { OfflineChatView(app:model,model:model.offline) }
                else { PhoneChatWorkspace(model:model) }
            }.tabItem { Label("聊天",systemImage:"bubble.left") }.tag("chat")
            NavigationStack { DailyReviewView(app:model) }.tabItem { Label("动态",systemImage:"bell") }.tag("activity")
            NavigationStack { HealthPageView(app:model,ask:{ text in model.mainChat.setDraft(text); tab="chat" }) }.tabItem { Label("健康",systemImage:"heart") }.tag("health")
            NavigationStack { Text("目标会出现在这里。") .navigationTitle("目标") }.tabItem { Label("目标",systemImage:"flag") }.tag("goals")
            NavigationStack { MainChatResourcesView(app:model,model:model.mainChat) }.tabItem { Label("成果库",systemImage:"folder") }.tag("resources")
        }
    }
}
