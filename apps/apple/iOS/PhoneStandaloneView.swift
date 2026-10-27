import SwiftUI
import PhotosUI
import AVFoundation
import UniformTypeIdentifiers
import WeftMateCore

struct PhoneStandaloneChat: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: PhoneStandaloneModel
    @ObservedObject private var cloud: CloudLoginModel
    @Binding var tab: PhoneTab
    init(app: AppleAppModel, model: PhoneStandaloneModel, tab: Binding<PhoneTab> = .constant(.chat)) { self.app=app; self.model=model; cloud=app.cloudLogin; _tab=tab }
    @State private var modelsOpen=false
    @State private var sidebar=false
    @State private var photos=false
    @State private var importing=false
    @State private var camera=false
    @State private var cameraDenied=false
    @State private var selection: [PhotosPickerItem]=[]
    @State private var preview: PhoneAttachment?
    @State private var importAccount=""
    @State private var importThread: String?
    private func captureScope() { focused=false;importAccount=app.phoneAccountIdentity;importThread=model.state.selected }
    private var validScope: Bool { importAccount == app.phoneAccountIdentity && importThread == model.state.selected }
    private func addImage(_ data: Data) {
        guard validScope else { return }
        do { model.addAttachment(try PhoneAttachmentInput.image(data)) } catch { model.notice=(error as? PhoneAttachmentFailure)?.message ?? "图片暂时读不了，请重试。" }
    }
    private func addFile(_ url: URL) {
        guard validScope else { return }
        do { model.addAttachment(try PhoneAttachmentInput.file(url,remainingText:PhoneAttachment.textUnits-model.attachments.reduce(0) {$0+($1.text?.utf16.count ?? 0)})) }
        catch { model.notice=(error as? PhoneAttachmentFailure)?.message ?? "文件暂时打不开，请重试。" }
    }
    private func openCamera() {
        captureScope()
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { model.notice="相机暂不可用，可从照片图库或文件添加。";return }
        let identity=importAccount,thread=importThread
        Task {
            let permission=AVCaptureDevice.authorizationStatus(for:.video)
            let allowed=permission == .authorized ? true : permission == .notDetermined ? await AVCaptureDevice.requestAccess(for:.video) : false
            guard identity == app.phoneAccountIdentity,thread == model.state.selected else { return }
            if allowed { camera=true } else { cameraDenied=true }
        }
    }
    @FocusState private var focused: Bool
    var body: some View {
        NavigationStack {
            VStack(spacing:AppleTokens.Space.p0) {
                if model.messages.isEmpty {
                    ScrollView {
                        VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                            Text("从这里开始聊").font(AppleTokens.Fonts.title2.bold())
                            Text("手机自己就能聊天，电脑可以以后再添加。")
                            if model.models.isEmpty { PhoneModelEditor(model:model) }
                            else { Text("模型已经准备好，发一句话试试。") }
                        }.padding(AppleTokens.Space.p20)
                    }
                } else {
                    ScrollViewReader { proxy in
                        ScrollView {
                            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                                ForEach(model.messages) { message in
                                    VStack(alignment:message.role == "user" ? .trailing : .leading,spacing:AppleTokens.Space.p8) {
                                        if message.role == "assistant" || !message.text.isEmpty {
                                            Text(message.text.isEmpty ? (message.replyStatus?.placeholder ?? "这次没回复，可以重试。") : message.text).textSelection(.enabled).frame(maxWidth:.infinity,alignment:message.role == "user" ? .trailing : .leading).accessibilityIdentifier("phoneChat.message."+message.role+"."+message.id)
                                        }
                                        if let attachments=message.attachments,!attachments.isEmpty {
                                            attachmentRow(attachments,removable:false)
                                        }
                                        if message.role == "assistant" {
                                            HStack {
                                                if !message.text.isEmpty { Button { UIPasteboard.general.string=message.text } label: { WeftIcon("copy") }.phoneIcon().accessibilityLabel("复制回复").accessibilityIdentifier("phoneChat.copy") }
                                                if message.replyStatus == .failed {
                                                    Button { model.retryReply(message.id) } label: { WeftIcon("sync") }.phoneIcon().disabled(model.busy).accessibilityLabel("重试回复").accessibilityIdentifier("phoneChat.retry."+message.id)
                                                } else if message.id == model.messages.last?.id { Button { model.send(regenerate:true) } label: { WeftIcon("sync") }.phoneIcon().disabled(model.busy).accessibilityLabel("重新生成").accessibilityIdentifier("phoneChat.regenerate") }
                                            }
                                        }
                                    }.id(message.id)
                                }
                            }.padding(AppleTokens.Space.p20)
                        }.onChange(of:model.messages.last?.id) { _,_ in
                            Task { @MainActor in await Task.yield();if let id=model.messages.last?.id { proxy.scrollTo(id,anchor:.bottom) } }
                        }.onChange(of:model.busy) { _,busy in
                            if !busy { Task { @MainActor in await Task.yield();if let id=model.messages.last?.id { proxy.scrollTo(id,anchor:.bottom) } } }
                        }
                    }
                }
                if let notice=model.notice, !model.models.isEmpty || !model.messages.isEmpty { Text(notice).font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted).padding(.horizontal,AppleTokens.Space.p16) }
                if !model.models.isEmpty {
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                        Text("手机上可以聊天和记住你说过的事；操作电脑，连上电脑后可用。")
                            .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        if !model.attachments.isEmpty { attachmentRow(model.attachments,removable:true) }
                        // A bounded editor keeps keyboard/focus layout independent of a growing reply.
                        TextEditor(text:$model.draft).frame(height:76).scrollContentBackground(.hidden)
                            .overlay(alignment:.topLeading) { if model.draft.isEmpty { Text("聊一聊…").foregroundStyle(Weave.muted).padding(.top,AppleTokens.Space.p8).padding(.leading,AppleTokens.Space.p4).allowsHitTesting(false) } }
                            .focused($focused).accessibilityLabel("聊一聊…").accessibilityIdentifier("phoneChat.draft")
                        HStack(spacing:AppleTokens.Space.p4) {
                            plusMenu
                            Menu { Text("手机聊天没有电脑操作，无需审批。"); Text("连上电脑后可选择操作模式。") } label: { PhoneOperationModeIcon().phoneMenuLabel(circle:true,onCard:true) }.phoneIcon().accessibilityLabel("操作模式，手机聊天").accessibilityIdentifier("phoneChat.mode")
                            ServiceModelMenuButton(services:model.services,current:model.modelID,label:model.selectedServiceModel?.name ?? model.currentModel?.model ?? "尚未配置",usesImages:model.conversationUsesImages,thinkingSupported:model.selectedServiceModel?.deepThinking?.supported == true,thinking:$model.thinkingEnabled,select:{service,item in model.selectServiceModel(service,item)},add:{focused=false;modelsOpen=true},refresh:{Task { for service in model.services { await model.refreshService(service) } }},identifier:"phoneChat.model")

                            Spacer(minLength:AppleTokens.Space.p4)
                            if focused { Button { focused=false } label: { WeftIcon("chevron") }.phoneIcon().accessibilityLabel("收起键盘") }
                            if model.busy { Button { model.stop() } label: { WeftIcon("stop") }.phoneIcon().accessibilityLabel("停止回复").accessibilityIdentifier("phoneChat.stop") }
                            Button { model.send() } label: { WeftIcon("send") }.phoneIcon(primary:true).disabled(model.draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && model.attachments.isEmpty).accessibilityLabel(model.busy ? "排队发送" : "发送").accessibilityIdentifier("phoneChat.send")
                        }
                    }.padding(AppleTokens.Space.p12).background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r24)).padding(AppleTokens.Space.p12)
                }
            }.background(Weave.canvas).allowsHitTesting(!sidebar).opacity(sidebar ? 0 : 1).navigationTitle("WeftMate").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement:.principal) { VStack(spacing:AppleTokens.Space.p3) { Text("WeftMate").font(AppleTokens.Fonts.headline); Text("手机自己答的").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) } }
                    ToolbarItem(placement:.topBarLeading) { Button { focused=false; sidebar=true } label: { WeftIcon("sidebar") }.phoneIcon().accessibilityLabel("对话列表").accessibilityIdentifier("phoneChat.sidebar") }
                    ToolbarItem(placement:.topBarTrailing) { PhoneAccountMenu(model:app) }
                }
                .navigationDestination(isPresented:$modelsOpen) { PhoneModelsView(model:model) }
                .overlay(alignment:.leading) { if sidebar { PhoneLocalDrawer(app:app,model:model,tab:$tab,close:{sidebar=false}) } }
        }.fileImporter(isPresented:$importing,allowedContentTypes:[.item],allowsMultipleSelection:true,onCompletion:fileCompletion)
        .photosPicker(isPresented:$photos,selection:$selection,maxSelectionCount:PhoneAttachment.imageCount,matching:.images)
        .onChange(of:selection) { _,items in
            let identity=importAccount,thread=importThread
            Task {
                for item in items {
                    do {
                        if let data=try await item.loadTransferable(type:Data.self),identity == app.phoneAccountIdentity,thread == model.state.selected { addImage(data) }
                    } catch { if identity == app.phoneAccountIdentity,thread == model.state.selected { model.notice="照片没能打开，请重试。" } }
                }
                if identity == app.phoneAccountIdentity,thread == model.state.selected { selection=[] }
            }
        }
        .sheet(isPresented:$camera) {
            let identity=importAccount,thread=importThread
            PhoneStandaloneCamera { data in
                camera=false
                if let data,identity == app.phoneAccountIdentity,thread == model.state.selected { addImage(data) }
            }
        }
        .alert("相机权限没有开启",isPresented:$cameraDenied) {
            Button("去设置") { if let url=URL(string:UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
            Button("取消",role:.cancel) {}
        } message: { Text("在设置里允许 WeftMate 使用相机；照片图库和文件仍可添加。") }
        .fullScreenCover(item:$preview) { attachment in PhoneStandaloneAttachmentPreview(attachment:attachment,close:{preview=nil}) }
        .onChange(of:app.phoneAccountIdentity) { _,_ in preview=nil;camera=false;photos=false;importing=false;selection=[] }
        .onChange(of:model.state.selected) { _,id in if let id { app.openedSessionID=id } }
        .task(id:"\(cloud.cloudAddress)|\(cloud.subject ?? "device-local")") { model.activate(app:app) }
    }
    private var fileCompletion: @Sendable (Result<[URL],Error>) -> Void {
        let identity=importAccount,thread=importThread
        return Self.importCallback { result in
            guard identity == app.phoneAccountIdentity,thread == model.state.selected else { return }
            switch result {
            case .success(let urls):
                var errors: [String]=[]
                for url in urls {
                    let count=model.attachments.count;addFile(url)
                    if model.attachments.count == count,let notice=model.notice,!errors.contains(notice) { errors.append(notice) }
                }
                if !errors.isEmpty { model.notice=errors.joined(separator:"\n") }
            case .failure: model.notice="文件没能打开，请重试。"
            }
        }
    }
    nonisolated private static func importCallback(_ complete: @escaping @MainActor @Sendable (Result<[URL],Error>) -> Void) -> @Sendable (Result<[URL],Error>) -> Void {
        { result in Task { @MainActor in complete(result) } }
    }
    private var plusMenu: some View {
        Menu {
            Button(model.currentModel?.supportsImages == false ? "拍照 · 当前模型看不了图片" : "拍照",image:ImageResource(name:"wm-camera",bundle:.main)) { openCamera() }.disabled(model.currentModel?.supportsImages == false).accessibilityIdentifier("phoneChat.camera")
            Button(model.currentModel?.supportsImages == false ? "照片图库 · 当前模型看不了图片" : "照片图库",image:ImageResource(name:"wm-image",bundle:.main)) { captureScope();photos=true }.disabled(model.currentModel?.supportsImages == false).accessibilityIdentifier("phoneChat.photos")
            Button("文件",image:ImageResource(name:"wm-file",bundle:.main)) { captureScope();importing=true }
        } label: { WeftIcon("plus").phoneMenuLabel(circle:true,onCard:true) }.phoneIcon().disabled(model.attachmentReason != nil)
            .accessibilityLabel(model.attachmentReason ?? "添加图片或文件").accessibilityIdentifier("phoneChat.plus")
    }
    private func attachmentRow(_ attachments: [PhoneAttachment],removable: Bool) -> some View {
        ScrollView(.horizontal,showsIndicators:false) {
            HStack(spacing:AppleTokens.Space.p8) {
                ForEach(attachments) { attachment in
                    PhoneAttachmentBlock(name:attachment.name,image:nil,memoryImage:attachment.isImage ? attachment.data : nil,isImage:attachment.isImage,status:attachment.truncated ? "只读了前一部分" : nil,remove:removable ? {model.removeAttachment(attachment.id)} : nil)
                        .onTapGesture { focused=false;preview=attachment }.accessibilityAction { focused=false;preview=attachment }.accessibilityAddTraits(.isButton).accessibilityLabel("预览 "+attachment.name)
                }
            }
        }
    }
}
struct PhoneLocalDrawer: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: PhoneStandaloneModel
    @Binding var tab: PhoneTab
    var close: () -> Void
    @State private var search=""
    @AppStorage("phone.conversationMode") private var savedMode="chat"
    private var mode: ConversationMode { ConversationMode(rawValue:savedMode) ?? .chat }
    private var modeBinding: Binding<ConversationMode> { Binding(get:{mode},set:{savedMode=$0.rawValue}) }
    var body: some View {
        ZStack(alignment:.leading) {
            Color.black.opacity(0.65).ignoresSafeArea().onTapGesture(perform:close).accessibilityLabel("关闭侧栏")
            VStack(spacing:AppleTokens.Space.p12) {
                HStack { Text("WeftMate").font(AppleTokens.Fonts.headline); Spacer(); PhoneAccountMenu(model:app); Button(action:close) { WeftIcon("deny") }.phoneIcon().accessibilityLabel("关闭侧栏") }.padding(AppleTokens.Space.p16)
                PhoneConversationModes(selection:modeBinding)
                if app.session != nil {
                    Button("打开电脑对话与任务") { app.openedSessionID=nil;close() }
                        .buttonStyle(OutlineActionStyle()).accessibilityIdentifier("phoneChat.computer")
                }
                ScrollView {
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p4) {
                        ForEach(PhoneTab.allCases) { item in
                            Button { tab=item; close() } label: { HStack(spacing:AppleTokens.Space.p12) { WeftIcon(item.icon); Text(item.title); Spacer(minLength:AppleTokens.Space.p0) }.frame(maxWidth:.infinity,minHeight:AppleTokens.Space.p44,alignment:.leading).padding(.horizontal,AppleTokens.Space.p12).background(tab == item ? Weave.accentSoft : .clear,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12)) }.buttonStyle(.plain)
                        }
                        if mode == .work, app.cloudLogin.authenticated, app.offline.hostOffline, app.offline.workSnapshot?.taskRecipient != nil, app.cloudLogin.offlineWorkAuthorization?.supportsTasks == true { PhoneOfflineWork(app:app) }
                        else if mode == .work { Text(WorkAndChat.noComputer).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted).padding(AppleTokens.Space.p12) }
                        else {
                        if app.cloudLogin.multipleComputers { ComputerConversationList(cloud:app.cloudLogin,query:search,close:close) }
                        Text("手机上的对话").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).padding(.horizontal,AppleTokens.Space.p12)
                        ForEach(model.state.threads.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }) { thread in
                            Button { model.select(thread.id); app.openedSessionID=thread.id; close() } label: { HStack(spacing:AppleTokens.Space.p12) { WeftIcon("chat"); Text(thread.title).lineLimit(2); Spacer(minLength:AppleTokens.Space.p0) }.frame(maxWidth:.infinity,minHeight:AppleTokens.Space.p44,alignment:.leading).padding(.horizontal,AppleTokens.Space.p12).background(thread.id == model.state.selected ? Weave.accentSoft : .clear,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12)) }.buttonStyle(.plain)
                        }
                        }
                    }.padding(.horizontal,AppleTokens.Space.p12)
                }
                HStack(spacing:AppleTokens.Space.p8) {
                    HStack { WeftIcon("search"); TextField("搜索对话",text:$search).textFieldStyle(.plain) }.padding(.horizontal,AppleTokens.Space.p12).frame(minHeight:AppleTokens.Space.p44).background(Weave.surface,in:Capsule())
                    Button { model.newThread(); app.openedSessionID=model.state.selected; close() } label: { WeftIcon("plus") }.phoneIcon().accessibilityLabel("新建对话").accessibilityIdentifier("phoneChat.new").disabled(mode == .work)
                }.padding(AppleTokens.Space.p12)
            }.frame(maxWidth:320).background(Weave.soft)
        }.gesture(DragGesture().onEnded { value in if value.translation.width < -50 { close() } })
    }
}
struct PhoneModelsView: View {
    @State private var clearing=false
    @ObservedObject var model: PhoneStandaloneModel
    var body: some View {
        VStack(spacing:AppleTokens.Space.p12) {
            Text("每段对话会多用一次小的模型请求。连上电脑后，由电脑负责记忆。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).padding(.horizontal,AppleTokens.Space.p20)
            ModelServicesSettingsView(store:ModelServiceSettingsModel(app:nil,phone:model))
            Button("清除手机上的模型、对话与记忆") { clearing=true }.buttonStyle(ServiceActionStyle()).padding(.horizontal,AppleTokens.Space.p20).accessibilityIdentifier("phoneModel.clearLocalData")
        }.confirmationDialog("清除这台手机当前账号的模型、对话与记忆？电脑上的内容不受影响。",isPresented:$clearing,titleVisibility:.visible) {
            Button("清除本机内容",role:.destructive) { model.clearLocalData() };Button("取消",role:.cancel) {}
        }
    }
}
struct PhoneModelEditor: View {
    @ObservedObject var model: PhoneStandaloneModel
    var existing: PhoneModelConfiguration? = nil
    var body: some View { ModelServiceEditor(store:ModelServiceSettingsModel(app:nil,phone:model),existing:nil) }
}
struct PhoneComputerEmptyPage: View {
    @ObservedObject var app: AppleAppModel
    var title: String
    var explanation: String
    @State private var devices=false
    var body: some View {
        VStack(spacing:AppleTokens.Space.p20) { EmptyState(symbol:PhoneTab.allCases.first(where: { $0.title == title })?.icon ?? "desktop",title:title,message:explanation+"连上电脑后可用。"); Button("怎么连上电脑") { devices=true }.buttonStyle(OutlineActionStyle()).padding(AppleTokens.Space.p20) }
            .navigationTitle(title).background(Weave.canvas).toolbar { PhoneAccountMenu(model:app) }
            .sheet(isPresented:$devices) { SettingsView(model:app,route:.init(categoryID:"devices"),onClose:{devices=false}) }
    }
}

struct PhoneAccountSettingsContent: View {
    @ObservedObject var cloud: CloudLoginModel
    var body: some View {
        if cloud.authenticated { AccountSettingsView(cloud:cloud) }
        else { AuthView(model:cloud) }
    }
}
