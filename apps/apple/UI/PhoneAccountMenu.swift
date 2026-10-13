#if os(iOS)
import SwiftUI
import WeftMateCore

/// Auxiliary pages keep the current conversation underneath the sheet.
struct PhoneAccountMenu: View {
    @ObservedObject var model: AppleAppModel
    @ObservedObject private var cloud: CloudLoginModel
    @EnvironmentObject private var health: DailyHealthModel
    @StateObject private var usage: AccountUsageModel
    init(model: AppleAppModel) { self.model = model; cloud=model.cloudLogin; _usage = StateObject(wrappedValue: AccountUsageModel(app: model)) }
    @State private var confirmingLogout = false
    @State private var route: Route?

    private enum Destination { case memory, settings, about, activity }
    private struct Route: Identifiable {
        let id = UUID()
        let destination: Destination
        let epoch: UUID
    }

    // The avatar opens the existing settings routes with the generated account icon.
    var body: some View {
        Button { model.settingsRoute = .init(categoryID: "general"); open(.settings) } label: {
            WeftIcon("account")
        }.phoneIcon().accessibilityLabel("设置").accessibilityIdentifier("phoneAccountMenu")
        .task(id: "\(model.uxScope)-\(route?.id.uuidString ?? "home")") { await usage.refresh() }
        .accessibilityLabel("设置")
        .accessibilityIdentifier("phoneAccountMenu")
        .sheet(item: $route) { item in
            Group {
                if (item.destination == .settings || item.destination == .about) && item.epoch == model.accountEpoch {
                    SettingsView(model: model, route: item.destination == .about ? .init(categoryID: "about") : nil, onClose: { dismissPhonePreviewKeyboard(); route = nil })
                } else {
                    NavigationStack {
                Group {
                    if item.epoch == model.accountEpoch, model.session != nil {
                        switch item.destination {
                        case .memory: MemoryWorkspaceView(appModel: model).id(item.epoch)
                        case .settings, .about: EmptyView()
                        case .activity:
                            DailyReviewView(app: model)
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
            .environmentObject(health)
            .preferredColorScheme(AppleAppearance(rawValue: model.appearanceMode)?.colorScheme)
        }
        .confirmationDialog("退出登录？本机对话与记忆保留。", isPresented: $confirmingLogout, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) { Task { await model.signOut() } }
            Button("取消", role: .cancel) {}
        }
        .onChange(of:cloud.authenticated) { _,value in if value { dismissPhonePreviewKeyboard(); route=nil } }
        .onChange(of: model.accountEpoch) { _, _ in route = nil; confirmingLogout = false }
    }

    private func open(_ destination: Destination) {
        route = Route(destination: destination, epoch: model.accountEpoch)
    }
}
#endif
