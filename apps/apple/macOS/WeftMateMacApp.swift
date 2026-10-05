import SwiftUI

@main
struct WeftMateMacApp: App {
    @StateObject private var model = AppleAppModel()
    @StateObject private var updates = MacUpdateModel()
    @Environment(\.openWindow) private var openWindow
    var body: some Scene {
        Window("WeftMate", id: "main") {
            WeftMateRootView(model: model)
                .environmentObject(updates)
                .frame(minWidth: 780, minHeight: 540)
        }
        .defaultSize(width: 1080, height: 760)
        .commands {
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
        Window("检查更新", id: "updates") {
            MacUpdateView().environmentObject(updates)
        }
        .defaultSize(width: 520, height: 620)
        .windowResizability(.contentMinSize)
    }
}
