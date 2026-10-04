import SwiftUI
import WeftMateCore

struct ConversationListContent: View {
    @ObservedObject var model: AppleAppModel
    @Binding var search: String

    var filtered: [ConversationSummary] {
        guard !search.isEmpty else { return model.conversations }
        return model.conversations.filter { $0.title.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        Group {
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

    private var draft: Binding<String> {
        Binding(get: { model.drafts[conversation.id] ?? "" },
                set: { model.drafts[conversation.id] = $0 })
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if model.historyBusy {
                        HStack(spacing: 10) {
                            ProgressView().controlSize(.small)
                            Text("正在读取原会话…").font(.callout).foregroundStyle(Weave.muted)
                        }.padding(.vertical, 24).frame(maxWidth: .infinity)
                    } else if let error = model.historyError {
                        InlineNotice(message: error, isError: true)
                        Button("重新读取") { Task { await model.open(conversation) } }
                            .buttonStyle(.bordered)
                    } else if model.messages.isEmpty {
                        EmptyState(symbol: "text.bubble", title: "还没有消息",
                                   message: "这段原会话还没有可显示的文字记录。")
                            .frame(minHeight: 240)
                    } else {
                        ForEach(model.messages) { message in
                            MessageView(message: message).id(message.id)
                        }
                    }
                    Color.clear.frame(height: 1).id("latest")
                }
                .padding(.horizontal, 24).padding(.vertical, 26)
                .frame(maxWidth: 760).frame(maxWidth: .infinity)
            }
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
            .onChange(of: model.messages.count) { _, _ in
                if !draftFocused { proxy.scrollTo("latest", anchor: .bottom) }
            }
        }
        .background(Weave.surface)
        .navigationTitle(conversation.title.isEmpty ? "原会话" : conversation.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await model.open(conversation) }
                } label: { Label("刷新记录", systemImage: "arrow.clockwise") }
                .disabled(model.historyBusy)
                .accessibilityIdentifier("refreshHistoryButton")
            }
        }
        .task(id: conversation.id) { await model.open(conversation) }
        .accessibilityIdentifier("conversationDetail")
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 6) {
                Image(systemName: "text.bubble")
                Text("原会话 · \(conversation.originalModelLabel ?? "模型尚未标注")")
                    .lineLimit(1)
                Spacer(minLength: 0)
                if conversation.running { Text("正在处理").foregroundStyle(Weave.accent) }
            }
            .font(.caption).foregroundStyle(Weave.muted)

            VStack(alignment: .leading, spacing: 8) {
                TextField("记下要接着说的话…", text: draft, axis: .vertical)
                    .lineLimit(2...6).textFieldStyle(.plain).font(.body)
                    .focused($draftFocused).padding(.horizontal, 9).padding(.top, 7)
                    .accessibilityIdentifier("conversationDraft")
                HStack(spacing: 12) {
                    Text("草稿留在本次登录中")
                        .font(.caption).foregroundStyle(Weave.muted)
                    Spacer()
                    Button {} label: {
                        Image(systemName: "arrow.up")
                            .font(.body.weight(.semibold)).frame(width: 40, height: 40)
                    }
                    .buttonStyle(.bordered).buttonBorderShape(.circle)
                    .disabled(true).accessibilityLabel("续聊尚未接通")
                    .accessibilityIdentifier("sendButton")
                }
            }
            .padding(9)
            .background(Weave.soft, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Weave.line))

            Text("当前可查看原记录，发送暂未开放；草稿仅保留在本次登录中。")
                .font(.caption).foregroundStyle(Weave.secondary).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 12)
        .frame(maxWidth: 792).frame(maxWidth: .infinity)
        .background(Weave.surface)
    }
}

private struct MessageView: View {
    let message: ChatMessage
    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 7) {
            if message.role == .user {
                HStack {
                    Spacer(minLength: 32)
                    Text(message.text).textSelection(.enabled).lineSpacing(5)
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .background(Weave.accentSoft, in: RoundedRectangle(cornerRadius: 19))
                }
            } else {
                Text(markdown(message.text)).textSelection(.enabled).lineSpacing(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if message.attachmentCount > 0 {
                Label("\(message.attachmentCount) 个附件 · 此版本尚未展开", systemImage: "paperclip")
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

    private func markdown(_ text: String) -> AttributedString {
        // Preserve line breaks and plain source if the recorded Markdown is malformed.
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}
