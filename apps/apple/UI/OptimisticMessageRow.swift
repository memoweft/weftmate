import SwiftUI
import WeftMateCore

struct OptimisticMessageRow: View {
    @ObservedObject var model: AppleAppModel
    let row: ConversationCommandPresentation
    let openAttachment: (ConversationAttachmentReference) -> Void
    private var failed: Bool { row.record.state == .uncertain || row.record.state == .rejected }
    var body: some View {
        VStack(alignment: .trailing, spacing: AppleTokens.Space.p7) {
            MessageView(model: model, message: row.optimisticMessage, openAttachment: openAttachment)
                .opacity(row.record.state == .accepted ? 1 : AppleTokens.Opacity.disabled)
            if row.record.state != .accepted {
                HStack {
                    Text(failed ? "发送失败，草稿已保留" : "发送中")
                    if failed {
                        Button("重试") { Task { await model.retryMessage(row.id, accountEpoch: model.accountEpoch) } }
                            .disabled(model.reconcilingRequests.contains(row.id))
                    }
                }.font(AppleTokens.Fonts.caption).foregroundStyle(failed ? Weave.danger : Weave.muted)
            }
        }.accessibilityIdentifier("optimisticMessage." + row.id)
    }
}
