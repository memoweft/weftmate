import SwiftUI
import WeftMateCore

struct ComputerMenuButton: View {
    @ObservedObject var cloud: CloudLoginModel
    @State private var open=false
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        if cloud.multipleComputers {
            Button { open.toggle() } label: { WeftIcon("desktop",size:AppleTokens.Space.p22).frame(width:AppleTokens.Space.p44,height:AppleTokens.Space.p44).contentShape(Circle()) }
                .buttonStyle(.plain).foregroundStyle(Weave.secondary).accessibilityLabel("电脑："+cloud.selectedComputerName).accessibilityIdentifier("computer.menu")
                .popover(isPresented:$open,arrowEdge:.bottom) {
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p4) {
                        Text("这件事在哪台电脑上做").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        ForEach(cloud.hosts) { host in
                            ServiceMenuRow(title:host.computerName,subtitle:host.online ? nil : host.computerName+"不在线",selected:(host.hostId ?? host.id) == cloud.requestedComputerID) { open=false;Task { await cloud.connectHost(id:host.hostId ?? host.id) } }.accessibilityIdentifier("computer.choose."+host.id)
                        }
                        if let notice=cloud.selectedComputerNotice { Text(notice) .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                    }.padding(AppleTokens.Space.p12).frame(width:AppleTokens.Space.pmodel_menu_extent).background(ServiceControlPalette(dark:scheme == .dark).surface,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12)).overlay(RoundedRectangle(cornerRadius:AppleTokens.Radius.r12).stroke(ServiceControlPalette(dark:scheme == .dark).line,lineWidth:AppleTokens.Space.p1)).presentationCompactAdaptation(.popover).presentationBackground(.clear).presentationCornerRadius(AppleTokens.Radius.r12)
                }
        }
    }
}
struct ComputerConversationList: View {
    @ObservedObject var cloud: CloudLoginModel
    var currentHostID: String? = nil
    var currentConversations: [ConversationSummary] = []
    var query=""
    var mode: ConversationMode? = nil
    var archived: Bool? = nil
    var groups: [SessionGroup] = []
    private var conversations: [ComputerConversation] {
        guard let currentHostID, let host = cloud.hosts.first(where: { ($0.hostId ?? $0.id) == currentHostID }) else {
            return cloud.computerConversations
        }
        // The active connection already has fresh metadata; other hosts can still be refreshing.
        return cloud.computerConversations.filter { $0.hostId != currentHostID } + currentConversations.map {
            ComputerConversation(hostId: currentHostID, name: host.computerName, online: host.online, conversation: $0)
        }
    }
    private var sections: [ComputerConversationSection] {
        let rows=conversations.filter { (mode == nil || WorkAndChat.mode($0.conversation) == mode) && (archived == nil || $0.conversation.archived == archived) && (query.isEmpty || $0.conversation.title.localizedCaseInsensitiveContains(query)) }
        if mode == .chat {
            return WorkAndChat.sections(rows:rows.map(\.conversation),groups:groups,mode:.chat,query:query,archived:archived ?? false).map { section in
                .init(id:section.id,title:section.title,rows:section.rows.flatMap { item in rows.filter { $0.conversation.id == item.id } })
            }
        }
        guard mode == .work else { return [.init(id:"conversations",title:nil,rows:rows)] }
        let groups=Dictionary(grouping:rows) { $0.hostId+"|"+($0.conversation.projectId ?? "removed") }
        return groups.keys.sorted().map { key in
            let rows=groups[key]!
            return .init(id:key,title:rows.first.map { $0.name+" · "+($0.conversation.workDirectory?.name ?? $0.conversation.projectName ?? "需要选择文件夹") },rows:rows)
        }
    }
    var close: () -> Void = {}
    var body: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p4) {
            ForEach(sections) { section in
                if let title=section.title { Text(title).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).padding(.top,AppleTokens.Space.p12) }
                ForEach(section.rows) { row in
                Button { Task { await cloud.openComputerConversation(row);if row.online { close() } } } label: {
                    HStack(spacing:AppleTokens.Space.p12) { WeftIcon("chat");VStack(alignment:.leading,spacing:AppleTokens.Space.p3) { Text(row.conversation.title.isEmpty ? "新对话" : row.conversation.title).lineLimit(2);Text(row.name+(row.online ? "" : " · 不在线")).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) };Spacer() }.frame(minHeight:AppleTokens.Space.p44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("computer.conversation."+row.id)
            }
            }
            if let error=cloud.error { Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
        }.task { await cloud.refreshComputerConversations(force:true) }
    }
}

private struct ComputerConversationSection: Identifiable {
    let id: String
    let title: String?
    let rows: [ComputerConversation]
}
