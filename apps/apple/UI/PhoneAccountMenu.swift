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

    var body: some View {
        Menu {
            Button { open(.memory) } label: { WeftLabel("记忆", icon: "memory") }
                .accessibilityIdentifier("phoneMenu.memory")
            Button { open(.spirit) } label: { WeftLabel("小纬", icon: "pet") }
                .accessibilityIdentifier("phoneMenu.spirit")
            Button { open(.health) } label: { WeftLabel("健康", icon: "health") }
                .accessibilityIdentifier("phoneMenu.health")
            Button("用 WeftMate 账号登录") {
                Task { await model.signOut(); if model.session == nil { model.cloudLogin.showLogin = true } }
            }
            Divider()
            Button { open(.devices) } label: { WeftLabel("设备", icon: "desktop") }
                .accessibilityIdentifier("phoneMenu.devices")
            Button { open(.settings) } label: { WeftLabel("账户与设置", icon: "account") }
                .accessibilityIdentifier("phoneMenu.settings")
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
                        case .devices: DevicesView(model: model)
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
        }
        .onChange(of: model.accountEpoch) { _, _ in route = nil }
    }

    private func open(_ destination: Destination) {
        route = Route(destination: destination, epoch: model.accountEpoch)
    }
}
#endif
