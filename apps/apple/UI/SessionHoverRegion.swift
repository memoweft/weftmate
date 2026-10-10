#if os(macOS)
import SwiftUI
import AppKit
import WeftMateCore

/// The card is a native popover anchored to its row. No layout/preference closure reads UI state.
struct SessionHoverCard: View {
    let row: ConversationSummary
    let device: String
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            HStack(spacing: AppleTokens.Space.p8) {
                Text(row.title).font(AppleTokens.Fonts.headline)
                WeftIcon("desktop", size: AppleTokens.Space.p16).accessibilityLabel(device)
                Spacer()
                Text(DeviceDateText.relativeTimestamp(row.updatedAt)).foregroundStyle(Weave.muted)
            }
            if let project = row.projectName { WeftLabel(project, icon: "folder", size: AppleTokens.Space.p16) }
            else { Text("未分组").foregroundStyle(Weave.muted) }
        }.font(AppleTokens.Fonts.caption).padding(AppleTokens.Space.p16)
            .frame(width: AppleTokens.Space.p32 * 10).background(Weave.surface)
            .clipShape(RoundedRectangle(cornerRadius: AppleTokens.Radius.r8))
            .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r8).strokeBorder(Weave.line))
            .accessibilityIdentifier("sessionHoverDetails")
    }
}

/// A nonactivating native panel preserves the draft/row keyboard responder while hovering.
struct SessionHintPresenter: NSViewRepresentable {
    let showing: Bool
    let row: ConversationSummary
    let device: String
    let appearance: String
    func makeNSView(context: Context) -> Marker { Marker() }
    func updateNSView(_ view: Marker, context: Context) {
        view.update(showing: showing, row: row, device: device, appearance: appearance)
    }
    static func dismantleNSView(_ view: Marker, coordinator: ()) { view.close() }
    @MainActor final class Marker: NSView {
        var panel: HintPanel?
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        func update(showing: Bool, row: ConversationSummary, device: String, appearance: String) {
            guard showing, let window else { close(); return }
            let hint = panel ?? HintPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            let content = NSHostingView(rootView: SessionHoverCard(row: row, device: device).preferredColorScheme(AppleAppearance(rawValue: appearance)?.colorScheme))
            hint.contentView = content; hint.isOpaque = false; hint.hasShadow = true; hint.ignoresMouseEvents = true
            content.frame = CGRect(x: 0, y: 0, width: AppleTokens.Space.p32 * 11, height: AppleTokens.Space.p24 * 4)
            content.layoutSubtreeIfNeeded()
            let fitting = content.fittingSize
            let size = CGSize(width: max(AppleTokens.Space.p32 * 11, fitting.width), height: max(AppleTokens.Space.p24 * 4, fitting.height))
            let rect = window.convertToScreen(convert(bounds, to: nil))
            hint.backgroundColor = .clear; hint.level = .floating
            let visible = window.screen?.visibleFrame ?? rect
            hint.setFrame(CGRect(x: min(rect.maxX + AppleTokens.Space.p8, visible.maxX - size.width), y: max(visible.minY, rect.maxY - size.height), width: size.width, height: size.height), display: true)
            if panel == nil { window.addChildWindow(hint, ordered: .above) }; panel = hint
            hint.orderFrontRegardless()
        }
        func close() { if let panel { panel.parent?.removeChildWindow(panel); panel.orderOut(nil) }; panel = nil }
    }
    @MainActor final class HintPanel: NSPanel {
        override var canBecomeKey: Bool { false }
        override var canBecomeMain: Bool { false }
    }
}

/// Size delivery uses AppKit's main-thread layout, without a SwiftUI geometry closure.
struct MacViewWidthObserver: NSViewRepresentable {
    let changed: @MainActor (CGFloat) -> Void
    func makeNSView(context: Context) -> Marker { Marker() }
    func updateNSView(_ view: Marker, context: Context) { view.changed = changed; view.deliver() }
    @MainActor final class Marker: NSView {
        var changed: (@MainActor (CGFloat) -> Void)?
        var last: CGFloat = -1
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func layout() { super.layout(); deliver() }
        override func setFrameSize(_ newSize: NSSize) { super.setFrameSize(newSize); deliver() }
        func deliver() {
            let width = bounds.width
            guard width > 0, width != last else { return }; last = width
            DispatchQueue.main.async { [weak self] in self?.changed?(width) }
        }
    }
}

/// Native mouse tracking leaves hit testing and keyboard focus with the session's controls.
struct SessionHoverRegion: NSViewRepresentable {
    let changed: @MainActor (Bool) -> Void
    let identifier: String?
    var contextMenu: (@MainActor () -> NSMenu)? = nil
    init(identifier: String? = nil, changed: @escaping @MainActor (Bool) -> Void) { self.identifier = identifier; self.changed = changed }
    func withContextMenu(_ menu: @escaping @MainActor () -> NSMenu) -> Self { var copy = self; copy.contextMenu = menu; return copy }
    func makeNSView(context: Context) -> Region { let view = Region(); view.contextMenu = contextMenu; view.changed = changed; view.identifier = identifier.map { NSUserInterfaceItemIdentifier(rawValue: $0) }; return view }
    func updateNSView(_ view: Region, context: Context) { view.contextMenu = contextMenu; view.changed = changed; view.identifier = identifier.map { NSUserInterfaceItemIdentifier(rawValue: $0) } }
    final class Region: NSView {
        var changed: @MainActor (Bool) -> Void = { _ in }
        var contextMenu: (@MainActor () -> NSMenu)?
        override func hitTest(_ point: NSPoint) -> NSView? {
            if contextMenu != nil, NSApplication.shared.currentEvent?.type == .rightMouseDown { return self }
            return nil
        }
        override func menu(for event: NSEvent) -> NSMenu? { contextMenu?() }
        override var acceptsFirstResponder: Bool { false }
        override func isAccessibilityElement() -> Bool { false }
        override func updateTrackingAreas() {
            for area in trackingAreas { removeTrackingArea(area) }
            addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil))
            super.updateTrackingAreas()
        }
        override func mouseEntered(with event: NSEvent) { changed(true) }
        override func mouseExited(with event: NSEvent) { changed(false) }
    }
}
#endif
