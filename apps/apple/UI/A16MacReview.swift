#if DEBUG && os(macOS)
import AppKit
import Foundation
import Darwin
import QuartzCore
import WeftMateCore
@MainActor private final class A16MenuObserver: NSObject {
    var menu: NSMenu?
    override init() { super.init(); NotificationCenter.default.addObserver(self,selector:#selector(track(_:)),name:NSMenu.didBeginTrackingNotification,object:nil) }
    @objc private func track(_ note: Notification) { menu = note.object as? NSMenu }
    func stop() { NotificationCenter.default.removeObserver(self) }
}
@MainActor enum A16MacReview {
    private struct Failure: Error { let step: String }
    private static var reviewTask: Task<Void, Error>?
    static func runPersistent(_ app: AppleAppModel) async throws {
        if let reviewTask { try await reviewTask.value; return }
        let task = Task<Void, Error> { @MainActor in
            do { try await run(app); Darwin.exit(0) }
            catch {
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
        _ = try await A10MacReview.wait(root); try await A10MacReview.capture(name,identifier:root)
        let data = try JSONSerialization.data(withJSONObject:["scene":name,"text":A13MacReview.texts().joined(separator:"\n")])
        FileHandle.standardOutput.write(Data(("A13_TEXT:"+String(decoding:data,as:UTF8.self)+"\n").utf8))
    }
    private static func press(_ id: String) async throws {
        FileHandle.standardOutput.write(Data(("A16_STEP:" + id + "\n").utf8))
        let titles = ["mainChat.date": "跳日期", "mainChat.search": "搜索", "mainChat.find": "查找", "mainChat.latest": "回到底部", "mainChat.next": "下一条", "mainChat.previous": "上一条", "mainChat.plus": "添加", "mainChat.send": "发送", "conversationMenu": "对话菜单", "closeSessionActions": "完成"]
        var named: NSObject?
        if let title = titles[id] {
            for window in NSApplication.shared.windows where window.isVisible { if let node = A10MacReview.findButton(title, in: window) { named = node; break } }
        }
        if let node = named { try A10MacReview.pressNode(node, id: id) }
        else { try await A10MacReview.press(id) }
        try await Task.sleep(for: .milliseconds(300))
        if id == "conversationMenu", A10MacReview.control("closeSessionActions") == nil, let node = named {
            let selector = NSSelectorFromString("accessibilityFrame")
            typealias Frame = @convention(c) (AnyObject, Selector) -> CGRect
            guard node.responds(to: selector), let window = NSApplication.shared.windows.first(where: { $0.isVisible && A10MacReview.find("conversationDetail", in: $0) != nil }) else { throw Failure(step: "Native menu frame") }
            let frame = unsafeBitCast(node.method(for: selector), to: Frame.self)(node, selector)
            let point = window.convertPoint(fromScreen: CGPoint(x: frame.midX, y: frame.midY))
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                if let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) { window.sendEvent(event) }
            }
            try await Task.sleep(for: .milliseconds(500))
        }
    }
    private static func choose(_ observer: A16MenuObserver,id: String,title: String) async throws {
        observer.menu=nil; try await press(id)
        try await until("Native menu missing " + title) { observer.menu?.items.contains { $0.title == title } == true }
        let menu=observer.menu!,index=menu.items.firstIndex(where:{$0.title==title})!
        menu.performActionForItem(at:index);menu.cancelTrackingWithoutAnimation();try await Task.sleep(for:.milliseconds(500))
    }
    private static func hover(_ id: String) async throws {
        let node=try await A10MacReview.wait(id),selector=NSSelectorFromString("accessibilityFrame")
        typealias Frame = @convention(c) (AnyObject, Selector) -> CGRect
        guard node.responds(to:selector),let window=NSApplication.shared.windows.first(where:{$0.isVisible && A10MacReview.find(id,in:$0) != nil}),let content=window.contentView else{throw Failure(step:"Native message hover")}
        let frame=unsafeBitCast(node.method(for:selector),to:Frame.self)(node,selector),point=window.convertPoint(fromScreen:CGPoint(x:frame.midX,y:frame.midY))
        func visit(_ view:NSView){let local=view.convert(point,from:nil);for area in view.trackingAreas where (area.options.contains(.inVisibleRect) ? view.bounds:area.rect).contains(local){
            if let owner=area.owner as? NSResponder,let e=NSEvent.enterExitEvent(with:.mouseEntered,location:point,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,eventNumber:0,trackingNumber:0,userData:nil){owner.mouseEntered(with:e)}};for child in view.subviews{visit(child)}}
        visit(content);try await Task.sleep(for:.milliseconds(500))
    }
    static func run(_ app: AppleAppModel) async throws {
        let observer=A16MenuObserver();defer{observer.stop()}
        NSApplication.shared.setActivationPolicy(.regular);NSApplication.shared.activate(ignoringOtherApps:true)
        let ready=try await driver("/ready"),model=app.mainChat,main=ready["mainChatID"] as! String
        _=try await A10MacReview.wait("mainChat")
        try await until("Main body tail") { !model.window.events.isEmpty }
        guard model.window.events.count <= 1000,app.conversations.first?.isMainChat==true else{throw Failure(step:"Main identity or bounded window")}
        try await capture("first-screen")
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
        try await choose(observer,id:"mainChat.messageMenu."+source,title:"开旁聊")
        _=try await A10MacReview.wait("sideChat.source");_=try await A10MacReview.wait("sideChat.referencesOnly")
        try await capture("side-source",root:"conversationDetail")
        try await press("sideChat.source");_=try await A10MacReview.wait("mainChat")
        try await until("Return original event") {model.window.events.contains{$0.id==source}}
        try await capture("returned-source")
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
        try await press("conversationMenu")
        _=try await A10MacReview.wait("temporaryChat.memory");_=try await A10MacReview.wait("temporaryChat.recall")
        try await capture("temporary-menu",root:"conversationDetail")
        guard let current=app.selectedConversation,!current.temporaryState.cacheAllowed,current.temporaryState.memoryMode=="off",current.temporaryState.recallEnabled,current.temporaryState.autoDeleteDays==30 else{throw Failure(step:"Temporary default policy")}
        // Actual native menu radio state is captured before the asynchronous host acknowledgement.
        observer.menu = nil
        try await press("temporaryChat.expiryMenu")
        try await until("Native deletion deadline radio menu") { observer.menu?.items.contains { $0.title == "30 天" } == true }
        guard let menu = observer.menu, let current = menu.items.first(where: { $0.title == "30 天" }), current.state == .on,
              let seven = menu.items.firstIndex(where: { $0.title == "7 天" }) else { throw Failure(step: "Deadline current radio selection") }
        try await capture("temporary-expiry",root:"conversationDetail")
        menu.performActionForItem(at: seven); menu.cancelTrackingWithoutAnimation()
        try await until("Seven day host acknowledgement") { app.selectedConversation?.temporaryState.autoDeleteDays == 7 }
        try await capture("temporary-seven-days", root:"conversationDetail")
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
            "globalPermissionsRequested": .bool(false), "syntheticOnly": .bool(true), "historyCount": .number(10000), "performance": .object(metrics)]
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
