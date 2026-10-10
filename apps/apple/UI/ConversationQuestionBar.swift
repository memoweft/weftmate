import SwiftUI
import WeftMateCore

/// One question at a time; only the final action submits the original complete batch.
struct ConversationQuestionBar: View {
    @ObservedObject var model: TaskInteractionModel
    @State private var expanded = false
    @FocusState private var submitFocused: Bool
    @FocusState private var customFocused: Bool
    private func draft(_ batch: SessionQuestionBatch) -> QuestionBarDraft { model.questionDrafts[batch.id] ?? .init() }
    private func update(_ batch: SessionQuestionBatch, _ change: (inout QuestionBarDraft) -> Void) {
        var value = draft(batch); change(&value); model.questionDrafts[batch.id] = value
    }
    var body: some View {
        let submitFocus = $submitFocused
        if let batch = model.pendingQuestions.first, !batch.questions.isEmpty {
            let key = "question:" + batch.id
            let value = draft(batch)
            let index = min(value.index, batch.questions.count - 1)
            let question = batch.questions[index]
            let editable = !model.hasSaved(key)
            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                HStack {
                    Button { expanded.toggle() } label: {
                        HStack(spacing: AppleTokens.Space.p5) {
                            WeftIcon(expanded ? "chevron" : "right", size: 16)
                            Text(question.question).lineLimit(expanded ? nil : 2)
                        }
                    }.buttonStyle(.plain).accessibilityIdentifier("questionDetails").accessibilityValue(expanded ? "已展开" : "已收起")
                    Spacer(minLength: AppleTokens.Space.p0)
                    let remaining = batch.questions.count - index - 1 + model.pendingQuestions.dropFirst().reduce(0) { $0 + $1.questions.count }
                    Text("还有 \(remaining) 个问题").foregroundStyle(Weave.muted).accessibilityIdentifier("questionRemaining")
                }
                if expanded {
                    if let header = question.header { Text(header).foregroundStyle(Weave.muted) }
                    if let detail = question.detail { Text(detail).textSelection(.enabled) }
                    ForEach(question.options ?? [], id: \.label) { option in
                        if let description = option.description { Text(option.label + "：" + description).foregroundStyle(Weave.muted) }
                    }
                    if question.intent?["kind"]?.string == "plan-review" { Text("确认计划后开始执行；危险操作仍会询问。") }
                }
                if editable {
                    if question.multiSelect == true { Text("可多选，也可补充说明").foregroundStyle(Weave.muted) }
                    ViewThatFits(in: .horizontal) {
                        options(question, batch: batch, vertical: false)
                        options(question, batch: batch, vertical: true)
                    }
                    TextField((question.options ?? []).isEmpty ? "写下回答" : "其他…", text: Binding(get: { draft(batch).custom[question.id] ?? "" }, set: { text in update(batch) { $0.write(text, question: question) } }), axis: .vertical)
                        .lineLimit(1...3).weaveField().focused($customFocused)
                        .accessibilityIdentifier("questionCustom." + question.id)
                        #if os(macOS)
                        .onKeyPress(.return) { .handled }
                        #endif
                    HStack {
                        if index > 0 { Button("上一题") { update(batch) { $0.index -= 1 }; expanded = false }.accessibilityIdentifier("questionPrevious") }
                        Spacer(minLength: AppleTokens.Space.p0)
                        if index < batch.questions.count - 1 {
                            Button("下一题") { update(batch) { $0.index += 1 }; expanded = false; customFocused = false }
                                .disabled(!value.complete(question) || !model.canRespond(key)).accessibilityIdentifier("questionNext")
                        } else {
                            #if os(macOS)
                            ExplicitReturnButton(enabled: batch.questions.allSatisfy(value.complete) && model.canRespond(key), identifier: "submitQuestion." + batch.id) { submit(batch) }
                            #else
                            Button("提交回答") { submit(batch) }
                                .buttonStyle(PrimaryActionStyle(fillsWidth: false)).focusable(interactions: [.activate, .edit]).focused(submitFocus)
                                .disabled(!batch.questions.allSatisfy(value.complete) || !model.canRespond(key))
                                .accessibilityIdentifier("submitQuestion." + batch.id)
                                .onKeyPress(.return) { guard submitFocus.wrappedValue else { return .ignored }; submit(batch); return .handled }
                            #endif
                        }
                    }
                } else {
                    Text((model.savedAnswers(batch) ?? []).flatMap { $0.selected + ($0.custom.map { [$0] } ?? []) }.joined(separator: "；"))
                    Text(model.notices[key] ?? "提交结果待核对，原请求已保留。").foregroundStyle(Weave.muted)
                    Button("核对并继续原提交") { Task { await model.continueOriginal(key) } }
                        .disabled(model.loading || model.busy.contains(key)).accessibilityIdentifier("continueInteraction." + key)
                }
                if let error = model.errors[key] { Text(error).foregroundStyle(Weave.danger) }
                if model.busy.contains(key) { ProgressView().controlSize(.small) }
            }.font(AppleTokens.Fonts.caption).padding(AppleTokens.Space.p10)
                .background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
                .accessibilityElement(children: .contain).accessibilityIdentifier("questionBar")
                .onChange(of: batch.id) { _, _ in expanded = false; submitFocused = false; customFocused = false }
        }
    }
    private func options(_ question: SessionQuestion, batch: SessionQuestionBatch, vertical: Bool) -> some View {
        let layout = vertical ? AnyLayout(VStackLayout(alignment: .leading, spacing: AppleTokens.Space.p5)) : AnyLayout(HStackLayout(spacing: AppleTokens.Space.p5))
        return layout {
            ForEach(question.options ?? [], id: \.label) { option in
                Button { customFocused = false; update(batch) { $0.select(option.label, question: question) } } label: {
                    HStack(spacing: AppleTokens.Space.p5) {
                        if draft(batch).choices[question.id, default: []].contains(option.label) { WeftIcon("allow", size: 16) }
                        Text(option.label)
                    }
                }.buttonStyle(OutlineActionStyle()).disabled(!model.canRespond("question:" + batch.id))
                    .accessibilityLabel(option.label).accessibilityValue(draft(batch).choices[question.id, default: []].contains(option.label) ? "已选择" : "未选择")
                    .accessibilityIdentifier("questionOption." + question.id + "." + option.label)
            }
        }
    }
    private func submit(_ batch: SessionQuestionBatch) {
        let value = draft(batch)
        guard batch.questions.allSatisfy(value.complete), model.canRespond("question:" + batch.id) else { return }
        customFocused = false
        Task { await model.answer(batch, answers: batch.questions.map(value.answer)) }
    }
}
