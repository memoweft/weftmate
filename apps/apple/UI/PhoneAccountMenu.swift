#if os(iOS)
import SwiftUI
import WeftMateCore

/// Existing avatar entry keeps the current conversation underneath settings.
struct PhoneAccountMenu: View {
    @ObservedObject var model: AppleAppModel
    @ObservedObject private var cloud: CloudLoginModel
    @EnvironmentObject private var health: DailyHealthModel
    @State private var showingSettings = false
    init(model: AppleAppModel) { self.model = model; cloud = model.cloudLogin }
    var body: some View {
        Button { showingSettings = true } label: { WeftIcon("account") }
            .phoneIcon().accessibilityLabel("设置").accessibilityIdentifier("phoneAccountMenu")
            .sheet(isPresented: $showingSettings) {
                SettingsView(model: model, onClose: { dismissPhonePreviewKeyboard(); showingSettings = false })
                    .environmentObject(health)
                    .preferredColorScheme(AppleAppearance(rawValue: model.appearanceMode)?.colorScheme)
            }
            .onChange(of: cloud.authenticated) { _, value in if value { dismissPhonePreviewKeyboard(); showingSettings = false } }
            .onChange(of: model.accountEpoch) { _, _ in showingSettings = false }
    }
}
#endif
