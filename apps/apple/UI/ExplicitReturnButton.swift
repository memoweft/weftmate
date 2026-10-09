#if os(macOS)
import AppKit
import SwiftUI

/// AppKit owns keyboard focus explicitly; no default/global Return equivalent.
struct ExplicitReturnButton: NSViewRepresentable {
    let enabled: Bool
    let identifier: String
    let action: @MainActor () -> Void
    @Environment(\.colorScheme) private var scheme
    func makeCoordinator() -> Coordinator { Coordinator(action: action) }
    func makeNSView(context: Context) -> ReturnButton {
        let button = ReturnButton(title: "提交回答", target: context.coordinator, action: #selector(Coordinator.press))
        button.isBordered = false; button.wantsLayer = true; button.keyEquivalent = ""
        button.font = NSFont.systemFont(ofSize: AppleTokens.FontSize.f14, weight: .semibold)
        return button
    }
    func updateNSView(_ button: ReturnButton, context: Context) {
        context.coordinator.action = action; button.isEnabled = enabled
        button.setAccessibilityIdentifier(identifier); button.setAccessibilityLabel("提交回答")
        button.layer?.cornerRadius = AppleTokens.Radius.r10
        let appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)!
        appearance.performAsCurrentDrawingAppearance {
            button.layer?.backgroundColor = NSColor(Weave.accent).withAlphaComponent(enabled ? 1 : AppleTokens.Opacity.disabled).cgColor
            button.contentTintColor = NSColor(Weave.onAccent)
        }
    }
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: ReturnButton, context: Context) -> CGSize? {
        CGSize(width: nsView.intrinsicContentSize.width + AppleTokens.Space.p28, height: AppleTokens.Space.p44)
    }
    @MainActor final class Coordinator: NSObject {
        var action: @MainActor () -> Void
        init(action: @escaping @MainActor () -> Void) { self.action = action }
        @objc func press() { action() }
    }
    @MainActor final class ReturnButton: NSButton {
        override var acceptsFirstResponder: Bool { isEnabled }
        override func keyDown(with event: NSEvent) {
            if event.keyCode == 36, isEnabled, window?.firstResponder === self { performClick(nil) }
            else { super.keyDown(with: event) }
        }
    }
}
#endif
