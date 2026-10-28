import SwiftUI
import WeftMateCore
import UniformTypeIdentifiers
import PhotosUI

private struct PhoneWorkAppKey: EnvironmentKey { static let defaultValue: AppleAppModel? = nil }
extension EnvironmentValues {
    var phoneWorkApp: AppleAppModel? {
        get { self[PhoneWorkAppKey.self] }
        set { self[PhoneWorkAppKey.self]=newValue }
    }
}

struct PhoneConversationModes: View {
    @Binding var selection: ConversationMode
    var body: some View {
        HStack(spacing: AppleTokens.Space.p4) {
            ForEach(ConversationMode.allCases, id: \.self) { mode in
                Button { selection = mode } label: {
                    WeftLabel(mode.title, icon: mode.icon)
                        .frame(maxWidth: .infinity, minHeight: AppleTokens.Space.p44)
                        .foregroundStyle(selection == mode ? Weave.ink : Weave.secondary)
                        .background(selection == mode ? Weave.surface : .clear, in: Capsule())
                }.buttonStyle(.plain).accessibilityLabel(mode.title)
                    .accessibilityValue(selection == mode ? "已选择" : "未选择")
                    .accessibilityIdentifier("phone.mode." + mode.rawValue)
            }
        }.padding(AppleTokens.Space.p4).background(Weave.soft, in: Capsule())
            .padding(.horizontal, AppleTokens.Space.p12)
    }
}

struct PhoneWorkSelection: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject private var cloud: CloudLoginModel
    @Binding var projectID: String
    var allowsComputer = true
    init(app: AppleAppModel, projectID: Binding<String>, allowsComputer: Bool = true) {
        self.app = app; cloud = app.cloudLogin; _projectID = projectID; self.allowsComputer = allowsComputer
    }
    var body: some View {
        VStack(spacing:0) {
            if allowsComputer {
                NavigationLink {
                    List {
                        ForEach(cloud.hosts) { host in
                            Button {
                                if (host.hostId ?? host.id) != app.session?.hostId {
                                    projectID=""; Task { await cloud.connectHost(id:host.hostId ?? host.id) }
                                }
                            } label: {
                                HStack {
                                    PhoneChatPageRow(title:host.computerName,subtitle:host.online ? "在线" : "不在线",icon:"desktop")
                                    if (host.hostId ?? host.id) == app.session?.hostId { WeftIcon("allow",size:16) }
                                }
                            }.buttonStyle(.plain).disabled(!host.online).accessibilityIdentifier("phone.work.computer."+host.id)
                        }
                        if cloud.hosts.isEmpty { Text("从设置里添加电脑，再回到这里。") }
                        if let error=cloud.error { Text(error).foregroundStyle(Weave.danger) }
                    }.navigationTitle("选择电脑").toolbar(.visible,for:.navigationBar).background(Weave.grouped)
                } label: { PhoneChatPageRow(title:cloud.selectedComputerName,subtitle:app.offline.hostOffline ? "电脑暂时不在线" : "当前连接的电脑",icon:"desktop") }
                    .accessibilityIdentifier("phone.work.computer")
                Divider()
            }
            NavigationLink {
                PhoneWorkProjects(app:app,projectID:$projectID)
            } label: {
                let project=app.projects.first { $0.id == projectID }
                PhoneChatPageRow(title:project?.name ?? "选择项目或文件夹",subtitle:project.map { "项目 · "+$0.permission.title } ?? "先确定读写范围",icon:"folder")
            }.accessibilityIdentifier("phone.work.project")
        }.buttonStyle(.plain).padding(.horizontal,AppleTokens.Space.p16)
            .background(Weave.surface,in:RoundedRectangle(cornerRadius:AppleTokens.Phone.groupRadius))
    }
}
private struct PhoneWorkProjects: View {
    @ObservedObject var app: AppleAppModel
    @Binding var projectID: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        List {
            Section("项目与读写范围") {
                ForEach(app.projects.filter { !$0.revoked }) { project in
                    Button { projectID=project.id; dismiss() } label: {
                        HStack {
                            PhoneChatPageRow(title:project.name,subtitle:project.permission.title,icon:"folder")
                            if project.id == projectID { WeftIcon("allow",size:16) }
                        }
                    }.buttonStyle(.plain).accessibilityIdentifier("phone.work.project."+project.id)
                }
            }
            Section {
                Text("工作只使用所选项目的文件范围，危险操作继续询问。项目在电脑上创建和管理。")
                    .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                if app.projects.isEmpty { Button("刷新项目") { Task { await app.refresh() } } }
                if let error=app.projectsError { Text(error).foregroundStyle(Weave.danger) }
            }
        }.navigationTitle("选择项目").toolbar(.visible,for:.navigationBar).background(Weave.grouped)
    }
}

struct PhoneNewConversation: View {
    @ObservedObject var app: AppleAppModel
    var mode: ConversationMode
    @ObservedObject private var catalogue: MainChatModel
    init(app: AppleAppModel, mode: ConversationMode, initialProjectID:String = "") { self.app=app; self.mode=mode; catalogue=app.mainChat; _projectID=State(initialValue:initialProjectID) }
    @State private var files: [ConversationAttachmentDraft] = []
    @State private var importing=false
    @State private var camera=false
    @State private var photos=false
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var importEpoch: UUID?
    @State private var dictation=false
    private var text: String {
        get { app.phoneNewConversationDraft }
        nonmutating set { app.phoneNewConversationDraft=newValue }
    }
    @State private var projectID = ""
    @State private var modelsOpen = false
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool
    private var canWork: Bool { WorkAndChat.canCreateWork(connected: app.session?.verification == .verified && !app.offline.hostOffline && !app.cloudLogin.selectedComputerUnavailable, taskAvailable: app.executionAccount) }
    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            if mode == .chat {
                PhoneChatHeader(title:"新建对话", status:"由 " + app.cloudLogin.selectedComputerName + " 回答") { EmptyView() }
            }
            if mode == .work {
                ScrollView {
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                        Text("开始一件工作").font(AppleTokens.Fonts.largeTitle.bold())
                        Text("先选好电脑和项目，再交代事情。").foregroundStyle(Weave.muted)
                        Text("这次在哪里做").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        PhoneWorkSelection(app:app,projectID:$projectID)
                        composer
                        Text("开始工作后，这段对话保持工作模式；想纯聊天可以另开一段。")
                            .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
                        Button { focused=false; Task { await send() } } label: { Text(busy ? "正在开始…" : "开始工作").frame(maxWidth:.infinity) }
                            .buttonStyle(PrimaryActionStyle()).disabled(busy || !canWork || !app.projects.contains { $0.id == projectID } || text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && files.isEmpty)
                            .accessibilityIdentifier("phone.work.start")
                        if !canWork {
                            Text(WorkAndChat.noComputer).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                            if WorkAndChat.offlineWorkAvailable(snapshot:app.offline.workSnapshot,authorization:app.cloudLogin.offlineWorkAuthorization,authenticated:app.cloudLogin.authenticated) { PhoneOfflineWork(app:app) }
                        }
                        if let error { Text(error).foregroundStyle(Weave.danger) }
                    }.padding(AppleTokens.Phone.pageInset)
                }
            } else {
                Spacer()
                VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                    Text("从这里开始聊").font(AppleTokens.Fonts.title2)
                    Text("问问题、查资料，或说说你的想法。").foregroundStyle(Weave.muted)
                    if let error { Text(error).foregroundStyle(Weave.danger) }
                }.padding(AppleTokens.Phone.pageInset).frame(maxWidth:.infinity,alignment:.leading)
                Spacer()
            }

        }.safeAreaInset(edge:.bottom,spacing:0) { if mode == .chat { composer } }
            .background(mode == .work ? Weave.grouped : Weave.canvas)
            .navigationTitle("").navigationBarTitleDisplayMode(.inline)
            .toolbar(mode == .work ? .visible : .hidden, for: .navigationBar)
            .fileImporter(isPresented:$importing,allowedContentTypes:[.item],allowsMultipleSelection:true,onCompletion:importCallback)
            .photosPicker(isPresented:$photos,selection:$photoSelection,maxSelectionCount:4,matching:.images)
            .onChange(of:photoSelection) { _,items in
                let epoch=importEpoch
                Task {
                    for item in items {
                        guard epoch == app.accountEpoch else { return }
                        if let data=try? await item.loadTransferable(type:Data.self) {
                            let url=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString+".jpg")
                            do { try data.write(to:url); addFiles([url]); try? FileManager.default.removeItem(at:url) } catch { self.error="照片没能打开，请重试。" }
                        }
                    }
                    photoSelection=[]
                }
            }
            .onChange(of:app.accountEpoch) { _,_ in files.forEach { $0.removeTemporaryFiles() };files=[];text="";importing=false;photos=false }
            .sheet(isPresented:$camera) { ComposerCamera { url in camera=false; if let url,importEpoch == app.accountEpoch { addFiles([url]);try? FileManager.default.removeItem(at:url) } } }
            .sheet(isPresented: $modelsOpen) { SettingsView(model: app, route: .init(categoryID: "models"), onClose: { modelsOpen = false }) }
            .onChange(of: app.session?.hostId) { _, _ in projectID = "" }
    }
    private var composer: some View {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                    if !files.isEmpty {
                        ScrollView(.horizontal) { HStack {
                            ForEach(files) { file in PhoneAttachmentBlock(name:file.original.name,image:file.original.isImage ? file.file : nil,isImage:file.original.isImage,status:nil,remove:{ file.removeTemporaryFiles(); files.removeAll { $0.id == file.id } }) }
                        } }
                    }
                    TextField(mode == .chat ? "聊一聊…" : "让电脑做什么…", text: $app.phoneNewConversationDraft, axis: .vertical)
                        .lineLimit(1...5).focused($focused).accessibilityIdentifier("phone.new.text")
                    composerTools
                }.phoneChatComposer()
    }
    private var composerTools: some View {
                    HStack {
                        PhoneActionMenu {
                            if UIImagePickerController.isSourceTypeAvailable(.camera) { Button("拍照") { focused=false;importEpoch=app.accountEpoch;camera=true } }
                            Button("照片图库") { focused=false;importEpoch=app.accountEpoch;photos=true }
                            Button("选择文件") { focused=false;importEpoch=app.accountEpoch;importing=true }
                        } label: { WeftIcon("plus").phoneMenuLabel(circle:true,onCard:true) }.phoneIcon().accessibilityLabel("添加").accessibilityIdentifier("phone.new.plus")
                        ApprovalModeControl(model:app,sessionID:nil,compact:true)
                        if app.modelServicesSupported == true {
                        ServiceModelMenuButton(services: app.modelServices, current: app.mainChat.modelID,
                            label: app.mainChat.modelID, usesImages: false, thinkingSupported: false, thinking: .constant(false),
                            select: { service, item in Task { await app.chooseServiceModel(service, item, conversation: nil) } },
                            add: { modelsOpen = true }, refresh: { Task { await app.refreshServiceMenus() } }, identifier: "phone.new.model")
                        } else {
                            Menu {
                                ForEach(catalogue.models.filter(\.configured)) { item in
                                    Button { catalogue.modelID=item.id } label: {
                                        if item.id == catalogue.modelID { Label(item.name,systemImage:"checkmark") } else { Text(item.name) }
                                    }
                                }
                                Button("添加模型服务…") { modelsOpen=true }
                            } label: { WeftIcon("model").phoneMenuLabel(circle:true,onCard:true) }.phoneIcon().accessibilityLabel("模型选择").accessibilityIdentifier("phone.new.model")
                        }
                        Spacer()
                        if mode == .chat {
                        Button { if text.isEmpty && files.isEmpty { focused=true;dictation=true } else { focused = false; Task { await send() } } } label: { WeftIcon(busy ? "stop" : text.isEmpty && files.isEmpty ? "mic" : "send") }
                            .phoneIcon(primary: true).disabled(busy || catalogue.modelID.isEmpty || mode == .work && !app.projects.contains { $0.id == projectID })
                            .accessibilityLabel(text.isEmpty && files.isEmpty ? "语音输入" : "发送").accessibilityIdentifier("phone.new.send")
                            .popover(isPresented:$dictation) { Text("使用系统听写输入文字").padding(AppleTokens.Space.p16).presentationCompactAdaptation(.popover) }
                        }
                    }
    }
    private var importCallback: @Sendable (Result<[URL],Error>) -> Void {
        let epoch=importEpoch
        return Self.fileCallback { result in
            guard epoch == app.accountEpoch else { return }
            if case .success(let urls)=result { addFiles(urls) }
            else if case .failure=result { error="文件没能打开，请重试。" }
        }
    }
    nonisolated private static func fileCallback(_ complete: @escaping @MainActor @Sendable (Result<[URL],Error>) -> Void) -> @Sendable (Result<[URL],Error>) -> Void {
        { @Sendable result in Task { @MainActor in complete(result) } }
    }
    private func addFiles(_ urls: [URL]) {
        do {
            guard files.count+urls.count <= 4 else { error="每条消息最多添加 4 个附件。";return }
            for url in urls { files.append(try ConversationAttachmentDraft.prepare(file:url)) }
        } catch { self.error="附件未添加，请重试。" }
    }
    private func send() async {
        busy = true; defer { busy = false }
        let draft = text, epoch = app.accountEpoch
        app.openedSessionID = nil
        app.phoneCreatingWork = mode == .work
        defer { app.phoneCreatingWork = false }
        if mode == .work {
            guard let project = app.projects.first(where: { $0.id == projectID }), canWork else { return }
            await app.beginProjectConversation(project)
            if app.projectModels.contains(where: { $0.id == app.mainChat.modelID }) { app.projectModelID = app.mainChat.modelID }
            // The selection remains in the composer; the existing creation flow owns retries and receipts.
            await app.createProjectConversation()
        } else { await app.mainChat.createSide(fresh: true) }
        guard app.accountEpoch == epoch, let id = app.openedSessionID,
              let row = app.conversations.first(where: { $0.id == id }) else { error = app.projectError ?? app.mainChat.error ?? "还没能新建，请重试。"; return }
        await app.open(row)
        guard app.accountEpoch == epoch else { return }
        guard app.transferComposer(from:nil,to:row,text:draft,files:files,epoch:epoch) else { error="草稿还没能接着发送，请重试。";return }
        text = ""; files=[]
        await app.send(row, accountEpoch: epoch)
    }
}

struct PhoneWorkDirectoryLine: View {
    @ObservedObject var app: AppleAppModel
    var row: ConversationSummary
    var body: some View {
        NavigationLink {
            PhoneWorkProjects(app:app,projectID:Binding(get:{row.projectId ?? ""},set:{ id in Task { await app.updateMetadata(row,projectID:id,changeProject:true) } }))
        } label: { PhoneChatPageRow(title:row.projectName ?? "选择项目",subtitle:"工作 · "+app.cloudLogin.selectedComputerName,icon:"folder") }
            .buttonStyle(.plain).disabled(row.running || app.lifecycleBusy || row.taskAvailable == false)
            .padding(.horizontal,AppleTokens.Space.p12)

    }
}

struct PhoneWorkSwitchCard: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: TaskInteractionModel
    var approval: SessionApproval
    @State private var projectID = ""
    private var key: String { "approval:" + approval.id }
    private func decide(accept: Bool) async {
        await model.switchToWork(approval,capabilities:app.mainChat.capabilities,project:app.projects.first { $0.id == projectID },accept:accept)
        if model.isRegistered(key) { await app.refresh() }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
            Text("这件事需要在电脑上做。要切换到工作吗？").font(AppleTokens.Fonts.headline)
            Text("由 " + app.cloudLogin.selectedComputerName + " 接着做，保留这段对话。电脑操作仍会按原来的权限询问。")
                .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
            if app.offline.hostOffline {
                Text("需要一台在线的电脑").foregroundStyle(Weave.muted)
                if app.cloudLogin.authenticated, app.offline.workSnapshot?.taskRecipient != nil, app.cloudLogin.offlineWorkAuthorization?.supportsTasks == true { PhoneOfflineWork(app:app) }
            }
            else { PhoneWorkSelection(app: app, projectID: $projectID, allowsComputer: false) }
            HStack {
                Spacer()
                Button("继续对话") { Task { await decide(accept:false) } }.buttonStyle(OutlineActionStyle())
                    .disabled(!model.canRespond(key)).accessibilityIdentifier("phone.work.reject")
                Button("切换到工作") { Task { await decide(accept:true) } }
                    .buttonStyle(PrimaryActionStyle()).disabled(!model.canRespond(key) || app.offline.hostOffline || !app.projects.contains { $0.id == projectID })
                    .accessibilityIdentifier("phone.work.accept")
            }
            if let error = model.errors[key] { Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger) }
            if model.hasSaved(key) { Button("核对并继续原提交") { Task { await model.continueOriginal(key); await app.refresh() } } }
        }.padding(AppleTokens.Space.p16).background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r24))
            .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r24).strokeBorder(Weave.line))
            .accessibilityElement(children: .contain).accessibilityIdentifier("phone.work.switchCard")
    }
}
