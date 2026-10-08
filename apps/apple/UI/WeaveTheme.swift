import SwiftUI

// Match the existing Weave palette while respecting the system appearance.
enum Weave {
    static let accent = adaptive(light: 0x2859D8, dark: 0x7FA7FF)
    static let accentSoft = adaptive(light: 0xE9F0FF, dark: 0x20345A)
    static let ink = adaptive(light: 0x1C2940, dark: 0xE9EFFB)
    static let secondary = adaptive(light: 0x56657B, dark: 0xB9C7DF)
    static let muted = adaptive(light: 0x64748A, dark: 0xA2B2CB)
    static let canvas = adaptive(light: 0xF3F5FA, dark: 0x121A28)
    static let surface = adaptive(light: 0xFFFFFF, dark: 0x161F2F)
    static let soft = adaptive(light: 0xF7F9FD, dark: 0x1D2A3F)
    static let line = adaptive(light: 0xE4E9F2, dark: 0x344259)
    static let danger = adaptive(light: 0xB93248, dark: 0xFF8EA0)

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        #if os(macOS)
        return Color(nsColor: NSColor(name: nil) { appearance in
            let value = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
            return NSColor(red: CGFloat((value >> 16) & 255) / 255,
                           green: CGFloat((value >> 8) & 255) / 255,
                           blue: CGFloat(value & 255) / 255, alpha: 1)
        })
        #else
        return Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((value >> 16) & 255) / 255,
                           green: CGFloat((value >> 8) & 255) / 255,
                           blue: CGFloat(value & 255) / 255, alpha: 1)
        })
        #endif
    }
}

struct BrandMark: View {
    var size: CGFloat = 42
    var body: some View {
        Image("wm-brand").resizable().scaledToFit()
            .frame(width: size, height: size).accessibilityHidden(true)
    }
}

struct WeaveCard<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        content
            .padding(24)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(Weave.line, lineWidth: 1))
            .shadow(color: .black.opacity(0.035), radius: 18, x: 0, y: 8)
    }
}

struct PrimaryActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, design: .default, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 46)
            .foregroundStyle(.white)
            .background(Weave.accent.opacity(enabled ? (configuration.isPressed ? 0.78 : 1) : 0.45),
                        in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
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
        .font(.callout)
        .foregroundStyle(isError ? Weave.danger : Weave.secondary)
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isError ? Weave.danger.opacity(0.07) : Weave.soft,
                    in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

struct EmptyState: View {
    let symbol: String
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: 12) {
            WeftIcon(symbol, size: 34).foregroundStyle(Weave.accent)
            Text(title).font(.title3.weight(.semibold)).foregroundStyle(Weave.ink)
            Text(message).font(.body).foregroundStyle(Weave.muted)
                .multilineTextAlignment(.center).lineSpacing(4)
                .frame(maxWidth: 390)
        }
        .padding(30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension View {
    func weaveField() -> some View {
        self.textFieldStyle(.plain)
            .font(.body)
            .padding(.horizontal, 13)
            .padding(.vertical, 12)
            .background(Weave.soft, in: RoundedRectangle(cornerRadius: 11))
            .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(Weave.line))
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
