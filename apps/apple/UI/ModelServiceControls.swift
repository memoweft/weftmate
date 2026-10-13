import SwiftUI
import WeftMateCore

/// Values from the supplied controls-spec tokens, scoped to APPLE-9 controls.
private struct ServiceControlPalette {
    let dark: Bool
    private func color(_ light: UInt32,_ darkValue: UInt32) -> Color {
        let value=dark ? darkValue : light
        return Color(red:Double((value>>16)&255)/255,green:Double((value>>8)&255)/255,blue:Double(value&255)/255)
    }
    var surface: Color { color(0xffffff,0x2a2a2c) }
    var canvas: Color { color(0xfaf9f7,0x1c1c1e) }
    var ink: Color { color(0x272724,0xf2f2f4) }
    var secondary: Color { color(0x575752,0xc4c4c9) }
    var muted: Color { color(0x676762,0xa3a3a9) }
    var accent: Color { dark ? color(0x2c2c2e,0xe6e6e8) : color(0x2c2c2e,0xe6e6e8).opacity(0.84) }
    var onAccent: Color { color(0xffffff,0x1c1c1e) }
    var line: Color { dark ? Color.white.opacity(0.14) : color(0xe1e0db,0xe1e0db) }
    var soft: Color { dark ? Color.gray.opacity(0.26) : color(0xf1f0ed,0xf1f0ed) }
}
struct ServiceActionStyle: ButtonStyle {
    var primary=false
    @Environment(\.colorScheme) private var scheme
    func makeBody(configuration: Configuration) -> some View {
        let colors=ServiceControlPalette(dark:scheme == .dark)
        configuration.label.font(.system(size:15,weight:.medium)).foregroundStyle(primary ? colors.onAccent : colors.secondary)
            .padding(.horizontal,18).frame(minHeight:44).frame(maxWidth:.infinity)
            .background(primary ? colors.accent : configuration.isPressed ? colors.soft : colors.surface,in:Capsule())
            .overlay(Capsule().stroke(primary ? .clear : colors.line,lineWidth:1))
    }
}
struct ServiceSwitch: View {
    var title: String
    @Binding var enabled: Bool
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let colors=ServiceControlPalette(dark:scheme == .dark)
        Button { enabled.toggle() } label: {
            HStack {
                Text(title).font(.system(size:15,weight:.medium)).foregroundStyle(colors.ink);Spacer()
                Capsule().fill(enabled ? colors.accent : colors.muted).frame(width:42,height:26)
                    .overlay(alignment:enabled ? .trailing : .leading) { Circle().fill(enabled ? colors.onAccent : colors.surface).frame(width:20,height:20).padding(3) }
            }.frame(minHeight:44).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(title).accessibilityValue(enabled ? "已开启" : "已关闭").accessibilityAddTraits(.isButton)
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
            HStack(spacing:8) {
                VStack(alignment:.leading,spacing:3) {
                    Text(title).font(.system(size:15,weight:.medium)).lineLimit(1).truncationMode(.middle)
                    if let subtitle { Text(subtitle).font(.system(size:12)).foregroundStyle(colors.muted) }
                };Spacer(minLength:8)
                if selected { WeftIcon("allow",size:18) }
            }.foregroundStyle(colors.ink).frame(maxWidth:.infinity,minHeight:44,alignment:.leading).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityValue(selected ? "当前选择" : "")
    }
}
struct ServiceModelMenuButton: View {
    var services: [ModelService]
    var current: String?
    var label: String
    var usesImages=false
    var thinkingSupported=false
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
    var body: some View {
        Button { open.toggle();all=false;query="";refresh() } label: { WeftIcon("model",size:22).frame(width:44,height:44).contentShape(Circle()) }
            .buttonStyle(.plain).foregroundStyle(colors.secondary).accessibilityLabel("模型："+label).accessibilityIdentifier(identifier)
            .popover(isPresented:$open,arrowEdge:.bottom) { menuContent.presentationCompactAdaptation(.popover) }
    }
    private var listHeight: CGFloat {
        let rows=services.reduce(0) { $0+ModelCatalog.menuModels($1.models,current:current,all:all,query:query).count }
        return min(300,CGFloat(rows*44+(services.count > 1 ? services.count*32 : 0)))
    }
    private var menuContent: some View {
        VStack(alignment:.leading,spacing:4) {
            if all { TextField("搜索全部模型",text:$query).textFieldStyle(.plain).padding(12).background(colors.soft,in:RoundedRectangle(cornerRadius:8)).accessibilityIdentifier("modelServices.search") }
            ScrollView { LazyVStack(alignment:.leading,spacing:0) { ForEach(services) { service in serviceRows(service) } } }.frame(height:listHeight)
            if !all,services.contains(where: {$0.models.filter(\.enabled).count > 12}) { ServiceMenuRow(title:"全部模型") { all=true }.accessibilityIdentifier("modelServices.all") }
            if thinkingSupported { Divider();ServiceSwitch(title:"深度思考",enabled:$thinking).accessibilityIdentifier("modelServices.thinking") }
            Divider()
            ServiceMenuRow(title:"添加模型服务…") { open=false;add() }.accessibilityIdentifier("modelServices.add")
        }.padding(12).frame(width:300).foregroundStyle(colors.ink).background(colors.surface,in:RoundedRectangle(cornerRadius:12))
            .overlay(RoundedRectangle(cornerRadius:12).stroke(colors.line,lineWidth:1))
            .shadow(color:.black.opacity(scheme == .dark ? 0.28 : 0.16),radius:24,y:12)
    }
    @ViewBuilder private func serviceRows(_ service: ModelService) -> some View {
        if services.count > 1 { Text(service.name).font(.system(size:12)).foregroundStyle(colors.muted).padding(.vertical,8) }
        ForEach(ModelCatalog.menuModels(service.models,current:current,all:all,query:query)) { item in modelRow(service,item) }
    }
    private func modelRow(_ service: ModelService,_ item: ServiceModel) -> some View {
        ServiceMenuRow(title:item.name,subtitle:usesImages && item.capabilities?.vision == false ? "这个模型看不了这段对话里的图片" : nil,selected:item.matches(current) || item.modelId == current) { select(service,item);open=false }
            .accessibilityIdentifier("modelServices.choose."+item.modelId)
    }
}
