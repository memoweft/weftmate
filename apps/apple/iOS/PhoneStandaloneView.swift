import SwiftUI
import PhotosUI
import AVFoundation
import UniformTypeIdentifiers
import WeftMateCore

struct PhoneStandaloneChat: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: PhoneStandaloneModel
    @ObservedObject private var cloud: CloudLoginModel
    init(app: AppleAppModel, model: PhoneStandaloneModel) { self.app=app; self.model=model; cloud=app.cloudLogin }
    @State private var modelsOpen=false
    @Environment(\.phoneSidebar) private var sidebar
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
    @State private var following = true
    @State private var atLatest = true
    @State private var latestJump = 0
    @State private var queueOpen = false
    @StateObject private var positions = MainChatPositionTracker()
    @FocusState private var focused: Bool
    var body: some View {
        Group {
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
                    messageTimeline
                }
                if let notice=model.notice, !model.models.isEmpty || !model.messages.isEmpty { Text(notice).font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted).padding(.horizontal,AppleTokens.Space.p16) }
            }.safeAreaInset(edge:.bottom,spacing:0) {
                if !model.models.isEmpty {
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                        if !model.attachments.isEmpty { attachmentRow(model.attachments,removable:true) }
                        if model.messages.contains(where: { $0.replyStatus == .queued }) {
                            Button("查看排队消息") { focused=false; queueOpen=true }
                                .font(AppleTokens.Fonts.caption).accessibilityIdentifier("phoneChat.queue")
                        }
                        TextField("接着聊，或者交代一件事…", text:$model.draft, axis:.vertical)
                            .lineLimit(1...5).textFieldStyle(.plain).focused($focused)
                            .accessibilityLabel("聊一聊…").accessibilityIdentifier("phoneChat.draft")
                        HStack(spacing:AppleTokens.Space.p4) {
                            plusMenu
                            Menu { Text("手机聊天没有电脑操作，无需审批。"); Text("连上电脑后可选择操作模式。") } label: { PhoneOperationModeIcon().phoneMenuLabel(circle:true,onCard:true) }.phoneIcon().accessibilityLabel("操作模式，手机聊天").accessibilityIdentifier("phoneChat.mode")
                            ServiceModelMenuButton(services:model.services,current:model.modelID,label:model.selectedServiceModel?.name ?? model.currentModel?.model ?? "尚未配置",usesImages:model.conversationUsesImages,thinkingSupported:model.selectedServiceModel?.deepThinking?.supported == true,thinking:$model.thinkingEnabled,select:{service,item in model.selectServiceModel(service,item)},add:{focused=false;modelsOpen=true},refresh:{Task { for service in model.services { await model.refreshService(service) } }},identifier:"phoneChat.model")

                            Spacer(minLength:AppleTokens.Space.p4)
                            if focused { Button { focused=false } label: { WeftIcon("chevron") }.phoneIcon().accessibilityLabel("收起键盘") }
                            let action = PhoneComposerPrimaryAction.resolve(running:model.busy,draft:model.draft,attachmentCount:model.attachments.count)
                            Button {
                                if action == .stop { model.stop() }
                                else if action == .voice { focused=true }
                                else { model.send() }
                            } label: { WeftIcon(action == .stop ? "stop" : action == .voice ? "mic" : "send") }
                                .phoneIcon(primary:true).accessibilityLabel(action == .stop ? "停止回复" : action == .voice ? "语音输入" : model.busy ? "排队发送" : "发送")
                                .accessibilityIdentifier("phoneChat.send")
                        }
                    }.phoneChatComposer()
                }
            }.background(Weave.canvas).navigationTitle("WeftMate").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement:.principal) { VStack(spacing:AppleTokens.Space.p3) { Text("WeftMate").font(AppleTokens.Fonts.headline); Text("手机自己答的").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) } }
                    ToolbarItem(placement:.topBarLeading) { Button { focused=false; sidebar?() } label: { WeftIcon("sidebar") }.phoneIcon().accessibilityLabel("对话列表").accessibilityIdentifier("phoneChat.sidebar") }
                    ToolbarItem(placement:.topBarTrailing) { PhoneAccountMenu(model:app) }
                }
                .navigationDestination(isPresented:$modelsOpen) { PhoneModelsView(model:model) }
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
        .sheet(isPresented:$queueOpen) {
            ScrollView {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                    ForEach(model.messages.filter { $0.replyStatus == .queued }) { reply in
                        let index=model.messages.firstIndex(where: { $0.id == reply.id })
                        let user=index.flatMap { $0 > 0 ? model.messages[$0-1] : nil }
                        VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                            Text(user?.text ?? "附件消息").lineLimit(5)
                            HStack {
                                Button("修改") { model.withdrawQueued(reply.id,edit:true); queueOpen=false }
                                Spacer()
                                Button("撤回",role:.destructive) { model.withdrawQueued(reply.id,edit:false) }
                            }.frame(minHeight:AppleTokens.Space.p44)
                        }.accessibilityIdentifier("phoneChat.queued."+reply.id)
                        Divider()
                    }
                    if !model.messages.contains(where: { $0.replyStatus == .queued }) { Text("没有排队消息，已开始的回复可以在输入框停止。").foregroundStyle(Weave.muted) }
                }.padding(AppleTokens.Phone.pageInset)
            }.phoneSheet("排队消息",close:{queueOpen=false})
        }
        .onChange(of:app.phoneAccountIdentity) { _,_ in preview=nil;camera=false;photos=false;importing=false;selection=[] }
        .onChange(of:model.state.selected) { _,id in if let id { app.openedSessionID=id } }
        .task(id:"\(cloud.cloudAddress)|\(cloud.subject ?? "device-local")") { model.activate(app:app) }
    }
    private var messageTimeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                    ForEach(model.messages) { message in
                        VStack(alignment:message.role == "user" ? .trailing : .leading,spacing:AppleTokens.Space.p8) {
                            if message.role == "user" {
                                if !message.text.isEmpty {
                                    HStack { Spacer(minLength:AppleTokens.Space.p32)
                                        Text(message.text).textSelection(.enabled).lineSpacing(AppleTokens.Space.p6)
                                            .padding(AppleTokens.Space.p16).background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r16))
                                    }.accessibilityIdentifier("phoneChat.message.user."+message.id)
                                }
                            } else {
                                Text(message.replyStatus == .replying ? "正在回复…" : message.replyStatus == .queued ? "排队中" : message.replyStatus == .failed ? "回复未完成" : "已回复")
                                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                                if !message.text.isEmpty {
                                    MessageBodyView(text:message.text,messageID:message.id,streaming:message.replyStatus == .replying)
                                        .accessibilityIdentifier("phoneChat.message.assistant."+message.id)
                                } else if message.replyStatus == .failed {
                                    Text("这次没回复，可以重试。").foregroundStyle(Weave.muted)
                                }
                            }
                            if let attachments=message.attachments,!attachments.isEmpty { attachmentRow(attachments,removable:false) }
                            if message.role == "assistant", message.replyStatus != .replying && message.replyStatus != .queued {
                                HStack {
                                    if !message.text.isEmpty { Button { UIPasteboard.general.string=message.text } label: { WeftIcon("copy") }.phoneIcon().accessibilityLabel("复制回复").accessibilityIdentifier("phoneChat.copy") }
                                    if message.replyStatus == .failed {
                                        Button { model.retryReply(message.id) } label: { WeftIcon("sync") }.phoneIcon().disabled(model.busy).accessibilityLabel("重试回复").accessibilityIdentifier("phoneChat.retry."+message.id)
                                    } else if message.id == model.messages.last?.id {
                                        Button { model.send(regenerate:true) } label: { WeftIcon("sync") }.phoneIcon().disabled(model.busy).accessibilityLabel("重新生成").accessibilityIdentifier("phoneChat.regenerate")
                                    }
                                }
                            }
                        }.id(message.id)
                    }
                    Color.clear.frame(height:1).id("latest")
                        .background(MainChatEventPosition(eventID:"phone.end") { _, rect, height, user in
                            guard let rect else { return }
                            let distance=max(0,rect.maxY-height)
                            if user,let before=positions.previousEndTop {
                                if rect.minY > before { following=false }
                                else if rect.minY < before { following=distance <= 48 }
                            }
                            positions.previousEndTop=rect.minY
                            atLatest=distance <= 48
                            if following && !user && distance > 0 { proxy.scrollTo("latest",anchor:.bottom) }
                        })
                }.padding(AppleTokens.Phone.pageInset)
            }.scrollDismissesKeyboard(.interactively)
                .simultaneousGesture(DragGesture().onChanged { if $0.translation.height > 0 { following=false } })
                .onChange(of:model.messages.last?.id) { _,_ in if following { proxy.scrollTo("latest",anchor:.bottom) } }
                .onChange(of:model.messages.last?.text) { _,_ in if following { proxy.scrollTo("latest",anchor:.bottom) } }
                .onChange(of:latestJump) { _,_ in following=true; withAnimation { proxy.scrollTo("latest",anchor:.bottom) } }
                .onChange(of:model.state.selected) { _,_ in following=true; proxy.scrollTo("latest",anchor:.bottom) }
                .overlay(alignment:.bottom) { if !following && !atLatest { PhoneLatestReplyButton { latestJump += 1 }.accessibilityIdentifier("phoneChat.latest") } }
                .onAppear { proxy.scrollTo("latest",anchor:.bottom) }
        }.accessibilityIdentifier("phoneChat.timeline")
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
        PhoneActionMenu {
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
