#if os(iOS)
import SwiftUI

/// Auxiliary pages keep the current conversation underneath the sheet.
struct PhoneAccountMenu: View {
    @ObservedObject var model: AppleAppModel
    @EnvironmentObject private var health: HealthSettingsModel
    @State private var route: Route?

    private enum Destination { case memory, devices, settings, spirit, health }
    private struct Route: Identifiable {
        let id = UUID()
        let destination: Destination
        let epoch: UUID
    }

    // Native menu labels expose their title and generated template icon to UIKit accessibility.
    var body: some View {
        Menu {
            Button { open(.memory) } label: { Label("记忆", image: "wm-memory") }
                .accessibilityLabel("记忆").accessibilityIdentifier("phoneMenu.memory")
            Button { open(.spirit) } label: { Label("小纬", image: "wm-pet") }
                .accessibilityLabel("小纬").accessibilityIdentifier("phoneMenu.spirit")
            Button { open(.health) } label: { Label("健康", image: "wm-health") }
                .accessibilityLabel("健康").accessibilityIdentifier("phoneMenu.health")
            Divider()
            Button { open(.devices) } label: { Label("设备", image: "wm-desktop") }
                .accessibilityLabel("设备").accessibilityIdentifier("phoneMenu.devices")
            Button { open(.settings) } label: { Label("账户与设置", image: "wm-account") }
                .accessibilityLabel("账户与设置").accessibilityIdentifier("phoneMenu.settings")
        } label: {
            WeftIcon("account")
        }
        .accessibilityLabel("账户菜单")
        .accessibilityIdentifier("phoneAccountMenu")
        .sheet(item: $route) { item in
            NavigationStack {
                Group {
                    if item.epoch == model.accountEpoch, model.session != nil {
                        switch item.destination {
                        case .memory: MemoryWorkspaceView(appModel: model).id(item.epoch)
                        case .devices: CloudDevicesView(app: model, cloud: model.cloudLogin)
                        case .settings: SettingsView(model: model)
                        case .spirit: SpiritProfileView()
                        case .health:
                            HealthSettingsView(model: health, app: model)
                        }
                    } else {
                        EmptyState(symbol: "account", title: "账户已变更",
                            message: "回到当前账户后重新打开。")
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { route = nil }
                            .accessibilityIdentifier("closeAuxiliarySheetButton")
                    }
                }
            }
            .preferredColorScheme(AppleAppearance(rawValue: model.appearanceMode)?.colorScheme)
        }
        .onChange(of: model.accountEpoch) { _, _ in route = nil }
    }

    private func open(_ destination: Destination) {
        route = Route(destination: destination, epoch: model.accountEpoch)
    }
}
#endif
