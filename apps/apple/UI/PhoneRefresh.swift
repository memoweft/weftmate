import SwiftUI
import WeftMateCore

#if os(iOS)
/// All phone controls inherit the generated palette, including native menus and links.
struct PhoneActionStyle: ButtonStyle {
    var primary = false
    var destructive = false
    var selected = false
    var onCard = false
    var fillsWidth = false
    var horizontalPadding = AppleTokens.Space.p12
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        let state = PhonePresentation.controlState(selected: selected, pressed: configuration.isPressed, enabled: enabled)
        configuration.label.font(AppleTokens.Fonts.callout.weight(.medium))
            .padding(.horizontal, horizontalPadding)
            .frame(minWidth: AppleTokens.Space.p44, maxWidth: fillsWidth ? .infinity : nil, minHeight: AppleTokens.Space.p44)
            .foregroundStyle(primary ? Weave.onAccent : destructive ? Weave.danger : Weave.accent)
            .background(primary ? Weave.accent : selected ? Weave.accentSoft : onCard ? Weave.surface : Weave.soft, in: Capsule())
            .opacity(state == "disabled" ? AppleTokens.Opacity.disabled : state == "pressed" ? AppleTokens.Opacity.pressed : 1)
            .contentShape(Capsule())
            .animation(PhoneMotion.feedback(reduce: reduceMotion), value: configuration.isPressed)
    }
}
struct PhoneOperationModeIcon: View {
    @ScaledMetric private var size: CGFloat=20
    var body: some View { Image(systemName:"slider.horizontal.3").font(.system(size:size,weight:.regular)).frame(width:size,height:size).accessibilityHidden(true) }
}
struct PhoneIconStyle: ButtonStyle {
    var primary = false
    var quiet = false
    var onCard = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(minWidth: AppleTokens.Space.p44, minHeight: AppleTokens.Space.p44)
            .foregroundStyle(primary ? Weave.onAccent : quiet ? Weave.muted : Weave.accent)
            .background(primary ? Weave.accent : quiet ? AppleTokens.Colors.clear : onCard ? Weave.surface : Weave.soft, in: Circle())
            .contentShape(Circle())
            .opacity(!enabled ? AppleTokens.Opacity.disabled : configuration.isPressed ? AppleTokens.Opacity.pressed : 1)
            .animation(PhoneMotion.feedback(reduce: reduceMotion), value: configuration.isPressed)
    }
}
struct PhoneCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content.frame(maxWidth: .infinity, alignment: .leading).padding(AppleTokens.Space.p12)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Phone.groupRadius, style: .continuous))
    }
}
struct PhoneSheetChrome: ViewModifier {
    let title: String
    let close: () -> Void
    var closeIdentifier = "phoneSheet.close"
    func body(content: Content) -> some View {
        VStack(spacing: AppleTokens.Space.p0) {
            HStack {
                AppleTokens.Colors.clear.frame(width: AppleTokens.Space.p44, height: AppleTokens.Space.p44)
                Text(title).font(AppleTokens.Fonts.headline).frame(maxWidth: .infinity).multilineTextAlignment(.center)
                Button(action: close) { WeftIcon("deny") }.buttonStyle(PhoneIconStyle())
                    .accessibilityLabel("关闭" + title).accessibilityIdentifier(closeIdentifier)
            }.padding(AppleTokens.Space.p12)
            content
        }.background(Weave.canvas).tint(Weave.accent).buttonStyle(PhoneActionStyle())
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible).presentationCornerRadius(AppleTokens.Phone.sheetRadius)
    }
}
struct PhoneSidebarButton: View {
    @Environment(\.phoneSidebar) private var sidebar
    var body: some View {
        Button { sidebar?() } label: { WeftIcon("sidebar") }.phoneIcon(quiet: true)
            .accessibilityLabel("打开侧栏").accessibilityIdentifier("phone.sidebar")
    }
}
private struct PhoneSidebarKey: EnvironmentKey { static let defaultValue: (@MainActor () -> Void)? = nil }
private struct PhoneOpenConversationKey: EnvironmentKey { static let defaultValue: (@MainActor (String) -> Void)? = nil }
private struct PhoneNavigationBackKey: EnvironmentKey { static let defaultValue: (@MainActor () -> Void)? = nil }
extension EnvironmentValues {
    var phoneNavigationBack: (@MainActor () -> Void)? {
        get { self[PhoneNavigationBackKey.self] } set { self[PhoneNavigationBackKey.self] = newValue }
    }
    var phoneOpenConversation: (@MainActor (String) -> Void)? {
        get { self[PhoneOpenConversationKey.self] } set { self[PhoneOpenConversationKey.self] = newValue }
    }
    var phoneSidebar: (@MainActor () -> Void)? {
        get { self[PhoneSidebarKey.self] } set { self[PhoneSidebarKey.self] = newValue }
    }
}
struct PhoneChatHeader<Actions: View>: View {
    let title: String
    let status: String
    let actions: Actions
    @Environment(\.phoneSidebar) private var sidebar
    @Environment(\.phoneNavigationBack) private var back
    @Environment(\.dismiss) private var dismiss
    init(title: String, status: String, @ViewBuilder actions: () -> Actions) {
        self.title = title; self.status = status; self.actions = actions()
    }
    var body: some View {
        HStack(spacing: AppleTokens.Space.p8) {
            Button { if let back { back() } else if let sidebar { sidebar() } else { dismiss() } } label: { WeftIcon(back == nil ? "sidebar" : "back") }
                .buttonStyle(PhoneIconStyle()).accessibilityLabel(back == nil ? "打开侧栏" : "返回").accessibilityIdentifier(back == nil ? "phone.sidebar" : "phone.back")
            VStack(spacing: AppleTokens.Space.p3) {
                Text(title).font(AppleTokens.Fonts.headline).lineLimit(1)
                Text(status).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).lineLimit(1)
            }.frame(maxWidth: .infinity).accessibilityElement(children: .combine).accessibilityIdentifier("phone.chatTitle")
            actions.buttonStyle(PhoneIconStyle())
        }.padding(.horizontal, AppleTokens.Space.p12).padding(.vertical, AppleTokens.Space.p8)
    }
}
struct PhoneBottomTabs: View {
    @Binding var selection: PhoneTab
    var reselect: () -> Void = {}
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.phoneReduceMotion) private var reduceMotion
    private var items: some View {
        HStack(spacing: AppleTokens.Space.p4) {
            ForEach(PhoneTab.allCases) { tab in
                Button {
                    if selection == tab { reselect() }
                    else { withAnimation(PhoneMotion.tabs(reduce: reduceMotion)) { selection = tab } }
                } label: {
                    VStack(spacing: AppleTokens.Space.p3) {
                        WeftIcon(tab.icon, size: AppleTokens.Space.p24)
                            .frame(width: AppleTokens.Space.p64, height: AppleTokens.Space.p28)
                            .background(selection == tab ? Weave.soft : .clear, in: Capsule())
                        Text(tab.title).font(AppleTokens.Fonts.caption2)
                    }.frame(maxWidth: .infinity).frame(minWidth: AppleTokens.Space.p44, minHeight: AppleTokens.Space.p44).contentShape(Rectangle())
                }.buttonStyle(PhoneTabStyle(selected: selection == tab))
                    .accessibilityLabel(tab.title).accessibilityIdentifier("phone.tab." + tab.id)
                    .accessibilityAddTraits(selection == tab ? .isSelected : [])
            }
        }.padding(AppleTokens.Space.p4)
    }
    var body: some View {
        items.padding(.horizontal, AppleTokens.Space.p12).padding(.vertical, AppleTokens.Space.p8)
            .overlay(alignment: .top) { Weave.line.opacity(0.4).frame(height: AppleTokens.Space.p1) }
            .accessibilityElement(children: .contain).accessibilityIdentifier("phone.bottomTabs")
    }
}
private struct PhoneTabStyle: ButtonStyle {
    let selected: Bool
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.foregroundStyle(selected ? Weave.ink : Weave.muted)
            .opacity(!enabled ? AppleTokens.Opacity.disabled : configuration.isPressed ? AppleTokens.Opacity.pressed : 1)
    }
}
#endif
#if os(iOS)
extension AppleAppModel {
    var phoneConnectionStatus: String {
        if serverLoginExpired { return cloudLogin.authenticated ? "电脑暂时连不上" : "请重新登录" }
        if offline.hostOffline { return "电脑离线" }
        return session?.verification == .verified ? "已连接" : "正在连接"
    }
}
#endif
extension View {
    /// Native iOS Menu does not render a custom ButtonStyle; its label owns the shape.
    @ViewBuilder func phoneMenuLabel(circle: Bool = false, onCard: Bool = false, quiet: Bool = false) -> some View {
        #if os(iOS)
        if circle {
            self.frame(width: AppleTokens.Space.p44, height: AppleTokens.Space.p44)
                .foregroundStyle(quiet ? Weave.muted : Weave.accent)
                .background(quiet ? AppleTokens.Colors.clear : onCard ? Weave.surface : Weave.soft, in: Circle())
        } else {
            self.font(AppleTokens.Fonts.caption).padding(.horizontal, AppleTokens.Space.p8)
                .frame(minWidth: AppleTokens.Space.p44, minHeight: AppleTokens.Space.p44)
                .foregroundStyle(Weave.accent).background(onCard ? Weave.surface : Weave.soft, in: Capsule())
        }
        #else
        self
        #endif
    }
    @ViewBuilder func phoneAction() -> some View {
        #if os(iOS)
        self.buttonStyle(PhoneActionStyle())
        #else
        self
        #endif
    }
    @ViewBuilder func phoneCardIdentifier(_ value: String) -> some View {
        #if os(iOS)
        self.accessibilityElement(children: .contain).accessibilityIdentifier(value)
        #else
        self
        #endif
    }
    @ViewBuilder func phoneComposerControl(circle: Bool = false) -> some View {
        #if os(iOS)
        if circle { self.buttonStyle(PhoneIconStyle(onCard: true)).tint(Weave.accent) }
        else { self.buttonStyle(PhoneActionStyle(onCard: true)).tint(Weave.accent) }
        #else
        self
        #endif
    }
    @ViewBuilder func phoneFixedActionLabel() -> some View {
        #if os(iOS)
        self.fixedSize(horizontal: true, vertical: false)
        #else
        self
        #endif
    }
    @ViewBuilder func phoneIcon(primary: Bool = false, quiet: Bool = false) -> some View {
        #if os(iOS)
        self.buttonStyle(PhoneIconStyle(primary: primary, quiet: quiet)).tint(Weave.accent)
        #else
        self
        #endif
    }
    @ViewBuilder func phoneCard() -> some View {
        #if os(iOS)
        self.modifier(PhoneCardModifier())
        #else
        self
        #endif
    }
    @ViewBuilder func phoneSheet(_ title: String, identifier: String = "phoneSheet.close", close: @escaping () -> Void) -> some View {
        #if os(iOS)
        self.modifier(PhoneSheetChrome(title: title, close: close, closeIdentifier: identifier))
        #else
        self
        #endif
    }

}
