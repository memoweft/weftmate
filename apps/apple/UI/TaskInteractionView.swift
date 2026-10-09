import SwiftUI
import WeftMateCore
#if os(iOS)
import UIKit
#endif

/// An authenticated interaction projected at its original timeline position.
struct TimelineInteractionCard: View {
    @ObservedObject var model: TaskInteractionModel
    let entry: TimelineEntry
    let events: [TimelineEvent]
    @State private var choices: [String: Set<String>] = [:]
    @State private var text: [String: String] = [:]
    @FocusState private var focusedQuestion: String?
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
            if entry.event.type.hasPrefix("approval.") {
                if let approval = model.approvals.first(where: { $0.id == entry.event.data["approvalId"]?.string }) {
                    if approval.canDecide && entry.resolved == nil { approvalCard(approval) }
                    else { WeftLabel(approval.decisionSummary, icon: "approval", size: 16).font(AppleTokens.Fonts.caption)
                            .accessibilityIdentifier("approvalSummary.\(approval.id)") }
                } else { unavailableCard }
            } else if let batch = questionBatch {
                if let summary = model.answeredSummary(batch) { Text(summary).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("answeredQuestion." + batch.id) }
            } else { unavailableCard }
        }
    }
    private var questionBatch: SessionQuestionBatch? {
        // A session may ask repeatedly within a turn. Only bind to the last ask not later than observedSeq.
        model.questions.first { batch in
            guard batch.turn == entry.event.data["turn"]?.int, let observed = batch.observedSeq else { return false }
            return events.last(where: { $0.type == "question.asked" && $0.data["turn"]?.int == batch.turn && $0.seq <= observed })?.seq == entry.event.seq
        }
    }
    private var unavailableCard: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            Text(entry.resolved != nil ? "已处理" : entry.event.type.hasPrefix("approval.") ? "需要审批" : "需要补充信息").font(AppleTokens.Fonts.headline)
            Text(OperationNames.text(entry.event.data["summary"]?.string ?? "")).font(AppleTokens.Fonts.callout)
            if entry.resolved == nil {
                Text("回应状态尚未核对。" ).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                if model.hasMoreApprovals && entry.event.type.hasPrefix("approval.") {
                    Button("读取更早的审批") { Task { await model.loadMoreApprovals() } }
                } else if model.hasMoreQuestions { Button("读取更早的问题") { Task { await model.loadMoreQuestions() } } }
            }
        }.padding(AppleTokens.Space.p14).background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r14))
    }

    private func approvalCard(_ approval: SessionApproval) -> some View {
        let key = "approval:" + approval.id
        return VStack(alignment: .leading, spacing: AppleTokens.Space.p10) {
            WeftLabel("需要审批", icon: "approval").font(AppleTokens.Fonts.subheadline.weight(.semibold)).foregroundStyle(Weave.ink)
            Text(model.readableApprovals[approval.id] ?? approval.readableSummary).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.ink).textSelection(.enabled)
            if let reason = approval.readableRisk { Text(reason).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            DisclosureGroup("详情") { Text(ToolStepDetail(raw: model.approvalDetails[approval.id] ?? approval.reason).readableText).font(AppleTokens.Fonts.caption.monospaced()).textSelection(.enabled) }
            if !approval.riskLabels.isEmpty {
                Text("风险类别：" + approval.riskLabels.joined(separator: "、"))
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.secondary)
            }
            Text(approval.reversalNotice).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            if !(approval.riskCategories ?? []).isEmpty {
                Text("总是允许此类：用于本对话后续同类操作。")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }
            if approval.canDecide, !model.hasSaved(key) {
                ViewThatFits(in: .horizontal) {
                    approvalButtons(approval, key: key, vertical: false)
                    approvalButtons(approval, key: key, vertical: true)
                }
            }
            responseState(key, status: approval.status,
                observed: model.currentApprovals.contains(approval.id))
        }
        .padding(AppleTokens.Space.p14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r14))
        .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r14).strokeBorder(Weave.line))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("approvalCard.\(approval.id)")
        .task(id: approval.id) { await model.readApprovalPresentation(approval, events: events) }
    }

    private func approvalButtons(_ approval: SessionApproval, key: String, vertical: Bool) -> some View {
        let layout = vertical ? AnyLayout(VStackLayout(alignment: .leading, spacing: AppleTokens.Space.p8)) : AnyLayout(HStackLayout(spacing: AppleTokens.Space.p10))
        return layout {
            Button("允许一次") {
                endInput()
                Task { await model.decide(approval, outcome: .allowedOnce, decisionScope: .once) }
            }.buttonStyle(PrimaryActionStyle(fillsWidth: false)).accessibilityIdentifier("approveOnce.\(approval.id)")
            Button("总是允许此类") {
                endInput()
                Task { await model.decide(approval, outcome: .allowedOnce, decisionScope: .conversationCategory) }
            }
            .disabled((approval.riskCategories ?? []).isEmpty)
            .accessibilityIdentifier("approveCategory.\(approval.id)")
            Button("拒绝") { endInput(); Task { await model.decide(approval, outcome: .rejected) } }
                .accessibilityIdentifier("rejectApproval.\(approval.id)")
        }
        .buttonStyle(OutlineActionStyle()).tint(Weave.accent).disabled(!model.canRespond(key))
    }

    private func endInput() {
        focusedQuestion = nil
        #if os(iOS)
        // A task response changes the current interaction; retain text while dismissing its keyboard.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        #endif
    }

    @ViewBuilder private func responseState(_ key: String, status: SessionInteractionStatus, observed: Bool) -> some View {
        if let notice = model.notices[key] {
            Text(notice).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.secondary).accessibilityIdentifier("interactionNotice.\(key)")
        } else if status == .pending, !observed, !model.loading {
            Text("这项回应尚待重新核对。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
        } else if !status.isKnown {
            Text("状态待核对，刷新后继续。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
        }
        if let error = model.errors[key] { InlineNotice(message: error, isError: true) }
        if model.busy.contains(key) { ProgressView().controlSize(.small) }
        if model.hasSaved(key), status == .pending || status == .answered {
            Button(model.responseNeedsReadback(key) ? "核对并继续原提交" : "核对接收状态") {
                Task { await model.continueOriginal(key) }
            }.buttonStyle(OutlineActionStyle()).disabled(model.loading || model.busy.contains(key))
                .accessibilityIdentifier("continueInteraction.\(key)")
        }
    }
}
