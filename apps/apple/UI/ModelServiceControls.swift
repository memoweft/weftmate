import SwiftUI
import WeftMateCore

private var serviceControlHeight: CGFloat {
    #if os(macOS)
    AppleTokens.Space.p32
    #else
    AppleTokens.Space.p44
    #endif
}
private var serviceControlRadius: CGFloat {
    #if os(macOS)
    AppleTokens.Radius.r8
    #else
    AppleTokens.Radius.r12
    #endif
}

/// Scoped controls-spec palette from the generated, shared token source.
struct ServiceControlPalette {
    let dark: Bool
    #if os(iOS)
    var surface: Color { Weave.surface }
    var canvas: Color { Weave.grouped }
    var ink: Color { Weave.ink }
    var secondary: Color { Weave.secondary }
    var muted: Color { Weave.muted }
    var accent: Color { Weave.accent }
    var onAccent: Color { Weave.onAccent }
    var line: Color { Weave.line }
    var soft: Color { Weave.soft }
    var shadow: Color { AppleTokens.Colors.controlShadow.opacity(AppleTokens.Opacity.controlShadowLight) }
    #else
    var surface: Color { AppleTokens.Colors.controlSurface }
    var canvas: Color { AppleTokens.Colors.controlCanvas }
    var ink: Color { AppleTokens.Colors.controlInk }
    var secondary: Color { AppleTokens.Colors.controlSecondary }
    var muted: Color { AppleTokens.Colors.controlMuted }
    var accent: Color { AppleTokens.Colors.controlAccent.opacity(dark ? AppleTokens.Opacity.opaque : AppleTokens.Opacity.controlAccentLight) }
    var onAccent: Color { AppleTokens.Colors.controlOnAccent }
    var line: Color { AppleTokens.Colors.controlLine.opacity(dark ? AppleTokens.Opacity.controlLineDark : AppleTokens.Opacity.opaque) }
    var soft: Color { AppleTokens.Colors.controlSoft.opacity(dark ? AppleTokens.Opacity.controlSoftDark : AppleTokens.Opacity.opaque) }
    var shadow: Color { AppleTokens.Colors.controlShadow.opacity(dark ? AppleTokens.Opacity.controlShadowDark : AppleTokens.Opacity.controlShadowLight) }
    #endif
}
struct ServiceActionStyle: ButtonStyle {
    var primary=false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorScheme) private var scheme
    func makeBody(configuration: Configuration) -> some View {
        let colors=ServiceControlPalette(dark:scheme == .dark)
        configuration.label.font(AppleTokens.Fonts.callout.weight(.medium)).foregroundStyle(primary ? colors.onAccent : colors.secondary)
            .padding(.horizontal,AppleTokens.Space.p18).frame(minHeight:serviceControlHeight).frame(maxWidth:.infinity)
            .background(primary ? colors.accent : configuration.isPressed ? colors.soft : colors.surface,in:RoundedRectangle(cornerRadius:serviceControlRadius))
            .overlay(RoundedRectangle(cornerRadius:serviceControlRadius).stroke(primary ? .clear : colors.line,lineWidth:AppleTokens.Space.p1))
            .opacity(enabled ? 1 : AppleTokens.Opacity.disabled)
    }
}
struct ServiceSwitch: View {
    var title: String
    @Binding var enabled: Bool
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let colors=ServiceControlPalette(dark:scheme == .dark)
        #if os(iOS)
        Toggle(title, isOn: $enabled).tint(Weave.accent).font(AppleTokens.Fonts.body)
        #else
        Button { enabled.toggle() } label: {
            HStack {
                Text(title).font(AppleTokens.Fonts.body.weight(.medium)).foregroundStyle(colors.ink);Spacer()
                Capsule().fill(enabled ? colors.accent : colors.muted).frame(width:AppleTokens.Space.pcontrol_switch_width,height:AppleTokens.Space.p26)
                    .overlay(alignment:enabled ? .trailing : .leading) { Circle().fill(enabled ? colors.onAccent : colors.surface).frame(width:AppleTokens.Space.p20,height:AppleTokens.Space.p20).padding(AppleTokens.Space.p3) }
            }.frame(minHeight:serviceControlHeight).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(title).accessibilityValue(enabled ? "已开启" : "已关闭").accessibilityAddTraits(.isButton)
        #endif
    }
}
struct ServiceMenuRow: View {
    var title: String
    var subtitle: String? = nil
    var selected=false
    var action: () -> Void
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let colors=ServiceControlPalette(dark:scheme == .dark)
        Button(action:action) {
            HStack(spacing:AppleTokens.Space.p8) {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p3) {
                    Text(title).font(AppleTokens.Fonts.body.weight(.medium)).lineLimit(1).truncationMode(.middle)
                    if let subtitle { Text(subtitle).font(AppleTokens.Fonts.caption).foregroundStyle(colors.muted) }
                };Spacer(minLength:AppleTokens.Space.p8)
                if selected { WeftIcon("allow",size:AppleTokens.Space.p18) }
            }.foregroundStyle(colors.ink).frame(maxWidth:.infinity,minHeight:serviceControlHeight,alignment:.leading).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityValue(selected ? "当前选择" : "")
    }
}
struct ServiceModelMenuButton: View {
    var services: [ModelService]
    var current: String?
    var label: String
    var usesImages=false
    var thinkingSupported=false
    var thinkingAvailable=true
    var thinkingUnavailableReason: String? = nil
    @Binding var thinking: Bool
    var select: (ModelService,ServiceModel) -> Void
    var add: () -> Void
    var refresh: () -> Void
    var identifier="modelServices.menu"
    @State private var open=false
    @State private var all=false
    @State private var query=""
    @Environment(\.colorScheme) private var scheme
    private var colors: ServiceControlPalette { .init(dark:scheme == .dark) }
    private var menuWidth: CGFloat {
        #if os(iOS)
        AppleTokens.Phone.menuWidth
        #else
        AppleTokens.Space.pmodel_menu_extent
        #endif
    }
    var body: some View {
        Button { open.toggle();all=false;query="";refresh() } label: {
            #if os(iOS)
            HStack(spacing: AppleTokens.Space.p4) { Text(label).font(AppleTokens.Fonts.caption).lineLimit(1); WeftIcon("chevron",size:AppleTokens.Space.p12) }
                .frame(minWidth:AppleTokens.Space.p44, maxWidth:AppleTokens.Space.p64 * 3, minHeight:AppleTokens.Space.p44).contentShape(Rectangle())
            #else
            WeftIcon("model",size:serviceControlHeight == AppleTokens.Space.p32 ? AppleTokens.Space.p18 : AppleTokens.Space.p22).frame(width:serviceControlHeight,height:serviceControlHeight).contentShape(Circle())
            #endif
        }
            .buttonStyle(.plain).foregroundStyle(colors.secondary).accessibilityLabel("模型："+label).accessibilityIdentifier(identifier)
            .phonePopover(isPresented:$open) { menuContent }
    }
    private var listHeight: CGFloat {
        let rows=services.reduce(0) { $0+ModelCatalog.menuModels($1.models,current:current,all:all,query:query).count }
        return min(AppleTokens.Space.pmodel_menu_extent,CGFloat(rows)*serviceControlHeight+(services.count > 1 ? CGFloat(services.count)*AppleTokens.Space.p32 : AppleTokens.Space.p0))
    }
    private var menuContent: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p4) {
            if all { TextField("搜索全部模型",text:$query).textFieldStyle(.plain).padding(AppleTokens.Space.p12).background(colors.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r8)).accessibilityIdentifier("modelServices.search") }
            ScrollView { LazyVStack(alignment:.leading,spacing:AppleTokens.Space.p0) { ForEach(services) { service in serviceRows(service) } } }.frame(height:listHeight)
            if !all,services.contains(where: {$0.models.filter(\.enabled).count > 12}) { ServiceMenuRow(title:"全部模型") { all=true }.accessibilityIdentifier("modelServices.all") }
            if thinkingSupported {
                Divider();ServiceSwitch(title:"深度思考",enabled:$thinking).disabled(!thinkingAvailable).accessibilityIdentifier("modelServices.thinking")
                if let thinkingUnavailableReason { Text(thinkingUnavailableReason).font(.system(size:AppleTokens.FontSize.f12)).foregroundStyle(colors.muted) }
            }
            Divider()
            ServiceMenuRow(title:"添加模型服务…") { open=false;add() }.accessibilityIdentifier("modelServices.add")
        }.padding(AppleTokens.Space.p12).frame(width:menuWidth).foregroundStyle(colors.ink).background(colors.surface,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12))
            .overlay(RoundedRectangle(cornerRadius:AppleTokens.Radius.r12).stroke(colors.line,lineWidth:AppleTokens.Space.p1))
            .shadow(color:colors.shadow,radius:AppleTokens.Space.p24,y:AppleTokens.Space.p12)
    }
    @ViewBuilder private func serviceRows(_ service: ModelService) -> some View {
        if services.count > 1 { Text(service.name).font(.system(size:AppleTokens.FontSize.f12)).foregroundStyle(colors.muted).padding(.vertical,AppleTokens.Space.p8) }
        ForEach(ModelCatalog.menuModels(service.models,current:current,all:all,query:query)) { item in modelRow(service,item) }
    }
    private func modelRow(_ service: ModelService,_ item: ServiceModel) -> some View {
        ServiceMenuRow(title:item.name,subtitle:usesImages && item.capabilities?.vision == false ? "这个模型看不了这段对话里的图片" : nil,selected:item.matches(current) || item.modelId == current) { select(service,item);open=false }
            .accessibilityIdentifier("modelServices.choose."+item.modelId)
    }
}

extension View {
    @ViewBuilder func modelServiceField() -> some View {
        #if os(macOS)
        self.modifier(MacModelServiceField())
        #else
        self.weaveField()
        #endif
    }
}
#if os(macOS)
private struct MacModelServiceField: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        let colors = ServiceControlPalette(dark: scheme == .dark)
        content.textFieldStyle(.plain).font(AppleTokens.Fonts.body).foregroundStyle(colors.ink)
            .padding(.horizontal, AppleTokens.Space.p12).frame(minHeight: AppleTokens.Space.p32)
            .background(colors.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r8))
            .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r8).strokeBorder(colors.line))
    }
}
#endif
