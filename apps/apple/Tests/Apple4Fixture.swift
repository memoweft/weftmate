#if DEBUG && os(iOS) && targetEnvironment(simulator)
import SwiftUI
import WeftMateCore

/// The production phone workspace with synthetic loopback data and isolated account state.
struct Apple4Fixture: View {
    @StateObject private var app = AppleAppModel()
    @ObservedObject var health: DailyHealthModel
    @State private var ready = false
    @State private var scenario = "final"
    @State private var query = ""
    private let scenarios = ["empty", "final", "stream", "aligned", "warning", "two", "long", "question", "files", "side", "conversations", "search", "history", "work", "projects", "resources", "task", "stream-long"]
    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            if ready {
                if !ProcessInfo.processInfo.arguments.contains("--ios-ui-2-capture") { HStack {
                    Menu { ForEach(scenarios, id: \.self) { value in Button(value) { Task { await select(value) } } } } label: { Text("合成场景") }.buttonStyle(PhoneActionStyle()).accessibilityIdentifier("apple4.scenarios")
                    Spacer()
                }.padding(.horizontal, AppleTokens.Space.p8) }
                if ["conversations","search"].contains(scenario) {
                    NavigationStack { PhoneConversationsPage(app:app,phone:app.phoneChat,query:$query) }
                } else if scenario == "history" { NavigationStack { MainChatView(app:app,initialDate:Date()) } }
                else if scenario == "work" { NavigationStack { PhoneNewConversation(app:app,mode:.work) } }
                else if scenario == "projects" { NavigationStack { PhoneProjectsPage(app:app) } }
                else if scenario == "resources" { NavigationStack { MainChatResourcesView(app:app,model:app.mainChat,embedded:true) } }
                else if scenario == "task" { NavigationStack { PhoneTaskProcessPage(app:app,sessionID:app.mainChat.chat?.activeSessionId ?? "",events:app.mainChat.nativeEvents) } }
                else if scenario == "side", let row = app.conversations.first(where: { !$0.isMainChat }) {
                    NavigationStack { ConversationView(model: app, conversation: row) }
                } else { PhoneWorkspace(model: app).id(scenario) }
            } else { Text(app.authError ?? "正在连接合成账号…") }
        }.environmentObject(health).tint(Weave.accent).buttonStyle(PhoneActionStyle())
            .preferredColorScheme(ProcessInfo.processInfo.arguments.contains("dark") ? .dark : .light)
            .dynamicTypeSize(ProcessInfo.processInfo.arguments.contains("--apple5-large") ? .accessibility3 : .large)
            .task {
                await app.authenticate(username: "health4_synthetic", password: "synthetic-only-A1!", displayName: "合成账号", register: false)
                if app.session != nil {
                    if ProcessInfo.processInfo.arguments.contains("--apple5-reset-presentation"),let origin=app.session?.server.origin {
                        var request=URLRequest(url:origin.appendingPathComponent("fixture/apple3"));request.httpMethod="POST";request.httpBody=try? JSONSerialization.data(withJSONObject:["reset":true]);_=try? await URLSession.shared.data(for:request)
                    }
                    await select("final"); ready = true
                }
            }
    }
    private func select(_ value: String) async {
        guard let origin = app.session?.server.origin else { return }
        var request = URLRequest(url: origin.appendingPathComponent("fixture/apple3"))
        request.httpMethod = "POST"; request.httpBody = try? JSONSerialization.data(withJSONObject: ["scenario": value == "side" ? "final" : value])
        _ = try? await URLSession.shared.data(for: request)
        app.mainChat.invalidate(); await app.mainChat.configure(); await app.mainChat.read(replace: true)
        await app.refresh()
        query=value == "search" ? "合成" : ""
        if value == "resources" { await app.mainChat.loadResources() }
        scenario = value
    }
}
#endif
