import SwiftUI
import WeftMateCore

struct OfflineWorkspace: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: OfflineChatModel
    var body: some View {
        VStack(spacing: AppleTokens.Space.p0) {
            if model.hostOffline || model.showHistory {
                OfflineChatView(app: app, model: model)
            } else {
                if !model.turns.isEmpty {
                    Button(model.pending == 0 ? "离线对话 · 已同步" : "离线对话 · 等待同步") { model.showHistory = true }
                        .font(AppleTokens.Fonts.caption).padding(AppleTokens.Space.p8)
                        .accessibilityIdentifier("offlineHistory")
                }
                #if os(macOS)
                MacWorkspace(model: app)
                #else
                PhoneWorkspace(model: app)
                #endif
            }
        }.accessibilityElement(children: .contain)
    }
}

struct OfflineChatView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: OfflineChatModel
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
            HStack {
                Text(model.hostOffline ? "离线模式" : "离线对话").font(AppleTokens.Fonts.title3)
                Spacer()
                Menu("对话") {
                    ForEach(model.conversationIDs, id: \.self) { id in
                        Button(model.turns.first { $0.conversationId == id }?.messages.first?.text ?? "离线对话") { model.conversationID = id }
                    }
                    ForEach(model.recent) { row in Button(row.title ?? "近期对话") { model.newConversation(recent: row.id) } }
                }
                Button("新对话") { model.newConversation() }.accessibilityIdentifier("offlineNew")
                if !model.hostOffline { Button("返回") { model.showHistory = false }.accessibilityIdentifier("offlineBack") }
                Button("重新连接") { Task { await app.pollOffline() } }.accessibilityIdentifier("offlineReconnect")
            }
            if model.hostOffline {
                Text(OfflineChatModel.warning).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
                    .accessibilityIdentifier("offlineTopWarning")
            }
            if model.truncated { Text("已同步部分记忆，副本不包含全部记忆。") .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            ScrollView {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                    ForEach(model.turns.filter { $0.conversationId == model.conversationID }) { turn in
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                            ForEach(Array(turn.messages.enumerated()), id: \.offset) { _, message in
                                Text(message.text).font(AppleTokens.Fonts.body).foregroundStyle(message.role == "user" ? Weave.secondary : Weave.ink)
                                    .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
                            }
                            Text(model.synced.contains(turn.id) ? "已同步" : "电脑上线后自动同步")
                                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.accessibilityIdentifier("offlineMessages")
            if let notice = model.notice { Text(notice).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("offlineNotice") }
            if model.busy { ProgressView("正在回复…").font(AppleTokens.Fonts.caption) }
            if model.hostOffline {
                Text(OfflineChatModel.warning).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    .accessibilityIdentifier("offlineInputWarning")
                if !model.ready { Text("请联网核对授权，或先连接电脑同步副本与云模型。") .font(AppleTokens.Fonts.callout) }
                HStack(alignment: .bottom) {
                    TextField("聊一聊…", text: $model.draft, axis: .vertical).lineLimit(1...5)
                        .textFieldStyle(.plain).autocorrectionDisabled().accessibilityIdentifier("offlineInput")
                    Button { Task { await model.send(control: app.offlineAuthorization) } } label: { WeftIcon("send", size: AppleTokens.Space.p20) }
                        .disabled(!model.ready || model.busy || model.polling || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityLabel("发送").accessibilityIdentifier("offlineSend")
                }.padding(AppleTokens.Space.p12).background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
            }
        }.padding(AppleTokens.Space.p20).background(Weave.canvas)
            .accessibilityElement(children: .contain).accessibilityIdentifier("offlineChat")
    }
}
