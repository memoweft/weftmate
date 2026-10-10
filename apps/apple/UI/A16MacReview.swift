#if DEBUG && os(macOS)
import AppKit
import Foundation
import Darwin
import QuartzCore
import WeftMateCore
@MainActor private final class A16MenuObserver: NSObject {
    var menu: NSMenu?
    var selectContextSide = false
    var contextSelected = false
    override init() { super.init(); NotificationCenter.default.addObserver(self,selector:#selector(track(_:)),name:NSMenu.didBeginTrackingNotification,object:nil) }
    @objc private func track(_ note: Notification) {
        menu = note.object as? NSMenu
        FileHandle.standardOutput.write(Data(("A16_STEP:tracked-menu:" + (menu?.items.map(\.title).joined(separator: "|") ?? "") + "\n").utf8))
        if selectContextSide { perform(#selector(selectSide), with: nil, afterDelay: 0.6, inModes: [.eventTracking, .default]) }
    }
    @objc private func selectSide() {
        guard selectContextSide, let menu, let index = menu.items.firstIndex(where: { $0.title == "开旁聊" }), !menu.items.contains(where: { $0.title.contains("编辑") }) else { return }
        A16MacReview.captureVisible("user-message-menu")
        selectContextSide = false; contextSelected = true
        menu.performActionForItem(at: index); menu.cancelTrackingWithoutAnimation()
    }
    func stop() { NotificationCenter.default.removeObserver(self) }
}
@MainActor enum A16MacReview {
    private struct Failure: Error { let step: String }
    private static var systemSaveContentCaptured = false
    private static var reviewTask: Task<Void, Error>?
    static func runPersistent(_ app: AppleAppModel) async throws {
        if let reviewTask { try await reviewTask.value; return }
        let task = Task<Void, Error> { @MainActor in
            do { try await run(app); Darwin.exit(0) }
            catch {
                for panel in NSApplication.shared.windows.compactMap({ $0 as? NSSavePanel }) where panel.isVisible && panel.directoryURL?.lastPathComponent.hasPrefix("A16-export-") != true { panel.cancel(nil) }
                captureVisible("failure")
                FileHandle.standardOutput.write(Data(("A5_CAPTURE_FAILED:" + String(describing: error) + "\n").utf8))
                Darwin.exit(1)
            }
        }
        reviewTask = task
        try await task.value
    }
    private static func until(_ message: String,_ condition: () -> Bool) async throws {
        for _ in 0..<200 { if condition() { return }; try await Task.sleep(for:.milliseconds(100)) }; throw Failure(step:message)
    }
    private static func driver(_ path: String) async throws -> [String:Any] {
        let args=ProcessInfo.processInfo.arguments,i=args.firstIndex(of:"--a16-driver")!
        let (data,response)=try await URLSession.shared.data(from:URL(string:args[i+1]+path)!)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Failure(step:"Synthetic driver") }
        return try JSONSerialization.jsonObject(with:data) as! [String:Any]
    }
    private static func capture(_ name: String, root: String = "mainChat") async throws {
        _ = try await A10MacReview.wait(root)
        try await Task.sleep(for: .milliseconds(500))
        captureVisible(name)
    }
    static func captureVisible(_ name: String, single: Bool = false) {
        typealias Images = @convention(c) (CGRect, CFArray, UInt32) -> Unmanaged<CGImage>?
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImageFromArray") else { return }
        // AppKit menu windows are not included in NSApplication.windows. Capture only
        // window-server IDs owned by this process, including its native menus.
        let info = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
        var ids: [UnsafeRawPointer?] = info.filter { ($0[kCGWindowOwnerPID as String] as? Int) == Int(getpid()) }
            .map { ($0[kCGWindowNumber as String] as? Int).flatMap(UnsafeRawPointer.init(bitPattern:)) }
        let array = CFArrayCreate(kCFAllocatorDefault, &ids, ids.count, nil)!
        guard let image = unsafeBitCast(symbol, to: Images.self)(.null, array, 1)?.takeRetainedValue(), let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { return }
        if single {
            FileHandle.standardOutput.write(Data(("LG2_CAPTURE:" + png.base64EncodedString() + "\n").utf8))
            if let data = try? JSONSerialization.data(withJSONObject: ["scene": name, "text": A13MacReview.texts().joined(separator: "\n")]) {
                FileHandle.standardOutput.write(Data(("A17_TEXT:" + String(decoding: data, as: UTF8.self) + "\n").utf8))
            }
            return
        }
        FileHandle.standardOutput.write(Data(("A10_CAPTURE:" + name + ":" + png.base64EncodedString() + "\n").utf8))
        if let data = try? JSONSerialization.data(withJSONObject:["scene":name,"text":A13MacReview.texts().joined(separator:"\n")]) {
            FileHandle.standardOutput.write(Data(("A13_TEXT:"+String(decoding:data,as:UTF8.self)+"\n").utf8))
        }
    }
    static func press(_ id: String) async throws {
        FileHandle.standardOutput.write(Data(("A16_STEP:" + id + "\n").utf8))
        let titles = ["mainChat.date": "跳日期", "mainChat.search": "搜索", "mainChat.find": "查找", "mainChat.latest": "回到底部", "mainChat.next": "下一条", "mainChat.previous": "上一条", "mainChat.plus": "添加", "mainChat.send": "发送", "conversationMenu": "对话菜单", "closeSessionActions": "完成", "defaultApprovalMode": "默认审批模式", "approvalMode": "审批模式"]
        var named: NSObject?
        if let title = titles[id] ?? (id.hasPrefix("mainChat.messageMenu.") ? "消息操作" : nil) {
            for window in NSApplication.shared.windows where window.isVisible { if let node = A10MacReview.findButton(title, in: window) { named = node; break } }
        }
        if let node = named { try A10MacReview.pressNode(node, id: id) }
        else { try await A10MacReview.press(id) }
        try await Task.sleep(for: .milliseconds(300))

    }
    private static func nativeClick(_ id: String) async throws {
        let node = try await A10MacReview.wait(id), selector = NSSelectorFromString("accessibilityFrame")
        typealias Frame = @convention(c) (AnyObject, Selector) -> CGRect
        guard node.responds(to: selector), let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find(id, in: $0) != nil }) else { throw Failure(step: "Native click frame: " + id) }
        let rect = unsafeBitCast(node.method(for: selector), to: Frame.self)(node, selector)
        let point = window.convertPoint(fromScreen: CGPoint(x: rect.midX, y: rect.midY))
        guard let down = NSEvent.mouseEvent(with: .leftMouseDown, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1),
              let up = NSEvent.mouseEvent(with: .leftMouseUp, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 0) else { throw Failure(step: "Native mouse event") }
        NSApplication.shared.postEvent(up, atStart: false); window.sendEvent(down)
        try await Task.sleep(for: .milliseconds(400))
    }
    private static func choose(_ observer: A16MenuObserver,id: String,title: String) async throws {
        observer.menu=nil; try await press(id)
        try await until("Native menu missing " + title) { observer.menu?.items.contains { $0.title == title } == true }
        let menu=observer.menu!,index=menu.items.firstIndex(where:{$0.title==title})!
        try await capture(id == "mainChat.plus" ? "composer-menu" : "assistant-message-menu")
        menu.cancelTrackingWithoutAnimation(); try await Task.sleep(for: .milliseconds(200))
        menu.performActionForItem(at:index); try await Task.sleep(for:.milliseconds(500))
    }
    private static func hover(_ id: String) async throws {
        let node=try await A10MacReview.wait(id),selector=NSSelectorFromString("accessibilityFrame")
        typealias Frame = @convention(c) (AnyObject, Selector) -> CGRect
        guard node.responds(to:selector),let window=NSApplication.shared.windows.first(where:{$0.isVisible && A10MacReview.find(id,in:$0) != nil}),let content=window.contentView else{throw Failure(step:"Native message hover")}
        let frame=unsafeBitCast(node.method(for:selector),to:Frame.self)(node,selector),point=window.convertPoint(fromScreen:CGPoint(x:frame.midX,y:frame.midY))
        let target = "messageHover." + id.replacingOccurrences(of: "mainChat.event.", with: "")
        var matched = false
        func visit(_ view: NSView) {
            if let region = view as? SessionHoverRegion.Region, let identifier = region.identifier {
                let selected = identifier.rawValue == target && !region.visibleRect.isEmpty
                matched = matched || selected
                if let event = NSEvent.enterExitEvent(with: selected ? .mouseEntered : .mouseExited, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, trackingNumber: 0, userData: nil) {
                    if selected { region.mouseEntered(with: event) } else { region.mouseExited(with: event) }
                }
            }
            for child in view.subviews { visit(child) }
        }
        visit(content); guard matched else { throw Failure(step: "Native hover region missing") }; try await Task.sleep(for:.milliseconds(500))
    }
    private static func contextMenu(_ id: String) async throws {
        let node = try await A10MacReview.wait(id), selector = NSSelectorFromString("accessibilityFrame")
        typealias Frame = @convention(c) (AnyObject, Selector) -> CGRect
        guard node.responds(to: selector), let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find(id, in: $0) != nil }) else { throw Failure(step: "Message context frame") }
        let frame = unsafeBitCast(node.method(for: selector), to: Frame.self)(node, selector)
        var point = window.convertPoint(fromScreen: CGPoint(x: frame.midX, y: frame.midY))
        let target = "messageHover." + id.replacingOccurrences(of: "mainChat.event.", with: "")
        func locate(_ view: NSView) {
            if let region = view as? SessionHoverRegion.Region, region.identifier?.rawValue == target, !region.visibleRect.isEmpty {
                let rect = region.bounds.intersection(region.visibleRect)
                point = region.convert(NSPoint(x: rect.midX, y: rect.midY), to: nil)
            }
            for child in view.subviews { locate(child) }
        }
        if let content = window.contentView { locate(content) }
        DispatchQueue.main.async {
            for type in [NSEvent.EventType.rightMouseDown, .rightMouseUp] {
                if let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) { window.sendEvent(event) }
            }
        }
        try await Task.sleep(for: .milliseconds(500))
    }
    static func run(_ app: AppleAppModel) async throws {
        let observer=A16MenuObserver();defer{observer.stop()}
        NSApplication.shared.setActivationPolicy(.regular);NSApplication.shared.activate(ignoringOtherApps:true)
        let ready=try await driver("/ready"),model=app.mainChat,main=ready["mainChatID"] as! String
        _=try await A10MacReview.wait("mainChat")
        for window in NSApplication.shared.windows where window.isVisible && A10MacReview.find("mainChat", in: window) != nil { window.setContentSize(NSSize(width: 1080, height: 760)) }
        try await Task.sleep(for: .milliseconds(400))
        try await until("Main body tail") { !model.window.events.isEmpty }
        guard model.window.events.count <= 1000,app.conversations.first?.isMainChat==true else{throw Failure(step:"Main identity or bounded window")}
        try await capture("first-screen")
        if let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find("mainChat", in: $0) != nil }) {
            let original = window.frame
            window.setContentSize(NSSize(width: 480, height: 720))
            try await capture("narrow-window")
            let toggle = try await A10MacReview.wait("macSidebarToggle")
            try await nativeClick("macSidebarToggle")
            let valueSelector = NSSelectorFromString("accessibilityValue")
            if toggle.responds(to: valueSelector) { FileHandle.standardOutput.write(Data(("A16_STEP:sidebar-value=" + String(describing: toggle.perform(valueSelector)?.takeUnretainedValue()) + "\n").utf8)) }
            _ = try await A10MacReview.wait("compactSidebar")
            try await capture("narrow-sidebar")
            try await nativeClick("macSidebarToggle")
            try await until("Compact sidebar dismissed") { A10MacReview.control("compactSidebar") == nil }
            window.setFrame(original, display: true)
        }
        try await press("mainChat.resources")
        try await until("Resources panel") { NSApplication.shared.windows.contains { $0.isVisible && A10MacReview.findButton("完成", in: $0) != nil } }
        captureVisible("resources")
        if let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.findButton("完成", in: $0) != nil }), let close = A10MacReview.findButton("完成", in: window) { try A10MacReview.pressNode(close, id: "resources.done") }
        try await Task.sleep(for: .milliseconds(500))
        scrollMainToTop()
        try await Task.sleep(for: .milliseconds(500))
        if let day=ready["oldDay"] as? String {
            let id="mainChat.day."+day
            _=try await A10MacReview.wait(id);try await press(id)
            guard model.window.expandedDays.contains(day) else{throw Failure(step:"Day expand")}
            try await capture("expanded-day");try await press(id)
            guard !model.window.expandedDays.contains(day) else{throw Failure(step:"Day collapse")}
        }
        try await press("mainChat.date");_=try await A10MacReview.wait("mainChat.datePicker");try await capture("native-date-picker")
        try await press("mainChat.jump");try await until("Date located") {model.target != nil};try await capture("date-located")
        try await press("mainChat.search")
        model.query="A16查找纸船";try await press("mainChat.find")
        try await until("Search full history") {model.hits.count==2 && model.window.events.contains{$0.id==model.hits[0].id}}
        try await capture("search-first");try await press("mainChat.next");guard model.hitIndex==1 else{throw Failure(step:"Search next")}
        try await capture("search-next");try await press("mainChat.previous");guard model.hitIndex==0 else{throw Failure(step:"Search previous")}
        let source=model.hits[0].id
        try await hover("mainChat.event."+source)
        try await capture("user-hover")
        observer.menu = nil; observer.selectContextSide = true
        try await contextMenu("mainChat.event." + source)
        try await until("D49 source context action") { observer.contextSelected }
        _=try await A10MacReview.wait("sideChat.source");_=try await A10MacReview.wait("sideChat.referencesOnly")
        try await capture("side-source",root:"conversationDetail")
        try await press("sideChat.source");_=try await A10MacReview.wait("mainChat")
        try await until("Return original event") {model.window.events.contains{$0.id==source}}
        try await capture("returned-source")
        if let assistant = ready["assistantEventID"] as? String {
            try await hover("mainChat.event." + assistant)
            try await capture("assistant-hover")
            try await choose(observer, id: "mainChat.messageMenu." + assistant, title: "导出")
            try await until("Export preview save control") { NSApplication.shared.windows.contains { $0.isVisible && A10MacReview.findButton("保存 Markdown", in: $0) != nil } }
            captureVisible("export-preview")
            if let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.findButton("保存 Markdown", in: $0) != nil }), let save = A10MacReview.findButton("保存 Markdown", in: window) { try A10MacReview.pressNode(save, id: "export.save") }
            try await until("Synthetic native save panel") { NSApplication.shared.windows.contains { $0 is NSSavePanel && $0.isVisible } }
            guard let panel = NSApplication.shared.windows.compactMap({ $0 as? NSSavePanel }).first(where: \.isVisible) else { throw Failure(step: "Native save panel missing") }
            guard let root = app.assistantStateDirectory else { panel.cancel(nil); throw Failure(step: "Synthetic export directory unavailable") }
            let folder = root.appendingPathComponent("A16-export-review")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            panel.directoryURL = folder
            try await Task.sleep(for: .milliseconds(500))
            guard panel.directoryURL?.lastPathComponent == "A16-export-review" else { panel.cancel(nil); throw Failure(step: "Export dialog did not stay in synthetic directory") }
            do {
                try await until("Native save field rendered") { A13MacReview.texts(in: panel).contains { $0.contains("WeftMate-reply") } }
                try await Task.sleep(for: .milliseconds(500))
                captureVisible("export-save-panel"); systemSaveContentCaptured = true
            } catch {
                // The remote system file-service AX/pixels are outside this own-window harness.
                // Record the unverified visual boundary; never change global privacy settings.
                FileHandle.standardOutput.write(Data("A16_STEP:system-save-content-not-captured\n".utf8))
            }
            panel.cancel(nil)
            try await Task.sleep(for: .milliseconds(500))
            if let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.findButton("取消", in: $0) != nil }), let cancel = A10MacReview.findButton("取消", in: window) { try A10MacReview.pressNode(cancel, id: "export.cancel") }
            try await Task.sleep(for: .milliseconds(500))
        }
        app.openedSessionID=main;await model.read(replace:true);try await press("mainChat.latest")
        if let result=(ready["resultIDs"] as? [String])?.first {
            try await press("mainChat.result."+result);_=try await A10MacReview.wait("conversationDetail");try await capture("result-opened",root:"conversationDetail")
            app.openedSessionID=main;_=try await A10MacReview.wait("mainChat")
        }
        try await choose(observer,id:"mainChat.plus",title:"添加合成附件")
        model.draft="A16 合成主对话发送";try await press("mainChat.send")
        try await until("Logical send receipt") {model.pending==nil && model.draft.isEmpty}
        try await capture("sent")
        try await until("Native approval action") {
            NSApplication.shared.windows.contains { $0.isVisible && A10MacReview.find("mainChat", in: $0) != nil && A10MacReview.findButton("批准", in: $0) != nil }
        }; try await capture("approval")
        if let approval=runtimeApprovalID(try await driver("/report")) {
            if let node = A10MacReview.control("approveOnce."+approval) { try A10MacReview.pressNode(node, id: approval) }
            else if let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find("mainChat", in: $0) != nil }), let node = A10MacReview.findButton("批准", in: window) { try A10MacReview.pressNode(node, id: approval) }
            else { throw Failure(step: "Native approval button") }
            try await Task.sleep(for: .milliseconds(500)); _=try await driver("/consume")
        }
        FileHandle.standardOutput.write(Data("A16_STEP:performance-start\n".utf8))
        let perf = try await performance(app)
        FileHandle.standardOutput.write(Data("A16_STEP:performance-complete\n".utf8))
        try await choose(observer,id:"mainChat.plus",title:"这次别记")
        _=try await A10MacReview.wait("temporaryChat.title");_=try await A10MacReview.wait("temporaryChat.composer")
        try await capture("temporary",root:"conversationDetail")
        observer.menu = nil
        try await press("conversationMenu")
        try await until("Native conversation menu") { observer.menu?.items.contains { $0.title == "此对话不形成记忆" } == true }
        guard let rootMenu = observer.menu,
              rootMenu.items.first(where: { $0.title == "此对话不形成记忆" })?.state == .on,
              rootMenu.items.first(where: { $0.title == "使用已有记忆" })?.state == .on,
              !rootMenu.items.contains(where: { $0.title == "完成" }) else { throw Failure(step: "Native temporary check states") }
        try await capture("temporary-menu",root:"conversationDetail")
        guard let current=app.selectedConversation,!current.temporaryState.cacheAllowed,current.temporaryState.memoryMode=="off",current.temporaryState.recallEnabled,current.temporaryState.autoDeleteDays==30 else{throw Failure(step:"Temporary default policy")}
        guard let item = rootMenu.items.first(where: { $0.title.hasPrefix("自动删除") }), let menu = item.submenu else { throw Failure(step: "Native deadline submenu") }
        guard let current = menu.items.first(where: { $0.title == "30 天" }), current.state == .on,
              let seven = menu.items.firstIndex(where: { $0.title == "7 天" }) else { throw Failure(step: "Deadline current radio selection") }
        // Open the native submenu through its AX action before capturing it.
        item.accessibilityPerformPress()
        try await Task.sleep(for: .milliseconds(500))
        try await capture("temporary-expiry",root:"conversationDetail")
        menu.performActionForItem(at: seven); menu.cancelTrackingWithoutAnimation(); rootMenu.cancelTrackingWithoutAnimation()
        try await until("Seven day host acknowledgement") { app.selectedConversation?.temporaryState.autoDeleteDays == 7 }
        try await capture("temporary-seven-days", root:"conversationDetail")
        // A17: every new native submenu and destructive confirmation is captured open.
        for (title, scene) in [("移至项目", "move-project-menu"), ("移至分组", "move-group-menu")] {
            observer.menu = nil; try await press("conversationMenu")
            try await until("Native submenu " + title) { observer.menu?.items.contains { $0.title == title } == true }
            guard let parent = observer.menu, let item = parent.items.first(where: { $0.title == title }), let submenu = item.submenu else { throw Failure(step: title) }
            item.accessibilityPerformPress(); try await Task.sleep(for: .milliseconds(400))
            try await capture(scene, root: "conversationDetail")
            submenu.cancelTrackingWithoutAnimation(); parent.cancelTrackingWithoutAnimation()
        }
        observer.menu = nil; try await press("conversationMenu")
        try await until("Native delete item") { observer.menu?.items.contains { $0.title == "删除" } == true }
        guard let deletionMenu = observer.menu, let deletionIndex = deletionMenu.items.firstIndex(where: { $0.title == "删除" }) else { throw Failure(step: "Delete action") }
        deletionMenu.performActionForItem(at: deletionIndex); deletionMenu.cancelTrackingWithoutAnimation()
        _ = try await A10MacReview.wait("confirmDeleteConversation")
        try await capture("delete-confirmation", root: "confirmDeleteConversation")
        guard let confirmation = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find("confirmDeleteConversation", in: $0) != nil }),
              let cancel = A10MacReview.findButton("取消", in: confirmation) else { throw Failure(step: "Delete confirmation cancel") }
        try A10MacReview.pressNode(cancel, id: "delete.cancel")
        try await until("Delete cancelled") { app.deletionCandidate == nil }
        // Close only the app's own sheet through its existing close action.
        // Finish with the verified menu visible. AppKit's AX close action retires the
        // SwiftUI review task on this SDK; the parent closes the isolated app after the report.
        FileHandle.standardOutput.write(Data("A16_STEP:completion-report\n".utf8))
        var metrics: [String: JSONValue] = [:]
        for (key, value) in perf {
            if let text = value as? String { metrics[key] = .string(text) }
            else if let number = value as? Double { metrics[key] = .number(number) }
            else if let number = value as? Int { metrics[key] = .number(Double(number)) }
        }
        let report: [String: JSONValue] = ["passed": .bool(true), "nativeOwnAX": .bool(true), "xcuITest": .bool(false),
            "systemSavePanelContentCaptured": .bool(systemSaveContentCaptured), "globalPermissionsRequested": .bool(false), "syntheticOnly": .bool(true), "historyCount": .number(10000), "performance": .object(metrics)]
        let bytes = try JSONEncoder().encode(report)
        FileHandle.standardOutput.write(Data("A10_REPORT:".utf8) + bytes + Data("\n".utf8))
        FileHandle.standardOutput.write(Data("A16_STEP:report-written\n".utf8))
        Darwin._exit(0)
    }
    private static func runtimeApprovalID(_ row:[String:Any])->String?{(row["approvals"] as? [[String:Any]])?.first(where:{$0["resolved"] as? Bool==false})?["id"] as? String}
    private static func scrollMainToTop() {
        func visit(_ view: NSView) {
            if let scroll = view as? NSScrollView, (scroll.documentView?.bounds.height ?? 0) > 600 {
                scroll.contentView.scroll(to: .zero); scroll.reflectScrolledClipView(scroll.contentView)
            }
            for child in view.subviews { visit(child) }
        }
        for window in NSApplication.shared.windows where window.isVisible && A10MacReview.find("mainChat", in: window) != nil { if let content = window.contentView { visit(content) } }
    }
    private static func performance(_ app:AppleAppModel) async throws -> [String:Any] {
        guard let window=NSApplication.shared.windows.first(where:{$0.isVisible && A10MacReview.find("mainChat",in:$0) != nil}),let content=window.contentView else{throw Failure(step:"Scroll window")}
        func scroll(_ v:NSView)->NSScrollView? {if let s=v as? NSScrollView,s.documentView?.bounds.height ?? 0 > 600{return s};for c in v.subviews{if let s=scroll(c){return s}};return nil}
        guard let s=scroll(content) else{throw Failure(step:"Native scroll container")}
        let sampler = A16FrameSampler()
        let link = content.displayLink(target: sampler, selector: #selector(A16FrameSampler.tick(_:)))
        link.add(to: .main, forMode: .common)
        defer { link.invalidate() }
        let start = ProcessInfo.processInfo.systemUptime

        for i in 0..<600 {
            if i % 120 == 0 { FileHandle.standardOutput.write(Data(("A16_STEP:scroll-" + String(i) + "\n").utf8)) }
            var point=s.contentView.bounds.origin;point.y=max(0,min((s.documentView?.bounds.height ?? 0)-s.contentView.bounds.height,point.y+(i%120<60 ? -14:14)))
            s.contentView.scroll(to:point);s.reflectScrolledClipView(s.contentView)
            try await Task.sleep(for:.milliseconds(16))
        }
        var report = sampler.report(bodyWindow: app.mainChat.window.events.count)
        report["nativeScrollUpdates"] = 600; report["elapsedSeconds"] = ProcessInfo.processInfo.systemUptime - start
        return report
    }
}
#endif
