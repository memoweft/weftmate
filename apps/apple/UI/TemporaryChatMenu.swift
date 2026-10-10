import SwiftUI
import WeftMateCore

struct TemporaryChatMenu: View {
    @ObservedObject var app: AppleAppModel
    let conversation: ConversationSummary
    var body: some View {
        Toggle(isOn: Binding(get: { conversation.temporaryState.memoryMode == "off" }, set: { value in
            Task { await app.mainChat.temporarySetting(conversation, fields: ["memoryMode": .string(value ? "off" : "on")]) }
        })) { Label("此对话不形成记忆", image: "wm-memory") }.accessibilityIdentifier("temporaryChat.memory").help("设置从新回合生效；过去形成的记忆可到记忆页遗忘。")
        Toggle(isOn: Binding(get: { conversation.temporaryState.recallEnabled }, set: { value in
            Task { await app.mainChat.temporarySetting(conversation, fields: ["recallEnabled": .bool(value)]) }
        })) { Label("使用已有记忆", image: "wm-book") }.accessibilityIdentifier("temporaryChat.recall")
        #if os(iOS)
        Button {
            let epoch = app.accountEpoch
            app.sessionMenuCandidate = nil
            Task {
                try? await Task.sleep(for: .milliseconds(350))
                guard app.accountEpoch == epoch else { return }
                app.temporaryExpiryCandidate = conversation
            }
        } label: {
            Label("自动删除 · " + (conversation.temporaryState.autoDeleteDays.map { "\($0) 天" } ?? "不自动删除"), image: "wm-clock")
        }
        .accessibilityIdentifier("temporaryChat.expiryMenu")
        #else
        Menu {
Picker("自动删除", selection: Binding<Int>(get: { conversation.temporaryState.autoDeleteDays ?? 0 }, set: { value in
                Task { await app.mainChat.temporarySetting(conversation, fields: ["autoDeleteDays": value == 0 ? .null : .number(Double(value))]) }
            })) {
                Text("1 天").tag(1); Text("7 天").tag(7); Text("30 天").tag(30); Text("不自动删除").tag(0)
            }.pickerStyle(.inline).accessibilityIdentifier("temporaryChat.expiry")
        }
        label: { Label("自动删除 · " + (conversation.temporaryState.autoDeleteDays.map { "\($0) 天" } ?? "不自动删除"), image: "wm-clock") }
        .menuStyle(.borderlessButton).foregroundStyle(Weave.ink).fixedSize()
        .accessibilityIdentifier("temporaryChat.expiryMenu")
        #endif
        Divider()
    }
}
struct SideChatSourceView: View {
    @ObservedObject var app: AppleAppModel
    let conversation: ConversationSummary
    @ObservedObject var model: MainChatModel
    init(app: AppleAppModel, conversation: ConversationSummary) { self.app = app; self.conversation = conversation; model = app.mainChat }
    var body: some View {
        if let source = model.sideSource, source.id == conversation.chatId {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                if source.contextTransfer?["sourceDeleted"]?.bool == true { Text("来源已删除") }
                else {
                    ForEach(Array((source.originRefs ?? []).enumerated()), id: \.offset) { _, ref in
                        Button { Task { await app.mainChat.returnToSource(ref) } } label: { WeftLabel("返回来源消息", icon: "back") }
                            .buttonStyle(OutlineActionStyle()).accessibilityIdentifier("sideChat.source")
                    }
                }
                if source.contextTransfer?["state"]?.string == "references_only" { Text("相关上下文尚未带入").accessibilityIdentifier("sideChat.referencesOnly") }
            }.font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
        }
    }
}
#if DEBUG
@MainActor enum A16TestSupport {
    static func addAttachment(_ model: MainChatModel) {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("A16-synthetic.txt")
        try? Data("A16 合成附件 PAPER-42".utf8).write(to: file)
        model.addFiles([file]); try? FileManager.default.removeItem(at: file)
    }
}
#endif
