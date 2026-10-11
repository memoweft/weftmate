#if DEBUG && !os(watchOS)
import SwiftUI
import WeftMateCore
#if os(macOS)
import AppKit
#endif
/// Double-gated synthetic harness in the existing About page. No credentials or network.
struct DIAG3TestHost: View {
    @ObservedObject var model: AppleAppModel
    @ObservedObject private var log = RunLogRuntime.shared
    @State private var show = false
    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            if log.notify {
                Button { show = true; log.notify = false } label: { InlineNotice(message: "上次没有正常结束，已留下运行记录。点击查看。", isError: true) }
                    .buttonStyle(.plain).padding(AppleTokens.Space.p8).accessibilityIdentifier("previousRunNotice")
            }
            SettingsView(model: model, route: .init(categoryID: "about"))
        }.background(Weave.canvas)
            #if os(iOS)
            .fullScreenCover(isPresented: $show) { RunLogView(onClose: { show = false }) }
            #else
            .sheet(isPresented: $show) { RunLogView(onClose: { show = false }) }
            #endif
            .preferredColorScheme(AppleAppearance(rawValue: model.appearanceMode)?.colorScheme)
            .task {
                model.settingsRoute = .init(categoryID: "about")
                await log.ready()
                #if os(macOS)
                NSApplication.shared.accessibilitySetValue(true, forAttribute: NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface"))
                NSApplication.shared.setActivationPolicy(.regular); NSApplication.shared.activate(ignoringOtherApps: true)
                let args = ProcessInfo.processInfo.arguments
                if args.contains("--diag3-benchmark") {
                    do { _ = try await A10MacReview.wait("openRunLog") } catch { return }
                    FileHandle.standardOutput.write(Data("DIAG3_READY\n".utf8))
                    NSApplication.shared.terminate(nil); return
                }
                guard args.contains("--diag3-capture") else { return }
                do {
                    _ = try await A10MacReview.wait("openRunLog")
                    if log.notify { try await A10MacReview.capture("diag3-banner", identifier: "settingsRoot") }
                    try await A10MacReview.press("openRunLog")
                    _ = try await A10MacReview.wait("runLogPage")
                    try await Task.sleep(for: .milliseconds(500))
                    try await A10MacReview.capture("diag3-records", identifier: "runLogPage")
                    // Summary is visible before copy / sharing become available.
                    try await A10MacReview.press("previewRunSummary")
                    _ = try await A10MacReview.wait("runSummaryPreview")
                    let result = await log.store.summaryJSON()
                    FileHandle.standardOutput.write(Data(("DIAG3_SUMMARY:" + result.replacingOccurrences(of: "\n", with: "") + "\n").utf8))
                    if args.contains("--diag3-hold") { return }
                    try await A10MacReview.press("closeRunLog")
                    NSApplication.shared.terminate(nil)
                } catch {
                    FileHandle.standardOutput.write(Data("DIAG3_FAILURE: missing native diagnostic control\n".utf8))
                    NSApplication.shared.terminate(nil)
                }
                #endif
            }
    }
}
#endif
