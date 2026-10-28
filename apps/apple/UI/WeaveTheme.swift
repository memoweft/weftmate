import SwiftUI

// Neutral desktop and mobile palette; the C4 brand retains its blue.
enum Weave {
    static let accent = AppleTokens.Colors.accent
    static let accentSoft = AppleTokens.Colors.accentSoft
    static let ink = AppleTokens.Colors.ink
    static let secondary = AppleTokens.Colors.secondary
    static let muted = AppleTokens.Colors.muted
    static let canvas = AppleTokens.Colors.canvas
    static let surface = AppleTokens.Colors.surface
    static let soft = AppleTokens.Colors.soft
    static let line = AppleTokens.Colors.line
    #if os(iOS)
    static let grouped = AppleTokens.Phone.grouped
    #endif
    static let onAccent = AppleTokens.Colors.onAccent
    static let status = AppleTokens.Colors.status
    static let danger = AppleTokens.Colors.danger

}

#if os(iOS)
/// System navigation, Menu and sheets own their interactive transitions.
/// Custom shell motion follows the approved iPhone scale and Reduce Motion.
enum PhoneMotion {
    static func easeOut(_ duration: Double) -> Animation { AppleTokens.Phone.easeOut(duration) }
    static func feedback(reduce: Bool) -> Animation { easeOut(AppleTokens.Motion.fast) }
    static func tabs(reduce: Bool) -> Animation { easeOut(reduce ? AppleTokens.Motion.reduced : AppleTokens.Motion.base) }
    static func drawer(reduce: Bool, interactive: Bool = false) -> Animation {
        if reduce { return easeOut(AppleTokens.Motion.reduced) }
        if interactive { return .interactiveSpring(response: AppleTokens.Phone.springResponse, dampingFraction: AppleTokens.Phone.springDamping, blendDuration: AppleTokens.Phone.springBlend) }
        return easeOut(AppleTokens.Motion.slow)
    }
}
#endif

struct BrandMark: View {
    var size: CGFloat = 42
    var body: some View {
        Image("wm-brand").resizable().scaledToFit()
            .frame(width: size, height: size).accessibilityHidden(true)
    }
}

struct WeaveCard<Content: View>: View {
    let content: Content
    let padding: CGFloat
    init(padding: CGFloat = AppleTokens.Space.p20, @ViewBuilder content: () -> Content) { self.padding = padding; self.content = content() }
    var body: some View {
        #if os(iOS)
        content.frame(maxWidth: .infinity, alignment: .leading).padding(padding)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Phone.groupRadius, style: .continuous))
        #else
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r14).strokeBorder(Weave.line, lineWidth: AppleTokens.Space.p1))
        #endif
    }
}

enum AppleAppearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var title: String { switch self { case .system: "跟随系统"; case .light: "浅色"; case .dark: "深色" } }
    var colorScheme: ColorScheme? { switch self { case .system: nil; case .light: .light; case .dark: .dark } }
}

/// Actions grow with Dynamic Type and retain a 44 pt touch target.
struct OutlineActionStyle: ButtonStyle {
    var destructive = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        #if os(iOS)
        PhoneActionStyle(destructive: destructive).makeBody(configuration: configuration)
        #else
        configuration.label.font(AppleTokens.Fonts.callout.weight(.medium))
            .padding(.horizontal, AppleTokens.Space.p12).frame(minHeight: 44)
            .foregroundStyle(destructive ? Weave.danger : Weave.ink)
            .background(configuration.isPressed ? Weave.soft : Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r10))
            .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r10).strokeBorder(destructive ? Weave.danger : Weave.line))
            .opacity(enabled ? 1 : AppleTokens.Opacity.disabled)
        #endif
    }
}

struct PrimaryActionStyle: ButtonStyle {
    var fillsWidth = true
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        #if os(iOS)
        PhoneActionStyle(primary: true).makeBody(configuration: configuration).frame(maxWidth: fillsWidth ? .infinity : nil)
        #else
        configuration.label
            .font(.system(AppleTokens.TextStyle.body, design: .default, weight: .semibold))
            .padding(.horizontal, AppleTokens.Space.p14)
            .frame(maxWidth: fillsWidth ? .infinity : nil, minHeight: 44)
            .foregroundStyle(Weave.onAccent)
            .background(Weave.accent.opacity(enabled ? (configuration.isPressed ? AppleTokens.Opacity.pressed : 1) : AppleTokens.Opacity.disabled),
                        in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r10, style: .continuous))
            .scaleEffect(configuration.isPressed ? AppleTokens.Scale.pressed : 1)
        #endif
    }
}

struct InlineNotice: View {
    let message: String
    var isError = false
    var body: some View {
        Label {
            Text(message).fixedSize(horizontal: false, vertical: true)
        } icon: {
            WeftIcon(isError ? "warn" : "info")
        }
        .font(AppleTokens.Fonts.callout)
        .foregroundStyle(isError ? Weave.danger : Weave.secondary)
        .padding(AppleTokens.Space.p13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isError ? Weave.danger.opacity(AppleTokens.Opacity.notice) : Weave.soft,
                    in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
        .accessibilityElement(children: .combine)
    }
}

struct EmptyState: View {
    let symbol: String
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: AppleTokens.Space.p12) {
            WeftIcon(symbol, size: 34).foregroundStyle(Weave.accent)
            Text(title).font(AppleTokens.Fonts.title3.weight(.semibold)).foregroundStyle(Weave.ink)
            Text(message).font(AppleTokens.Fonts.body).foregroundStyle(Weave.muted)
                .multilineTextAlignment(.center).lineSpacing(AppleTokens.Space.p4)
                .frame(maxWidth: 390)
        }
        .padding(AppleTokens.Space.p30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension View {
    @ViewBuilder func weaveField() -> some View {
        #if os(iOS)
        self.textFieldStyle(.plain).font(AppleTokens.Fonts.body)
            .padding(.horizontal, AppleTokens.Space.p16).padding(.vertical, AppleTokens.Space.p12)
            .frame(minHeight: AppleTokens.Space.p44)
            .background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r24))
        #else
        self.textFieldStyle(.plain)
            .font(AppleTokens.Fonts.body)
            .padding(.horizontal, AppleTokens.Space.p13)
            .padding(.vertical, AppleTokens.Space.p12)
            .background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r11))
            .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r11).strokeBorder(Weave.line))
        #endif
    }

    @ViewBuilder func accountInput() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        self
        #endif
    }

    @ViewBuilder func serverInput() -> some View {
        #if os(iOS)
        self.keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        self
        #endif
    }
}
