#if DEBUG && os(macOS)
import AppKit
import Foundation
import Darwin
import WeftMateCore

@MainActor enum A14MacReview {
    private static func capture(_ scene: String, expecting text: String) async throws {
        for window in NSApplication.shared.windows { window.makeKeyAndOrderFront(nil) }
        var visible = false
        for _ in 0..<100 {
            if A13MacReview.texts().contains(text) { visible = true; break }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard visible, let window = NSApplication.shared.windows.first(where: { $0.isVisible && $0.title == "WeftMate" }) else { throw OfflineFailure.invalid }
        try await Task.sleep(for: .milliseconds(500))
        typealias Images = @convention(c) (CGRect, CFArray, UInt32) -> Unmanaged<CGImage>?
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImageFromArray") else { throw OfflineFailure.invalid }
        var ids = [UnsafeRawPointer(bitPattern: window.windowNumber)]
        let array = CFArrayCreate(kCFAllocatorDefault, &ids, ids.count, nil)!
        guard let image = unsafeBitCast(symbol, to: Images.self)(.null, array, 1)?.takeRetainedValue(),
              let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw OfflineFailure.invalid }
        FileHandle.standardOutput.write(Data(("A10_CAPTURE:" + scene + ":" + png.base64EncodedString() + "\n").utf8))
    }
    private static func poll(_ app: AppleAppModel) async throws {
        while app.offline.polling { try await Task.sleep(for: .milliseconds(100)) }
        await app.pollOffline()
    }
    static func run(_ app: AppleAppModel) async throws {
        NSApplication.shared.setActivationPolicy(.regular); NSApplication.shared.activate(ignoringOtherApps: true)
        for window in NSApplication.shared.windows { window.makeKeyAndOrderFront(nil) }
        try await Task.sleep(for: .seconds(1))
        try await poll(app)
        guard app.offline.ready else { throw OfflineFailure.notReady }
        _ = try await A14TestSupport.get("stop"); try await poll(app)
        guard app.offline.hostOffline else { throw OfflineFailure.invalid }
        app.offline.draft = "我喝茶喜欢什么？"
        await app.offline.send(control: app.offlineAuthorization)
        guard app.offline.messages.last?.text == "你喜欢茉莉花茶，不加糖。" else { throw OfflineFailure.model }
        try await capture("a14-memory", expecting: "你喜欢茉莉花茶，不加糖。")
        app.offline.draft = "我徒步用墨绿色双肩背包。"
        await app.offline.send(control: app.offlineAuthorization)
        _ = try await A14TestSupport.get("start"); try await poll(app)
        guard app.offline.pending == 0, app.offline.turns.count == 2 else { throw OfflineFailure.invalid }
        app.offline.showHistory = true
        try await capture("a14-synced", expecting: "已同步")
        _ = try await A14TestSupport.get("forget"); try await poll(app)
        guard app.offline.turns.isEmpty else { throw OfflineFailure.invalid }
        _ = try await A14TestSupport.get("stop"); try await poll(app)
        try await capture("a14-forgotten", expecting: OfflineChatModel.warning)
        // Scan app-controlled bytes before deleting the test namespace. Keys never enter files.
        let object = try JSONSerialization.jsonObject(with: await A14TestSupport.get("needles")) as! [String: [String]]
        let scan = try app.scanOfflineTestStorage(needles: object["values"]!)
        FileHandle.standardOutput.write(Data(("A14_SCAN:" + String(decoding: scan, as: UTF8.self) + "\n").utf8))
        app.offline.erase()
        FileHandle.standardOutput.write(Data("A10_REPORT:{\"passed\":true,\"syntheticOnly\":true,\"scenes\":3}\n".utf8))
    }
}
#endif
