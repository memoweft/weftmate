#if os(macOS)
import SwiftUI
import AppKit
import WeftMateCore

struct SessionRowBounds: PreferenceKey {
    static let defaultValue: [String: Anchor<CGRect>] = [:]
    static func reduce(value: inout [String: Anchor<CGRect>], nextValue: () -> [String: Anchor<CGRect>]) { value.merge(nextValue(), uniquingKeysWith: { _, new in new }) }
}
private struct SessionHintHeight: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
struct SessionHoverOverlay: ViewModifier {
    @ObservedObject var app: AppleAppModel
    @State private var hintHeight: CGFloat = AppleTokens.Space.p28 * 6
    func body(content: Content) -> some View {
        content.overlayPreferenceValue(SessionRowBounds.self) { anchors in
            GeometryReader { geometry in
                if let row = app.hoveredSession, let anchor = anchors[row.id] {
                    let rect = geometry[anchor]
                    let below = rect.maxY + AppleTokens.Space.p4
                    let top = below + hintHeight < geometry.size.height ? below : max(AppleTokens.Space.p12, rect.minY - hintHeight - AppleTokens.Space.p4)
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p6) {
                        Text(row.title).font(AppleTokens.Fonts.headline)
                        Text(row.projectName.map { "项目：" + $0 } ?? app.sessionGroups.first { $0.id == row.groupId }.map { "分组：" + $0.name } ?? "未分组")
                        Text("更新时间：" + (row.updatedAt.map { DeviceDateText.timestamp($0) } ?? "未记录"))
                        Text("执行电脑：" + (app.cloudLogin.hosts.first { $0.hostId == row.hostId }?.name ?? (row.hostId != nil && row.hostId == app.session?.hostId ? "当前连接的电脑" : "未记录")))
                    }.font(AppleTokens.Fonts.caption).foregroundStyle(Weave.ink)
                        .padding(AppleTokens.Space.p16).frame(width: geometry.size.width - AppleTokens.Space.p24, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r8))
                        .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r8).strokeBorder(Weave.line))
                        .background(GeometryReader { g in AppleTokens.Colors.clear.preference(key: SessionHintHeight.self, value: g.size.height) })
                        .offset(x: AppleTokens.Space.p12, y: top).allowsHitTesting(false)
                        .accessibilityIdentifier("sessionHoverDetails")
                }
            }.onPreferenceChange(SessionHintHeight.self) { hintHeight = $0 }
        }
    }
}

/// Native mouse tracking leaves hit testing and keyboard focus with the session's controls.
struct SessionHoverRegion: NSViewRepresentable {
    let changed: (Bool) -> Void
    func makeNSView(context: Context) -> Region { let view = Region(); view.changed = changed; return view }
    func updateNSView(_ view: Region, context: Context) { view.changed = changed }
    final class Region: NSView {
        var changed: (Bool) -> Void = { _ in }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
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
