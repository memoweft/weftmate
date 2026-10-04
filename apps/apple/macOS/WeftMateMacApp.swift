import SwiftUI

@main
struct WeftMateMacApp: App {
    @StateObject private var model = AppleAppModel()
    var body: some Scene {
        Window("WeftMate", id: "main") {
            WeftMateRootView(model: model).frame(minWidth: 780, minHeight: 540)
        }
        .defaultSize(width: 1080, height: 760)
        .commands {
            CommandGroup(after: .newItem) {
                Button("刷新原会话") { Task { await model.refresh() } }
                    .keyboardShortcut("r", modifiers: [.command])
                    .disabled(model.session == nil || model.refreshing)
            }
        }
    }
}
