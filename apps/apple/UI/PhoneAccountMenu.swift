#if os(iOS)
import SwiftUI
import WeftMateCore

/// Auxiliary pages keep the current conversation underneath the sheet.
struct PhoneAccountMenu: View {
    @ObservedObject var model: AppleAppModel
    @EnvironmentObject private var health: HealthSettingsModel
    @StateObject private var usage: AccountUsageModel
    init(model: AppleAppModel) { self.model = model; _usage = StateObject(wrappedValue: AccountUsageModel(app: model)) }
    @State private var confirmingLogout = false
    @State private var route: Route?

    private enum Destination { case memory, settings, about, health }
    private struct Route: Identifiable {
        let id = UUID()
        let destination: Destination
        let epoch: UUID
    }

    // Native menu labels expose their title and generated template icon to UIKit accessibility.
    var body: some View {
        Menu {
            Text(model.accountName)
            Text(model.cloudLogin.authenticated ? model.cloudLogin.email : "本机账户：" + (model.session?.account.username ?? ""))
            if let summary = usage.summary {
                Text(AccountUsagePresentation.text(summary))
                if let notice = summary.total.uncertaintyNotice { Text(notice) }
            } else { Text(usage.error ?? "正在读取本月用量…") }
            Button { open(.memory) } label: { Label("记忆", image: "wm-memory") }
                .accessibilityLabel("记忆").accessibilityIdentifier("phoneMenu.memory")
            Button { open(.health) } label: { Label("健康", image: "wm-health") }
                .accessibilityLabel("健康").accessibilityIdentifier("phoneMenu.health")
            Divider()
            Button { model.settingsRoute = .init(categoryID: "general"); open(.settings) } label: { Label("设置", image: "wm-settings") }
                .accessibilityLabel("设置").accessibilityIdentifier("phoneMenu.settings")
            Button { open(.about) } label: { Label("帮助 / 关于", image: "wm-info") }
            Button { confirmingLogout = true } label: { Label("退出登录", image: "wm-logout") }
        } label: {
            WeftIcon("account")
        }
        .task(id: "\(model.uxScope)-\(route?.id.uuidString ?? "home")") { await usage.refresh() }
        .accessibilityLabel("账户菜单")
        .accessibilityIdentifier("phoneAccountMenu")
        .sheet(item: $route) { item in
            Group {
                if (item.destination == .settings || item.destination == .about) && item.epoch == model.accountEpoch && model.session != nil {
                    SettingsView(model: model, route: item.destination == .about ? .init(categoryID: "about") : nil, onClose: { route = nil })
                } else {
                    NavigationStack {
                Group {
                    if item.epoch == model.accountEpoch, model.session != nil {
                        switch item.destination {
                        case .memory: MemoryWorkspaceView(appModel: model).id(item.epoch)
                        case .settings, .about: EmptyView()
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
        .confirmationDialog("退出登录？本机对话与记忆保留。", isPresented: $confirmingLogout, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) { Task { await model.signOut() } }
            Button("取消", role: .cancel) {}
        }
        .onChange(of: model.accountEpoch) { _, _ in route = nil; confirmingLogout = false }
    }

    private func open(_ destination: Destination) {
        route = Route(destination: destination, epoch: model.accountEpoch)
    }
}
#endif
