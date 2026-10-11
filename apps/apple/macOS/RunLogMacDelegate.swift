import AppKit
import WeftMateCore

@MainActor final class RunLogMacDelegate: NSObject, NSApplicationDelegate {
    private var terminationReason = "user_quit"
    @objc nonisolated private func systemWillTerminate(_ notification: Notification) {
        Task { @MainActor [weak self] in self?.terminationReason = "system_termination" }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Reply only after the off-main durable exit record; no main-thread disk I/O.
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--diag3-disable-logging") { return .terminateNow }
        #endif
        let reason = terminationReason
        let store = RunLogRuntime.shared.store
        Task.detached {
            _ = await store.start()
            await store.exit(reason: reason, code: 0)
            // AppKit runs NSModalPanelRunLoopMode while waiting for terminateLater.
            // A MainActor Task can stall there. Schedule on the actual main run loop,
            // including modal/event-tracking modes; the callback is guaranteed main-thread.
            RunLoop.main.perform(inModes: [.default, .modalPanel, .eventTracking]) {
                MainActor.assumeIsolated { NSApplication.shared.reply(toApplicationShouldTerminate: true) }
            }
        }
        return .terminateLater
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(systemWillTerminate(_:)), name: NSWorkspace.willPowerOffNotification, object: nil)
        Task {
            await RunLogRuntime.shared.ready()
            let store = RunLogRuntime.shared.store
            Task.detached(priority: .utility) {
                guard let home = FileManager.default.homeDirectory(forUser: NSUserName()) else {
                    await store.record(.reports, fields: ["code": "UNAVAILABLE"]); return
                }
                let root = home.appendingPathComponent("Library/Logs/DiagnosticReports")
                do {
                    var urls = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey])
                    let retired = root.appendingPathComponent("Retired")
                    if FileManager.default.fileExists(atPath: retired.path) {
                        urls += try FileManager.default.contentsOfDirectory(at: retired, includingPropertiesForKeys: [.contentModificationDateKey])
                    }
                    let reports = urls.filter { $0.lastPathComponent.hasPrefix("WeftMateMac-") && $0.pathExtension == "ips" }.map { url in
                        RunReportReference(name: url.lastPathComponent, at: RunLog.timestamp((try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast))
                    }
                    await store.reportInventory(reports)
                } catch {
                    // Sandbox denial is an unavailable inventory, never a false zero-crash result.
                    await store.record(.reports, fields: ["code": "UNAVAILABLE"])
                }
            }
        }
    }
}
