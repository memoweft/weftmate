import SwiftUI
import WeftMateCore

private struct PhoneReduceMotionOverrideKey: EnvironmentKey {
    static let defaultValue = false
}
extension EnvironmentValues {
    var phoneReduceMotionOverride: Bool {
        get { self[PhoneReduceMotionOverrideKey.self] }
        set { self[PhoneReduceMotionOverrideKey.self] = newValue }
    }
    var phoneReduceMotion: Bool { accessibilityReduceMotion || phoneReduceMotionOverride }
}

/// Native short actions stay attached to their trigger, including in compact width.
struct PhoneActionMenu<Label: View, Actions: View>: View {
    let label: Label
    let actions: Actions
    init(@ViewBuilder actions: () -> Actions, @ViewBuilder label: () -> Label) {
        self.actions = actions(); self.label = label()
    }
    var body: some View { Menu { actions } label: { label } }
}

#if os(iOS)
/// Shared drawer presentation. The page remains mounted under the scrim.
struct PhoneDrawer<Panel: View>: ViewModifier {
    @Binding var open: Bool
    let canOpenFromEdge: Bool
    let panel: () -> Panel
    @State private var drag: CGFloat = 0
    @State private var containerWidth: CGFloat = 0
    @Environment(\.phoneReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        let width = min(AppleTokens.Phone.drawerWidth, max(0, containerWidth - AppleTokens.Space.p44))
        let progress = PhoneDrawerGesture.progress(open: open, translation: Double(drag), width: Double(width))
        ZStack(alignment: .leading) {
            content.allowsHitTesting(progress == 0).accessibilityHidden(progress > 0)
            // Stable layers animate without retaining an outgoing modal's gesture ownership.
            Color.black.opacity((scheme == .dark ? AppleTokens.Phone.darkScrim : AppleTokens.Phone.lightScrim) * progress)
                .ignoresSafeArea().onTapGesture { setOpen(false) }
                .gesture(gesture, including: progress > 0 ? .all : .none)
                .allowsHitTesting(progress > 0).accessibilityHidden(true)
            panel().frame(width: width).frame(maxHeight: .infinity)
                .background(Weave.canvas)
                .clipShape(UnevenRoundedRectangle(bottomTrailingRadius: AppleTokens.Radius.r24, topTrailingRadius: AppleTokens.Radius.r24))
                .offset(x: reduceMotion ? 0 : -width * CGFloat(1 - progress))
                .opacity(reduceMotion ? progress : 1)
                .accessibilityElement(children: progress > 0 ? .contain : .ignore)
                .accessibilityAddTraits(progress > 0 ? .isModal : [])
                .accessibilityAction(.escape) { setOpen(false) }
                .accessibilityIdentifier("phone.sidebar.panel")
                .simultaneousGesture(gesture, including: progress > 0 ? .all : .none)
                .allowsHitTesting(progress > 0)
                .accessibilityHidden(progress == 0)
            if canOpenFromEdge && !open {
                Color.clear.frame(width: AppleTokens.Phone.edgeWidth).contentShape(Rectangle())
                    .accessibilityHidden(true).gesture(gesture)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onGeometryChange(for: CGFloat.self, of: { @Sendable proxy in proxy.size.width },
                          action: Self.widthChanged { containerWidth = $0 })
    }
    nonisolated private static func widthChanged(_ update: @escaping @MainActor @Sendable (CGFloat) -> Void) -> @Sendable (CGFloat) -> Void {
        { value in Task { @MainActor in update(value) } }
    }
    private var gesture: some Gesture {
        DragGesture(minimumDistance: AppleTokens.Space.p12)
            .onChanged { value in
                guard abs(value.translation.width) > abs(value.translation.height),
                      open || canOpenFromEdge && value.startLocation.x <= AppleTokens.Phone.edgeWidth else { return }
                drag = value.translation.width
            }
            .onEnded { value in
                guard drag != 0 else { return }
                let next = PhoneDrawerGesture.commits(open: open, translation: Double(value.translation.width), predicted: Double(value.predictedEndTranslation.width), threshold: Double(AppleTokens.Phone.gestureCommit))
                withAnimation(PhoneMotion.drawer(reduce: reduceMotion, interactive: true)) { open = next; drag = 0 }
            }
    }
    private func setOpen(_ value: Bool) {
        withAnimation(PhoneMotion.drawer(reduce: reduceMotion)) { open = value; drag = 0 }
    }
}

extension View {
    func phoneDrawer<Panel: View>(open: Binding<Bool>, canOpenFromEdge: Bool, @ViewBuilder panel: @escaping () -> Panel) -> some View {
        modifier(PhoneDrawer(open: open, canOpenFromEdge: canOpenFromEdge, panel: panel))
    }
}
#endif

extension View {
    /// Forms/long content use phoneSheet; short choices use this anchored popover.
    @ViewBuilder func phonePopover<Content: View>(isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> Content) -> some View {
        #if os(iOS)
        self.popover(isPresented: isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
            content().presentationCompactAdaptation(.popover)
                .presentationBackground(Weave.surface).presentationCornerRadius(AppleTokens.Phone.groupRadius)
        }
        #else
        self.popover(isPresented: isPresented, arrowEdge: .bottom) {
            content().presentationCompactAdaptation(.popover).presentationBackground(.clear).presentationCornerRadius(AppleTokens.Radius.r12)
        }
        #endif
    }
}
