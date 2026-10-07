import SwiftUI
import WeftMateCore
#if os(iOS)
import UIKit
#endif

struct ConversationListContent: View {
    @ObservedObject var model: AppleAppModel
    @Binding var search: String

    var filtered: [ConversationSummary] {
        guard !search.isEmpty else { return model.conversations }
        return model.conversations.filter { $0.title.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        Group {
            if let cachedAt = model.conversationsCachedAt {
                Text("本机缓存 · \(cachedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(Weave.muted)
            }
            if model.refreshing && model.conversations.isEmpty {
                HStack { ProgressView(); Text("正在读取原会话…").foregroundStyle(Weave.muted) }
                    .padding(.vertical, 18)
            } else if let error = model.conversationsError {
                VStack(alignment: .leading, spacing: 12) {
                    InlineNotice(message: error, isError: true)
                    Button("重新连接") { Task { await model.refresh() } }
                        .disabled(model.refreshing)
                }.padding(.vertical, 10)
            } else if model.conversations.isEmpty {
                Text("这个账户还没有已同步的对话。")
                    .font(.callout).foregroundStyle(Weave.muted).padding(.vertical, 18)
            } else if filtered.isEmpty {
                Text("没有找到相关对话。")
                    .font(.callout).foregroundStyle(Weave.muted).padding(.vertical, 18)
            }
        }
    }
}

struct ConversationRow: View {
    let conversation: ConversationSummary
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(conversation.title.isEmpty ? "未命名对话" : conversation.title)
                    .font(.body.weight(.medium)).foregroundStyle(Weave.ink).lineLimit(2)
                if conversation.running {
                    Circle().fill(Weave.accent).frame(width: 6, height: 6)
                        .accessibilityLabel("正在处理")
                }
            }
            Text(conversation.originalModelLabel ?? "已同步的原会话")
                .font(.caption).foregroundStyle(Weave.muted).lineLimit(1)
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("conversationRow.\(conversation.id)")
    }
}

struct ConversationView: View {
    @ObservedObject var model: AppleAppModel
    let conversation: ConversationSummary
    @FocusState private var draftFocused: Bool
    @State private var visibleMessageID: String?
    @State private var previousTailID: String?
    @State private var composerIdentity = UUID()

    private var draft: Binding<String> {
        let accountEpoch = model.accountEpoch
        return Binding(get: { model.draftText(for: conversation, accountEpoch: accountEpoch) },
                       set: { model.setDraft($0, for: conversation, accountEpoch: accountEpoch) })
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    if let cachedAt = model.historyCachedAt {
                        Text("离线记录 · \(cachedAt.formatted(date: .abbreviated, time: .shortened))，等待核对最新状态。")
                            .font(.caption).foregroundStyle(Weave.muted)
                            .accessibilityIdentifier("cachedHistoryNotice")
                    }
                    if model.historyBusy && model.messages.isEmpty {
                        HStack(spacing: 10) {
                            ProgressView().controlSize(.small)
                            Text("正在读取原会话…").font(.callout).foregroundStyle(Weave.muted)
                        }.padding(.vertical, 24).frame(maxWidth: .infinity)
                    }
                    if let error = model.historyError {
                        InlineNotice(message: error, isError: true)
                        Button("重新读取") { Task { await model.open(conversation) } }
                            .buttonStyle(.bordered)
                    }
                    if !model.historyBusy && model.messages.isEmpty {
                        EmptyState(symbol: "text.bubble", title: "还没有消息",
                                   message: "这段原会话还没有可显示的文字记录。")
                            .frame(minHeight: 240)
                    }
                    ForEach(model.messages) { message in
                        MessageView(message: message).id(message.id)
                    }
                    if let sessionId = model.taskSessionID(for: conversation, accountEpoch: model.accountEpoch),
                       let hostId = model.session?.hostId {
                        ConversationTaskOverviewView(appModel: model, conversation: conversation, hostId: hostId, sessionId: sessionId)
                            .id(sessionId + ":" + hostId + ":" + model.accountEpoch.uuidString)
                    }
                    commandStatusCards
                    adoptionStatusCards
                    Color.clear.frame(height: 1).id("latest")
                }
                .scrollTargetLayout()
                .padding(.horizontal, 24).padding(.vertical, 26)
                .frame(maxWidth: 760).frame(maxWidth: .infinity)
            }
            .scrollPosition(id: $visibleMessageID, anchor: .bottom)
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .safeAreaInset(edge: .bottom, spacing: 0) { composer.id(composerIdentity) }
            .onChange(of: model.messages.count) { _, _ in
                let oldTail = previousTailID
                previousTailID = model.messages.last?.id
                // Follow new messages only when already at the end; preserve reading position otherwise.
                if !draftFocused, previousTailID != nil,
                   oldTail == nil || visibleMessageID == "latest" || visibleMessageID == oldTail {
                    proxy.scrollTo("latest", anchor: .bottom)
                }
            }
        }
        .background(Weave.surface)
        .navigationTitle(conversation.title.isEmpty ? "原会话" : conversation.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .primaryAction) {
                PhoneAccountMenu(model: model)
            }
            #endif
            ToolbarItem(placement: .primaryAction) {
                let accountEpoch = model.accountEpoch
                if let sessionID = model.taskSessionID(for: conversation, accountEpoch: accountEpoch),
                   let hostID = model.session?.hostId {
                    NavigationLink {
                        if model.taskSessionID(for: conversation, accountEpoch: accountEpoch) == sessionID,
                           model.session?.hostId == hostID {
                            TaskDirectoryView(appModel: model, sessionId: sessionID, expectedHostId: hostID)
                                .id(sessionID + ":" + hostID + ":" + accountEpoch.uuidString)
                        } else {
                            EmptyState(symbol: "checklist", title: "会话已变更", message: "返回当前会话后重新打开任务。")
                        }
                    } label: { Label("会话任务", systemImage: "checklist").labelStyle(.titleAndIcon) }
                    .accessibilityIdentifier("conversationTasksButton")
                } else {
                    Label("会话任务待确认", systemImage: "checklist").font(.caption).foregroundStyle(Weave.muted)
                        .accessibilityIdentifier("conversationTasksUnavailable")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await model.open(conversation) }
                } label: { Label("刷新记录", systemImage: "arrow.clockwise") }
                .disabled(model.historyBusy)
                .accessibilityIdentifier("refreshHistoryButton")
            }
        }
        .task(id: conversation.id) { await model.open(conversation) }
        // End this view's keyboard focus when navigating away. Retaining the old responder
        // can restore the keyboard without the safe-area composer after a task detail returns.
        .onDisappear { endDraftFocus(); composerIdentity = UUID() }
        .onAppear { endDraftFocus() }
        .onChange(of: conversation.id) { _, _ in
            previousTailID = nil; visibleMessageID = nil
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversationDetail")
    }

    private func endDraftFocus() {
        draftFocused = false
        #if os(iOS)
        // Navigation can restore UIKit's old responder after SwiftUI's focus binding cleared.
        // Resign it as the conversation reappears so the composer and keyboard agree.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        #endif
    }

    private var commandStatusCards: some View {
        let accountEpoch = model.accountEpoch
        let key = AppleAppModel.draftKey(for: conversation)
        let rows = model.commandRows(for: conversation)
        return ForEach(rows) { row in
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(row.status).font(.caption.weight(.semibold))
                    if model.reconcilingRequests.contains(row.id) { ProgressView().controlSize(.small) }
                }
                if row.progress == nil || row.progress == .pending || row.progress == .accepted || row.progress == .unknown {
                    Text(row.record.intent.text ?? "").font(.caption).lineLimit(4).textSelection(.enabled)
                }
                if let note = row.note {
                    Text(note).font(.caption).fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                        Button("重新确认") {
                        Task { await model.reconcileSavedRequest(row.id, accountEpoch: accountEpoch) }
                    }.disabled(model.reconcilingRequests.contains(row.id))
                    if row.lookupNotFound {
                            Button("继续发送") {
                            Task { await model.continueSavedRequest(row.id, accountEpoch: accountEpoch) }
                        }.disabled(model.reconcilingRequests.contains(row.id) || model.sendTargets[key] == nil)
                    }
                    if row.record.intent.kind == .message,
                       let sessionId = row.record.intent.sessionId,
                       let commandId = row.record.receipt?.commandId {
                        NavigationLink {
                            if model.taskSessionID(for: conversation, accountEpoch: accountEpoch) == sessionId,
                               model.session?.server == row.record.intent.server,
                               model.session?.account.ownerId == row.record.intent.ownerId,
                               model.session?.hostId == row.record.intent.hostId,
                               model.commandRows(for: conversation).contains(where: {
                                   $0.id == row.id && $0.record.intent == row.record.intent && $0.record.receipt?.commandId == commandId
                               }) {
                                TaskWorkspaceView(appModel: model, taskId: commandId,
                                    expectedHostId: row.record.intent.hostId,
                                    expectedSessionId: sessionId, expectedRequestId: row.record.intent.requestId)
                                    .id(commandId + ":" + accountEpoch.uuidString)
                            } else {
                                EmptyState(symbol: "checklist", title: "会话已变更", message: "返回当前会话后重新打开任务。")
                            }
                        } label: { Label("查看任务与成果", systemImage: "checklist") }
                        .accessibilityIdentifier("openTask.\(row.id)")
                    }
                }.buttonStyle(.bordered).font(.caption)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Weave.soft, in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(Weave.secondary)
            .accessibilityIdentifier("commandStatus.\(row.id)")
        }
    }

    private var composer: some View {
        let accountEpoch = model.accountEpoch
        let key = AppleAppModel.draftKey(for: conversation)
        return VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 6) {
                Image(systemName: "text.bubble")
                Text("模型 · \(model.sendTargets[key]?.modelName ?? conversation.originalModelLabel ?? "尚未确认")")
                    .lineLimit(1)
                Spacer(minLength: 0)
                if conversation.running { Text("正在处理").foregroundStyle(Weave.accent) }
            }
            .font(.caption).foregroundStyle(Weave.muted)

            VStack(alignment: .leading, spacing: 8) {
                TextField("记下要接着说的话…", text: draft, axis: .vertical)
                    .lineLimit(2...6).textFieldStyle(.plain).font(.body)
                    .focused($draftFocused).padding(.horizontal, 9).padding(.top, 7)
                    .disabled(!model.canEditDraft(for: conversation))
                    .accessibilityIdentifier("conversationDraft")
                HStack(spacing: 12) {
                    Text(model.draftStatus(for: conversation))
                        .font(.caption).foregroundStyle(Weave.muted)
                        .accessibilityIdentifier("draftSaveStatus")
                    Spacer()
                    Button { Task { await model.send(conversation, accountEpoch: accountEpoch) } } label: {
                        Image(systemName: "arrow.up")
                            .font(.body.weight(.semibold)).frame(width: 40, height: 40)
                    }
                    .buttonStyle(.bordered).buttonBorderShape(.circle)
                    .disabled(!model.canSend(conversation)).accessibilityLabel("发送到原会话")
                    .accessibilityIdentifier("sendButton")
                }
            }
            .padding(9)
            .background(Weave.soft, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Weave.line))

            if let error = model.draftError {
                InlineNotice(message: error, isError: true).accessibilityIdentifier("draftStorageError")
            }
            if let error = model.cacheError {
                Text(error).font(.caption).foregroundStyle(Weave.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let notice = model.continuationNotices[key] {
                Text(notice).font(.caption).foregroundStyle(Weave.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let choice = model.modelsToConfirm[key] {
                Button("确认使用会话已绑定的模型：\(choice.name)") {
                    Task { await model.confirmBoundModel(for: conversation, accountEpoch: accountEpoch) }
                }.buttonStyle(.bordered).accessibilityIdentifier("confirmBoundModelButton")
            }
            if let choices = model.adoptionChoices[key], !choices.isEmpty {
                Menu("选择模型并接通原会话") {
                    ForEach(choices) { choice in
                        Button("\(choice.name) · \(choice.model)") {
                            Task { await model.adopt(conversation, profileID: choice.id, accountEpoch: accountEpoch) }
                        }
                    }
                }
                .disabled(!model.canAdopt(conversation))
                .accessibilityIdentifier("chooseAdoptionModelButton")
            }
            if let error = model.adoptionError {
                Text(error).font(.caption).foregroundStyle(Weave.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 12)
        .frame(maxWidth: 792).frame(maxWidth: .infinity)
        .background(Weave.surface)
    }

    private var adoptionStatusCards: some View {
        let accountEpoch = model.accountEpoch
        return ForEach(model.adoptionRows(for: conversation)) { row in
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(row.status).font(.caption.weight(.semibold))
                    if model.adoptingRequests.contains(row.id) { ProgressView().controlSize(.small) }
                }
                if let note = row.note { Text(note).font(.caption).fixedSize(horizontal: false, vertical: true) }
                if row.record.receipt?.projection.binding?.truncated == true {
                    Text("采用的原上下文有截断，原始记录仍保留。").font(.caption)
                }
                if let count = row.record.receipt?.projection.binding?.omittedImages, count > 0 {
                    Text("采用上下文未包含 \(count) 张图片。").font(.caption)
                }
                HStack {
                    Button("重新确认接通") {
                        Task { await model.reconcileAdoptionRequest(row.id, accountEpoch: accountEpoch) }
                    }.disabled(model.adoptingRequests.contains(row.id))
                    if row.lookupNotFound {
                        Button("继续接通") {
                            Task { await model.continueAdoptionRequest(row.id, accountEpoch: accountEpoch) }
                        }.disabled(model.adoptingRequests.contains(row.id))
                    }
                }.buttonStyle(.bordered).font(.caption)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Weave.soft, in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(Weave.secondary)
            .accessibilityIdentifier("adoptionStatus.\(row.id)")
        }
    }
}

private struct MessageView: View {
    let message: ChatMessage
    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 7) {
            if message.role == .user {
                if !message.text.isEmpty {
                    HStack {
                        Spacer(minLength: 32)
                        Text(message.text).textSelection(.enabled).lineSpacing(5)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                            .background(Weave.accentSoft, in: RoundedRectangle(cornerRadius: 19))
                    }
                }
            } else {
                MessageBodyView(text: message.text, messageID: message.id)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(message.originalAttachments) { attachment in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: attachment.isImage ? "photo" : "doc")
                        .foregroundStyle(Weave.secondary)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(attachment.name).font(.callout).textSelection(.enabled)
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        Text("\(attachment.isImage ? "图片原件" : "文件原件") · \(ByteCountFormatter.string(fromByteCount: Int64(attachment.size), countStyle: .file))")
                            .font(.caption).foregroundStyle(Weave.secondary)
                        if message.unpreviewedOriginalImageIds.contains(attachment.attachmentId) {
                            Text("图片暂无预览").font(.caption).foregroundStyle(Weave.muted)
                        }
                        Text("原件下载暂不可用").font(.caption).foregroundStyle(Weave.muted)
                    }
                    Spacer(minLength: 0)
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Weave.surface, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("originalAttachment.\(message.id).\(attachment.attachmentId)")
            }
            let remainingAttachments = max(0, message.attachmentCount - message.originalAttachments.count)
            if remainingAttachments > 0 {
                Label("\(remainingAttachments) 个附件 · 此版本尚未展开", systemImage: "paperclip")
                    .font(.caption).foregroundStyle(Weave.muted)
            }
            if message.truncated {
                Text("这条记录仅显示部分内容。")
                    .font(.caption).foregroundStyle(Weave.muted)
            }
            if message.pendingContext {
                Text("已保存记录，尚未进入原模型上下文。")
                    .font(.caption).foregroundStyle(Weave.muted)
            }
        }
        .font(.body).foregroundStyle(Weave.ink)
        .padding(.vertical, 2)
        .accessibilityIdentifier("message.\(message.id)")
    }
}
