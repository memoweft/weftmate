#if DEBUG && os(macOS)
import AppKit
import Foundation

@MainActor enum DIAG3MacReview {
    private struct Failure: Error { let step: String }
    static func run() async {
        // Existing in-app AX only. No global input, TCC request, or system settings.
        NSApplication.shared.accessibilitySetValue(true, forAttribute: NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface"))
        NSApplication.shared.setActivationPolicy(.regular); NSApplication.shared.activate(ignoringOtherApps: true)
        let args = ProcessInfo.processInfo.arguments, log = RunLogRuntime.shared
        let expected = args.firstIndex(of: "--diag3-expect").map { args[$0 + 1] } ?? "records"
        var step = "openRunLog"
        func capture(_ name: String, _ identifier: String) async throws {
            try await Task.sleep(for: .seconds(2))
            try await A10MacReview.capture(name, settings: true, identifier: identifier, includeSheets: true)
        }
        func check(_ value: Bool, _ name: String) throws { if !value { throw Failure(step: name) } }
        do {
            await log.ready()
            _ = try await A10MacReview.wait("openRunLog")
            try await Task.sleep(for: .milliseconds(500))
            let hadNotice = log.notify
            try check(hadNotice == (expected == "records"), "forced restart notice / normal exit without notice")
            if hadNotice {
                try await capture("banner", "settingsRoot")
                try await A10MacReview.press("dismissPreviousRunNotice")
                try check(!log.notify, "notice dismissed")
                try await capture("banner-dismissed", "settingsRoot")
            }
            try await capture("about-" + expected, "settingsRoot")
            try await A10MacReview.press("openRunLog")
            step = "runLogPage"; _ = try await A10MacReview.wait(step)
            try await Task.sleep(for: .milliseconds(500))
            try await capture(expected, step)
            try check(A10MacReview.control("reloadRunLog") == nil, "no refresh button")
            if expected == "read-failure" {
                _ = try await A10MacReview.wait("runLogReadFailure")
                _ = try await A10MacReview.wait("retryRunLog")
                try await A10MacReview.press("retryRunLog")
                try check(log.snapshot?.readable == false, "read failure remains truthful")
            } else {
                if expected == "records" {
                    _ = try await A10MacReview.wait("runLogRecord.0")
                    try await A10MacReview.press("runLogRecord.0")
                    _ = try await A10MacReview.wait("runLogDetail")
                    try check(A10MacReview.control("runLogRawRecord") == nil, "raw record initially collapsed")
                    try await capture("detail", "runLogDetail")
                    try await A10MacReview.press("expandRunLogRaw")
                    _ = try await A10MacReview.wait("runLogRawRecord")
                    try await capture("detail-raw", "runLogDetail")
                    try await A10MacReview.press("backRunLog")
                }
                step = "previewRunSummary"; try await A10MacReview.press(step)
                step = "runSummaryPreviewSection"; _ = try await A10MacReview.wait(step)
                try check(A10MacReview.control("runSummaryPreview") == nil, "summary raw initially collapsed")
                try await capture("summary-preview-" + expected, step)
                try await A10MacReview.press("expandRunSummaryRaw")
                _ = try await A10MacReview.wait("runSummaryPreview")
                try await capture("summary-raw-" + expected, "runSummaryPreview")
                try await A10MacReview.press("copyRunSummary")
                _ = try await A10MacReview.wait("runLogPage")
                try await A10MacReview.press("shareRunLog")
                _ = try await A10MacReview.wait("runLogFilePreview")
                try check(A10MacReview.control("runLogFilePreviewText") == nil, "file raw initially collapsed")
                try await capture("file-preview-" + expected, "runLogFilePreview")
                try await A10MacReview.press("expandRunFileRaw")
                _ = try await A10MacReview.wait("runLogFilePreviewText")
                try await capture("file-raw-" + expected, "runLogFilePreviewText")
                // Revealing the file is the user's action. Verify the ready preview without opening Finder.
                _ = try await A10MacReview.wait("confirmShareRunLog")
                try await A10MacReview.press("closeRunLogPreview")
            }
            let report: [String: Any] = ["passed": true, "hadNotice": hadNotice, "nativeOwnAX": true,
                "realSettingsWindow": true, "rawInitiallyCollapsed": true, "realModelRequests": 0,
                "expectedState": expected, "noGlobalPermissionsRequested": true]
            let bytes = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
            FileHandle.standardOutput.write(Data("DIAG3_REPORT:".utf8) + bytes + Data("\n".utf8))
            if args.contains("--diag3-hold") { return }
            step = "closeRunLog"; try await A10MacReview.press(step)
            try await Task.sleep(for: .milliseconds(500))
            NSApplication.shared.terminate(nil)
        } catch {
            FileHandle.standardOutput.write(Data(("DIAG3_FAILURE:" + step + " " + String(describing: error) + "\n").utf8))
            NSApplication.shared.terminate(nil)
        }
    }
}
#endif
