#if os(iOS)
import SwiftUI

/// Auxiliary pages keep the current conversation underneath the sheet.
struct PhoneAccountMenu: View {
    @ObservedObject var model: AppleAppModel
    @State private var route: Route?

    private enum Destination { case memory, devices, settings, spirit, health }
    private struct Route: Identifiable {
        let id = UUID()
        let destination: Destination
        let epoch: UUID
    }

    var body: some View {
        Menu {
            Button { open(.memory) } label: { Label("记忆", systemImage: "brain.head.profile") }
                .accessibilityIdentifier("phoneMenu.memory")
            Button { open(.spirit) } label: { Label("小纬", systemImage: "sparkles") }
                .accessibilityIdentifier("phoneMenu.spirit")
            Button { open(.health) } label: { Label("健康", systemImage: "heart") }
                .accessibilityIdentifier("phoneMenu.health")
            Divider()
            Button { open(.devices) } label: { Label("设备", systemImage: "laptopcomputer.and.iphone") }
                .accessibilityIdentifier("phoneMenu.devices")
            Button { open(.settings) } label: { Label("账户与设置", systemImage: "person.crop.circle") }
                .accessibilityIdentifier("phoneMenu.settings")
        } label: {
            Image(systemName: "person.crop.circle")
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
                            EmptyState(symbol: "heart", title: "健康摘要尚未接通",
                                message: "接通后，你可以选择要查看的健康项目。")
                                .padding(24).navigationTitle("健康")
                                .accessibilityIdentifier("healthUnavailable")
                        }
                    } else {
                        EmptyState(symbol: "person.crop.circle", title: "账户已变更",
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
