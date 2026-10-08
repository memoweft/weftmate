import SwiftUI

// Neutral desktop and mobile palette; the C4 brand retains its blue.
enum Weave {
    static let accent = adaptive(light: 0x30352F, dark: 0xE5E5DE)
    static let accentSoft = adaptive(light: 0xF0EFEC, dark: 0x32332E)
    static let ink = adaptive(light: 0x292B27, dark: 0xF1F1EB)
    static let secondary = adaptive(light: 0x55574F, dark: 0xC4C5BA)
    static let muted = adaptive(light: 0x707268, dark: 0xA6A89B)
    static let canvas = adaptive(light: 0xFAF9F6, dark: 0x252620)
    static let surface = adaptive(light: 0xFFFFFF, dark: 0x252620)
    static let soft = adaptive(light: 0xF5F4F0, dark: 0x2E3029)
    static let line = adaptive(light: 0xDDDED7, dark: 0x414338)
    static let onAccent = adaptive(light: 0xFFFFFF, dark: 0x252620)
    static let status = adaptive(light: 0x667E5A, dark: 0xA3B693)
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Weave.line, lineWidth: 1))
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
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.callout.weight(.medium))
            .padding(.horizontal, 12).frame(minHeight: 44)
            .foregroundStyle(Weave.ink)
            .background(configuration.isPressed ? Weave.soft : Weave.surface, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Weave.line))
            .opacity(enabled ? 1 : 0.45)
    }
}

struct PrimaryActionStyle: ButtonStyle {
    var fillsWidth = true
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, design: .default, weight: .semibold))
            .padding(.horizontal, 14)
            .frame(maxWidth: fillsWidth ? .infinity : nil, minHeight: 44)
            .foregroundStyle(Weave.onAccent)
            .background(Weave.accent.opacity(enabled ? (configuration.isPressed ? 0.78 : 1) : 0.45),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous))
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
