import SwiftUI

@main
struct WeftMatePhoneApp: App {
    @StateObject private var model = AppleAppModel()
    var body: some Scene {
        WindowGroup { WeftMateRootView(model: model) }
    }
}
