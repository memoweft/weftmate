import SwiftUI
import AppKit
import WeftMateCore

/// The Mac uses the same streaming controller, model library and sealed store as iPhone.
struct MacStandaloneWorkspace: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var cloud: CloudLoginModel
    @ObservedObject private var chat: PhoneStandaloneModel
    @State private var notes = false
    @State private var models = false
    @State private var importing = false
    @State private var search = ""
    @State private var sidebar = true
    @Environment(\.colorScheme) private var scheme
    private var colors: ServiceControlPalette { .init(dark: scheme == .dark) }
    @Environment(\.openWindow) private var openWindow

    init(app: AppleAppModel, cloud: CloudLoginModel, chat: PhoneStandaloneModel) {
        self.app = app; self.cloud = cloud; self.chat = chat
    }
    var body: some View {
        HSplitView {
            if sidebar {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                    HStack {
                        Text("WeftMate").font(AppleTokens.Fonts.headline)
                        Spacer()
                        Button { chat.newThread(); notes = false } label: { WeftIcon("plus", size: 18) }
                            .buttonStyle(MacStandaloneActionStyle()).disabled(chat.busy)
                            .accessibilityLabel("新建对话").accessibilityIdentifier("macChat.new")
                    }
                    TextField("搜索对话", text: $search).modelServiceField()
                    ScrollView {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p4) {
                            ForEach(chat.state.threads.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }) { thread in
                                Button { chat.select(thread.id); notes = false } label: {
                                    HStack { WeftIcon("chat", size: 18); Text(thread.title).lineLimit(2); Spacer(minLength: 0) }
                                }.buttonStyle(MacStandaloneActionStyle(selected: !notes && chat.state.selected == thread.id))
                                    .disabled(chat.busy).accessibilityIdentifier("macChat.thread." + thread.id)
                            }
                        }
                    }
                    Button { notes = true } label: { WeftLabel("本机笔记", icon: "file", size: 18) }
                        .buttonStyle(MacStandaloneActionStyle(selected: notes)).accessibilityIdentifier("macChat.notes")
                    Button { models = true } label: { WeftLabel("模型服务", icon: "model", size: 18) }
                        .buttonStyle(MacStandaloneActionStyle()).accessibilityIdentifier("macChat.models")
                    Button { cloud.requireLogin() } label: { WeftLabel(cloud.authenticated ? "账户与电脑" : "登录或连接电脑", icon: "account", size: 18) }
                        .buttonStyle(MacStandaloneActionStyle()).accessibilityIdentifier("macChat.account")
                    Button { openWindow(id: "settings") } label: { WeftLabel("设置", icon: "settings", size: 18) }
                        .buttonStyle(MacStandaloneActionStyle()).accessibilityIdentifier("macChat.settings")
                }.padding(AppleTokens.Space.p16).frame(minWidth: 200, idealWidth: 240, maxWidth: 280)
                    .background(colors.soft).background(.ultraThinMaterial)
            }
            VStack(spacing: 0) {
                HStack {
                    Button { sidebar.toggle() } label: { WeftIcon("sidebar", size: 18) }
                        .buttonStyle(MacStandaloneActionStyle()).accessibilityLabel("对话列表")
                    Text(notes ? "本机笔记" : "聊天").font(AppleTokens.Fonts.headline)
                    Spacer()
                    if !sidebar {
                        Button("模型服务") { models = true }.buttonStyle(MacStandaloneActionStyle())
                        Button("账户") { cloud.requireLogin() }.buttonStyle(MacStandaloneActionStyle())
                    }
                }.padding(AppleTokens.Space.p12)
                if notes {
                    LocalAccountWorkspace(app: app, cloud: cloud, onHelp: { text in
                        notes = false; chat.draft = text
                        if chat.currentModel == nil { models = true } else { chat.send() }
                    })
                } else {
                    conversation
                }
            }.frame(minWidth: 360, maxWidth: .infinity, maxHeight: .infinity).background(colors.canvas)
        }.accessibilityElement(children: .contain).accessibilityIdentifier("macStandaloneWorkspace")
            .sheet(isPresented: $models) {
                NavigationStack {
                    ModelServicesSettingsView(store: ModelServiceSettingsModel(app: nil, phone: chat))
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { models = false }.buttonStyle(MacStandaloneActionStyle()) } }
                }.frame(minWidth: 480, idealWidth: 560, minHeight: 560, idealHeight: 650)
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true, onCompletion: importCompletion)
            #if DEBUG
            .task {
                guard MacStandaloneReview.enabled, !ProcessInfo.processInfo.arguments.contains("--apple12-fix1-notification") else { return }
                if ProcessInfo.processInfo.arguments.contains("--apple12-fix1-connection") {
                    Task { await MacStandaloneReview.run(app: app, chat: chat) }
                } else { await MacStandaloneReview.run(app: app, chat: chat) }
            }
            #endif
    }
    private var conversation: some View {
        VStack(spacing: AppleTokens.Space.p12) {
            ScrollViewReader { proxy in
                ScrollView {
                    if chat.messages.isEmpty {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                            Text("从这里开始聊").font(AppleTokens.Fonts.title2.bold())
                            Text(chat.models.isEmpty ? "先添加一个模型服务，就能在这台 Mac 上聊天。" : "模型已经准备好，发一句话试试。")
                                .foregroundStyle(colors.muted)
                            if chat.models.isEmpty {
                                ModelServiceEditor(store: ModelServiceSettingsModel(app: nil, phone: chat), existing: nil, embedded: true)
                                    .frame(minHeight: 430)
                            }
                        }.padding(AppleTokens.Space.p24).frame(maxWidth: 640).frame(maxWidth: .infinity)
                    } else {
                        LazyVStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                            ForEach(chat.messages) { message in
                                VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: AppleTokens.Space.p8) {
                                    Text(message.role == "user" ? "你" : "WeftMate").font(AppleTokens.Fonts.caption).foregroundStyle(colors.muted)
                                    Text(message.text.isEmpty ? (message.replyStatus?.placeholder ?? "这次没回复，可以重试。") : message.text)
                                        .textSelection(.enabled).accessibilityIdentifier("macChat.message." + message.id)
                                    ForEach(message.attachments ?? []) { attachment in Text(attachment.placeholder).font(AppleTokens.Fonts.caption).foregroundStyle(colors.muted) }
                                    if message.role == "assistant" {
                                        HStack {
                                            Button("复制回复") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(message.text, forType: .string) }
                                                .buttonStyle(MacStandaloneActionStyle()).disabled(message.text.isEmpty)
                                            if message.replyStatus == .failed {
                                                Button("重试回复") { chat.retryReply(message.id) }.buttonStyle(MacStandaloneActionStyle()).disabled(chat.busy)
                                            } else if message.id == chat.messages.last?.id {
                                                Button("重新生成") { chat.send(regenerate: true) }.buttonStyle(MacStandaloneActionStyle()).disabled(chat.busy)
                                            }
                                        }
                                    }
                                }.frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading).id(message.id)
                            }
                        }.padding(AppleTokens.Space.p24).frame(maxWidth: 800).frame(maxWidth: .infinity)
                    }
                }.onChange(of: chat.messages.last?.id) { _, _ in
                    Task { @MainActor in await Task.yield();if let id=chat.messages.last?.id { proxy.scrollTo(id,anchor:.bottom) } }
                }.onChange(of: chat.busy) { _, busy in
                    if !busy { Task { @MainActor in await Task.yield();if let id=chat.messages.last?.id { proxy.scrollTo(id,anchor:.bottom) } } }
                }
            }
            if let notice = chat.notice { Text(notice).font(AppleTokens.Fonts.callout).foregroundStyle(colors.muted).padding(.horizontal, AppleTokens.Space.p16) }
            if !chat.models.isEmpty {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                    ForEach(chat.attachments) { attachment in
                        HStack { Text(attachment.name).lineLimit(1); Spacer(); Button("移除") { chat.removeAttachment(attachment.id) }.buttonStyle(MacStandaloneActionStyle()) }
                    }
                    TextField("聊一聊…", text: $chat.draft, axis: .vertical).lineLimit(2...6).textFieldStyle(.plain)
                        .accessibilityIdentifier("macChat.draft")
                    HStack {
                        Button { importing = true } label: { WeftIcon("plus", size: 18) }.buttonStyle(MacStandaloneActionStyle())
                            .disabled(chat.attachmentReason != nil).accessibilityLabel(chat.attachmentReason ?? "添加图片或文件")
                        ServiceModelMenuButton(services: chat.services, current: chat.modelID, label: chat.selectedServiceModel?.name ?? chat.currentModel?.model ?? "尚未配置", usesImages: chat.conversationUsesImages, thinkingSupported: chat.selectedServiceModel?.deepThinking?.supported == true, thinking: $chat.thinkingEnabled, select: chat.selectServiceModel, add: { models = true }, refresh: { Task { for service in chat.services { await chat.refreshService(service) } } }, identifier: "macChat.model")
                        Text(chat.currentModel?.model ?? "").font(AppleTokens.Fonts.caption).foregroundStyle(colors.muted).lineLimit(1)
                        Spacer()
                        if chat.busy { Button { chat.stop() } label: { WeftIcon("stop",size:18) }.buttonStyle(MacStandaloneActionStyle()).accessibilityLabel("停止回复").accessibilityIdentifier("macChat.stop") }
                        Button { chat.send() } label: { WeftIcon("send", size: 18) }
                            .buttonStyle(MacStandaloneActionStyle(primary: true))
                            .disabled(chat.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && chat.attachments.isEmpty)
                            .accessibilityLabel(chat.busy ? "排队发送" : "发送").accessibilityIdentifier("macChat.send")
                    }
                }.padding(AppleTokens.Space.p16).background(colors.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r14))
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r14))
                    .padding(AppleTokens.Space.p16)
            }
        }
    }
    private var importCompletion: @Sendable (Result<[URL], Error>) -> Void {
        let identity = app.phoneAccountIdentity, thread = chat.state.selected
        return Self.importCallback { result in
            guard identity == app.phoneAccountIdentity, thread == chat.state.selected else { return }
            do {
                for url in try result.get() {
                    chat.addAttachment(try PhoneAttachmentInput.file(url, remainingText: PhoneAttachment.textUnits - chat.attachments.reduce(0) { $0 + ($1.text?.utf16.count ?? 0) }))
                }
            } catch { chat.notice = (error as? PhoneAttachmentFailure)?.message ?? "文件暂时打不开，请重试。" }
        }
    }
    nonisolated private static func importCallback(_ complete: @escaping @MainActor @Sendable (Result<[URL], Error>) -> Void) -> @Sendable (Result<[URL], Error>) -> Void {
        { result in Task { @MainActor in complete(result) } }
    }
}

struct MacStandaloneActionStyle: ButtonStyle {
    var primary = false
    var selected = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorScheme) private var scheme
    func makeBody(configuration: Configuration) -> some View {
        let colors = ServiceControlPalette(dark: scheme == .dark)
        return configuration.label.font(AppleTokens.Fonts.callout).padding(.horizontal, AppleTokens.Space.p8).frame(minHeight: AppleTokens.Space.p32)
            .foregroundStyle(primary ? colors.onAccent : colors.ink)
            .background(primary ? colors.accent : selected ? colors.soft : configuration.isPressed ? colors.soft : .clear, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r8))
            .opacity(enabled ? 1 : AppleTokens.Opacity.disabled).scaleEffect(configuration.isPressed ? AppleTokens.Scale.pressed : 1)
    }
}
