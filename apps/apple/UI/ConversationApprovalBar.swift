import SwiftUI
import WeftMateCore

struct ConversationApprovalBar: View {
    @ObservedObject var model: TaskInteractionModel
    let events: [TimelineEvent]
    @State private var expanded = false
    @FocusState private var approveFocused: Bool
    var body: some View {
        if let approval = model.pendingApprovals.first {
            let key = "approval:" + approval.id
            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                HStack(alignment: .center, spacing: AppleTokens.Space.p8) {
                    Button { expanded.toggle() } label: {
                        HStack(spacing: AppleTokens.Space.p5) {
                            WeftIcon(expanded ? "chevron" : "right", size: 16)
                            Text(model.readableApprovals[approval.id] ?? approval.readableSummary).lineLimit(expanded ? nil : 2)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.plain).accessibilityLabel("审批详情").accessibilityValue(expanded ? "已展开" : "已收起")
                    Button("批准") { Task { await model.decide(approval, outcome: .allowedOnce, decisionScope: .once) } }
                        .buttonStyle(PrimaryActionStyle(fillsWidth: false)).focused($approveFocused)
                        .accessibilityIdentifier("approveOnce." + approval.id)
                        #if os(macOS)
                        .onKeyPress(.return) {
                            guard approveFocused else { return .ignored }
                            Task { await model.decide(approval, outcome: .allowedOnce, decisionScope: .once) }
                            return .handled
                        }
                        #endif
                    Button("拒绝") { Task { await model.decide(approval, outcome: .rejected) } }
                        .buttonStyle(OutlineActionStyle()).accessibilityIdentifier("rejectApproval." + approval.id)
                }.disabled(!model.canRespond(key))
                if model.pendingApprovals.count > 1 { Text("还有 \(model.pendingApprovals.count - 1) 个待批准").foregroundStyle(Weave.muted) }
                if expanded {
                    Text(model.approvalDetails[approval.id] ?? approval.reason).font(AppleTokens.Fonts.caption.monospaced()).textSelection(.enabled)
                    Text(approval.reversalNotice).foregroundStyle(Weave.muted)
                    if !(approval.riskCategories ?? []).isEmpty {
                        Button("总是允许此类") { Task { await model.decide(approval, outcome: .allowedOnce, decisionScope: .conversationCategory) } }.disabled(!model.canRespond(key))
                    }
                }
                if let error = model.errors[key] { Text(error).foregroundStyle(Weave.danger) }
                if model.hasSaved(key) {
                    Button("核对并继续原提交") { Task { await model.continueOriginal(key) } }.disabled(model.busy.contains(key))
                }
            }.font(AppleTokens.Fonts.caption).padding(AppleTokens.Space.p10)
                .background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
                .accessibilityIdentifier("approvalBar")
                .task(id: approval.id) { expanded = false; approveFocused = false; await model.readApprovalPresentation(approval, events: events) }
        }
    }
}
