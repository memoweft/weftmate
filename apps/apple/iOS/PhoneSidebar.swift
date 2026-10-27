import SwiftUI
import WeftMateCore

/// The same navigation and conversation data sources serve both phone chat modes.
struct PhoneSidebar: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var phone: PhoneStandaloneModel
    @Binding var search: String
    let close: () -> Void
    let newConversation: () -> Void
    let newWork: () -> Void
    let mainConversation: () -> Void
    let navigate: (PhoneSidebarDestination) -> Void
    let settings: (Bool) -> Void
    @ScaledMetric(relativeTo: .body) private var fontSize = AppleTokens.Phone.listSize
    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            HStack {
                Text("WeftMate").font(AppleTokens.Fonts.headline); Spacer()
                Button(action: close) { WeftIcon("deny") }.phoneIcon(quiet: true)
                    .accessibilityLabel("关闭侧栏").accessibilityIdentifier("phone.sidebar.close")
            }.padding(.horizontal, AppleTokens.Space.p16)
            HStack {
                WeftIcon("search", size: AppleTokens.Space.p16).foregroundStyle(Weave.muted)
                TextField("搜索对话与内容", text: $search).textFieldStyle(.plain)
                    .submitLabel(.search).onSubmit { navigate(.conversations) }.accessibilityIdentifier("phone.sidebar.search")
            }.padding(.horizontal, AppleTokens.Space.p12).frame(minHeight: AppleTokens.Space.p44)
                .background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
                .padding(.horizontal, AppleTokens.Space.p16)
            ScrollView {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p4) {
                    PhoneActionMenu {
                        Button("新建对话", action: newConversation).accessibilityIdentifier("phone.sidebar.newChat")
                        Button("新建工作", action: newWork).accessibilityIdentifier("phone.sidebar.newWork")
                    } label: {
                        HStack(spacing: AppleTokens.Space.p12) { WeftIcon("compose"); Text("新建对话"); Spacer(minLength: 0) }
                            .frame(maxWidth: .infinity, minHeight: AppleTokens.Space.p44, alignment: .leading).padding(.horizontal, AppleTokens.Space.p12)
                    }.accessibilityIdentifier("phone.sidebar.new")
                    heading("你的对话")
                    row("主对话", icon: "chat", id: "phone.sidebar.main", action: mainConversation)
                    destination(.conversations)
                    PhoneConversationDirectory(app: app, phone: phone, query: search, recentOnly: true, close: close)
                    heading("长期留下来的")
                    ForEach(PhoneSidebarDestination.lasting) { destination($0) }
                    heading("工作空间")
                    destination(.projects)
                }.padding(AppleTokens.Space.p16)
            }
            Divider().overlay(Weave.line).padding(.horizontal, AppleTokens.Space.p16)
            HStack {
                Button { settings(true) } label: {
                    HStack(spacing: AppleTokens.Space.p12) {
                        WeftIcon("account").frame(width: AppleTokens.Space.p36, height: AppleTokens.Space.p36).background(Weave.soft, in: Circle())
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p3) {
                            Text(app.cloudLogin.authenticated ? "我的账号" : "登录账号")
                            Text("个人空间").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        }
                    }.frame(maxWidth: .infinity, minHeight: AppleTokens.Space.p52, alignment: .leading)
                }.buttonStyle(.plain).accessibilityIdentifier("phone.sidebar.account")
                Button { settings(false) } label: { WeftIcon("settings") }.phoneIcon(quiet: true)
                    .accessibilityLabel("设置").accessibilityIdentifier("phone.sidebar.settings")
            }.padding(AppleTokens.Space.p16)
        }.font(.system(size: fontSize)).foregroundStyle(Weave.ink).background(Weave.canvas)
    }
    private func heading(_ title: String) -> some View {
        Text(title).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            .padding(.top, AppleTokens.Space.p20).padding(.horizontal, AppleTokens.Space.p12).padding(.bottom, AppleTokens.Space.p4)
            .accessibilityAddTraits(.isHeader)
    }
    private func destination(_ item: PhoneSidebarDestination) -> some View {
        row(item.title, icon: item.icon, id: "phone.sidebar." + item.rawValue.replacingOccurrences(of: "shell.", with: "")) { navigate(item) }
    }
    private func row(_ title: String, icon: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: AppleTokens.Space.p12) { WeftIcon(icon); Text(title); Spacer(minLength: 0) }
                .frame(maxWidth: .infinity, minHeight: AppleTokens.Space.p44, alignment: .leading).padding(.horizontal, AppleTokens.Space.p12).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier(id)
    }
}

struct PhoneConversationDirectory: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var phone: PhoneStandaloneModel
    var query: String
    var recentOnly = false
    var close: () -> Void
    @Environment(\.phoneOpenConversation) private var openConversation
    @AppStorage("phone.conversationMode") private var savedMode = "chat"
    @State private var archived = false
    private var mode: ConversationMode { ConversationMode(rawValue: savedMode) ?? .chat }
    private var sections: [SessionSidebarSection] {
        if app.mainChat.capabilities.supports("workAndChat") {
            return WorkAndChat.sections(rows: app.conversations, groups: app.sessionGroups, mode: mode, query: query, archived: archived)
        }
        return SessionSidebar.sections(rows: app.conversations, groups: app.sessionGroups, query: query)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p4) {
            if !recentOnly, app.mainChat.capabilities.supports("workAndChat") {
                PhoneConversationModes(selection: Binding(get: { mode }, set: { savedMode = $0.rawValue }))
                Toggle("查看归档", isOn: $archived).font(AppleTokens.Fonts.callout)
            }
            if !phone.state.threads.isEmpty {
                if !recentOnly { Text("手机上的对话").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                ForEach(Array(phone.state.threads.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }.prefix(recentOnly ? 3 : Int.max))) { thread in
                    Button { phone.select(thread.id); select(thread.id) } label: {
                        Text(thread.title).lineLimit(2).frame(maxWidth: .infinity, minHeight: AppleTokens.Space.p44, alignment: .leading).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("phone.conversation." + thread.id)
                }
            }
            if app.cloudLogin.multipleComputers && !recentOnly {
                ComputerConversationList(cloud: app.cloudLogin, query: query, mode: mode, archived: archived, groups: app.sessionGroups, close: close)
            } else {
                ForEach(Array(sections.flatMap(\.rows).prefix(recentOnly ? 3 : Int.max))) { row in
                    if app.renamingSessionID == row.id { EditableSessionRow(app: app, conversation: row) }
                    else {
                        Button { select(row.id) } label: {
                            HStack { Text(row.title.isEmpty ? "未命名对话" : row.title).lineLimit(2); Spacer(); if row.unread { Circle().fill(Weave.accent).frame(width: 8, height: 8) } }
                                .frame(maxWidth: .infinity, minHeight: AppleTokens.Space.p44, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain).contextMenu { SessionActions(app: app, conversation: row) }.accessibilityIdentifier("conversationRow." + row.id)
                    }
                }
            }
        }.padding(.horizontal, AppleTokens.Space.p12)
    }
    private func select(_ id: String) {
        if app.openedSessionID == id { openConversation?(id) }
        else { app.openedSessionID = id }
        close()
    }
}
