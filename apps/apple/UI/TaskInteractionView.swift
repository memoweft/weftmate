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
        VStack(alignment: .leading, spacing: 12) {
            if entry.event.type.hasPrefix("approval.") {
                if let approval = model.approvals.first(where: { $0.id == entry.event.data["approvalId"]?.string }) {
                    if approval.canDecide && entry.resolved == nil { approvalCard(approval) }
                    else { WeftLabel(approval.decisionSummary, icon: "approval", size: 16).font(.caption)
                            .accessibilityIdentifier("approvalSummary.\(approval.id)") }
                } else { unavailableCard }
            } else if let batch = questionBatch {
                if batch.canAnswer && entry.resolved == nil { questionCard(batch) }
                else { WeftLabel(model.notices["question:" + batch.id] ?? "已回答", icon: "chat", size: 16).font(.caption) }
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
        VStack(alignment: .leading, spacing: 8) {
            Text(entry.resolved != nil ? "已处理" : entry.event.type.hasPrefix("approval.") ? "需要审批" : "需要补充信息").font(.headline)
            Text(entry.event.data["summary"]?.string ?? "").font(.callout)
            if entry.resolved == nil {
                Text("回应状态尚未核对。" ).font(.caption).foregroundStyle(Weave.muted)
                if model.hasMoreApprovals && entry.event.type.hasPrefix("approval.") {
                    Button("读取更早的审批") { Task { await model.loadMoreApprovals() } }
                } else if model.hasMoreQuestions { Button("读取更早的问题") { Task { await model.loadMoreQuestions() } } }
            }
        }.padding(14).background(Weave.soft, in: RoundedRectangle(cornerRadius: 14))
    }

    private func approvalCard(_ approval: SessionApproval) -> some View {
        let key = "approval:" + approval.id
        return VStack(alignment: .leading, spacing: 10) {
            WeftLabel("需要审批", icon: "approval").font(.subheadline.weight(.semibold)).foregroundStyle(Weave.ink)
            Text(approval.reason).font(.callout).foregroundStyle(Weave.ink).textSelection(.enabled)
            if !approval.riskLabels.isEmpty {
                Text("风险类别：" + approval.riskLabels.joined(separator: "、"))
                    .font(.caption).foregroundStyle(Weave.secondary)
            }
            Text(approval.reversalNotice).font(.caption).foregroundStyle(Weave.muted)
            if !(approval.riskCategories ?? []).isEmpty {
                Text("总是允许此类：用于本对话后续同类操作。")
                    .font(.caption).foregroundStyle(Weave.muted)
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
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Weave.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Weave.line))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("approvalCard.\(approval.id)")
    }

    private func approvalButtons(_ approval: SessionApproval, key: String, vertical: Bool) -> some View {
        let layout = vertical ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 10))
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

    private func questionCard(_ batch: SessionQuestionBatch) -> some View {
        let key = "question:" + batch.id
        let planReview = batch.questions.contains { $0.intent?["kind"]?.string == "plan-review" }
        let editable = batch.canAnswer && !model.hasSaved(key)
        return VStack(alignment: .leading, spacing: 14) {
            WeftLabel(planReview ? "确认执行计划" : "补充信息", icon: "chat")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Weave.ink)
            if planReview {
                Text("确认计划后开始执行；危险操作仍会询问。")
                    .font(.caption).foregroundStyle(Weave.muted)
            }
            ForEach(batch.questions) { question in
                VStack(alignment: .leading, spacing: 8) {
                    if let header = question.header, !header.isEmpty {
                        Text(header).font(.caption.weight(.semibold)).foregroundStyle(Weave.muted)
                    }
                    Text(question.question).font(.callout.weight(.medium)).foregroundStyle(Weave.ink)
                    if let detail = question.detail, !detail.isEmpty {
                        Text(detail).font(.caption).foregroundStyle(Weave.secondary).textSelection(.enabled)
                    }
                    if editable {
                        questionEditor(question, batch: batch).disabled(!model.isCurrent ||
                            model.persistenceError != nil || model.busy.contains(key))
                    } else if let answer = model.savedAnswers(batch)?.first(where: { $0.id == question.id }) {
                        Text((answer.selected + (answer.custom.map { [$0] } ?? [])).joined(separator: "；"))
                            .font(.callout).foregroundStyle(Weave.secondary).textSelection(.enabled)
                            .accessibilityIdentifier("submittedQuestionAnswer.\(batch.id).\(question.id)")
                    }
                }
            }
            if editable {
                Button("提交回答") {
                    endInput()
                    let values = answers(for: batch)
                    Task { await model.answer(batch, answers: values) }
                }
                .buttonStyle(PrimaryActionStyle(fillsWidth: false)).tint(Weave.accent)
                .disabled(!model.canRespond(key) || !complete(batch))
                .accessibilityIdentifier("submitQuestion.\(batch.id)")
            }
            responseState(key, status: batch.status, observed: model.currentQuestions.contains(batch.id))
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Weave.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Weave.line))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("questionCard.\(batch.id)")
    }

    private func questionEditor(_ question: SessionQuestion, batch: SessionQuestionBatch) -> some View {
        let field = batch.id + ":" + question.id
        return VStack(alignment: .leading, spacing: 8) {
            if question.multiSelect == true { Text("可多选，也可补充说明").font(.caption).foregroundStyle(Weave.muted) }
            ForEach(question.options ?? [], id: \.label) { option in
                Button {
                    var selected = choices[field] ?? []
                    if question.multiSelect == true {
                        if !selected.insert(option.label).inserted { selected.remove(option.label) }
                    } else { selected = [option.label]; text[field] = "" }
                    choices[field] = selected; endInput()
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        WeftIcon("allow", size: 16)
                            .opacity((choices[field] ?? []).contains(option.label) ? 1 : 0).foregroundStyle(Weave.accent)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(option.label).foregroundStyle(Weave.ink)
                            if let description = option.description, !description.isEmpty {
                                Text(description).font(.caption).foregroundStyle(Weave.muted)
                            }
                        }
                        Spacer(minLength: 0)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(option.label)
                .accessibilityValue((choices[field] ?? []).contains(option.label) ? "已选择" : "未选择")
                .accessibilityIdentifier("questionOption.\(batch.id).\(question.id).\(option.label)")
            }
            TextField((question.options ?? []).isEmpty ? "写下回答" : "填写补充回答",
                text: Binding(get: { text[field] ?? "" }, set: { value in
                    text[field] = value
                    if question.multiSelect != true, !value.isEmpty { choices[field] = [] }
                }), axis: .vertical)
                .lineLimit(1...5).textFieldStyle(.roundedBorder).focused($focusedQuestion, equals: field)
                .accessibilityIdentifier("questionCustom.\(batch.id).\(question.id)")
        }
    }

    private func answers(for batch: SessionQuestionBatch) -> [QuestionAnswerItem] {
        batch.questions.map { question in
            let field = batch.id + ":" + question.id
            let value = text[field] ?? ""
            let selected = (question.options ?? []).map(\.label).filter { (choices[field] ?? []).contains($0) }
            return QuestionAnswerItem(id: question.id, selected: selected,
                custom: value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : value)
        }
    }
    private func complete(_ batch: SessionQuestionBatch) -> Bool {
        answers(for: batch).allSatisfy { !$0.selected.isEmpty || $0.custom != nil }
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
            Text(notice).font(.caption).foregroundStyle(Weave.secondary).accessibilityIdentifier("interactionNotice.\(key)")
        } else if status == .pending, !observed, !model.loading {
            Text("这项回应尚待重新核对。").font(.caption).foregroundStyle(Weave.muted)
        } else if !status.isKnown {
            Text("状态待核对，刷新后继续。").font(.caption).foregroundStyle(Weave.muted)
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
