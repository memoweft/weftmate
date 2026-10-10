import SwiftUI
import WeftMateCore

struct SessionActions: View {
    @ObservedObject var app: AppleAppModel
    let conversation: ConversationSummary
    var onSelect: () -> Void = {}
    var onDelete: (() -> Void)?
    var body: some View {
        if !conversation.isMainChat, conversation.sessionId != nil {
            if app.mainChat.capabilities.supports("temporaryChats") { TemporaryChatMenu(app: app, conversation: conversation) }

            ForEach(SessionMenuAction.allCases, id: \.self) { action in
                if action == .project {
                    Menu("移至项目", image: ImageResource(name: "wm-folder", bundle: .main)) {
                        Text(ProjectPresentation.moveNotice)
                        ForEach(app.projects) { project in
                            Button(project.name) { onSelect(); Task { await app.updateMetadata(conversation, projectID: project.id, changeProject: true) } }
                                .accessibilityIdentifier("sessionProject." + project.id)
                        }
                        Button("移出项目") { onSelect(); Task { await app.updateMetadata(conversation, changeProject: true) } }
                            .disabled(conversation.projectId == nil).accessibilityIdentifier("sessionProject.none")
                    }.disabled(app.lifecycleBusy || conversation.running).accessibilityIdentifier("sessionAction.project")
                    #if os(macOS)
                    .menuStyle(.borderlessButton).foregroundStyle(Weave.ink).fixedSize()
                    #endif
                } else if action == .group {
                    Menu("移至分组", image: ImageResource(name: "wm-list", bundle: .main)) {
                        ForEach(app.sessionGroups) { group in
                            Button(group.name) { onSelect(); Task { await app.updateMetadata(conversation, groupID: group.id, changeGroup: true) } }
                        }
                        Button("新建分组…") {
                            let deferSheet = app.sessionMenuCandidate != nil
                            onSelect()
                            Task { if deferSheet { try? await Task.sleep(for: .milliseconds(350)) }; app.newGroupName = ""; app.groupCandidate = conversation }
                        }
                        Button("移出分组") { onSelect(); Task { await app.updateMetadata(conversation, changeGroup: true) } }
                            .disabled(conversation.groupId == nil)
                    }.disabled(app.lifecycleBusy)
                    #if os(macOS)
                    .menuStyle(.borderlessButton).foregroundStyle(Weave.ink).fixedSize()
                    #endif
                } else {
                    Button(role: action == .delete ? .destructive : nil) { perform(action) } label: { Label(action.title(for: conversation), image: "wm-" + action.menuIcon) }
                        .keyboardShortcut(KeyEquivalent(Character(action.shortcut!)), modifiers: [])
                        .disabled(app.lifecycleBusy || (action == .fork && conversation.running))
                        .accessibilityIdentifier("sessionAction." + action.rawValue)
                        #if os(macOS)
                        .foregroundStyle(action == .delete ? Weave.danger : Weave.ink)
                        #endif
                }
            }
        }
    }
    private func perform(_ action: SessionMenuAction) {
        if action == .delete, app.sessionMenuCandidate != nil {
            onSelect(); Task { try? await Task.sleep(for: .milliseconds(350)); app.askToDelete(conversation) }; return
        }
        if action == .delete, let onDelete { onDelete(); return }
        onSelect()
        switch action {
        case .pin: Task { await app.updateMetadata(conversation, pinned: !conversation.pinned) }
        case .unread: Task { await app.updateMetadata(conversation, unread: !conversation.unread) }
        case .rename: app.beginRename(conversation)
        case .fork: Task { await app.fork(conversation) }
        case .archive: Task { await app.archive(conversation, archived: !conversation.archived) }
        case .delete: app.askToDelete(conversation)
        case .project, .group: break
        }
    }
}
struct EditableSessionRow: View {
    @ObservedObject var app: AppleAppModel
    let conversation: ConversationSummary
    var selected = false
    @FocusState private var editing: Bool
    @State private var hovering = false
    @FocusState private var rowFocused: Bool
    var body: some View {
        Group {
            if app.renamingSessionID == conversation.id {
                HStack {
                    TextField("对话名称", text: $app.sessionTitleDraft)
                        .focused($editing).onSubmit { Task { await app.saveSessionTitle(conversation) } }
                        .accessibilityIdentifier("sessionRename." + conversation.id)
                    Button("保存") { Task { await app.saveSessionTitle(conversation) } }.disabled(app.lifecycleBusy)
                    Button("取消") { app.renamingSessionID = nil }
                        #if os(macOS)
                        .keyboardShortcut(.cancelAction)
                        #endif
                }.onAppear { editing = true }
            } else {
                HStack {
                    #if os(macOS)
                    Text((conversation.temporaryState.notice().isEmpty ? "" : "临时对话 · ") + conversation.title)
                        .font(AppleTokens.Fonts.body).lineLimit(1).foregroundStyle(Weave.ink)
                        .padding(.leading, conversation.projectId == nil ? AppleTokens.Space.p0 : AppleTokens.Space.p24)
                        .accessibilityIdentifier("conversationRow." + conversation.id)
                    #else
                    ConversationRow(conversation: conversation, selected: selected)
                    #endif
                    Spacer(minLength: AppleTokens.Space.p4)
                    #if os(macOS)
                    if hovering || rowFocused {
                        Button { Task { await app.updateMetadata(conversation, pinned: !conversation.pinned) } } label: { WeftIcon("pin", size: 16) }
                            .buttonStyle(.plain).disabled(app.lifecycleBusy)
                            .help(conversation.pinned ? "取消置顶聊天" : "置顶聊天")
                            .accessibilityLabel(conversation.pinned ? "取消置顶" : "置顶").accessibilityValue(conversation.pinned ? "已开启" : "已关闭")
                            .accessibilityIdentifier("sessionPin." + conversation.id)
                        Button { Task { await app.archive(conversation, archived: true) } } label: { WeftIcon("archive", size: 16) }
                            .buttonStyle(.plain).disabled(app.lifecycleBusy).help("归档聊天")
                            .accessibilityLabel("归档").accessibilityIdentifier("sessionArchive." + conversation.id)
                    } else if conversation.running {
                        ProgressView().controlSize(.mini).accessibilityLabel("正在处理")
                    } else if conversation.unread {
                        Circle().fill(Weave.accent).frame(width: AppleTokens.Space.p6, height: AppleTokens.Space.p6).accessibilityLabel("未读")
                    }
                    #endif
                }
                #if os(macOS)
                .background(SessionHoverRegion(changed: { hovering = $0; if !$0, app.hoveredSession?.id == conversation.id { app.hoveredSession = nil } }).withContextMenu { MacSessionMenu.make(app: app, conversation: conversation) })
                .focusable().focusEffectDisabled().focused($rowFocused)
                .task(id: hovering || rowFocused) {
                    guard hovering || rowFocused else { app.hoveredSession = nil; return }
                    do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
                    if hovering || rowFocused { app.hoveredSession = conversation }
                }
                .padding(.horizontal, AppleTokens.Space.p8).padding(.vertical, AppleTokens.Space.p6)
                .background(selected || hovering || rowFocused ? Weave.line.opacity(0.5) : AppleTokens.Colors.clear, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r8))
                .background(SessionHintPresenter(showing: app.hoveredSession?.id == conversation.id,
                    row: conversation, device: app.cloudLogin.hosts.first { $0.hostId == conversation.hostId }?.name ?? "当前连接的电脑", appearance: app.appearanceMode))
                .onDisappear { if app.hoveredSession?.id == conversation.id { app.hoveredSession = nil } }
                #endif
                #if os(iOS)
                .contextMenu { SessionActions(app: app, conversation: conversation) }
                #endif
            }
        }
    }
}
struct ForgetPreviewList: View {
    let preview: ForgetPreview?
    let loading: Bool
    let error: String?
    var conversation = false
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p10) {
            if loading { ProgressView("正在读取将一起忘掉的记忆…") }
            if let error { InlineNotice(message: error, isError: true) }
            if let preview {
                Text(conversation ? preview.conversationSummary : preview.summary).font(AppleTokens.Fonts.headline).accessibilityIdentifier("forgetPreviewSummary")
                ForEach(preview.items, id: \.identity) { item in Text(item.summary).accessibilityIdentifier("forgetPreviewItem." + item.id) }
            }
        }
    }
}
struct OriginalSnippetsOption: View {
    @Binding var checked: Bool
    var body: some View {
        Button { checked.toggle() } label: {
            HStack(spacing: AppleTokens.Space.p12) {
                ZStack {
                    RoundedRectangle(cornerRadius: AppleTokens.Radius.r8).strokeBorder(Weave.line)
                    if checked { WeftIcon("allow", size: 16).foregroundStyle(Weave.accent) }
                }.frame(width: 24, height: 24)
                Text("同时删除对话里含这句话的原话").multilineTextAlignment(.leading)
            }.contentShape(Rectangle())
        }.buttonStyle(.plain).foregroundStyle(Weave.ink)
            .accessibilityLabel("同时删除对话里含这句话的原话")
            .accessibilityValue(checked ? "已勾选" : "未勾选")
            .accessibilityIdentifier("deleteConversationSnippets")
    }
}
struct SessionDeleteSheet: View {
    @ObservedObject var app: AppleAppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                Text("删除对话？").font(AppleTokens.Fonts.title2)
                Text(app.deletionCandidate?.projectId != nil ? "这会永久删除对话与执行记录，项目文件夹里的文件不会删除。运行中的对话会先停止。" : "这会永久删除对话、工作目录与经验，无法恢复。运行中的对话会先停止。")
                Button { Task { await app.setConversationForget(!app.forgetConversationMemories) } } label: {
                    HStack(spacing: AppleTokens.Space.p12) {
                        ZStack {
                            RoundedRectangle(cornerRadius: AppleTokens.Radius.r8).strokeBorder(Weave.line)
                            if app.forgetConversationMemories { WeftIcon("allow", size: 16).foregroundStyle(Weave.accent) }
                        }.frame(width: 24, height: 24)
                        Text("同时忘掉从这段对话形成的记忆").multilineTextAlignment(.leading)
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain).foregroundStyle(Weave.ink)
                    .accessibilityLabel("同时忘掉从这段对话形成的记忆")
                    .accessibilityValue(app.forgetConversationMemories ? "已勾选" : "未勾选")
                    .accessibilityIdentifier("forgetConversationMemories").disabled(app.lifecycleBusy)
                if app.forgetConversationMemories {
                    ForgetPreviewList(preview: app.conversationForget.preview, loading: app.conversationPreviewLoading, error: nil, conversation: true)
                    OriginalSnippetsOption(checked: $app.conversationForget.deleteConversationSnippets).disabled(app.lifecycleBusy)
                    Button("重新读取遗忘范围") { Task { await app.setConversationForget(true) } }.disabled(app.lifecycleBusy || app.conversationPreviewLoading)
                }
                if let error = app.lifecycleError { InlineNotice(message: error, isError: true) }
                HStack {
                    Button("取消") { app.deletionCandidate = nil }.buttonStyle(OutlineActionStyle()).disabled(app.lifecycleBusy)
                    Button(app.lifecycleBusy ? "正在删除…" : "永久删除", role: .destructive) { Task { await app.deleteConversation() } }
                        .buttonStyle(OutlineActionStyle(destructive: true)).disabled(!app.canDeleteConversation).accessibilityIdentifier("confirmDeleteConversation")
                        #if os(macOS)
                        .foregroundStyle(Weave.danger)
                        #endif
                }
            }.padding(AppleTokens.Space.p24).frame(maxWidth: 600, alignment: .leading)
        }.background(Weave.surface)
        #if os(macOS)
        .frame(minWidth: AppleTokens.Space.p44 * 10, idealWidth: AppleTokens.Space.p32 * 18)
        .frame(height: app.forgetConversationMemories ? AppleTokens.Space.p24 * 20 : AppleTokens.Space.p24 * 10)
        #endif
    }
}
struct SessionGroupSheet: View {
    @ObservedObject var app: AppleAppModel
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
            Text("新建分组").font(AppleTokens.Fonts.title2)
            TextField("分组名称", text: $app.newGroupName).accessibilityIdentifier("sessionGroupName")
            if let error = app.lifecycleError { InlineNotice(message: error, isError: true) }
            HStack {
                Button("取消") { app.groupCandidate = nil }
                Button("创建并移入") { Task { await app.createGroupAndMove() } }.disabled(app.lifecycleBusy)
            }
        }.padding(AppleTokens.Space.p24).frame(maxWidth: 600)
    }
}
struct ArchivedSessionsView: View {
    @ObservedObject var app: AppleAppModel
    @State private var search = ""
    private var rows: [ConversationSummary] { app.conversations.filter { $0.archived && (search.isEmpty || $0.title.localizedCaseInsensitiveContains(search)) } }
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
            TextField("搜索已归档对话", text: $search).accessibilityIdentifier("archivedSearch")
                .weaveField().padding(.horizontal, AppleTokens.Space.p16)
            if let error = app.lifecycleError { InlineNotice(message: error, isError: true) }
            if let error = app.conversationsError { InlineNotice(message: error, isError: true) }
            List {
                ForEach(rows) { row in
                    HStack {
                        Text(row.title)
                        Spacer()
                        Button("恢复") { Task { await app.archive(row, archived: false) } }.accessibilityIdentifier("restoreArchived." + row.id)
                        Button("删除", role: .destructive) { app.askToDelete(row, inSettings: true) }.accessibilityIdentifier("deleteArchived." + row.id)
                            #if os(macOS)
                            .foregroundStyle(Weave.danger)
                            #endif
                    }.buttonStyle(.borderless).disabled(app.lifecycleBusy)
                }
                if rows.isEmpty { Text("没有已归档对话。").foregroundStyle(Weave.muted) }
            }.scrollContentBackground(.hidden)
        }.background(Weave.canvas).task { await app.refresh() }.accessibilityElement(children: .contain).accessibilityIdentifier("archivedSessions")
        // The settings scene or phone settings sheet owns this confirmation.
        .sheet(item: Binding(get: { app.deletionInSettings ? app.deletionCandidate : nil }, set: { app.deletionCandidate = $0 })) { _ in SessionDeleteSheet(app: app) }
    }
}

/// A sheet contains controls, unlike an AppKit/UIKit context menu that draws its own rows.
struct SessionMenuRowStyle: ButtonStyle {
    @State private var hovering = false
    @Environment(\.isEnabled) private var enabled
    private var rowHeight: CGFloat {
        #if os(macOS)
        AppleTokens.Space.p32
        #else
        AppleTokens.Space.p44
        #endif
    }
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, AppleTokens.Space.p8).frame(minHeight: rowHeight)
            .background(configuration.isPressed ? Weave.line : hovering ? Weave.soft : AppleTokens.Colors.clear, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r8))
            .opacity(enabled ? 1 : AppleTokens.Opacity.disabled)
            .onHover { hovering = $0 }
    }
}

private extension SessionMenuAction {
    var menuIcon: String {
        switch self { case .pin: "pin"; case .unread: "mail"; case .rename: "edit"; case .fork: "chat"; case .project: "folder"; case .group: "list"; case .archive: "archive"; case .delete: "trash" }
    }
}
