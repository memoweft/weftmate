#if DEBUG && os(iOS) && targetEnvironment(simulator)
import SwiftUI
import WeftMateCore

/// The production phone workspace with synthetic loopback data and isolated account state.
struct Apple4Fixture: View {
    @StateObject private var app = AppleAppModel()
    @ObservedObject var health: DailyHealthModel
    @State private var ready = false
    @State private var scenario = "final"
    private let scenarios = ["empty", "final", "stream", "aligned", "warning", "files", "side"]
    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            if ready {
                HStack {
                    Menu { ForEach(scenarios, id: \.self) { value in Button(value) { Task { await select(value) } } } }
                        label: { Text("合成场景") }.buttonStyle(PhoneActionStyle()).accessibilityIdentifier("apple4.scenarios")
                    Spacer()
                }.padding(.horizontal, AppleTokens.Space.p8)
                if scenario == "side", let row = app.conversations.first(where: { !$0.isMainChat }) {
                    NavigationStack { ConversationView(model: app, conversation: row) }
                } else { PhoneWorkspace(model: app).id(scenario) }
            } else { Text(app.authError ?? "正在连接合成账号…") }
        }.environmentObject(health).tint(Weave.accent).buttonStyle(PhoneActionStyle())
            .preferredColorScheme(ProcessInfo.processInfo.arguments.contains("dark") ? .dark : .light)
            .task {
                await app.authenticate(username: "health4_synthetic", password: "synthetic-only-A1!", displayName: "合成账号", register: false)
                if app.session != nil { await select("final"); ready = true }
            }
    }
    private func select(_ value: String) async {
        guard let origin = app.session?.server.origin else { return }
        var request = URLRequest(url: origin.appendingPathComponent("fixture/apple3"))
        request.httpMethod = "POST"; request.httpBody = try? JSONSerialization.data(withJSONObject: ["scenario": value == "side" ? "final" : value])
        _ = try? await URLSession.shared.data(for: request)
        app.mainChat.invalidate(); await app.mainChat.configure(); await app.mainChat.read(replace: true)
        await app.refresh()
        scenario = value
    }
}
#endif
