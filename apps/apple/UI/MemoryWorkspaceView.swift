import SwiftUI
import WeftMateCore

struct MemoryWorkspaceView: View {
    @ObservedObject private var appModel: AppleAppModel
    @StateObject private var model: MemoryWorkspaceModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var showingDetail = false
    @State private var expandedSources = false
    @State private var pendingAction: MemoryActionContext?
    @State private var confirmingItemDeletion = false
    @State private var confirmingMute = false

    init(appModel: AppleAppModel) {
        self.appModel = appModel
        _model = StateObject(wrappedValue: MemoryWorkspaceModel(client: appModel.assistantClient,
            journal: try? LocalMemoryOperationStore(directory: appModel.assistantStateDirectory),
            accountEpoch: appModel.accountEpoch,
            currentEpoch: { [weak appModel] in appModel?.accountEpoch ?? UUID() },
            currentSession: { [weak appModel] in appModel?.session }))
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                HStack(spacing: AppleTokens.Space.p12) {
                    WeftIcon("memory", size: 28).foregroundStyle(Weave.accent)
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p4) {
                        Text("我的记忆").font(AppleTokens.Fonts.title2.weight(.semibold)).foregroundStyle(Weave.ink)
                        Text("查看记住的内容与来源，也可以纠正、停用或删除。")
                            .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                    }
                }
                controls
                if let status = model.status { serviceState(status.status) }
                if let notice = model.notice { InlineNotice(message: notice).accessibilityIdentifier("memoryNotice") }
                if let error = model.error { InlineNotice(message: error, isError: true).accessibilityIdentifier("memoryError") }
                if model.loading { ProgressView("正在读取记忆…") }
                if model.items.isEmpty && !model.loading && model.error == nil {
                    Text(model.query.isEmpty ? "当前类别还没有记忆。" : "没有找到匹配的记忆。")
                        .foregroundStyle(Weave.muted).padding(.vertical, AppleTokens.Space.p16).accessibilityIdentifier("memoryEmptyState")
                }
                ForEach(model.items) { item in
                    Button {
                        showingDetail = true; expandedSources = false
                        Task { await model.open(item) }
                    } label: { memoryCard(item) }
                        .buttonStyle(.plain).accessibilityIdentifier("memoryItem.\(item.id)")
                }
                if model.hasMore {
                    Button("加载更多") { Task { await model.loadMore() } }
                        .buttonStyle(OutlineActionStyle()).disabled(model.loading).accessibilityIdentifier("memoryLoadMoreButton")
                }
                if !model.visibleOperations.isEmpty { operationHistory }
            }
            .padding(AppleTokens.Space.p24).frame(maxWidth: 820, alignment: .leading).frame(maxWidth: .infinity)
        }
        .background(Weave.canvas).navigationTitle("记忆")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await model.reload() } } label: { WeftLabel("刷新记忆", icon: "sync") }
                    .disabled(model.loading).accessibilityIdentifier("refreshMemoryButton")
            }
        }
        .task {
            await model.reload()
            #if DEBUG && os(macOS)
            let args = ProcessInfo.processInfo.arguments
            if args.contains("--ui-testing"), let index = args.firstIndex(of: "--a5-review-scene"), args.indices.contains(index + 1), args[index + 1] == "memory-forget", let item = model.items.first {
                await model.open(item); showingDetail = true
                try? await Task.sleep(for: .milliseconds(500))
                pendingAction = model.actionContext(.deleteItem)
            }
            #endif
        }
        .onDisappear { clearPresentation(); model.invalidate() }
        .onChange(of: model.detail?.item.id) { old, new in
            if old != nil && new == nil { showingDetail = false; expandedSources = false; pendingAction = nil }
        }
        .onChange(of: appModel.accountEpoch) { _, _ in clearPresentation(); model.invalidate() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { clearPresentation(); model.invalidate() }
            else { Task { await model.reload() } }
        }
        .sheet(isPresented: $showingDetail, onDismiss: { model.closeDetail(); expandedSources = false; pendingAction = nil }) { detailPage }
        .accessibilityIdentifier("memoryWorkspace")
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
            Picker("类别", selection: $model.kind) {
                Text("认知").tag(MemoryKind.cognition)
                Text("人物与事物").tag(MemoryKind.entity)
                Text("关系").tag(MemoryKind.relationship)
                Text("事件").tag(MemoryKind.event)
            }
            .pickerStyle(.menu).accessibilityIdentifier("memoryKindPicker")
            .onChange(of: model.kind) { _, _ in Task { await model.reload() } }
            HStack {
                TextField("搜索记忆", text: $model.query)
                    .textFieldStyle(.roundedBorder).onSubmit { Task { await model.reload() } }
                    .accessibilityIdentifier("memorySearchField")
                Button("搜索") { Task { await model.reload() } }
                    .buttonStyle(OutlineActionStyle()).disabled(model.loading).accessibilityIdentifier("memorySearchButton")
            }
        }
    }
    private func serviceState(_ status: MemoryServiceStatus) -> some View {
        let label: String = switch status.state {
        case .ready: "记忆服务可用"
        case .degraded: "记忆服务部分可用"
        case .disabled: "记忆服务已关闭"
        case .unavailable: "记忆服务暂不可用"
        }
        return Text(label).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.secondary).accessibilityIdentifier("memoryServiceStatus")
    }
    private func memoryCard(_ item: MemoryItem) -> some View {
        WeaveCard {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p10) {
                Text(item.text).font(AppleTokens.Fonts.body).foregroundStyle(Weave.ink).lineSpacing(AppleTokens.Space.p4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack {
                    Text(item.lifecycle.mutedAt != nil ? "已停用" : item.currentState == .current ? "当前有效" : "已不是当前版本")
                    Spacer()
                    Text("\(item.sourceCount) 个来源")
                    WeftIcon("right")
                }.font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                if item.truncated { Text("列表只显示部分内容，打开查看详情。") .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            }
        }
    }
    private var detailPage: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p22) {
                    if model.detailLoading { ProgressView("正在读取详情…") }
                    if let error = model.detailError { InlineNotice(message: error, isError: true) }
                    if let detail = model.detail {
                        Text(detail.item.text).font(AppleTokens.Fonts.body).foregroundStyle(Weave.ink).textSelection(.enabled).lineSpacing(AppleTokens.Space.p5)
                            .accessibilityIdentifier("memoryDetailText")
                        if detail.item.truncated { Text("服务返回的内容有截断。") .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                        DisclosureGroup(isExpanded: sourceExpansion) { sourceList } label: {
                            WeftLabel("来源 · \(detail.item.sourceCount)", icon: "source")
                        }.disabled(model.status?.status.capabilities.source != true)
                        management(detail)
                    } else if !model.detailLoading && model.detailError == nil {
                        Text("详情已关闭，请返回列表重新读取。") .foregroundStyle(Weave.muted)
                    }
                }.padding(AppleTokens.Space.p24).frame(maxWidth: 720, alignment: .leading).frame(maxWidth: .infinity)
            }
            .background(Weave.canvas).navigationTitle("记忆详情")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("完成") { showingDetail = false; model.closeDetail() } } }
            .sheet(isPresented: Binding(get: { pendingAction?.operation.isDeletion == true }, set: { if !$0 { pendingAction = nil; model.cancelForget() } })) {
                if let context = pendingAction {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                        Text("忘掉这条记忆？").font(AppleTokens.Fonts.title2)
                        Text("忘掉会清除来源及以下记忆，之后的记忆导出不再包含它们。")
                        ScrollView { ForgetPreviewList(preview: model.forgetConfirmation.preview, loading: model.forgetPreviewLoading, error: model.forgetPreviewError).frame(maxWidth: .infinity, alignment: .leading) }
                        OriginalSnippetsOption(checked: $model.forgetConfirmation.deleteConversationSnippets)
                        Text("默认保留对话原文；勾选后删除对应原生对话片段及个人命令副本。以前的备份仍保留。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        Button("重新读取遗忘范围") { Task { await model.prepareForget(context) } }.disabled(model.forgetPreviewLoading)
                        HStack {
                            Button("取消") { pendingAction = nil; model.cancelForget() }
                            Button("确认忘掉", role: .destructive) { Task { await model.mutate(context); pendingAction = nil } }.disabled(!model.canForget(context)).accessibilityIdentifier("confirmForgetMemory")
                                #if os(macOS)
                                .foregroundStyle(Weave.danger)
                                #endif
                        }
                    }.padding(AppleTokens.Space.p24).frame(maxWidth: 600).background(Weave.surface)
                    .task { await model.prepareForget(context) }
                    #if os(macOS)
                    .frame(minWidth: 440, idealWidth: 580, minHeight: 460)
                    #endif
                }
            }
            .confirmationDialog("停用这条记忆？", isPresented: $confirmingMute, titleVisibility: .visible) {
                Button("停用记忆") { submitPendingAction() }
                Button("取消", role: .cancel) { pendingAction = nil }
            } message: { Text("停用与删除分别处理，来源记录仍保留。") }
            .accessibilityIdentifier("memoryDetail")
        }
        #if os(macOS)
        .frame(minWidth: 440, idealWidth: 580, minHeight: 460, idealHeight: 640)
        #endif
    }
    private var sourceExpansion: Binding<Bool> {
        Binding(get: { expandedSources }, set: { value in
            expandedSources = value
            if value { Task { await model.loadSources() } } else { model.closeSources() }
        })
    }
    private var sourceList: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p14) {
            if model.sourcesLoading { ProgressView("正在读取选定记忆的来源…") }
            if let sources = model.sources {
                if sources.sources.isEmpty { Text("当前没有可显示的来源。") .foregroundStyle(Weave.muted) }
                ForEach(sources.sources, id: \.evidenceId) { source in
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p9) {
                        if let summary = source.summary { Text(summary).font(AppleTokens.Fonts.callout.weight(.medium)) }
                        if let text = source.rawContent { Text(text).font(AppleTokens.Fonts.body).textSelection(.enabled).lineSpacing(AppleTokens.Space.p4) }
                        if source.localContentWithheld { Text("这个来源未允许在本机显示正文。") .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                        else if !source.contentAvailable { Text("来源正文当前不可用。") .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                        if source.rawContentTruncated { Text("来源文字有截断。") .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                        Text("记录时间：\(source.recordedAt)").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        Button("删除这个来源", role: .destructive) { pendingAction = model.actionContext(.deleteEvidence, evidenceID: source.evidenceId) }
                            .disabled(!model.canMutate || model.status?.status.capabilities.deleteEvidence != true)
                            .accessibilityIdentifier("deleteMemorySource.\(source.evidenceId)")
                    }.padding(AppleTokens.Space.p14).background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
                }
            }
            Text("来源权限决定这里可显示的内容，不表示已连接云端模型召回。")
                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
        }.padding(.top, AppleTokens.Space.p12)
    }
    private func management(_ detail: MemoryItemDetail) -> some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p14) {
            Divider()
            if detail.availableActions.correct.available {
                Text("纠正这条记忆").font(AppleTokens.Fonts.headline)
                TextEditor(text: correctionBinding).frame(minHeight: 110).padding(AppleTokens.Space.p8)
                    .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r10))
                    .disabled(!model.canMutate)
                    .accessibilityIdentifier("memoryCorrectionEditor")
                if let error = model.correctionValidationMessage { Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger) }
                Button("提交纠正") {
                    if let context = model.actionContext(.correct) { Task { await model.mutate(context) } }
                }
                    .buttonStyle(PrimaryActionStyle(fillsWidth: false))
                    .disabled(!model.canMutate || model.correctionValidationMessage != nil || model.correctionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("correctMemoryButton")
            }
            HStack {
                Button("停用") { pendingAction = model.actionContext(.mute); confirmingMute = pendingAction != nil }
                    .disabled(!model.canMutate || !detail.availableActions.mute.available).accessibilityIdentifier("muteMemoryButton")
                Button("忘掉", role: .destructive) { pendingAction = model.actionContext(.deleteItem) }
                    .disabled(!model.canMutate || !detail.availableActions.delete.available).accessibilityIdentifier("deleteMemoryButton")
            }.buttonStyle(OutlineActionStyle())
            if !model.canMutate { Text("当前修改暂不可用；进行中的操作会显示在最近操作中。") .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            Text("操作结果未确认时先重新确认；继续操作会接续同一次请求。")
                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
        }
    }
    private var operationHistory: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
            Text("最近操作").font(AppleTokens.Fonts.headline).foregroundStyle(Weave.ink)
            ForEach(model.visibleOperations) { row in
                WeaveCard {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p10) {
                        Text(row.title).font(AppleTokens.Fonts.callout.weight(.semibold))
                        Text(row.status).font(AppleTokens.Fonts.caption).accessibilityIdentifier("memoryOperationStatus.\(row.id)")
                        if let note = row.note { Text(note).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                        HStack {
                            Button("重新确认") { Task { await model.reconcile(row.id) } }
                            if row.lookupNotFound && row.record.bodyAvailable {
                                Button("继续操作") { Task { await model.reconcile(row.id, allowSubmission: true) } }
                            }
                            if row.record.cleanupPending && row.record.bodyAvailable {
                                Button("继续存储清理") { Task { await model.retryCleanup(row.id) } }
                            }
                            if model.busyOperations.contains(row.id) { ProgressView().controlSize(.small) }
                        }.buttonStyle(OutlineActionStyle()).disabled(model.busyOperations.contains(row.id)).font(AppleTokens.Fonts.caption)
                    }
                }.accessibilityIdentifier("memoryOperation.\(row.id)")
            }
        }
    }
    private var correctionBinding: Binding<String> {
        let token = model.editorToken
        return Binding(get: { model.editorToken == token ? model.correctionText : "" },
            set: { model.setCorrection($0, token: token) })
    }
    private func submitPendingAction() {
        let context = pendingAction; pendingAction = nil
        if let context { Task { await model.mutate(context) } }
    }
    private func clearPresentation() {
        showingDetail = false; expandedSources = false; pendingAction = nil
        confirmingItemDeletion = false; confirmingMute = false
    }
}
