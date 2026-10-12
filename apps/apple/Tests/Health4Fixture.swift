#if DEBUG && os(iOS) && targetEnvironment(simulator)
import SwiftUI
import WeftMateCore

/// Isolated HTTP + genuine simulator HealthKit; no production account or device is used.
struct Health4Fixture: View {
    @StateObject private var app=AppleAppModel()
    @ObservedObject var health: DailyHealthModel
    @State private var ready=false
    @State private var message="准备好合成样本后，连接测试账号"
    @State private var asking=false
    @State private var information=false
    var body: some View {
        NavigationStack {
            if ready {
                if asking {
                    VStack {
                        Text("主对话").font(.title)
                        TextField("输入消息",text:Binding(get:{app.mainChat.draft},set:{app.mainChat.setDraft($0)}),axis:.vertical).accessibilityIdentifier("health4.draft")
                        Button("返回健康") { asking=false }
                    }.padding()
                } else {
                    HealthPageView(app:app,ask:{ text in app.mainChat.setDraft(text); asking=true })
                }
            } else {
                VStack(spacing:24) {
                    Button("连接合成账号") { Task {
                        await app.authenticate(username:"health4_synthetic",password:"synthetic-only-A1!",displayName:"合成账号",register:false)
                        if app.session != nil {
                            health.reader.fixtureTemperature=36.5
                            health.reader.fixtureProfile=HealthProfile(birthYear:1986,sex:"male",heightCm:175,weightKg:70)
                            if !ProcessInfo.processInfo.arguments.contains("--health4-render-only") { await health.connect(app:app) }
                            await app.mainChat.configure()
                            if let data=try? JSONSerialization.data(withJSONObject:["chatId":"health4-main","revision":1,"running":false,"sendAvailable":true,"pinned":true,"archived":false,"unread":false,"activeSessionId":"health4-session","createdAt":"2026-10-01T00:00:00Z","updatedAt":"2026-10-01T00:00:00Z","title":"主对话","kind":"main","timeZone":TimeZone.current.identifier,"contentRevision":1]), let chat=try? JSONDecoder().decode(LogicalChat.self,from:data) { app.mainChat.chat=chat }
                            ready=true
                            if ProcessInfo.processInfo.arguments.contains("--health4-additional-info") { information=true }
                        } else { message="FAILED" }
                    } }.accessibilityIdentifier("health4.connectLegacy")
                    Text(message)
                }
            }
        }.sheet(isPresented:$information) { HealthAdditionalAuthorizationView(authorize:{ information=false },later:{ information=false }) }.environmentObject(health)
            .preferredColorScheme(ProcessInfo.processInfo.arguments.contains("dark") ? .dark : .light)
    }
}
struct Health4BackgroundRegistrationFixture: View {
    @StateObject private var first=DailyHealthModel()
    @StateObject private var second=DailyHealthModel()
    var body: some View {
        Text(DailyHealthBackground.registrationCount == 1 ? "PASS: two models, one launch registration" : "FAIL")
            .accessibilityIdentifier("health4.registrationResult")
            .task { DailyHealthBackground.register(); DailyHealthBackground.register(); _=first.state; _=second.state }
    }
}
#endif
