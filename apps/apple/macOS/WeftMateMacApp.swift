import SwiftUI
import AppKit

@main
struct WeftMateMacApp: App {
    @StateObject private var model = AppleAppModel()
    @StateObject private var updates = MacUpdateModel()
    @Environment(\.openWindow) private var openWindow
    init() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-testing"), args.contains("--lg2-capture") {
            // Launch Services can restore this single-window app with no visible window.
            // Exercise its own Window menu action; no global events or Accessibility grant.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                guard let menu = NSApplication.shared.mainMenu else { return }
                for parent in menu.items {
                    if let child = parent.submenu,
                       let index = child.items.firstIndex(where: { $0.title == "WeftMate" && $0.submenu == nil && $0.action != nil }) {
                        child.performActionForItem(at: index)
                        break
                    }
                }
            }
        }
        #endif
    }
    var body: some Scene {
        Window("WeftMate", id: "main") {
            WeftMateRootView(model: model)
                .environmentObject(updates)
                .frame(minWidth: 780, minHeight: 540)
        }
        .defaultSize(width: 1080, height: 760)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("设置…") { openWindow(id: "settings") }
                    .keyboardShortcut(",", modifiers: [.command])
            }
            CommandGroup(after: .appInfo) {
                Button("检查更新…") {
                    openWindow(id: "updates")
                    updates.check()
                }
            }
            CommandGroup(after: .newItem) {
                Button("刷新原会话") { Task { await model.refresh() } }
                    .keyboardShortcut("r", modifiers: [.command])
                    .disabled(model.session == nil || model.refreshing)
            }
        }
        Window("设置", id: "settings") {
            NavigationStack { SettingsView(model: model).id(model.accountEpoch).environmentObject(updates) }
                .frame(minWidth: 480, minHeight: 540)
        }
        .defaultSize(width: 1000, height: 760)
        Window("检查更新", id: "updates") {
            MacUpdateView().environmentObject(updates)
        }
        .defaultSize(width: 520, height: 620)
        .windowResizability(.contentMinSize)
    }
}
