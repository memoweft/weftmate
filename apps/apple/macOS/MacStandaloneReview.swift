#if DEBUG
import AppKit
import Darwin
import WeftMateCore

/// In-process native control driver. It only accesses this isolated app's controls/windows.
@MainActor enum MacStandaloneReview {
    static var enabled: Bool {
        let args = ProcessInfo.processInfo.arguments
        return args.contains("--ui-testing") && args.contains("--apple12-review")
    }
    private static let credentials = ReviewCredentials()
    static func makeModel() -> PhoneStandaloneModel {
        enabled ? PhoneStandaloneModel(testCredentials: credentials, testLoopback: ProcessInfo.processInfo.arguments.contains("--apple12-fix1-connection")) : PhoneStandaloneModel()
    }
    static func set(_ id: String, _ value: String) async throws {
        let node = try await A10MacReview.wait(id)
        guard let cell = node as? NSCell, let field = cell.controlView as? NSTextField, let window = field.window else {
            throw NSError(domain: "Apple12ControlValue", code: 1)
        }
        window.makeKeyAndOrderFront(nil)
        guard window.makeFirstResponder(field), let editor = field.currentEditor() as? NSTextView else {
            throw NSError(domain: "Apple12FieldEditor", code: 1)
        }
        editor.selectAll(nil); editor.insertText(value, replacementRange: editor.selectedRange()); editor.didChangeText()
        window.endEditing(for: field)
        try await Task.sleep(for: .milliseconds(350))
    }
    private static func wait(_ condition: () -> Bool) async throws {
        for _ in 0..<1500 { if condition() { return }; try await Task.sleep(for: .milliseconds(100)) }
        throw NSError(domain: "Apple12ReviewTimeout", code: 1)
    }
    private static func connectionRegression(app: AppleAppModel, chat: PhoneStandaloneModel) async throws {
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
        for window in NSApplication.shared.windows { window.makeKeyAndOrderFront(nil) }
        NSApplication.shared.accessibilitySetValue(true, forAttribute: NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface"))
        guard let base = ProcessInfo.processInfo.environment["APPLE12_MODEL_FIXTURE"] else { throw NSError(domain: "FixtureMissing", code: 1) }
        chat.activate(app: app)
        try chat.saveModel(.init(name: "Synthetic", baseURL: base, model: "synthetic-stream", apiKey: "synthetic-state-key"))
        _ = try await A10MacReview.wait("macChat.draft")
        chat.draft = "慢回复"; chat.send()
        try await wait { !(chat.messages.last?.text.isEmpty ?? true) }
        guard chat.busy else { throw NSError(domain: "StreamNotInProgress", code: 1) }
        let thread = chat.state.selected
        try app.seedMacStandaloneConnectionReview()
        try await Task.sleep(for: .milliseconds(500))
        guard chat.busy else {
            print("APPLE12_FIX1_RED: connecting computer stopped the local stream")
            throw NSError(domain: "LocalStreamStoppedOnConnect", code: 1)
        }
        print("APPLE12_FIX1_STEP: stream retained after connection")
        try await A10MacReview.press("macChat.openLocal")
        _ = try await A10MacReview.wait("macChat.openComputer")
        print("APPLE12_FIX1_STEP: returned to visible local workspace")
        _ = try await A10MacReview.wait("macChat.draft")
        try await wait { !chat.busy }
        guard chat.state.selected == thread, app.session != nil, chat.notice == nil, !chat.messages.last!.text.isEmpty else { throw NSError(domain: "LocalHistoryLost", code: 1) }
        chat.draft = "接着聊"; chat.send(); try await wait { !chat.busy }
        guard chat.messages.count == 4, chat.notice == nil else { throw NSError(domain: "LocalContinuationFailed", code: 1) }
        try await A10MacReview.capture("fix1-connected-local-chat", identifier: "macChat.draft")
        print("APPLE12_FIX1_GREEN: computer connected mid-stream, local entry reopened same thread, reply finished and next turn succeeded")
    }

    static func run(app: AppleAppModel, chat: PhoneStandaloneModel) async {
        var stage = "restore"
        do {
            try await wait { !app.restoring }
            if ProcessInfo.processInfo.arguments.contains("--apple12-fix1-connection") {
                try await connectionRegression(app: app, chat: chat)
                await RunLogRuntime.shared.ready(); await RunLogRuntime.shared.store.exit(reason: "user_quit", code: 0)
                Darwin.exit(0)
            }
            guard app.session == nil, !app.cloudLogin.authenticated,
                  let key = ProcessInfo.processInfo.environment["MIMO_API_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty else {
                throw NSError(domain: "Apple12IsolatedLocalOnly", code: 1)
            }
            chat.activate(app: app)
            NSApplication.shared.setActivationPolicy(.regular)
            NSApplication.shared.activate(ignoringOtherApps: true)
            for window in NSApplication.shared.windows { window.makeKeyAndOrderFront(nil) }
            NSApplication.shared.accessibilitySetValue(true, forAttribute: NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface"))
            stage = "workspace"
            let rootControl = ProcessInfo.processInfo.arguments.contains("--apple12-reopen") ? "macChat.draft" : "modelServices.key"
            _ = try await A10MacReview.wait(rootControl)
            if ProcessInfo.processInfo.arguments.contains("--apple12-reopen") {
                guard chat.currentModel?.model == "mimo-v2.6-flash", chat.messages.count == 2,
                      !(chat.messages.last?.text.isEmpty ?? true) else { throw NSError(domain: "Apple12ProcessReopen", code: 1) }
                try await A10MacReview.capture("mac-reopened", identifier: rootControl)
                print("APPLE12_REOPEN: new app process restored model and nonempty reply from sealed disk state and process-only credential substitute")
                await RunLogRuntime.shared.ready()
                await RunLogRuntime.shared.store.exit(reason: "user_quit", code: 0)
                Darwin.exit(0)
            }
            guard chat.models.isEmpty, chat.messages.isEmpty else { throw NSError(domain: "Apple12ColdStartNotEmpty", code: 1) }
            try await A10MacReview.capture("mac-cold", identifier: rootControl)
            stage = "key-entry"
            try await set("modelServices.key", key)
            // The editor performs its regular debounced catalogue query after key entry.
            stage = "catalogue"
            _ = try await A10MacReview.wait("modelServices.default.mimo-v2.6-flash")
            try await A10MacReview.press("modelServices.default.mimo-v2.6-flash")
            try await Task.sleep(for: .milliseconds(400))
            stage = "save-model"
            try await A10MacReview.press("modelServices.save")
            try await wait { chat.currentModel?.model == "mimo-v2.6-flash" }
            _ = try await A10MacReview.wait("macChat.draft")
            stage = "draft-entry"
            try await set("macChat.draft", "请只回复：Mac独立聊天成功。")
            try await wait { !chat.draft.isEmpty }
            stage = "send-reply"
            try await A10MacReview.press("macChat.send")
            try await wait { !chat.busy && chat.messages.last?.role == "assistant" && !(chat.messages.last?.text.isEmpty ?? true) }
            guard chat.notice == nil else { throw NSError(domain: "Apple12ReplyNotice", code: 1) }
            try await A10MacReview.capture("mac-reply", identifier: "macChat.draft")
            let original = chat.messages
            chat.deactivate(); chat.activate(app: app)
            guard chat.messages == original, chat.currentModel?.model == "mimo-v2.6-flash" else { throw NSError(domain: "Apple12Reopen", code: 1) }
            stage = "notes"
            try await A10MacReview.press("macChat.notes")
            _ = try await A10MacReview.wait("localDraft")
            try await A10MacReview.capture("mac-notes", identifier: "localWorkspace")
            if let raw = ProcessInfo.processInfo.environment["APPLE12_CREDENTIAL_PIPE"], let fd = Int32(raw) {
                try FileHandle(fileDescriptor: fd, closeOnDealloc: false).write(contentsOf: credentials.export())
            }
            print("APPLE12_GUI: cold start, native secure entry, MiMo catalogue selection, native send, nonempty reply, sealed-store reload, notes entry; login 0; memory Keychain substitute")
            await RunLogRuntime.shared.ready()
            await RunLogRuntime.shared.store.exit(reason: "user_quit", code: 0)
            Darwin.exit(0)
        } catch {
            // Never stringify errors that could contain a request, header or provider body.
            print("APPLE12_GUI_FAILED: " + stage)
            if ProcessInfo.processInfo.arguments.contains("--apple12-fix1-connection") { print("APPLE12_FIX1_ERROR: " + String(describing: error)) }
            A16MacReview.captureVisible("mac-failure")
            Darwin.exit(1)
        }
    }
}
private final class ReviewCredentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]
    @MainActor init() {
        guard MacStandaloneReview.enabled, let value = ProcessInfo.processInfo.environment["APPLE12_CREDENTIAL_SNAPSHOT"],
              let data = Data(base64Encoded: value), let decoded = try? JSONDecoder().decode([String: Data].self, from: data) else { return }
        values = decoded
    }
    func export() throws -> Data { try lock.withLock { try JSONEncoder().encode(values) } }
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ data: Data, key: String) { lock.withLock { values[key] = data } }
    func delete(key: String) { lock.withLock { values[key] = nil } }
}
#endif
