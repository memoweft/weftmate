#if DEBUG && os(macOS)
import AppKit
import Foundation

@MainActor enum DIAG3MacReview {
    static func run() async {
        // Same app-owned AX setup as the existing A17 runner; no TCC or system settings.
        NSApplication.shared.accessibilitySetValue(true, forAttribute: NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface"))
        NSApplication.shared.setActivationPolicy(.regular); NSApplication.shared.activate(ignoringOtherApps: true)
        let args = ProcessInfo.processInfo.arguments, log = RunLogRuntime.shared
        var step = "openRunLog"
        do {
            await log.ready()
            _ = try await A10MacReview.wait("openRunLog")
            if log.notify { try await A10MacReview.capture("diag3-banner", identifier: "weftmateRoot") }
            try await A10MacReview.press("openRunLog")
            step = "runLogPage"; _ = try await A10MacReview.wait(step)
            try await Task.sleep(for: .milliseconds(500))
            try await A10MacReview.capture("diag3-records", identifier: step)
            step = "previewRunSummary"; try await A10MacReview.press(step)
            step = "runSummaryPreview"; _ = try await A10MacReview.wait(step)
            let summary = await log.store.summaryJSON()
            FileHandle.standardOutput.write(Data(("DIAG3_SUMMARY:" + summary.replacingOccurrences(of: "\n", with: "") + "\n").utf8))
            if args.contains("--diag3-hold") { return }
            FileHandle.standardOutput.write(Data("DIAG3_STEP:closing\n".utf8))
            step = "closeRunLog"; try await A10MacReview.press(step)
            FileHandle.standardOutput.write(Data("DIAG3_STEP:pressed-close\n".utf8))
            for _ in 0..<30 {
                if NSApplication.shared.modalWindow == nil && !NSApplication.shared.windows.contains(where: { $0.attachedSheet != nil }) { break }
                try await Task.sleep(for: .milliseconds(100))
            }
            try await Task.sleep(for: .milliseconds(500))
            FileHandle.standardOutput.write(Data("DIAG3_STEP:terminating\n".utf8))
            NSApplication.shared.terminate(nil)
        } catch {
            A16MacReview.captureVisible("diag3-failure")
            FileHandle.standardOutput.write(Data(("DIAG3_FAILURE:" + step + "\n").utf8))
            NSApplication.shared.terminate(nil)
        }
    }
}
#endif
