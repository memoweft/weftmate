import SwiftUI
import WeftMateCore

struct PhoneTaskProcessPage: View {
    @ObservedObject var app: AppleAppModel
    let sessionID: String
    let events: [TimelineEvent]
    @StateObject private var interactions: TaskInteractionModel
    @StateObject private var resources: ConversationResourcesModel
    init(app:AppleAppModel,sessionID:String,events:[TimelineEvent]) {
        self.app=app; self.sessionID=sessionID; self.events=events
        _resources=StateObject(wrappedValue:ConversationResourcesModel(app:app,sessionID:sessionID))
        _interactions=StateObject(wrappedValue:TaskInteractionModel(client:app.assistantClient,account:app.session,epoch:app.accountEpoch,stateDirectory:app.assistantStateDirectory,currentEpoch:{[weak app] in app?.accountEpoch ?? UUID()},currentSession:{[weak app] in app?.session}))
    }
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text(app.cloudLogin.selectedComputerName+" · 工作模式").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                let entries=TimelineProjection.entries(events)
                if entries.isEmpty { Text("还没有执行记录").foregroundStyle(Weave.muted) }
                ForEach(entries.filter { !$0.steps.isEmpty || $0.event.type.hasPrefix("approval.") || $0.event.type.hasPrefix("question.") }) { entry in
                    if !entry.steps.isEmpty {
                        TimelineExecutionBlock(appModel:app,client:app.assistantClient,sessionID:sessionID,entry:entry,interactions:interactions,openSources:{ resources.showingList=true; resources.visible=true },sourceEvents:events)
                    } else { TimelineInteractionCard(model:interactions,entry:entry,events:events) }
                    Divider()
                }
                Text("返回后仍在原来的对话和阅读位置。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }.padding(AppleTokens.Phone.pageInset)
        }.background(Weave.canvas).navigationTitle("执行详情").navigationBarTitleDisplayMode(.large).toolbar(.visible,for:.navigationBar)
            .navigationDestination(isPresented:$resources.visible) { PhoneConversationResourcesPage(app:app,resources:resources) }
            .task { interactions.activate(); await interactions.refreshTimeline(sessionID:sessionID) }
            .onDisappear { interactions.suspend() }.accessibilityIdentifier("phone.task")
    }
}
