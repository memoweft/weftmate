#if DEBUG
import AppKit
import WeftMateCore

@MainActor enum A12MacReview {
    private static func pressToggle() async throws {
        do { try await A10MacReview.press("launchAtLogin"); return }
        catch {
            // SwiftUI's switch has no AXPress action in this Xcode build. Send
            // mouse events solely to our own window, never global input or TCC.
            let node = try await A10MacReview.wait("launchAtLogin")
            let selector = NSSelectorFromString("accessibilityFrame")
            guard node.responds(to: selector),
                  let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find("launchAtLogin", in: $0) != nil }) else { throw error }
            typealias Frame = @convention(c) (AnyObject, Selector) -> CGRect
            let frame = unsafeBitCast(node.method(for: selector), to: Frame.self)(node, selector)
            guard frame.width > 0, frame.height > 0 else { throw error }
            window.makeKeyAndOrderFront(nil)
            let point = window.convertPoint(fromScreen: NSPoint(x: frame.midX, y: frame.midY))
            guard let down = NSEvent.mouseEvent(with: .leftMouseDown, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1),
                let up = NSEvent.mouseEvent(with: .leftMouseUp, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 0) else { throw error }
            NSApplication.shared.postEvent(up, atStart: true)
            NSApplication.shared.sendEvent(down)
        }
    }
    static func run(_ model: AppleAppModel, openSettings: () -> Void) async throws {
        // An isolated bundle identifier prevents touching a daily login item.
        guard Bundle.main.bundleIdentifier == "com.weftmate.apple.a12loginitem" else {
            throw NSError(domain: "A12RequiresIsolatedBundle", code: 1)
        }
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
        model.settingsRoute = .init(categoryID: "general")
        openSettings()
        _ = try await A10MacReview.wait("launchAtLogin")
        let service = NativeLoginItemService()
        let initial = service.state
        guard initial == .notRegistered || initial == .notFound else { throw NSError(domain: "A12LoginItemAlreadyRegistered", code: 1) }
        do {
            try await A10MacReview.capture("settings-general-before", settings: true, identifier: "settingsPage.general")
            try await pressToggle()
            try await Task.sleep(for: .seconds(2))
            let enabled = service.state
            try await A10MacReview.capture("settings-general-on", settings: true, identifier: "settingsPage.general")
            if enabled.isOn {
                try await pressToggle()
                try await Task.sleep(for: .seconds(2))
            }
            let disabled = service.state
            try await A10MacReview.capture("settings-general-off", settings: true, identifier: "settingsPage.general")
            let result: [String: Any] = ["isolatedBundle": true, "initial": initial.rawValue, "afterOn": enabled.rawValue,
                "afterOff": disabled.rawValue, "registerReadback": enabled.isOn, "unregisterReadback": !disabled.isOn,
                "realSMAppService": true, "actualLoginRebootTested": false]
            let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
            FileHandle.standardOutput.write(Data(("A10_REPORT:" + String(data: data, encoding: .utf8)! + "\n").utf8))
        } catch {
            if service.state.isOn { try? await service.unregister() }
            throw error
        }
        if service.state.isOn { try await service.unregister() }
    }
}
#endif
