#if os(iOS)
import SwiftUI

/// Auxiliary pages keep the current conversation underneath the sheet.
struct PhoneAccountMenu: View {
    @ObservedObject var model: AppleAppModel
    @EnvironmentObject private var health: HealthSettingsModel
    @State private var route: Route?

    private enum Destination { case memory, settings, health }
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
            Button { open(.health) } label: { Label("健康", image: "wm-health") }
                .accessibilityLabel("健康").accessibilityIdentifier("phoneMenu.health")
            Divider()
            Button { open(.settings) } label: { Label("设置", image: "wm-settings") }
                .accessibilityLabel("设置").accessibilityIdentifier("phoneMenu.settings")
        } label: {
            WeftIcon("account")
        }
        .accessibilityLabel("账户菜单")
        .accessibilityIdentifier("phoneAccountMenu")
        .sheet(item: $route) { item in
            Group {
                if item.destination == .settings && item.epoch == model.accountEpoch && model.session != nil {
                    SettingsView(model: model, onClose: { route = nil })
                } else {
                    NavigationStack {
                Group {
                    if item.epoch == model.accountEpoch, model.session != nil {
                        switch item.destination {
                        case .memory: MemoryWorkspaceView(appModel: model).id(item.epoch)
                        case .settings: EmptyView()
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
