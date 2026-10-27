import SwiftUI
import WeftMateCore

/// Content pages live outside PhoneWorkspace so the shell remains shared by the
/// parallel page/settings packages. Selection uses the shell's existing route.
struct PhoneConversationsPage: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var phone: PhoneStandaloneModel
    @Binding var query: String
    @Environment(\.phoneOpenConversation) private var openConversation
    @State private var mode = "all"
    @State private var archived = false
    @State private var unread = false
    @State private var ascending = false
    @State private var grouped = true
    @State private var dateOpen = false
    @State private var date = Date()
    @State private var historyOpen = false
    private var rows: [ConversationSummary] {
        app.conversations.filter {
            $0.archived == archived && (!unread || $0.unread) &&
            (mode == "all" || WorkAndChat.mode($0).rawValue == mode) &&
            (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query))
        }
    }
    private struct DirectorySection: Identifiable {
        let id: String
        let title: String
        let rows: [ConversationSummary]
    }
    private var sections: [DirectorySection] {
        let modes: [ConversationMode] = mode == "all" ? [.chat,.work] : [ConversationMode(rawValue:mode) ?? .chat]
        let projected=modes.flatMap { value in
            WorkAndChat.sections(rows:rows,groups:grouped ? app.sessionGroups : [],mode:value,query:query,archived:archived)
                .map { DirectorySection(id:value.rawValue+":"+$0.id,title:$0.title,rows:$0.rows) }
        }
        return ascending ? projected.reversed().map { .init(id:$0.id,title:$0.title,rows:Array($0.rows.reversed())) } : projected
    }
    var body: some View {
        List {
            if query.isEmpty {
                Section {
                    Text("对话和工作，各自接着上次。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                        .listRowBackground(Color.clear)
                    Picker("对话范围", selection:$mode) {
                        Text("全部").tag("all"); Text("对话").tag("chat"); Text("工作").tag("work")
                    }.pickerStyle(.segmented).listRowBackground(Color.clear).accessibilityIdentifier("conversations.mode")
                }
                if mode != "work" && !archived && !unread && !phone.state.threads.isEmpty {
                    Section("手机上的对话") {
                        ForEach(phone.state.threads) { thread in
                            Button { phone.select(thread.id); select(thread.id) } label: {
                                PhoneChatPageRow(title:thread.title,subtitle:"手机对话",icon:"chat")
                            }.buttonStyle(.plain).accessibilityIdentifier("phone.conversation."+thread.id)
                        }
                    }
                }
                if app.cloudLogin.multipleComputers {
                    Section("电脑上的对话") {
                        ComputerConversationList(cloud:app.cloudLogin,query:query,mode:ConversationMode(rawValue:mode),archived:archived,groups:app.sessionGroups)
                    }
                } else {
                    ForEach(sections) { section in
                        Section(section.title) {
                            ForEach(section.rows) { row in
                                HStack(spacing:AppleTokens.Space.p4) {
                                    Button { select(row.id) } label: {
                                        PhoneChatPageRow(title:row.title.isEmpty ? "未命名对话" : row.title,
                                            subtitle:row.running ? "正在处理" : row.unread ? "未读" : WorkAndChat.mode(row) == .work ? "工作 · "+(row.projectName ?? "需要选择项目") : "对话",
                                            icon:WorkAndChat.mode(row) == .work ? "desktop" : "chat")
                                    }.buttonStyle(.plain).accessibilityIdentifier("conversationRow."+row.id)
                                    PhoneActionMenu { SessionActions(app:app,conversation:row) } label: { WeftIcon("more").frame(width:44,height:44) }
                                        .accessibilityLabel("对话操作，"+row.title).accessibilityIdentifier("conversations.menu."+row.id)
                                }
                            }
                        }
                    }
                }
                if rows.isEmpty && (mode == "work" || phone.state.threads.isEmpty) && !app.cloudLogin.multipleComputers {
                    Section {
                        Text("这里还没有对话").font(AppleTokens.Fonts.headline)
                        Text("换个筛选条件，或从侧栏新建一段对话。").foregroundStyle(Weave.muted)
                        Button("显示全部") { mode="all"; unread=false; archived=false }
                    }
                }
            } else { PhoneChatSearchResults(app:app,phone:phone,query:query,select:select) }
            if let error=app.conversationsError {
                Section { Text(error).foregroundStyle(Weave.danger); Button("重试") { Task { await app.refresh() } } }
            }
            Section {
                Button { dateOpen=true } label: { PhoneChatPageRow(title:"按日期查看对话",subtitle:"定位到主对话的那一天",icon:"clock") }
                    .buttonStyle(.plain).accessibilityIdentifier("conversations.date")
                    .phonePopover(isPresented:$dateOpen) {
                        VStack {
                            DatePicker("选择日期",selection:$date,displayedComponents:.date).datePickerStyle(.graphical)
                                .environment(\.timeZone,TimeZone(identifier:app.mainChat.timeZone) ?? .gmt)
                            Button("查看这一天") { dateOpen=false; historyOpen=true }.buttonStyle(PrimaryActionStyle())
                        }.padding(AppleTokens.Space.p16).frame(idealWidth:320).accessibilityIdentifier("conversations.datePicker")
                    }.disabled(app.session == nil)
            }
        }.listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Weave.grouped)
            .navigationTitle(query.isEmpty ? "全部对话" : "搜索")
            .searchable(text:$query,prompt:"搜索对话、记忆和成果")
            .toolbar {
                ToolbarItem(placement:.topBarTrailing) {
                    PhoneActionMenu {
                        Toggle("只看未读",isOn:$unread)
                        Toggle("查看归档",isOn:$archived)
                        Toggle("按分组排列",isOn:$grouped)
                        Toggle("较早的在前",isOn:$ascending)
                    } label: { WeftIcon("more").frame(width:44,height:44) }
                        .accessibilityLabel("筛选与排序").accessibilityIdentifier("conversations.options")
                }
            }
            .refreshable { await app.refresh() }
            .navigationDestination(isPresented:$historyOpen) { PhoneChatHistoryPage(app:app,date:date) }
            .sheet(isPresented:Binding(get:{app.renamingSessionID != nil},set:{if !$0 { app.renamingSessionID=nil }})) {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                    TextField("对话名称",text:$app.sessionTitleDraft).weaveField().accessibilityIdentifier("conversations.rename")
                    if let error=app.lifecycleError { Text(error).foregroundStyle(Weave.danger) }
                    Button("保存") {
                        if let row=app.conversations.first(where:{$0.id == app.renamingSessionID}) { Task { await app.saveSessionTitle(row) } }
                    }.buttonStyle(PrimaryActionStyle()).disabled(app.lifecycleBusy)
                }.padding(AppleTokens.Phone.pageInset).phoneSheet("重命名对话",close:{app.renamingSessionID=nil})
            }
            .accessibilityIdentifier("conversationList")
    }
    private func select(_ id: String) {
        if app.openedSessionID == id { openConversation?(id) } else { app.openedSessionID=id }
    }
}

struct PhoneChatPageRow: View {
    let title: String
    var subtitle: String? = nil
    var icon = "file"
    var body: some View {
        HStack(spacing:AppleTokens.Space.p12) {
            WeftIcon(icon,size:20).foregroundStyle(Weave.secondary)
            VStack(alignment:.leading,spacing:AppleTokens.Space.p4) {
                Text(title).font(AppleTokens.Fonts.body).foregroundStyle(Weave.ink).lineLimit(2)
                if let subtitle { Text(subtitle).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).lineLimit(2) }
            }
            Spacer(minLength:AppleTokens.Space.p4)
            WeftIcon("right",size:12).foregroundStyle(Weave.muted)
        }.frame(maxWidth:.infinity,minHeight:AppleTokens.Phone.rowHeight,alignment:.leading).contentShape(Rectangle())
    }
}

private struct PhoneChatSearchResults: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var phone: PhoneStandaloneModel
    let query: String
    let select: (String) -> Void
    @State private var files: [PhoneLibraryItem] = []
    @State private var error: String?
    @State private var loading = false
    @State private var requestID=UUID()
    private var memories: [OfflineMemory] {
        guard let host=app.session?.hostId,let subject=app.cloudLogin.subject,app.cloudLogin.authenticated,app.offline.memoryHostID == host,
              app.offline.memoryAccountID == subject else { return [] }
        return app.offline.memoryItems.filter { $0.text.localizedCaseInsensitiveContains(query) }
    }
    var body: some View {
        Section("对话") {
            ForEach(phone.state.threads.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.messages.contains(where:{$0.text.localizedCaseInsensitiveContains(query)}) }) { row in
                Button { phone.select(row.id); select(row.id) } label: { PhoneChatPageRow(title:row.title,subtitle:"手机对话",icon:"chat") }.buttonStyle(.plain)
            }
            ForEach(app.visibleConversations.filter { $0.title.localizedCaseInsensitiveContains(query) }) { row in
                Button { select(row.id) } label: { PhoneChatPageRow(title:row.title,subtitle:"对话",icon:"chat") }.buttonStyle(.plain)
            }
            if app.mainChat.capabilities.supports("chatSearch") {
                NavigationLink { PhoneSearchMainChatPage(app:app,query:query) } label: { PhoneChatPageRow(title:"在主对话正文里查找",subtitle:query,icon:"search") }
            }
        }
        Section("记忆") {
            ForEach(memories) { item in
                NavigationLink { PhoneMemoryWorkspaceView(app:app) } label: { PhoneChatPageRow(title:item.text,subtitle:"电脑同步来的获准副本",icon:"memory") }
            }
            if memories.isEmpty { Text("获准副本里没有匹配的记忆").foregroundStyle(Weave.muted) }
        }
        Section("成果") {
            ForEach(files) { item in
                Button { app.phoneLibrarySelection=item.id } label: { PhoneChatPageRow(title:item.fileName,subtitle:PhoneFeaturePolicy.fileType(item.type),icon:"file") }.buttonStyle(.plain)
            }
            if loading { ProgressView("正在查找成果…") }
            else if let error { Text(error).foregroundStyle(Weave.muted) }
            else if files.isEmpty { Text("没有匹配的成果，试试文件名里的其他词。").foregroundStyle(Weave.muted) }
        }.task(id:query+app.accountEpoch.uuidString) {
            let ticket=UUID(); requestID=ticket
            files=[]; error=nil
            guard app.session != nil, !app.offline.hostOffline else { error="连接电脑后可搜索成果。"; return }
            loading=true; defer { if requestID == ticket { loading=false } }
            let epoch=app.accountEpoch
            do {
                try await Task.sleep(for:.milliseconds(250))
                let result=try await app.assistantClient.phoneLibrary(search:query)
                guard !Task.isCancelled,requestID == ticket,epoch == app.accountEpoch else { return }; files=result.items
            } catch is CancellationError { }
            catch { if !Task.isCancelled,requestID == ticket,epoch == app.accountEpoch { self.error="成果暂时读不了，换个词或稍后重试。" } }
        }
    }
}

private struct PhoneSearchMainChatPage: View {
    @ObservedObject var app: AppleAppModel
    let query: String
    var body: some View {
        MainChatView(app:app,initialQuery:query)
    }
}
private struct PhoneChatHistoryPage: View {
    @ObservedObject var app: AppleAppModel
    let date: Date
    var body: some View {
        MainChatView(app:app,initialDate:date)
    }
}
