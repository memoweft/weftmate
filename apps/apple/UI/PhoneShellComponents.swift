import SwiftUI
import WeftMateCore

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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        GeometryReader { geometry in
            let width = min(AppleTokens.Phone.drawerWidth, geometry.size.width - AppleTokens.Space.p44)
            let progress = PhoneDrawerGesture.progress(open: open, translation: Double(drag), width: Double(width))
            ZStack(alignment: .leading) {
                content.allowsHitTesting(progress == 0).accessibilityHidden(progress > 0)
                Color.black.opacity((scheme == .dark ? AppleTokens.Phone.darkScrim : AppleTokens.Phone.lightScrim) * progress)
                    .ignoresSafeArea().onTapGesture { setOpen(false) }
                    .allowsHitTesting(progress > 0).accessibilityHidden(true).gesture(gesture)
                panel().frame(width: width).frame(maxHeight: .infinity)
                    .background(Weave.canvas)
                    .clipShape(UnevenRoundedRectangle(bottomTrailingRadius: AppleTokens.Radius.r24, topTrailingRadius: AppleTokens.Radius.r24))
                    .offset(x: reduceMotion ? 0 : -width * CGFloat(1 - progress))
                    .opacity(reduceMotion ? progress : 1)
                    .allowsHitTesting(progress > 0).accessibilityHidden(progress == 0)
                    .accessibilityAddTraits(.isModal)
                    .accessibilityAction(.escape) { setOpen(false) }
                    .accessibilityIdentifier("phone.sidebar.panel")
                    .simultaneousGesture(gesture)
                if canOpenFromEdge && !open {
                    Color.clear.frame(width: AppleTokens.Phone.edgeWidth).contentShape(Rectangle())
                        .accessibilityHidden(true).gesture(gesture)
                }
            }
        }
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
