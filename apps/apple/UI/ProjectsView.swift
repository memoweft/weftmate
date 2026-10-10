import SwiftUI
import WeftMateCore
#if os(macOS)
import AppKit
#endif

#if os(macOS)
@MainActor enum ProjectFolderPicker {
    static var panel: NSOpenPanel?
    static func acceptSelection(_ url: URL, app: AppleAppModel) { app.projectEditor?.draft.selectFolder(url) }
    static func choose(app: AppleAppModel) {
        let picker = NSOpenPanel()
        picker.canChooseDirectories = true; picker.canChooseFiles = false; picker.allowsMultipleSelection = false
        picker.prompt = "选择文件夹"; picker.message = "选择这台宿主电脑上的项目文件夹。"
        picker.identifier = NSUserInterfaceItemIdentifier("projectFolderPanel")
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-testing"), args.contains("--lg2-capture"), let i = args.firstIndex(of: "--a11-folder"), args.indices.contains(i + 1) { let folder = URL(fileURLWithPath: args[i + 1]); picker.directoryURL = folder.deletingLastPathComponent(); picker.nameFieldStringValue = folder.lastPathComponent }
        #endif
        panel = picker
        picker.begin { @Sendable response in
            Task { @MainActor in
            if response == .OK, let url = picker.url {
                acceptSelection(url, app: app)
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--ui-testing") { FileHandle.standardOutput.write(Data(("A11_STEP:folder selected " + url.lastPathComponent + "\n").utf8)) }
                #endif
            }
            panel = nil
            }
        }
    }
}
#endif

struct ProjectHeading: View {
    @ObservedObject var app: AppleAppModel
    let project: Project
    @State private var hovering = false
    @FocusState private var rowFocused: Bool
    private var actionSize: CGFloat {
        #if os(macOS)
        AppleTokens.Space.p28
        #else
        AppleTokens.Space.p44
        #endif
    }
    var body: some View {
        HStack(spacing: AppleTokens.Space.p8) {
            Button {
                if app.collapsedProjects.contains(project.id) { app.collapsedProjects.remove(project.id) }
                else { app.collapsedProjects.insert(project.id) }
            } label: {
                HStack(spacing: AppleTokens.Space.p8) {
                    WeftIcon("folder-open", size: 16)
                    Text(project.name).lineLimit(2)
                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel(project.name)
                .accessibilityValue(app.collapsedProjects.contains(project.id) ? "已折叠" : "已展开")
                .accessibilityIdentifier("projectToggle." + project.id)
            #if os(macOS)
            let showActions = hovering || rowFocused
            #else
            let showActions = true
            #endif
            #if os(macOS)
            Group {
                Button { app.beginProject(project) } label: { WeftIcon("more", size: 16).frame(width: actionSize, height: actionSize) }
                    .buttonStyle(.plain).opacity(showActions ? 1 : 0).allowsHitTesting(showActions).accessibilityHidden(!showActions).disabled(!app.canChooseProjectFolder).help(app.canChooseProjectFolder ? "项目设置" : "请在项目所在电脑设置").accessibilityLabel("项目设置 \(project.name)").accessibilityIdentifier("projectSettings." + project.id)
            }
            #endif
            Button { Task { await app.beginProjectConversation(project) } } label: { WeftIcon("plus", size: 16).frame(width: actionSize, height: actionSize) }
                .buttonStyle(.plain).disabled(app.projectBusy).opacity(showActions ? 1 : 0).allowsHitTesting(showActions).accessibilityHidden(!showActions)
                .accessibilityLabel("在项目 \(project.name) 新建对话").accessibilityIdentifier("projectNewConversation." + project.id)
        }.accessibilityElement(children: .contain).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.ink)
            .padding(.vertical, AppleTokens.Space.p6).padding(.horizontal, AppleTokens.Space.p8)
            #if os(macOS)
            .background(hovering || rowFocused ? Weave.line.opacity(0.5) : AppleTokens.Colors.clear, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r8))
            .background(SessionHoverRegion { hovering = $0 }).focusable().focusEffectDisabled().focused($rowFocused)
            #endif
    }
}
struct ProjectsSectionTitle: View {
    @ObservedObject var app: AppleAppModel
    var body: some View {
        HStack {
            Text("项目")
            Spacer()
            #if os(macOS)
            if app.canChooseProjectFolder {
                Button { app.beginProject() } label: { WeftIcon("plus", size: 16) }
                    .buttonStyle(.plain).accessibilityLabel("新建项目").accessibilityIdentifier("newProject")
            } else {
                Text("在电脑上创建").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    .accessibilityIdentifier("projectsCreateOnHost")
            }
            #endif
        }
    }
}
struct ProjectsEmpty: View {
    @ObservedObject var app: AppleAppModel
    var body: some View {
        if let error = app.projectsError { Text(error).foregroundStyle(Weave.muted) }
        else if app.projects.isEmpty {
            Text(app.canChooseProjectFolder ? "添加一个文件夹，开始项目对话。" : "在电脑上添加项目后，可在这里开始对话。")
                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
        }
    }
}

struct ProjectEditorSheet: View {
    @ObservedObject var app: AppleAppModel
    @State private var confirmingRemoval = false
    private var draft: Binding<ProjectDraft> {
        Binding(get: { app.projectEditor?.draft ?? .init() }, set: { app.projectEditor?.draft = $0 })
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                Text(app.projectEditor?.project == nil ? "新建项目" : "项目设置").font(AppleTokens.Fonts.title2)
                if app.projectEditor?.project == nil {
                    Text("一个项目对应电脑上的一个文件夹。项目对话默认在这里读写文件和运行命令。")
                        .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                    #if os(macOS)
                    Button("选择文件夹…") {
                        ProjectFolderPicker.choose(app: app)
                    }.accessibilityIdentifier("projectChooseFolder")
                    // Paths exist only in the transient local creation draft, never the public list.
                    Text(draft.wrappedValue.rootPath.isEmpty ? "尚未选择文件夹" : URL(fileURLWithPath: draft.wrappedValue.rootPath).lastPathComponent)
                        .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("projectSelectedFolder")
                    #endif
                }
                VStack(alignment: .leading, spacing: AppleTokens.Space.p6) {
                    Text("项目名称").font(AppleTokens.Fonts.callout)
                    TextField("项目名称", text: draft.name).accessibilityIdentifier("projectName")
                }
                VStack(alignment: .leading, spacing: AppleTokens.Space.p6) {
                    Text("项目说明").font(AppleTokens.Fonts.callout)
                    TextEditor(text: draft.instructions).frame(minHeight: 120).accessibilityIdentifier("projectInstructions")
                }
                Picker("文件权限", selection: draft.permission) {
                    ForEach(ProjectPermission.allCases, id: \.self) { Text($0.title).tag($0) }
                }.pickerStyle(.segmented).accessibilityIdentifier("projectPermission")
                Text("项目说明会自动带给模型。可写权限仅适用于项目文件夹；危险操作继续按对话审批模式处理。")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                if let error = app.projectError { InlineNotice(message: error, isError: true).accessibilityIdentifier("projectError") }
                HStack {
                    if app.projectEditor?.project != nil {
                        Button("移除项目", role: .destructive) { confirmingRemoval = true }.accessibilityIdentifier("projectRemove")
                    }
                    Spacer()
                    Button("取消") { app.projectEditor = nil }.disabled(app.projectBusy).accessibilityIdentifier("projectCancel")
                    Button(app.projectEditor?.project == nil ? "创建项目" : "保存") { Task { await app.saveProject() } }
                        .disabled(app.projectBusy || !draft.wrappedValue.valid || (app.projectEditor?.project == nil && draft.wrappedValue.rootPath.isEmpty))
                        .accessibilityIdentifier("projectSave")
                }
            }.padding(AppleTokens.Space.p24).frame(maxWidth: 600, alignment: .leading)
        }.background(Weave.surface).foregroundStyle(Weave.ink)
            .accessibilityElement(children: .contain).accessibilityIdentifier("projectEditor")
            .confirmationDialog("移除「\(app.projectEditor?.project?.name ?? "项目")」？", isPresented: $confirmingRemoval, titleVisibility: .visible) {
                Button("移除登记", role: .destructive) { Task { await app.removeProject() } }.accessibilityIdentifier("projectConfirmRemove")
                Button("取消", role: .cancel) {}
            } message: { Text(ProjectPresentation.removalNotice) }
            #if os(macOS)
            .frame(minWidth: 500, idealWidth: 580, minHeight: 500)
            #endif
    }
}

struct ProjectConversationSheet: View {
    @ObservedObject var app: AppleAppModel
    var body: some View {
        #if os(iOS)
        ScrollView { content }.presentationDetents([.medium, .large])
        #else
        content
        #endif
    }
    private var content: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
            Text("在「\(app.projectConversation?.name ?? "项目")」新建对话").font(AppleTokens.Fonts.title2)
            Text("任务将在电脑上的项目文件夹执行。手机只显示项目与对话。")
                .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
            Picker("项目对话使用的电脑模型", selection: $app.projectModelID) {
                ForEach(app.projectModels) { Text($0.name).tag($0.id) }
            }.disabled(app.projectBusy || app.projectCreatedSessionID != nil).accessibilityIdentifier("projectConversationModel")
            Text(app.projectModels.isEmpty ? "请先在电脑配置可用模型。" : app.projectConversation?.permission == .readOnly ? "此项目只读，可阅读与分析资料。" : "可读写项目文件，危险操作仍需审批。")
                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            if app.projectModels.first(where: { $0.id == app.projectModelID })?.deepThinking?.supported == true {
                Toggle("深入思考", isOn: $app.projectThinking).disabled(app.projectBusy).accessibilityIdentifier("draftThinking")
            }
            if let error = app.projectError { InlineNotice(message: error, isError: true) }
            HStack {
                Button("取消") { app.projectConversation = nil }.buttonStyle(OutlineActionStyle()).disabled(app.projectBusy)
                Spacer()
                Button(app.projectBusy ? "正在保存…" : app.projectCreatedSessionID == nil ? "新建对话" : "重试保存") { Task { await app.createProjectConversation() } }
                    .buttonStyle(PrimaryActionStyle(fillsWidth: false)).disabled(app.projectBusy || app.projectModelID.isEmpty).accessibilityIdentifier("projectStartConversation")
            }
        }.padding(AppleTokens.Space.p24).background(Weave.surface).foregroundStyle(Weave.ink)
            .accessibilityElement(children: .contain).accessibilityIdentifier("projectConversationSheet")
            .interactiveDismissDisabled(app.projectBusy)
            #if os(macOS)
            .frame(minWidth: 480, idealWidth: 560)
            #endif
    }
}
