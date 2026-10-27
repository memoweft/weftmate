import SwiftUI
import WeftMateCore

struct OfflineWorkspace: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: OfflineChatModel
    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            if app.serverLoginExpired {
                HStack {
                    Text("已保存的内容仍可查看").font(AppleTokens.Fonts.callout)
                    Spacer()
                    #if os(iOS)
                    if app.cloudLogin.authenticated {
                        Button("重新连接电脑") { Task { await app.cloudLogin.retryConnection() } }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("reconnectComputer")
                    } else { Button("联网使用") { app.cloudLogin.requireLogin() }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("expiredLogin") }
                    #else
                    Button("联网使用") { app.cloudLogin.requireLogin() }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("expiredLogin")
                    #endif
                }.padding(AppleTokens.Space.p12)
            }
            #if os(iOS)
            PhoneWorkspace(model:app)
            #else
            if model.hostOffline || model.showHistory {
                OfflineChatView(app: app, model: model)
            } else {
                if !model.turns.isEmpty {
                    Button(model.pending == 0 ? "离线对话 · 电脑已收到" : "离线对话 · 等待交给电脑") { model.showHistory = true }
                        .font(AppleTokens.Fonts.caption).padding(AppleTokens.Space.p8)
                        .accessibilityIdentifier("offlineHistory")
                }
                #if os(macOS)
                MacWorkspace(model: app)
                #else
                PhoneWorkspace(model: app)
                #endif
            }
            #endif
        }.accessibilityElement(children: .contain)
    }
}

struct OfflineChatView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: OfflineChatModel
    #if os(iOS)
    @ObservedObject private var cloud: CloudLoginModel
    @State private var offlineWorkOpen=false
    @State private var sendTask: Task<Void,Never>?
    @State private var following=true
    @State private var atLatest=true
    @StateObject private var positions=MainChatPositionTracker()
    @FocusState private var focused: Bool
    init(app: AppleAppModel,model: OfflineChatModel) { self.app=app;self.model=model;cloud=app.cloudLogin }
    #endif
    private var defaultConversationTitle: String {
        #if os(iOS)
        "手机对话"
        #else
        "离线对话"
        #endif
    }
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
            #if os(iOS)
            PhoneChatHeader(title:"手机对话",status:app.phoneConnectionStatus) {
                PhoneActionMenu {
                    Button("新对话") { model.newConversation() }.accessibilityIdentifier("offlineNew")
                    ForEach(model.conversationIDs,id:\.self) { id in
                        Button(model.turns.first { $0.conversationId == id }?.messages.first?.text ?? defaultConversationTitle) { model.conversationID=id }
                    }
                    ForEach(model.recent) { row in Button(row.title ?? "近期对话") { model.newConversation(recent:row.id) } }
                    if !model.hostOffline { Button("返回电脑对话") { model.showHistory=false }.accessibilityIdentifier("offlineBack") }
                    Button("重新连接") { Task { await app.pollOffline() } }.accessibilityIdentifier("offlineReconnect")
                } label: { WeftIcon("more").frame(width:44,height:44) }.accessibilityLabel("对话菜单")
            }
            #else
            HStack {
                #if os(iOS)
                Text("手机对话").font(AppleTokens.Fonts.title3)
                #else
                Text(model.hostOffline ? "离线模式" : "离线对话").font(AppleTokens.Fonts.title3)
                #endif
                Spacer()
                Menu("对话") {
                    ForEach(model.conversationIDs, id: \.self) { id in
                        Button(model.turns.first { $0.conversationId == id }?.messages.first?.text ?? defaultConversationTitle) { model.conversationID = id }
                    }
                    ForEach(model.recent) { row in Button(row.title ?? "近期对话") { model.newConversation(recent: row.id) } }
                }
                Button("新对话") { model.newConversation() }.accessibilityIdentifier("offlineNew")
                if !model.hostOffline { Button("返回") { model.showHistory = false }.accessibilityIdentifier("offlineBack") }
                Button("重新连接") { Task { await app.pollOffline() } }.accessibilityIdentifier("offlineReconnect")
            }
            #endif
            PreviousRunNotice()
            if model.hostOffline {
                Text(OfflineChatModel.warning).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
                    .accessibilityIdentifier("offlineTopWarning")
            }
            #if os(iOS)
            if WorkAndChat.offlineWorkAvailable(snapshot:model.workSnapshot,authorization:cloud.offlineWorkAuthorization,authenticated:cloud.authenticated) {
                Button("交给电脑，上线后做") { offlineWorkOpen=true }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("offlineWork.open")
            }
            #endif
            if model.truncated { Text("这里暂时只有部分记忆，电脑上线后会继续更新。") .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            #if os(iOS)
            phoneMessages
            #else
            ScrollView {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                    ForEach(model.turns.filter { $0.conversationId == model.conversationID }) { turn in
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                            ForEach(Array(turn.messages.enumerated()), id: \.offset) { _, message in
                                Text(message.text).font(AppleTokens.Fonts.body).foregroundStyle(message.role == "user" ? Weave.secondary : Weave.ink)
                                    .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
                            }
                            Text(model.synced.contains(turn.id) ? "电脑已收到" : "电脑上线后自动接收")
                                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.accessibilityIdentifier("offlineMessages")
            #endif
            if let notice = model.notice { Text(notice).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("offlineNotice") }
            if model.busy { ProgressView("正在回复…").font(AppleTokens.Fonts.caption) }
            if model.hostOffline {
                #if os(macOS)
                Text(OfflineChatModel.warning).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    .accessibilityIdentifier("offlineInputWarning")
                #endif
                if !model.ready { Text("请联网核对账号，或先连上电脑读取记忆。") .font(AppleTokens.Fonts.callout) }
                #if os(macOS)
                HStack(alignment: .bottom) {
                    TextField("聊一聊…", text: $model.draft, axis: .vertical).lineLimit(1...5)
                        .textFieldStyle(.plain).autocorrectionDisabled().accessibilityIdentifier("offlineInput")
                    Button { Task {
                        #if os(iOS)
                        app.phoneChat.activate(app:app)
                        await model.send(control:app.offlineAuthorization,fallbackModel:app.phoneChat.currentModel)
                        #else
                        await model.send(control:app.offlineAuthorization)
                        #endif
                    } } label: { WeftIcon("send", size: AppleTokens.Space.p20) }
                        .disabled(!model.ready || model.busy || model.polling || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityLabel("发送").accessibilityIdentifier("offlineSend")
                }.padding(AppleTokens.Space.p12).background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
                #endif
            }
        }
            #if os(macOS)
            .padding(AppleTokens.Space.p20)
            #else
            .toolbar(.hidden,for:.navigationBar)
            #endif
            .background(Weave.canvas)
            #if os(iOS)
            .safeAreaInset(edge:.bottom,spacing:0) { if model.hostOffline { phoneComposer } }
            .onDisappear { sendTask?.cancel() }
            .sheet(isPresented:$offlineWorkOpen) { PhoneOfflineWork(app:app).phoneSheet("离线交代",close:{offlineWorkOpen=false}) }
            #endif
            .accessibilityElement(children: .contain).accessibilityIdentifier("offlineChat")
    }
    #if os(iOS)
    private var phoneComposer: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
            TextField("聊一聊…",text:$model.draft,axis:.vertical).lineLimit(1...5).focused($focused)
                .textFieldStyle(.plain).accessibilityIdentifier("offlineInput")
            HStack {
                Text("对话 · 电脑上线后接收原话").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                Spacer()
                Button {
                    if model.busy { sendTask?.cancel() }
                    else {
                        focused=false
                        sendTask=Task {
                            app.phoneChat.activate(app:app)
                            await model.send(control:app.offlineAuthorization,fallbackModel:app.phoneChat.currentModel)
                        }
                    }
                } label: { WeftIcon(model.busy ? "stop" : "send") }
                    .phoneIcon(primary:true).disabled(!model.busy && (!model.ready || model.polling || model.draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty))
                    .accessibilityLabel(model.busy ? "停止回复" : "发送").accessibilityIdentifier("offlineSend")
            }
        }.phoneChatComposer()
    }
    private var phoneMessages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                    ForEach(model.turns.filter { $0.conversationId == model.conversationID }) { turn in
                        VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                            ForEach(Array(turn.messages.enumerated()),id:\.offset) { index,message in
                                if message.role == "user" {
                                    HStack { Spacer(minLength:AppleTokens.Space.p32); Text(message.text).textSelection(.enabled)
                                        .padding(AppleTokens.Space.p16).background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r16)) }
                                } else { MessageBodyView(text:message.text,messageID:turn.id+String(index)) }
                            }
                            Text(model.synced.contains(turn.id) ? "电脑已收到" : "电脑上线后自动接收").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        }.id(turn.id)
                    }
                    Color.clear.frame(height:1).id("latest")
                        .background(MainChatEventPosition(eventID:"offline.end") { _,rect,height,user in
                            guard let rect else { return };let distance=max(0,rect.maxY-height)
                            if user,let before=positions.previousEndTop {
                                if rect.minY > before { following=false }
                                else if rect.minY < before { following=distance <= 48 }
                            }
                            positions.previousEndTop=rect.minY; atLatest=distance <= 48
                            if following && !user && distance > 0 { proxy.scrollTo("latest",anchor:.bottom) }
                        })
                }
            }.padding(.horizontal,AppleTokens.Phone.pageInset).scrollDismissesKeyboard(.interactively)
                .simultaneousGesture(DragGesture().onChanged { if $0.translation.height > 0 { following=false } })
                .onChange(of:model.turns.last?.id) { _,_ in if following { proxy.scrollTo("latest",anchor:.bottom) } }
                .onChange(of:model.conversationID) { _,_ in following=true; proxy.scrollTo("latest",anchor:.bottom) }
                .overlay(alignment:.bottom) { if !following && !atLatest { PhoneLatestReplyButton { following=true; proxy.scrollTo("latest",anchor:.bottom) }.accessibilityIdentifier("offline.latest") } }
                .onAppear { proxy.scrollTo("latest",anchor:.bottom) }
        }.accessibilityIdentifier("offlineMessages")
    }
    #endif

}
