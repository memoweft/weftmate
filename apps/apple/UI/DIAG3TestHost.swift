#if DEBUG && !os(watchOS)
import SwiftUI
import WeftMateCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif
/// Double-gated synthetic harness. Uses the real Settings window on Mac, and the real settings navigation on iPhone.
struct DIAG3TestHost: View {
    @ObservedObject var model: AppleAppModel
    @ObservedObject private var log = RunLogRuntime.shared
    @State private var cleanExitRecorded = false
    #if os(iOS)
    @State private var nativePrepared = false
    private var nativeScene: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "--diag3-native-scene"), args.indices.contains(index + 1) else { return nil }
        return args[index + 1]
    }
    #endif
    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    #endif
    var body: some View {
        Group {
            #if os(macOS)
            Text("运行记录界面验收").font(AppleTokens.Fonts.body).accessibilityIdentifier("diag3SyntheticHost")
            #else
            if nativeScene != nil && !nativePrepared {
                ProgressView("准备运行记录…").font(AppleTokens.Fonts.callout)
            } else {
            SettingsView(model: model, route: .init(categoryID: nativeScene.map { $0.hasPrefix("about") ? "about" : "run-log" } ?? "about"))
                .overlay(alignment: .bottom) {
                    if cleanExitRecorded { Text("已记录合成正常结束").accessibilityIdentifier("diag3CleanExitRecorded") }
                }
            }
            #endif
        }
        .preferredColorScheme(AppleAppearance(rawValue: model.appearanceMode)?.colorScheme)
        .task {
            model.settingsRoute = .init(categoryID: "about")
            await log.ready()
            let args = ProcessInfo.processInfo.arguments
            if args.contains("--diag3-clean-exit") {
                await log.store.exit(reason: "user_quit"); cleanExitRecorded = true
            }
            if args.contains("--diag3-watch-fixture") {
                let watch = RunLog(directory: FileManager.default.temporaryDirectory.appendingPathComponent("diag3b-watch-" + UUID().uuidString), platform: .watchos, appVersion: "0.1.0", osVersion: "26.2", policy: .watch)
                await watch.start()
                await watch.record(.approvalFailure, fields: ["errorType": "api", "code": "UNAVAILABLE", "errorCode": "503", "phase": "approval", "module": "WeftMateWatch", "file": "WatchHomeView.swift", "line": "42"])
                if let data = await watch.transferBytes() { _ = await log.store.receiveWatch(data) }
                await log.reload()
            }
            #if os(iOS)
            if args.contains("--diag3-dismiss-notice") { log.notify = false }
            nativePrepared = true
            if let nativeScene {
                let route = AppleSettingsRoute(categoryID: nativeScene.hasPrefix("about") ? "about" : "run-log")
                let content = AnyView(SettingsView(model: model, route: route).preferredColorScheme(AppleAppearance(rawValue: model.appearanceMode)?.colorScheme))
                Task { @MainActor in
                    guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
                          let window = scene.windows.first(where: \.isKeyWindow) else { return }
                    let controller = DIAG3NativeCaptureController(rootView: content)
                    controller.overrideUserInterfaceStyle = model.appearanceMode == "dark" ? .dark : .light
                    window.rootViewController = controller
                    controller.setNeedsUpdateOfHomeIndicatorAutoHidden()
                    try? await Task.sleep(for: .seconds(3))
                    controller.prepareCapture(scene: nativeScene)
                    try? await Task.sleep(for: .seconds(AppleTokens.Motion.slow))
                    FileHandle.standardOutput.write(Data("DIAG3_NATIVE_READY\n".utf8))
                }
            }
            #endif
            #if os(macOS)
            openWindow(id: "settings")
            NSApplication.shared.accessibilitySetValue(true, forAttribute: NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface"))
            NSApplication.shared.setActivationPolicy(.regular); NSApplication.shared.activate(ignoringOtherApps: true)
            if args.contains("--diag3-benchmark") {
                do { _ = try await A10MacReview.wait("openRunLog") } catch { return }
                FileHandle.standardOutput.write(Data("DIAG3_READY\n".utf8))
                NSApplication.shared.terminate(nil); return
            }
            guard args.contains("--diag3-capture") else { return }
            _ = try? await A10MacReview.wait("openRunLog")
            for window in NSApplication.shared.windows where A10MacReview.find("diag3SyntheticHost", in: window) != nil { window.orderOut(nil) }
            await DIAG3MacReview.run()
            #endif
        }
    }
}
#if os(iOS)
/// Real UIKit system chrome for screenshot fixtures; never draws a replacement indicator.
private final class DIAG3NativeCaptureController: UIHostingController<AnyView> {
    override var prefersHomeIndicatorAutoHidden: Bool { false }
    override var childForHomeIndicatorAutoHidden: UIViewController? { nil }
    override var prefersStatusBarHidden: Bool { false }
    override var preferredStatusBarStyle: UIStatusBarStyle { traitCollection.userInterfaceStyle == .dark ? .lightContent : .darkContent }
    func prepareCapture(scene: String) {
        // XCTest scrolls to the entry before its checkpoint. Match that visible state
        // in the screenshot-only fixture without changing the real settings layout.
        guard scene.hasPrefix("about"), scene != "about-banner" else { return }
        func scrollViews(_ root: UIView) -> [UIScrollView] {
            ((root as? UIScrollView).map { [$0] } ?? []) + root.subviews.flatMap(scrollViews)
        }
        guard let scroll = scrollViews(view).max(by: { $0.contentSize.height < $1.contentSize.height }) else { return }
        let bottom = max(-scroll.adjustedContentInset.top,
                         scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
        scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: bottom), animated: false)
        scroll.layoutIfNeeded()
    }
}
#endif
#endif
