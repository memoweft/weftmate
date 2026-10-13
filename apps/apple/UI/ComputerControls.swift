import SwiftUI
import WeftMateCore

struct ComputerMenuButton: View {
    @ObservedObject var cloud: CloudLoginModel
    @State private var open=false
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        if cloud.multipleComputers {
            Button { open.toggle() } label: { WeftIcon("desktop",size:22).frame(width:44,height:44).contentShape(Circle()) }
                .buttonStyle(.plain).foregroundStyle(Weave.secondary).accessibilityLabel("电脑："+cloud.selectedComputerName).accessibilityIdentifier("computer.menu")
                .popover(isPresented:$open,arrowEdge:.bottom) {
                    VStack(alignment:.leading,spacing:4) {
                        Text("这件事在哪台电脑上做").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        ForEach(cloud.hosts) { host in
                            ServiceMenuRow(title:host.computerName,subtitle:host.online ? nil : host.computerName+"不在线",selected:(host.hostId ?? host.id) == cloud.requestedComputerID) { open=false;Task { await cloud.connectHost(id:host.hostId ?? host.id) } }.accessibilityIdentifier("computer.choose."+host.id)
                        }
                        if let notice=cloud.selectedComputerNotice { Text(notice) .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                    }.padding(12).frame(width:300).background(ServiceControlPalette(dark:scheme == .dark).surface,in:RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).stroke(ServiceControlPalette(dark:scheme == .dark).line,lineWidth:1)).presentationCompactAdaptation(.popover).presentationBackground(.clear).presentationCornerRadius(12)
                }
        }
    }
}
struct ComputerConversationList: View {
    @ObservedObject var cloud: CloudLoginModel
    var query=""
    var close: () -> Void = {}
    var body: some View {
        VStack(alignment:.leading,spacing:4) {
            ForEach(cloud.computerConversations.filter { query.isEmpty || $0.conversation.title.localizedCaseInsensitiveContains(query) }) { row in
                Button { Task { await cloud.openComputerConversation(row);if row.online { close() } } } label: {
                    HStack(spacing:12) { WeftIcon("chat");VStack(alignment:.leading,spacing:3) { Text(row.conversation.title.isEmpty ? "新对话" : row.conversation.title).lineLimit(2);Text(row.name+(row.online ? "" : " · 不在线")).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) };Spacer() }.frame(minHeight:44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("computer.conversation."+row.id)
            }
            if let error=cloud.error { Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
        }.task { await cloud.refreshComputerConversations(force:true) }
    }
}
