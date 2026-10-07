import SwiftUI
import WeftMateCore
#if os(iOS)
import UIKit
#endif

/// The same task's permission and information prompts, in its conversation and detail.
struct TaskInteractionView: View {
    @ObservedObject private var appModel: AppleAppModel
    @StateObject private var model: TaskInteractionModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var refreshRevision = 0
    @State private var choices: [String: Set<String>] = [:]
    @State private var text: [String: String] = [:]
    @FocusState private var focusedQuestion: String?
    private let snapshot: TaskSnapshot

    init(appModel: AppleAppModel, snapshot: TaskSnapshot) {
        self.appModel = appModel; self.snapshot = snapshot
        _model = StateObject(wrappedValue: TaskInteractionModel(client: appModel.assistantClient,
            account: appModel.session, epoch: appModel.accountEpoch, stateDirectory: appModel.assistantStateDirectory,
            currentEpoch: { [weak appModel] in appModel?.accountEpoch ?? UUID() },
            currentSession: { [weak appModel] in appModel?.session }))
    }

    private struct ReadIdentity: Equatable {
        let phase: ScenePhase
        let revision: Int
        let snapshot: TaskSnapshot
    }
    private var observationKey: ReadIdentity {
        .init(phase: scenePhase, revision: refreshRevision, snapshot: snapshot)
    }
    private var hasContent: Bool {
        !model.approvals.isEmpty || !model.questions.isEmpty || model.approvalError != nil || model.questionError != nil ||
            model.hasMoreApprovals || model.hasMoreQuestions
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if model.isCurrent, hasContent {
                HStack {
                    Text(model.approvals.contains(where: { $0.canDecide }) || model.questions.contains(where: { $0.canAnswer })
                         ? "需要你的回应" : "回应记录").font(.headline).foregroundStyle(Weave.ink)
                    Spacer()
                    Button { refreshRevision += 1 } label: { Image(systemName: "arrow.clockwise") }
                        .accessibilityLabel("核对任务中的审批和问题")
                        .accessibilityIdentifier("refreshTaskInteractions")
                        .disabled(model.loading || !model.busy.isEmpty)
                    if model.loading { ProgressView().controlSize(.small) }
                }
                ForEach(model.approvals) { approval in approvalCard(approval) }
                ForEach(model.questions) { question in questionCard(question) }
                if let error = model.approvalError { Text("审批：" + error).font(.caption).foregroundStyle(Weave.muted) }
                if let error = model.questionError { Text("信息问答：" + error).font(.caption).foregroundStyle(Weave.muted) }
                if let error = model.persistenceError { InlineNotice(message: error, isError: true) }
                if model.hasMoreApprovals {
                    Button("读取更早的审批") { Task { await model.loadMoreApprovals() } }.disabled(model.loading)
                }
                if model.hasMoreQuestions {
                    Button("读取更早的问题") { Task { await model.loadMoreQuestions() } }.disabled(model.loading)
                }
            }
        }
        .task(id: observationKey) {
            model.suspend()
            guard scenePhase == .active else { return }
            model.activate()
            var policy = ConversationPollingPolicy()
            while !Task.isCancelled && model.isCurrent {
                let oldApprovals = model.approvals, oldQuestions = model.questions
                await model.refresh(snapshot)
                guard !Task.isCancelled, model.isCurrent, model.approvalError == nil, model.questionError == nil,
                      model.needsObservation || TaskPresentation.needsObservation(snapshot) else { return }
                do { try await Task.sleep(nanoseconds: policy.delayNanoseconds(madeProgress:
                    oldApprovals != model.approvals || oldQuestions != model.questions)) }
                catch { return }
            }
        }
        .onDisappear { focusedQuestion = nil; model.suspend() }
        .onChange(of: appModel.accountEpoch) { _, _ in
            focusedQuestion = nil; choices = [:]; text = [:]; model.cancel()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("taskInteractions.\(snapshot.taskId)")
    }

    private func approvalCard(_ approval: SessionApproval) -> some View {
        let key = "approval:" + approval.id
        return VStack(alignment: .leading, spacing: 10) {
            Label("操作审批", systemImage: "hand.raised").font(.subheadline.weight(.semibold)).foregroundStyle(Weave.ink)
            Text(approval.reason).font(.callout).foregroundStyle(Weave.ink).textSelection(.enabled)
            Text(approval.toolName).font(.caption).foregroundStyle(Weave.muted)
            if approval.canDecide, !model.hasSaved(key) {
                HStack(spacing: 12) {
                    Button("仅允许这一次") { endInput(); Task { await model.decide(approval, outcome: .allowedOnce) } }
                        .accessibilityIdentifier("approveOnce.\(approval.id)")
                    Button("拒绝") { endInput(); Task { await model.decide(approval, outcome: .rejected) } }
                        .accessibilityIdentifier("rejectApproval.\(approval.id)")
                }
                .buttonStyle(.bordered).tint(Weave.accent).disabled(!model.canRespond(key))
            }
            responseState(key, status: approval.status,
                observed: model.currentApprovals.contains(approval.id))
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Weave.canvas, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("approvalCard.\(approval.id)")
    }

    private func questionCard(_ batch: SessionQuestionBatch) -> some View {
        let key = "question:" + batch.id
        let editable = batch.canAnswer && !model.hasSaved(key)
        return VStack(alignment: .leading, spacing: 14) {
            Label("补充信息", systemImage: "text.bubble").font(.subheadline.weight(.semibold)).foregroundStyle(Weave.ink)
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
                .buttonStyle(.borderedProminent).tint(Weave.accent)
                .disabled(!model.canRespond(key) || !complete(batch))
                .accessibilityIdentifier("submitQuestion.\(batch.id)")
            }
            responseState(key, status: batch.status, observed: model.currentQuestions.contains(batch.id))
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Weave.canvas, in: RoundedRectangle(cornerRadius: 16))
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
                        Image(systemName: (choices[field] ?? []).contains(option.label)
                            ? "checkmark.circle.fill" : "circle").foregroundStyle(Weave.accent)
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
            }.buttonStyle(.bordered).disabled(model.loading || model.busy.contains(key))
                .accessibilityIdentifier("continueInteraction.\(key)")
        }
    }
}
