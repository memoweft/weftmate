import SwiftUI

/// Position bookkeeping never publishes per-pixel SwiftUI state or participates in layout.
@MainActor final class MainChatPositionTracker: ObservableObject {
    var frames: [String: CGRect] = [:]
    var following = true
}
#if os(macOS)
import AppKit
struct MainChatEventPosition: NSViewRepresentable {
    let eventID: String
    let onPosition: @MainActor (String, CGRect?, CGFloat, Bool) -> Void
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: Marker, context: Context) -> CGSize? { CGSize(width: proposal.width ?? 0, height: proposal.height ?? 0) }
    func makeNSView(context: Context) -> Marker { Marker() }
    func updateNSView(_ view: Marker, context: Context) { view.eventID = eventID; view.report = onPosition; view.schedule() }
    static func dismantleNSView(_ view: Marker, coordinator: ()) { view.disconnect() }
    @MainActor final class Marker: NSView {
        var eventID = ""
        var report: (@MainActor (String, CGRect?, CGFloat, Bool) -> Void)?
        weak var scroll: NSScrollView?
        var observation: NSObjectProtocol?
        var scheduled = false
        override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); schedule() }
        override func layout() { super.layout(); schedule() }
        func schedule() {
            guard !scheduled else { return }; scheduled = true
            DispatchQueue.main.async { [weak self] in self?.measure() }
        }
        func measure() {
            scheduled = false
            guard window != nil else { return }
            if scroll == nil {
                var parent = superview
                while parent != nil, !(parent is NSScrollView) { parent = parent?.superview }
                scroll = parent as? NSScrollView
                if let clip = scroll?.contentView {
                    clip.postsBoundsChangedNotifications = true
                    observation = NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification, object: clip, queue: .main) { @Sendable [weak self] _ in
                        Task { @MainActor [weak self] in self?.schedule() }
                    }
                }
            }
            guard let scroll else { return }
            let clip = scroll.contentView, rect = convert(bounds, to: clip)
            let y = scroll.documentView?.isFlipped == true ? rect.minY - clip.bounds.minY : clip.bounds.maxY - rect.maxY
            report?(eventID, CGRect(x: rect.minX, y: y, width: rect.width, height: rect.height), clip.bounds.height, NSApplication.shared.currentEvent?.type == .scrollWheel)
        }
        func disconnect() {
            if let observation { NotificationCenter.default.removeObserver(observation) }; observation = nil
            report?(eventID, nil, 0, false); report = nil; scroll = nil
        }
    }
}
#else
import UIKit
struct MainChatEventPosition: UIViewRepresentable {
    let eventID: String
    let onPosition: @MainActor (String, CGRect?, CGFloat, Bool) -> Void
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: Marker, context: Context) -> CGSize? { CGSize(width: proposal.width ?? 0, height: proposal.height ?? 0) }
    func makeUIView(context: Context) -> Marker { Marker() }
    func updateUIView(_ view: Marker, context: Context) { view.eventID = eventID; view.report = onPosition; view.schedule() }
    static func dismantleUIView(_ view: Marker, coordinator: ()) { view.disconnect() }
    @MainActor final class Marker: UIView {
        var eventID = ""
        var report: (@MainActor (String, CGRect?, CGFloat, Bool) -> Void)?
        weak var scroll: UIScrollView?
        var observation: NSKeyValueObservation?
        var scheduled = false
        override func didMoveToWindow() { super.didMoveToWindow(); schedule() }
        override func layoutSubviews() { super.layoutSubviews(); schedule() }
        func schedule() {
            guard !scheduled else { return }; scheduled = true
            DispatchQueue.main.async { [weak self] in self?.measure() }
        }
        func measure() {
            scheduled = false
            guard window != nil else { return }
            if scroll == nil {
                var parent = superview
                while parent != nil, !(parent is UIScrollView) { parent = parent?.superview }
                scroll = parent as? UIScrollView
                observation = scroll?.observe(\.contentOffset, options: [.new]) { @Sendable [weak self] _, _ in
                    Task { @MainActor [weak self] in self?.schedule() }
                }
            }
            guard let scroll else { return }; let rect = convert(bounds, to: scroll)
            report?(eventID, CGRect(x: rect.minX, y: rect.minY - scroll.bounds.minY, width: rect.width, height: rect.height), scroll.bounds.height, scroll.isDragging || scroll.isTracking || scroll.isDecelerating)
        }
        func disconnect() { observation?.invalidate(); observation = nil; report?(eventID, nil, 0, false); report = nil; scroll = nil }
    }
}
#endif
