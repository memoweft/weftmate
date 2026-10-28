import Foundation
import Testing
import UserNotifications
import WeftMateCore
@testable import MacStandaloneProduct

@MainActor @Suite(.serialized) struct MacStandaloneTests {
    private func wait(_ condition: () -> Bool) async throws {
        for _ in 0..<1500 { if condition() { return }; try await Task.sleep(for: .milliseconds(100)) }
        throw NSError(domain: "MacStandaloneTimeout", code: 1)
    }
    @Test func modelConfigurationStreamsAndReopensSealedHistory() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("fixture.mjs")
        let process = Process(), output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env"); process.arguments = ["node", fixture.path]; process.standardOutput = output
        try process.run()
        defer { if process.isRunning { process.terminate(); process.waitUntilExit() } }
        var bytes = Data()
        while true {
            let byte = output.fileHandleForReading.readData(ofLength: 1)
            #expect(!byte.isEmpty)
            if byte == Data([10]) { break }
            if byte.isEmpty { throw NSError(domain: "FixtureStart", code: 1) }; bytes.append(byte)
        }
        let ready = try JSONSerialization.jsonObject(with: bytes) as! [String: String]
        let base = ready["origin"]! + "/v1", keys = PhoneCheckCredentials(), app = AppleAppModel(directory: directory)
        app.cloudLogin.subject = nil; app.cloudLogin.authenticated = false
        let model = PhoneStandaloneModel(testCredentials: keys, testLoopback: true)
        defer { model.deactivate() }
        model.activate(app: app)
        #expect(model.models.isEmpty && model.messages.isEmpty && app.session == nil)
        let catalog = await model.queryService(baseUrl: base, apiKey: "synthetic-state-key", interfaceType: "openai-compatible")
        #expect(catalog.status == "available" && catalog.models?.first?.modelId == "synthetic-stream")
        try model.saveService(existing: nil, name: "Synthetic", baseUrl: base, apiKey: "synthetic-state-key", interfaceType: "openai-compatible", result: catalog, manual: "", selected: "synthetic-stream", enabled: nil)
        #expect(model.currentModel?.model == "synthetic-stream")
        model.draft = "Mac 独立问题"; model.send()
        try await wait { model.messages.last?.text == "第一片" }
        #expect(model.busy)
        try await wait { !model.busy }
        #expect(model.notice == nil)
        #expect(model.messages.map(\.role) == ["user", "assistant"])
        #expect(model.messages.last?.text == "第一片、第二片，Mac独立回复完成。")
        let restored = PhoneStandaloneModel(testCredentials: keys, testLoopback: true)
        defer { restored.deactivate() }
        restored.activate(app: app)
        #expect(restored.messages == model.messages)
        #expect(restored.services == model.services)
        #expect(restored.modelID == model.modelID)
        #expect(restored.state.selected == model.state.selected)
        let store = try PhoneChatStore(account: app.phoneAccountIdentity, directory: directory.appendingPathComponent("PhoneChats"), credentials: keys)
        let sealed = try Data(contentsOf: store.file)
        for text in ["Mac 独立问题", "第一片", "synthetic-state-key"] { #expect(sealed.range(of: Data(text.utf8)) == nil) }
        model.draft = "慢回复"; model.send()
        try await wait { !(model.messages.last?.text.isEmpty ?? true) }; model.stop()
        let stopped = model.messages
        try await Task.sleep(for: .milliseconds(300))
        #expect(model.messages == stopped && !model.busy)
        app.cloudLogin.subject = "other-account"; model.activate(app: app)
        #expect(model.messages.isEmpty && model.models.isEmpty)
        #expect(app.offline.enqueued.isEmpty)
    }
    @Test func macReminderAcknowledgementHasAnExistingDestination() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let app = AppleAppModel(directory: directory)
        app.cloudLogin.subject = nil; app.cloudLogin.authenticated = false
        let model = PhoneStandaloneModel(testCredentials: PhoneCheckCredentials(), testLoopback: false)
        defer { model.deactivate() }; model.activate(app: app)
        model.draft = "1分钟后提醒我喝水"; model.send()
        #expect(model.reminders.count == 1)
        #expect(model.reminders.first?.text == "喝水")
        #expect(model.messages.last?.role == "assistant")
        #expect(model.messages.last?.text.contains("目标页") == false)
        #expect(model.messages.last?.text.contains("通知") == true)
        let center = MacRecordingNotificationCenter()
        let notifications = MacReminderNotifications(center: center, authorization: { .authorized }, request: { true })
        notifications.attach(model); await notifications.reconcile()
        let pending = try #require(center.values.first)
        #expect(center.values.count == 1)
        #expect(pending.text == "喝水")
        #expect(pending.route.sessionID == model.state.selected)
        #expect(abs(pending.fireAt.timeIntervalSinceNow - 60) < 5)
        await notifications.reconcile()
        #expect(center.values.count == 1 && center.additions == 1)
        app.cloudLogin.subject = "other-account"; model.activate(app: app)
        await notifications.reconcile()
        #expect(center.values.isEmpty)

    }
    @Test func macNotificationAuthorizationFailureStaysVisibleAndRecovers() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let app = AppleAppModel(directory: directory)
        let model = PhoneStandaloneModel(testCredentials: PhoneCheckCredentials(), testLoopback: false)
        defer { model.deactivate() }; model.activate(app: app)
        model.draft = "1分钟后提醒我喝水"; model.send()
        let center = MacRecordingNotificationCenter()
        var status = UNAuthorizationStatus.notDetermined
        let notifications = MacReminderNotifications(center: center, authorization: { status }, request: { throw NSError(domain: "UNErrorDomain", code: 1) })
        notifications.attach(model); await notifications.requestPermission(); await notifications.reconcile()
        #expect(notifications.deliveryNotice?.contains("权限") == true)
        #expect(!notifications.needsPermission)
        #expect(center.values.isEmpty)
        status = .authorized; await notifications.reconcile()
        #expect(notifications.deliveryNotice == nil)
        #expect(center.values.count == 1)
    }
    @Test(.enabled(if: ProcessInfo.processInfo.environment["APPLE12_LIVE_MIMO"] == "1"))
    func threeRealMimoRepliesThroughMacProductController() async throws {
        let key = try #require(ProcessInfo.processInfo.environment["MIMO_API_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines))
        #expect(!key.isEmpty)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let keys = PhoneCheckCredentials(), app = AppleAppModel(directory: directory)
        app.cloudLogin.subject = nil; app.cloudLogin.authenticated = false
        let model = PhoneStandaloneModel(testCredentials: keys, testLoopback: false)
        defer { model.deactivate() }
        model.activate(app: app)
        let catalog = await model.queryService(baseUrl: "https://api.xiaomimimo.com/v1", apiKey: key, interfaceType: "openai-compatible")
        #expect(catalog.status == "available")
        try model.saveService(existing: nil, name: "MiMo", baseUrl: "https://api.xiaomimimo.com/v1", apiKey: key, interfaceType: "openai-compatible", result: catalog, manual: "mimo-v2.6-flash", selected: "mimo-v2.6-flash", enabled: nil)
        for prompt in ["请只回复：Mac聊天成功。", "请用一句话解释什么是本机保存。", "请只回复：第三条回复成功。"] {
            model.draft = prompt; model.send(); try await wait { !model.busy }
            #expect(model.messages.last?.role == "assistant")
            #expect(!(model.messages.last?.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true))
            #expect(model.notice == nil)
        }
        #expect(model.messages.count == 6)
        let restored = PhoneStandaloneModel(testCredentials: keys, testLoopback: false)
        defer { restored.deactivate() }; restored.activate(app: app)
        #expect(restored.messages == model.messages)
        #expect(app.session == nil && !app.cloudLogin.authenticated && app.offline.enqueued.isEmpty)
        print("APPLE12_LIVE: 3/3 nonempty streamed replies; sealed history reopened; account login 0; in-memory credential substitute")
    }
}

@MainActor private final class MacRecordingNotificationCenter: ReminderNotificationCenter {
    var values: [ReminderNotification] = []
    var additions = 0
    func pending() async -> [ReminderNotification] { values }
    func otherPendingCount() async -> Int { 0 }
    func remove(_ identifiers: [String]) { values.removeAll { identifiers.contains($0.identifier) } }
    func deliveredNotifications() async -> [ReminderNotification] { [] }
    func removeDelivered(_ identifiers: [String]) {}
    func add(_ notification: ReminderNotification) async throws { additions += 1; values.append(notification) }
}
