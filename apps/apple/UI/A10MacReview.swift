#if DEBUG && os(macOS)
import AppKit
import Foundation
import Darwin
import WeftMateCore

/// Runs inside the isolated Debug app. Uses only this app's native accessibility
/// objects and window IDs; no AXUIElement, global input, TCC request or other app.
@MainActor enum A10MacReview {
    private struct Failure: Error { let step: String }
    private static func object(_ node: NSObject, _ selector: String) -> Any? {
        let getter = NSSelectorFromString(selector)
        if node.responds(to: getter), let value = node.perform(getter)?.takeUnretainedValue() { return value }
        let attribute = selector == "accessibilityIdentifier" ? "AXIdentifier" : "AXChildren"
        let legacy = NSSelectorFromString("accessibilityAttributeValue:")
        guard node.responds(to: legacy) else { return nil }
        return node.perform(legacy, with: attribute)?.takeUnretainedValue()
    }
    static func find(_ id: String, in element: Any) -> NSObject? {
        var visited = Set<ObjectIdentifier>()
        return find(id, in: element, visited: &visited)
    }
    private static func find(_ id: String, in element: Any, visited: inout Set<ObjectIdentifier>) -> NSObject? {
        guard let node = element as? NSObject, visited.insert(ObjectIdentifier(node)).inserted else { return nil }
        if object(node, "accessibilityIdentifier") as? String == id { return node }
        for child in object(node, "accessibilityChildren") as? [Any] ?? [] {
            if let found = find(id, in: child, visited: &visited) { return found }
        }
        // SwiftUI may expose its content through the hosting view before AppKit's
        // window AX children have materialised. This still visits only our own views.
        if let view = node as? NSView {
            for child in view.subviews { if let found = find(id, in: child, visited: &visited) { return found } }
        }
        if let window = node as? NSWindow, let content = window.contentView { return find(id, in: content, visited: &visited) }
        return nil
    }
    static func control(_ id: String) -> NSObject? {
        for window in NSApplication.shared.windows where window.isVisible {
            if let node = find(id, in: window) { return node }
        }
        return find(id, in: NSApplication.shared)
    }
    static func wait(_ id: String) async throws -> NSObject {
        for _ in 0..<150 {
            if let node = control(id) { return node }
            try await Task.sleep(for: .milliseconds(200))
        }
        throw Failure(step: "Missing native control: " + id)
    }
    static func press(_ id: String) async throws {
        try pressNode(try await wait(id), id: id)
    }
    static func pressNode(_ node: NSObject, id: String) throws {
        let selector = NSSelectorFromString("accessibilityPerformPress")
        guard node.responds(to: selector) else { throw Failure(step: "Native press unavailable: " + id) }
        typealias Press = @convention(c) (AnyObject, Selector) -> Bool
        if unsafeBitCast(node.method(for: selector), to: Press.self)(node, selector) { return }
        // SwiftUI's legacy AppKit bridge advertises AXPress through actionNames
        // while its inherited modern accessibilityPerformPress returns false.
        let names = NSSelectorFromString("accessibilityActionNames")
        let action = NSSelectorFromString("accessibilityPerformAction:")
        guard node.responds(to: names), node.responds(to: action),
              let actions = node.perform(names)?.takeUnretainedValue() as? [String], actions.contains("AXPress") else { throw Failure(step: "Native press unavailable: " + id) }
        node.perform(action, with: "AXPress")
    }
    static func findButton(_ label: String, in element: Any) -> NSObject? {
        var visited = Set<ObjectIdentifier>()
        func visit(_ value: Any) -> NSObject? {
            guard let node = value as? NSObject, visited.insert(ObjectIdentifier(node)).inserted else { return nil }
            for name in ["accessibilityLabel", "accessibilityTitle", "title"] {
                let selector = NSSelectorFromString(name)
                if node.responds(to: selector), node.perform(selector)?.takeUnretainedValue() as? String == label { return node }
            }
            for child in object(node, "accessibilityChildren") as? [Any] ?? [] { if let found = visit(child) { return found } }
            if let view = node as? NSView { for child in view.subviews { if let found = visit(child) { return found } } }
            if let window = node as? NSWindow, let content = window.contentView { return visit(content) }
            return nil
        }
        return visit(element)
    }
    static func capture(_ scene: String, settings: Bool = false, identifier: String? = nil) async throws {
        let rootID = identifier ?? (settings ? "settingsPage." + String(scene.dropFirst("settings-".count)) : "conversationDetail")
        let window = NSApplication.shared.windows.first { $0.isVisible && find(rootID, in: $0) != nil }
        guard let window else { throw Failure(step: "Missing own window: " + scene) }
        window.makeKeyAndOrderFront(nil)
        try await Task.sleep(for: .milliseconds(500))
        typealias Images = @convention(c) (CGRect, CFArray, UInt32) -> Unmanaged<CGImage>?
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImageFromArray") else { throw Failure(step: "Window capture unavailable") }
        let windows = identifier == nil || settings ? [window] : NSApplication.shared.orderedWindows.filter(\.isVisible)
        var ids = windows.map { UnsafeRawPointer(bitPattern: $0.windowNumber) }
        let array = CFArrayCreate(kCFAllocatorDefault, &ids, ids.count, nil)!
        guard let image = unsafeBitCast(symbol, to: Images.self)(.null, array, 1)?.takeRetainedValue(),
              let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw Failure(step: "Own window has no image: " + scene) }
        FileHandle.standardOutput.write(Data(("A10_CAPTURE:" + scene + ":" + png.base64EncodedString() + "\n").utf8))
        let words = Array(Set(windows.flatMap { A13MacReview.texts(in: $0) })).sorted().joined(separator: "\n")
        let text = try JSONSerialization.data(withJSONObject: ["scene": scene, "text": words])
        FileHandle.standardOutput.write(Data(("A13_TEXT:" + String(decoding: text, as: UTF8.self) + "\n").utf8))
    }
    static func run(_ model: AppleAppModel, openSettings: () -> Void) async throws {
        guard model.session?.verification == .verified, !model.conversations.isEmpty else { throw Failure(step: "Isolated login/list failed") }
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
        try await Task.sleep(for: .seconds(2))
        do { _ = try await wait("conversationDetail") }
        catch {
            try? await capture("failure-main")
            throw Failure(step: "Native conversation control missing; selected=\(model.selectedConversation != nil)")
        }
        for _ in 0..<150 {
            if let conversation = model.selectedConversation, !model.historyBusy,
               model.sendTargets[AppleAppModel.draftKey(for: conversation)] != nil, !model.timeline.events.isEmpty { break }
            try await Task.sleep(for: .milliseconds(200))
        }
        guard let conversation = model.selectedConversation, !model.historyBusy,
              model.sendTargets[AppleAppModel.draftKey(for: conversation)] != nil, !model.timeline.events.isEmpty else { throw Failure(step: "Conversation history/model not ready") }
        try await capture("main")
        openSettings()
        var visited: [String] = []
        for category in AppleSettingsRegistry.list(desktop: true) {
            model.settingsRoute = .init(categoryID: category.id)
            _ = try await wait("settingsPage." + category.id)
            try await capture("settings-" + category.id, settings: true)
            if ["schedules", "archived"].contains(category.id) {
                var action: NSObject?
                for _ in 0..<100 {
                    for window in NSApplication.shared.windows where window.isVisible { if let found = findButton(category.id == "schedules" ? "提醒操作" : "已归档对话操作", in: window) { action = found; break } }
                    if action != nil { break }; try await Task.sleep(for: .milliseconds(100))
                }
                guard let action else { throw Failure(step: "Schedule menu missing") }
                try pressNode(action, id: "scheduleActions"); try await Task.sleep(for: .milliseconds(400))
                A16MacReview.captureVisible("settings-" + category.id + "-menu")
                (action as? NSPopUpButton)?.menu?.cancelTrackingWithoutAnimation()
            }
            visited.append(category.id)
        }
        try await press("closeSettings")
        for _ in 0..<150 {
            if control("settingsPage.about") == nil { break }
            try await Task.sleep(for: .milliseconds(200))
        }
        guard control("settingsPage.about") == nil else { throw Failure(step: "Settings close did not take effect") }
        model.setDraft("A10 合成排队消息", for: conversation, accountEpoch: model.accountEpoch)
        _ = try await wait("sendButton")
        try await capture("send-ready")
        try await press("sendButton")
        for _ in 0..<150 {
            if model.draftText(for: conversation, accountEpoch: model.accountEpoch).isEmpty { break }
            try await Task.sleep(for: .milliseconds(200))
        }
        guard model.draftText(for: conversation, accountEpoch: model.accountEpoch).isEmpty else { throw Failure(step: "Send draft was not acknowledged") }
        _ = try await wait("approvalBar")
        try await capture("approval")
        FileHandle.standardOutput.write(Data(("A10_REPORT:" + String(data: try JSONSerialization.data(withJSONObject: ["authenticated": true, "categories": visited, "sendPressed": true, "approvalBar": true, "ownWindowCapture": true, "globalPermissionsRequested": false]), encoding: .utf8)! + "\n").utf8))
    }
}
#endif
