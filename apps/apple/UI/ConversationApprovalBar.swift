import SwiftUI
import WeftMateCore

struct ConversationApprovalBar: View {
    @ObservedObject var model: TaskInteractionModel
    let events: [TimelineEvent]
    @State private var expanded = false
    @FocusState private var approveFocused: Bool
    @FocusState private var rejectFocused: Bool
    private var collapsedLines: Int {
        #if os(iOS)
        1
        #else
        2
        #endif
    }
    var body: some View {
        if let approval = model.pendingApprovals.first {
            let key = "approval:" + approval.id
            #if os(iOS)
            let warning = approval.secondOpinion?.recommendsRejection == true
            #else
            let warning = false
            #endif
            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                HStack(alignment: .center, spacing: AppleTokens.Space.p8) {
                    Button { expanded.toggle() } label: {
                        HStack(spacing: AppleTokens.Space.p5) {
                            WeftIcon(expanded ? "chevron" : "right", size: 16)
                            Text(model.approvalHeadline(approval)).lineLimit(expanded ? nil : collapsedLines)
                                .truncationMode(.tail)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.plain).accessibilityLabel(model.approvalHeadline(approval) + "，审批详情").accessibilityIdentifier("approvalDetails").accessibilityValue(expanded ? "已展开" : "已收起")
                    Button("批准") { Task { await model.decide(approval, outcome: .allowedOnce, decisionScope: .once) } }
                        .buttonStyle(ApprovalChoiceStyle(primary: !warning)).phoneFixedActionLabel().disabled(!model.canRespond(key)).focused($approveFocused)
                        .accessibilityIdentifier("approveOnce." + approval.id)
                        #if os(macOS)
                        .onKeyPress(.return) {
                            guard approveFocused else { return .ignored }
                            Task { await model.decide(approval, outcome: .allowedOnce, decisionScope: .once) }
                            return .handled
                        }
                        #endif
                    Button("拒绝") { Task { await model.decide(approval, outcome: .rejected) } }
                        .buttonStyle(ApprovalChoiceStyle(primary: warning)).phoneFixedActionLabel().disabled(!model.canRespond(key)).focused($rejectFocused).accessibilityIdentifier("rejectApproval." + approval.id)
                }
                #if os(iOS)
                HStack(spacing: AppleTokens.Space.p8) {
                    if let opinion = approval.secondOpinion {
                        Text(opinion.text).foregroundStyle(opinion.recommendsRejection ? Weave.danger : Weave.muted)
                            .lineLimit(expanded ? nil : 1).frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityLabel(opinion.text).accessibilityIdentifier("approvalSecondOpinion")
                    }
                    if approval.offersAlwaysAllow {
                        Button("以后这类都允许") { Task { await model.decide(approval, outcome: .allowedOnce, decisionScope: .globalCategory) } }
                            .buttonStyle(PhoneSecondaryChoiceStyle()).fixedSize(horizontal: true, vertical: false)
                            .disabled(!model.canRespond(key)).accessibilityIdentifier("approvalAlwaysAllow")
                    }
                }
                #endif
                if model.pendingApprovals.count > 1 { Text("还有 \(model.pendingApprovals.count - 1) 个待批准").foregroundStyle(Weave.muted) }
                if model.pendingQuestionCount > 0 { Text("处理审批后还有 \(model.pendingQuestionCount) 个问题").foregroundStyle(Weave.muted) }
                if expanded {
                    Text(ToolStepDetail(raw: model.approvalDetails[approval.id] ?? approval.reason).readableText).font(AppleTokens.Fonts.caption.monospaced()).textSelection(.enabled)
                    if let risk = approval.readableRisk { Text(risk).foregroundStyle(Weave.muted) }
                    Text(approval.reversalNotice).foregroundStyle(Weave.muted)
                    if !(approval.riskCategories ?? []).isEmpty {
                        Button("总是允许此类") { Task { await model.decide(approval, outcome: .allowedOnce, decisionScope: .conversationCategory) } }.disabled(!model.canRespond(key))
                    }
                }
                if let error = model.errors[key] { Text(error).foregroundStyle(Weave.danger) }
                if model.hasSaved(key) {
                    Button("核对并继续原提交") { Task { await model.continueOriginal(key) } }.disabled(model.busy.contains(key))
                }
            }.font(AppleTokens.Fonts.caption)
                #if os(iOS)
                .phoneCard()
                #else
                .padding(AppleTokens.Space.p10).background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
                #endif
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("approvalBar")
                #if os(iOS)
                .onChange(of: approval.secondOpinion) { _, opinion in if opinion?.recommendsRejection == true { approveFocused = false; rejectFocused = true } }
                #endif
                .task(id: approval.id) { expanded = false; approveFocused = false; rejectFocused = warning; await model.readApprovalPresentation(approval, events: events) }
        } else { ConversationQuestionBar(model: model) }
    }
}

private struct ApprovalChoiceStyle: ButtonStyle {
    let primary: Bool
    @Environment(\.isEnabled) private var enabled
    @ViewBuilder func makeBody(configuration: Configuration) -> some View {
        #if os(iOS)
        configuration.label.font(AppleTokens.Fonts.callout.weight(.medium))
            .frame(minWidth: AppleTokens.Space.p64, minHeight: AppleTokens.Space.p44)
            .foregroundStyle(primary ? Weave.onAccent : Weave.accent)
            .background(primary ? Weave.accent : Weave.surface, in: Capsule())
            .opacity(!enabled ? AppleTokens.Opacity.disabled : configuration.isPressed ? AppleTokens.Opacity.pressed : 1)
        #else
        if primary { PrimaryActionStyle(fillsWidth: false).makeBody(configuration: configuration) }
        else { OutlineActionStyle().makeBody(configuration: configuration) }
        #endif
    }
}

#if os(iOS)
private struct PhoneSecondaryChoiceStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(AppleTokens.Fonts.caption)
            .padding(.horizontal, AppleTokens.Space.p8).padding(.vertical, AppleTokens.Space.p6)
            .foregroundStyle(Weave.muted).background(Weave.surface, in: Capsule())
            .frame(minHeight: AppleTokens.Space.p44).contentShape(Capsule())
            .opacity(!enabled ? AppleTokens.Opacity.disabled : configuration.isPressed ? AppleTokens.Opacity.pressed : 1)
    }
}
#endif
