#if DEBUG && os(macOS)
import AppKit
import Foundation
import WeftMateCore

@MainActor enum A13MacReview {
    private struct Failure: Error { let step: String }
    private static func get(_ node: NSObject, _ name: String) -> Any? {
        let s = NSSelectorFromString(name); return node.responds(to: s) ? node.perform(s)?.takeUnretainedValue() : nil
    }
    private static func until(_ message: String, _ condition: () -> Bool) async throws {
        for _ in 0..<150 { if condition() { return }; try await Task.sleep(for: .milliseconds(200)) }; throw Failure(step: message)
    }
    static func texts() -> [String] {
        var visited = Set<ObjectIdentifier>(), values: [String] = []
        func visit(_ any: Any) {
            guard let node = any as? NSObject, visited.insert(ObjectIdentifier(node)).inserted else { return }
            for name in ["accessibilityLabel", "accessibilityTitle", "accessibilityValue"] {
                if let text = get(node, name) as? String, !text.isEmpty { values.append(text) }
            }
            let children = get(node, "accessibilityChildren") as? [Any] ?? node.performIfAvailable("accessibilityAttributeValue:", value: "AXChildren") as? [Any] ?? []
            // The SwiftUI AX bridge can vend a new proxy for the same view on each
            // traversal. Walking AX children AND physical subviews duplicates the
            // remote save-panel tree exponentially. Prefer its semantic AX children;
            // physical views remain the fallback before the AX tree materializes.
            if !children.isEmpty { for child in children { visit(child) } }
            else if let view = node as? NSView { for child in view.subviews { visit(child) } }
            if let window = node as? NSWindow, let content = window.contentView { visit(content) }
        }
        for window in NSApplication.shared.windows where window.isVisible { visit(window) }
        return Array(Set(values)).sorted()
    }
    private static func capture(_ scene: String, settings: Bool = false) async throws {
        if scene == "usage-month-picker" {
            try await Task.sleep(for: .milliseconds(400)); A16MacReview.captureVisible(scene)
        } else { try await A10MacReview.capture(scene, settings: settings, identifier: settings ? "settingsPage.usage" : "conversationDetail") }
        let data = try JSONSerialization.data(withJSONObject: ["scene": scene, "text": texts().joined(separator: "\n")])
        FileHandle.standardOutput.write(Data(("A13_TEXT:" + String(decoding: data, as: UTF8.self) + "\n").utf8))
    }
    private static func press(_ id: String) async throws {
        let control = try await A10MacReview.wait(id)
        if let button = control as? NSButton {
            guard button.isEnabled else { throw Failure(step: "Native button disabled: " + id) }
            button.performClick(nil)
        } else { try A10MacReview.pressNode(control, id: id) }
        try await Task.sleep(for: .milliseconds(400))
    }
    private static func focus(_ node: NSObject) {
        let legacy = NSSelectorFromString("accessibilitySetValue:forAttribute:")
        if node.responds(to: legacy) {
            typealias Setter = @convention(c) (AnyObject, Selector, AnyObject, AnyObject) -> Void
            unsafeBitCast(node.method(for: legacy), to: Setter.self)(node, legacy, NSNumber(value: true), "AXFocused" as NSString)
        }
    }
    private static func set(_ id: String, _ value: String) async throws {
        let node = try await A10MacReview.wait(id)
        guard let cell = node as? NSCell, let field = cell.controlView as? NSTextField, let window = field.window else {
            throw Failure(step: "Native text field unavailable: " + id)
        }
        window.makeKeyAndOrderFront(nil)
        guard window.makeFirstResponder(field), let editor = field.currentEditor() as? NSTextView else { throw Failure(step: "Native field editor unavailable: " + id) }
        editor.selectAll(nil); editor.insertText(value, replacementRange: editor.selectedRange()); editor.didChangeText()
        window.endEditing(for: field)
        try await Task.sleep(for: .milliseconds(350))
    }
    private static func driver(_ path: String) async throws -> [String: Any] {
        let args = ProcessInfo.processInfo.arguments, i = args.firstIndex(of: "--a13-driver")!
        let (data, response) = try await URLSession.shared.data(from: URL(string: args[i + 1] + path)!)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Failure(step: "Fixture HTTP failed") }
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    static func run(_ model: AppleAppModel, openSettings: () -> Void) async throws {
        NSApplication.shared.setActivationPolicy(.regular); NSApplication.shared.activate(ignoringOtherApps: true)
        _ = try await A10MacReview.wait("approvalBar")
        try await until("Waiting question count missing") { texts().contains(where: { $0.contains("处理审批后还有 3 个问题") }) }
        guard A10MacReview.control("questionBar") == nil else { throw Failure(step: "Approval priority failed") }
        try await capture("approval-priority")
        for _ in 0..<2 {
            let approval = try await A10MacReview.wait("approvalDetails")
            guard let button = A10MacReview.findButton("批准", in: NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find("approvalBar", in: $0) != nil })!) else { throw Failure(step: "Approve button missing") }
            _ = approval; try A10MacReview.pressNode(button, id: "approve")
            try await Task.sleep(for: .seconds(1))
        }
        _ = try await A10MacReview.wait("questionBar")
        try await press("questionOption.format.简要报告"); try await capture("single-choice")
        try await press("questionDetails"); try await capture("description")
        try await set("questionCustom.format", "合成其他格式")
        // Send Return only to our app's current native responder, never global input.
        let node = try await A10MacReview.wait("questionCustom.format")
        focus(node)
        if let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find("conversationDetail", in: $0) != nil }), let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, characters: "\r", charactersIgnoringModifiers: "\r", isARepeat: false, keyCode: 36) { window.sendEvent(event) }
        guard A10MacReview.control("questionNext") != nil else { throw Failure(step: "Input Return submitted") }
        try await capture("other-input-return")
        try await press("questionNext"); try await press("questionOption.sections.摘要"); try await press("questionOption.sections.步骤")
        try await set("questionCustom.sections", "合成补充"); try await capture("multiple-choice")
        try await press("questionNext"); try await set("questionCustom.note", "合成自由回答")
        let report = try await driver("/report")
        guard (report["questionHTTP"] as! [Any]).isEmpty else { throw Failure(step: "Partial batch submitted") }
        try await capture("free-answer")
        let questions = report["questions"] as! [String: Any], rows = questions["questions"] as! [[String: Any]], batchID = rows.first!["questionRpcId"] as! String
        let submit = try await A10MacReview.wait("submitQuestion." + batchID)
        guard let button = submit as? NSButton, let targetWindow = button.window else { throw Failure(step: "Native Return button unavailable") }
        targetWindow.makeKeyAndOrderFront(nil); NSApplication.shared.activate(ignoringOtherApps: true); targetWindow.endEditing(for: nil)
        try await Task.sleep(for: .milliseconds(250))
        guard targetWindow.makeFirstResponder(button), targetWindow.firstResponder === button, button.isEnabled else { throw Failure(step: "Native submit button did not accept focus") }
        try await Task.sleep(for: .milliseconds(200))
        FileHandle.standardOutput.write(Data("A13_KEY_STATE:native submit button is first responder\n".utf8))
        if let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: targetWindow.windowNumber, context: nil, characters: "\r", charactersIgnoringModifiers: "\r", isARepeat: false, keyCode: 36) { targetWindow.sendEvent(event) }
        try await until("Registered question did not disappear") { A10MacReview.control("questionBar") == nil }
        _ = try await A10MacReview.wait("answeredQuestion." + batchID); try await capture("answered")
        _ = try await driver("/retry-batch")
        _ = try await A10MacReview.wait("questionOption.format.简要报告")
        try await press("questionOption.format.完整记录"); try await press("questionNext"); try await press("questionOption.sections.摘要"); try await press("questionNext")
        try await set("questionCustom.note", "合成重试回答")
        let retryReport = try await driver("/report"), retryRows = (retryReport["questions"] as! [String: Any])["questions"] as! [[String: Any]]
        let retryID = retryRows.first(where: { $0["status"] as? String == "pending" })!["questionRpcId"] as! String
        _ = try await driver("/lose-next"); try await press("submitQuestion." + retryID)
        // The successful reply was dropped; readback may immediately recover it.
        try await until("Lost reply never reconciled") { A10MacReview.control("questionBar") == nil || A10MacReview.control("continueInteraction.question:" + retryID) != nil }
        if A10MacReview.control("continueInteraction.question:" + retryID) != nil { try await capture("retry"); try await press("continueInteraction.question:" + retryID) }
        try await until("Readback did not remove question") { A10MacReview.control("questionBar") == nil }
        try await capture("retry-reconciled")
        try await press("openConversationResources"); _ = try await A10MacReview.wait("conversationResourceList"); try await capture("chinese-sources")
        let page = try await model.assistantClient.conversationResources(sessionID: model.selectedConversation!.sessionId!)
        guard let source = page.sources.first(where: { $0.displayName == "扩展服务" }), let use = source.uses.first else { throw Failure(step: "Extension source missing") }
        try await press("resourceSource." + source.key)
        _ = use
        guard let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find("conversationResourcesPanel", in: $0) != nil }), let disclosure = A10MacReview.findButton("详情", in: window) else { throw Failure(step: "Source details disclosure missing") }
        try A10MacReview.pressNode(disclosure, id: "source-details")
        try await until("Chinese nested parameter missing") { texts().contains(where: { $0.contains("附加信息") }) }
        try await capture("chinese-detail")
        try await press("closeResourcesPanel")
        openSettings(); model.settingsRoute = .init(categoryID: "usage")
        _ = try await A10MacReview.wait("usageMonth"); _ = try await A10MacReview.wait("usageTotalCost")
        try await capture("usage-month", settings: true)
        let observer = A13MenuObserver(); defer { observer.stop() }
        try await press("usageMonth")
        try await until("Native month choices missing") { observer.menu?.items.contains(where: { $0.title.contains(" 年 ") && $0.title.contains(" 月") }) == true }
        try await capture("usage-month-picker", settings: true)
        guard let menu = observer.menu, let choice = menu.items.lastIndex(where: { $0.title.contains(" 年 ") && $0.title.contains(" 月") }) else { throw Failure(step: "Month menu unavailable") }
        menu.performActionForItem(at: choice); menu.cancelTrackingWithoutAnimation()
        guard let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find("usageMonth", in: $0) != nil }), let read = A10MacReview.findButton("读取月份", in: window) else { throw Failure(step: "Read selected month button missing") }
        try A10MacReview.pressNode(read, id: "read-month")
        try await Task.sleep(for: .seconds(1)); try await capture("usage-month-selected", settings: true)
        FileHandle.standardOutput.write(Data(("A10_REPORT:{\"authenticated\":true,\"questionBatch\":true,\"approvalPriority\":true,\"returnDoesNotSubmitInput\":true,\"retryReadback\":true,\"usagePicker\":true}\n").utf8))
    }
}
@MainActor private final class A13MenuObserver: NSObject {
    var menu: NSMenu?
    override init() { super.init(); NotificationCenter.default.addObserver(self, selector: #selector(track(_:)), name: NSMenu.didBeginTrackingNotification, object: nil) }
    @objc private func track(_ value: Notification) { menu = value.object as? NSMenu }
    func stop() { NotificationCenter.default.removeObserver(self) }
}
private extension NSObject {
    @discardableResult func performIfAvailable(_ selector: String, value: Any) -> Any? {
        let s = NSSelectorFromString(selector); return responds(to: s) ? perform(s, with: value)?.takeUnretainedValue() : nil
    }
}
#endif
