#if DEBUG && os(macOS)
import AppKit
import Foundation
import Darwin
import WeftMateCore
@MainActor private final class A15MenuObserver: NSObject {
    var menu: NSMenu?
    override init() { super.init(); NotificationCenter.default.addObserver(self,selector:#selector(track(_:)),name:NSMenu.didBeginTrackingNotification,object:nil) }
    @objc private func track(_ notification: Notification) { menu = notification.object as? NSMenu }
    func stop() { NotificationCenter.default.removeObserver(self); menu = nil }
}
@MainActor enum A15MacReview {
    private struct Failure: Error { let step: String }
    private static func until(_ message: String,_ condition: () -> Bool) async throws {
        for _ in 0..<150 { if condition() { return }; try await Task.sleep(for:.milliseconds(100)) }; throw Failure(step:message)
    }
    private static func press(_ id: String) async throws {
        if id.hasPrefix("projectNewConversation.") { try await hover("projectToggle." + String(id.dropFirst("projectNewConversation.".count)), card: false) }
        try await A10MacReview.press(id); try await Task.sleep(for:.milliseconds(250)) }
    private static func capture(_ name: String,root: String = "conversationList") async throws {
        _ = try await A10MacReview.wait(root)
        try await Task.sleep(for: .milliseconds(500))
        typealias Images = @convention(c) (CGRect, CFArray, UInt32) -> Unmanaged<CGImage>?
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImageFromArray") else { throw Failure(step: "Own window capture unavailable") }
        let info = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
        var ids: [UnsafeRawPointer?] = info.filter { ($0[kCGWindowOwnerPID as String] as? Int) == Int(getpid()) }
            .map { ($0[kCGWindowNumber as String] as? Int).flatMap(UnsafeRawPointer.init(bitPattern:)) }
        if name == "hover-details" {
            for window in NSApplication.shared.windows where window.isVisible {
                FileHandle.standardOutput.write(Data(("A13_NATIVE:window=" + String(describing: type(of: window)) + " frame=" + NSStringFromRect(window.frame) + "\n").utf8))
            }
        }
        let array = CFArrayCreate(kCFAllocatorDefault, &ids, ids.count, nil)!
        guard let image = unsafeBitCast(symbol, to: Images.self)(.null, array, 1)?.takeRetainedValue(), let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw Failure(step: "Own window image unavailable") }
        FileHandle.standardOutput.write(Data(("A10_CAPTURE:" + name + ":" + png.base64EncodedString() + "\n").utf8))
        let data = try JSONSerialization.data(withJSONObject:["scene":name,"text":A13MacReview.texts().joined(separator:"\n")])
        FileHandle.standardOutput.write(Data(("A13_TEXT:" + String(decoding:data,as:UTF8.self) + "\n").utf8))
    }
    private static func driver(_ path: String) async throws -> [String:Any] {
        let args=ProcessInfo.processInfo.arguments,i=args.firstIndex(of:"--a15-driver")!
        let (data,response)=try await URLSession.shared.data(from:URL(string:args[i+1]+path)!)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Failure(step:"Synthetic driver response") }
        return try JSONSerialization.jsonObject(with:data) as! [String:Any]
    }
    private static func choose(_ observer: A15MenuObserver,id: String,title: String) async throws {
        observer.menu=nil; try await press(id)
        try await until("Native menu missing: " + title) { observer.menu?.items.contains { $0.title == title } == true }
        guard let menu=observer.menu, let index=menu.items.firstIndex(where:{$0.title==title}) else { throw Failure(step:"Native menu item") }
        menu.performActionForItem(at:index);menu.cancelTrackingWithoutAnimation();try await Task.sleep(for:.milliseconds(400))
    }
    static func hover(_ id: String, card: Bool = true) async throws {
        let node = try await A10MacReview.wait(id), selector = NSSelectorFromString("accessibilityFrame")
        guard node.responds(to: selector), let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find(id, in: $0) != nil }), let content = window.contentView else { throw Failure(step: "Native row hover frame") }
        typealias Frame = @convention(c) (AnyObject, Selector) -> CGRect
        let rect = unsafeBitCast(node.method(for: selector), to: Frame.self)(node, selector)
        let point = window.convertPoint(fromScreen: CGPoint(x: rect.midX, y: rect.midY))
        let responder = window.firstResponder
        func exitRegions(_ view: NSView) {
            if let region = view as? SessionHoverRegion.Region,
               let event = NSEvent.enterExitEvent(with: .mouseExited, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, trackingNumber: 0, userData: nil) { region.mouseExited(with: event) }
            for child in view.subviews { exitRegions(child) }
        }
        exitRegions(content)
        try await Task.sleep(for: .milliseconds(100))
        func visit(_ view: NSView) {
            let local = view.convert(point, from: nil)
            for area in view.trackingAreas where (area.options.contains(.inVisibleRect) ? view.bounds : area.rect).contains(local) {
                if let owner = area.owner as? NSResponder, let event = NSEvent.enterExitEvent(with: .mouseEntered, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, trackingNumber: 0, userData: nil) { owner.mouseEntered(with: event) }
            }
            for child in view.subviews { visit(child) }
        }
        visit(content)
        try await Task.sleep(for: .milliseconds(650))
        if card { _ = try await A10MacReview.wait("sessionHoverDetails") }
        guard window.firstResponder === responder else { throw Failure(step: "Hover stole keyboard focus") }
    }
    static func run(_ app: AppleAppModel,openSettings: () -> Void) async throws {
        let observer=A15MenuObserver();defer{observer.stop()}
        NSApplication.shared.setActivationPolicy(.regular);NSApplication.shared.activate(ignoringOtherApps:true)
        _ = try await A10MacReview.wait("weftmateRoot")
        for window in NSApplication.shared.windows where window.isVisible && A10MacReview.find("weftmateRoot", in: window) != nil {
            window.setContentSize(NSSize(width: 1080, height: 760)); window.orderFrontRegardless(); window.makeKeyAndOrderFront(nil)
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
        try await Task.sleep(for: .milliseconds(500))
        let ready=try await driver("/ready"),project=ready["projectID"] as! String,sessionID=ready["sessionID"] as! String
        let projectIDs=ready["projectIDs"] as! [String]
        guard let p=app.projects.first(where:{$0.id==project}),app.projectRows(p).count==5, !app.projectRows(p).contains(where:{$0.id==projectIDs[0]}) else { throw Failure(step:"Default recent five") }
        _=try await A10MacReview.wait("projectMore."+project);try await capture("recent-five")
        try await hover("projectToggle." + project, card: false); try await capture("project-hover")
        try await press("projectMore."+project)
        guard app.projectRows(p).count==7 else { throw Failure(step:"Project more rows") }
        try await capture("project-expanded")
        guard let row=app.conversations.first(where:{$0.id==projectIDs[6]}) else { throw Failure(step:"Project row") }
        try await hover("conversationRow." + row.id); try await capture("hover-details")
        // Native row controls are driven through the app's own AX actions.
        try await press("sessionPin."+row.id)
        try await until("Pin acknowledgement") { app.conversations.first(where:{$0.id==row.id})?.pinned==true }
        try await hover("conversationRow." + row.id)
        try await press("sessionArchive."+row.id);_ = try await A10MacReview.wait("undoArchive");try await until("Archive acknowledgement settled") { !app.lifecycleBusy && app.archiveUndo != nil };try await capture("archive-undo")
        try await press("undoArchive");try await until("Archive restored") { app.conversations.first(where:{$0.id==row.id})?.archived==false }
        func leave(_ view: NSView) {
            if let region = view as? SessionHoverRegion.Region, let window = region.window, let event = NSEvent.enterExitEvent(with: .mouseExited, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, trackingNumber: 0, userData: nil) { region.mouseExited(with: event) }
            for child in view.subviews { leave(child) }
        }
        for window in NSApplication.shared.windows { if let content = window.contentView { leave(content) } }
        try await press("macAccountMenu");_ = try await A10MacReview.wait("accountUsageTotal");try await capture("account-menu")
        guard A13MacReview.texts().contains(where:{$0.contains("剩余")}) else { throw Failure(step:"Amount and remainder") }
        if let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find("macAccountMenuPanel", in: $0) != nil }), let event=NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,characters:"\u{1b}",charactersIgnoringModifiers:"\u{1b}",isARepeat:false,keyCode:53){window.sendEvent(event)}
        try await until("Account menu Esc") { A10MacReview.control("macAccountMenuPanel") == nil }
        app.openedSessionID=sessionID
        _=try await A10MacReview.wait("addAttachmentButton")
        try await until("Thinking catalogue ready") { app.thinking.confirmed?.supported==true }
        observer.menu=nil;try await press("addAttachmentButton")
        try await until("Plus menu") { observer.menu?.items.contains{$0.title=="区域截图"}==true }
        guard observer.menu?.items.contains(where:{$0.title=="粘贴剪贴板图片"})==true else { throw Failure(step:"Clipboard menu") }
        try await capture("plus-menu",root:"conversationDetail");observer.menu?.cancelTrackingWithoutAnimation()
        try await choose(observer,id:"addAttachmentButton",title:"深入思考")
        _=try await A10MacReview.wait("thinkingMarker");try await capture("thinking-enabled",root:"conversationDetail")
        try await choose(observer,id:"addAttachmentButton",title:"深入思考")
        try await until("Thinking disabled") { A10MacReview.control("thinkingMarker")==nil }
        try await choose(observer,id:"addAttachmentButton",title:"添加合成文件")
        try await choose(observer,id:"addAttachmentButton",title:"区域截图")
        try await choose(observer,id:"addAttachmentButton",title:"粘贴剪贴板图片")
        guard let current=app.selectedConversation,app.attachmentDrafts[AppleAppModel.draftKey(for:current)]?.count==3 else { throw Failure(step:"Three synthetic native attachments") }
        try await capture("synthetic-attachments",root:"conversationDetail")
        try await press("composerSubtasks");_ = try await A10MacReview.wait("subtask.active");try await capture("subtask-list",root:"conversationDetail")
        try await press("subtask.active");try await capture("subtask-step",root:"conversationDetail")
        let draftNode = try await A10MacReview.wait("conversationDraft")
        let focusSelector = NSSelectorFromString("accessibilitySetValue:forAttribute:")
        if draftNode.responds(to: focusSelector) {
            typealias Setter = @convention(c) (AnyObject, Selector, AnyObject, AnyObject) -> Void
            unsafeBitCast(draftNode.method(for: focusSelector), to: Setter.self)(draftNode, focusSelector, NSNumber(value: true), "AXFocused" as NSString)
        }
        guard let focusWindow = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find("conversationDraft", in: $0) != nil }), let draftResponder = focusWindow.firstResponder else { throw Failure(step: "Native draft responder") }
        _=try await driver("/finish");try await until("Subtasks terminal") { A10MacReview.control("composerSubtasks")==nil }
        guard focusWindow.firstResponder === draftResponder else { throw Failure(step: "Streaming update stole draft focus") }
        try await capture("subtasks-ended",root:"conversationDetail")
        app.settingsRoute = .init(categoryID:"general");openSettings();_ = try await A10MacReview.wait("settingsPage.general")
        // The setting's normal binding updates the account preference; verify both resulting native placeholders.
        guard let mode = A10MacReview.control("runningMessageMode"), let steer = A10MacReview.findButton("引导", in: mode) else { throw Failure(step: "Native running-message segmented control") }
        try A10MacReview.pressNode(steer,id:"引导");try await until("Steer preference") { app.runningMessageMode == .steer }
        try await press("closeSettings");try await capture("running-steer",root:"conversationDetail")
        openSettings();_ = try await A10MacReview.wait("runningMessageMode")
        guard let mode = A10MacReview.control("runningMessageMode"), let queue = A10MacReview.findButton("排队", in: mode) else { throw Failure(step: "Native queue control") }
        try A10MacReview.pressNode(queue,id:"排队");try await until("Queue preference") { app.runningMessageMode == .queue }
        try await press("closeSettings");try await capture("running-queue",root:"conversationDetail")
        if let window=NSApplication.shared.windows.first(where:{$0.isVisible && A10MacReview.find("conversationDetail",in:$0) != nil}) { window.setContentSize(NSSize(width:720,height:640));try await capture("narrow",root:"conversationDetail") }
        // Creation's durable receipt must survive a missing thinking reply: retry
        // the same session and save before opening it for its first message.
        let before = app.conversations.count
        try await press("projectNewConversation." + project)
        _ = try await A10MacReview.wait("projectConversationSheet")
        try await until("Draft models") { !app.projectModelID.isEmpty }
        try await press("draftThinking")
        guard app.projectThinking else { throw Failure(step: "Draft thinking toggle") }
        _ = try await driver("/lose-next-thinking")
        try await press("projectStartConversation")
        try await until("Lost thinking response must retain creation receipt") { !app.projectBusy && app.projectCreatedSessionID != nil && app.projectError != nil }
        let created = app.projectCreatedSessionID
        try await capture("draft-thinking-retry", root:"projectConversationSheet")
        try await press("projectStartConversation")
        try await until("Draft thinking saved") { app.projectConversation == nil && app.selectedConversation?.sessionId == created && app.thinking.confirmed?.enabled == true }
        guard app.conversations.count == before + 1 else { throw Failure(step: "Thinking retry duplicated the created session") }
        try await capture("draft-thinking-saved", root:"conversationDetail")
        FileHandle.standardOutput.write(Data(("A10_REPORT:" + String(decoding:try JSONSerialization.data(withJSONObject:["passed":true,"syntheticOnly":true,"nativeOwnAX":true,"xcuITest":false,"recentFive":true,"projectExpanded":true,"archiveUndo":true,"accountUsage":true,"thinking":true,"mediaInjected":true,"subtasks":true,"globalPermissionsRequested":false]),as:UTF8.self) + "\n").utf8))
    }
}
#endif
