import SwiftUI
import WeftMateCore

struct SessionActions: View {
    @ObservedObject var app: AppleAppModel
    let conversation: ConversationSummary
    var onSelect: () -> Void = {}
    var onDelete: (() -> Void)?
    var body: some View {
        if conversation.sessionId != nil {
            Button(conversation.archived ? "恢复对话" : "归档对话") { onSelect(); Task { await app.archive(conversation, archived: !conversation.archived) } }
                .disabled(app.lifecycleBusy)
            Button("删除对话", role: .destructive) {
                if let onDelete { onDelete() } else { onSelect(); app.askToDelete(conversation) }
            }.disabled(app.lifecycleBusy)
        }
    }
}
struct SessionDeleteSheet: View {
    @ObservedObject var app: AppleAppModel
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
            Text("删除对话？").font(AppleTokens.Fonts.title2)
            Text("永久删除这段对话、专属工作目录与经验，无法恢复。运行中的任务会先停止。长期记忆默认保留。")
            Button { app.forgetConversationMemories.toggle() } label: {
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
            if let error = app.lifecycleError { InlineNotice(message: error, isError: true) }
            HStack {
                Button("取消") { app.deletionCandidate = nil }.disabled(app.lifecycleBusy)
                Button(app.lifecycleBusy ? "正在删除…" : "永久删除", role: .destructive) { Task { await app.deleteConversation() } }.disabled(app.lifecycleBusy)
                    .accessibilityIdentifier("confirmDeleteConversation")
            }
        }.padding(AppleTokens.Space.p24).frame(maxWidth: 600).background(Weave.surface)
    }
}
