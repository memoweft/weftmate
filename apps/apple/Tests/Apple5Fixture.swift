#if DEBUG && os(iOS) && targetEnvironment(simulator)
import SwiftUI

/// Real personal-host HTTP with isolated synthetic data; no HealthKit reads or cloud.
struct Apple5Fixture: View {
    @StateObject private var app=AppleAppModel()
    @ObservedObject var health: DailyHealthModel
    @State private var ready=false
    var body: some View {
        Group {
            if ready { PhoneWorkspace(model:app) }
            else { Text(app.authError ?? "正在连接合成账号…") }
        }.environmentObject(health).tint(Weave.accent).buttonStyle(PhoneActionStyle())
            .preferredColorScheme(ProcessInfo.processInfo.arguments.contains("dark") ? .dark : .light)
            .task {
                let environment=ProcessInfo.processInfo.environment
                await app.authenticate(username:environment["WEFTMATE_APPLE5_USERNAME"] ?? "",password:environment["WEFTMATE_APPLE5_PASSWORD"] ?? "",displayName:"合成账号",register:false)
                guard app.session != nil else { return }
                await app.mainChat.configure(); await app.mainChat.read(replace:true); await app.refresh(); ready=true
            }
    }
}
#endif
