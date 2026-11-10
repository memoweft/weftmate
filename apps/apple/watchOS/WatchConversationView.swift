import SwiftUI
import WeftMateCore

struct WatchConversationView: View {
    @ObservedObject var model: WatchTimelineModel
    var body: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
            if let record=model.chat?.record {
                if let device=record.device {
                    WeftLabel(device.title+"回答",icon:device == .phone ? "phone" : "desktop",size:AppleTokens.Space.p16)
                        .font(AppleTokens.Fonts.caption).foregroundStyle(AppleTokens.Styles.secondary)
                }
                Text(record.text).font(AppleTokens.Fonts.caption).foregroundStyle(AppleTokens.Styles.secondary)
                if let answer=model.chat?.answer,!answer.isEmpty { Text(answer).font(AppleTokens.Fonts.body) }
                if record.phase.active {
                    HStack(spacing:AppleTokens.Space.p8) {
                        ProgressView()
                        Text(record.phase == .routing ? "正在选择回答设备…" : "正在处理…").font(AppleTokens.Fonts.caption)
                    }
                }
                if let notice=record.notice { Text(notice).font(AppleTokens.Fonts.caption) }
                if record.phase == .chooseDevice {
                    HStack {
                        Button("手机") { model.sendChat(device:.phone) }
                        Button("电脑") { model.sendChat(device:.computer) }
                    }.disabled(model.busy || !model.reachable)
                }
                if record.phase == .failed {
                    Button("再发一次") { model.sendChat(device:record.device) }
                        .disabled(model.busy || !model.reachable)
                }
            } else {
                Text("想聊些什么？").font(AppleTokens.Fonts.headline)
                Text("问问题交给手机，电脑操作交给电脑。")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(AppleTokens.Styles.secondary)
            }
            TextField("说句话或输入",text:$model.draft)
                .accessibilityIdentifier("watchChatInput")
                .disabled(model.chatWorking)
            Button { model.sendChat() } label: { WeftLabel("发送",icon:"send",size:AppleTokens.Space.p16) }
                .disabled(model.busy || model.chatWorking || model.chat?.record?.phase == .uncertain || !model.reachable || model.chat == nil || model.draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("watchChatSend")
            if model.chat?.record != nil {
                Button("新对话") { model.newConversation() }.disabled(model.chatWorking || model.busy)
            }
        }
    }
}
