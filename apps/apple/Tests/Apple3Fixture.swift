#if DEBUG && os(iOS) && targetEnvironment(simulator)
import SwiftUI
import WeftMateCore

/// Real native views, synthetic loopback contracts, no HealthKit read or sample seeding.
struct Apple3Fixture: View {
    @StateObject private var app = AppleAppModel()
    @ObservedObject var health: DailyHealthModel
    @State private var ready = false
    @State private var scenario = "stream"
    private let scenarios = ["stream", "final", "aligned", "warning", "files", "recovered", "interrupted", "failed", "health", "permissions", "healthSettings"]
    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            if ready {
                HStack {
                    Menu { ForEach(scenarios, id: \.self) { value in Button(value) { Task { await select(value) } }.accessibilityIdentifier("apple3." + value) } }
                        label: { Text("合成场景") }.accessibilityIdentifier("apple3.scenarios")
                    Spacer()
                }.padding(AppleTokens.Space.p8)
            }
            NavigationStack {
            if ready {
                Group {
                    if scenario == "health" { HealthPageView(app: app, ask: { app.mainChat.setDraft($0) }) }
                    else if scenario == "permissions" { SettingsView(model: app, route: .init(categoryID: "approvals")) }
                    else if scenario == "healthSettings" { Form { HealthAISettingsRow(app: app) } }
                    else { MainChatView(app: app).id(scenario) }
                }
            } else { Text(app.authError ?? "正在连接合成账号…") }
            }.id(scenario)
        }.environmentObject(health)
            .preferredColorScheme(ProcessInfo.processInfo.arguments.contains("dark") ? .dark : .light)
            .task {
                await app.authenticate(username: "health4_synthetic", password: "synthetic-only-A1!", displayName: "合成账号", register: false)
                if app.session != nil { await select("stream"); ready = true }
            }
    }
    private func select(_ value: String) async {
        guard let origin = app.session?.server.origin else { return }
        var request = URLRequest(url: origin.appendingPathComponent("fixture/apple3"))
        request.httpMethod = "POST"; request.httpBody = try? JSONSerialization.data(withJSONObject: ["scenario": value])
        _ = try? await URLSession.shared.data(for: request)
        app.mainChat.invalidate(); await app.mainChat.configure(); await app.mainChat.read(replace: true); scenario = value
    }
}
#endif
