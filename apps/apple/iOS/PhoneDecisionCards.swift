import SwiftUI
import WeftMateCore

struct PhoneApprovalCard: View {
    @Environment(\.phoneWorkApp) private var app
    @ObservedObject var model: TaskInteractionModel
    var approval: SessionApproval
    var events: [TimelineEvent]
    @State private var choice: PhoneApprovalChoice = .once
    private var key: String { "approval:"+approval.id }
    private var hasCategory: Bool { approval.offersAlwaysAllow || !(approval.riskCategories ?? []).isEmpty }
    var body: some View {
        if approval.isWorkSwitch, let app, app.mainChat.capabilities.supports("workAndChat") { PhoneWorkSwitchCard(app:app,model:model,approval:approval) }
        else { ordinaryCard }
    }
    private var ordinaryCard: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
            WeftLabel(model.approvalHeadline(approval),icon:"approval").font(AppleTokens.Fonts.headline).fixedSize(horizontal:false,vertical:true)
            if let risk=approval.readableRisk { Text(risk).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted) }
            DisclosureGroup("关键参数与详情") {
                Text(ToolStepDetail(raw:model.approvalDetails[approval.id] ?? approval.reason).readableText).font(AppleTokens.Fonts.caption).textSelection(.enabled)
                Text(approval.reversalNotice).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }.accessibilityIdentifier("approvalDetails")
            if let opinion=approval.secondOpinion { Text(opinion.text).font(AppleTokens.Fonts.callout).foregroundStyle(opinion.recommendsRejection ? Weave.danger : Weave.muted).accessibilityIdentifier("approvalSecondOpinion") }
            if hasCategory {
                ForEach(PhoneApprovalChoice.allCases,id:\.rawValue) { value in
                    Button { choice=value } label: { PhoneChoiceLabel(title:value.title,selected:choice == value) }
                        .buttonStyle(.plain).disabled(!model.canRespond(key)).accessibilityLabel(value.title).accessibilityValue(choice == value ? "已选择" : "未选择")
                        .accessibilityIdentifier(value == .category ? (approval.offersAlwaysAllow ? "approvalAlwaysAllow" : "approveCategory."+approval.id) : value == .once ? "approveOnce."+approval.id : "rejectApproval."+approval.id)
                }
                if !approval.offersAlwaysAllow { Text("以后这类都允许只用于当前对话。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                HStack { Spacer(); Button("确认") { submit(choice) }.buttonStyle(PhoneDecisionActionStyle(primary:true)).disabled(!model.canRespond(key)).accessibilityIdentifier("approvalConfirm."+approval.id) }
            } else {
                HStack { Spacer(); Button("拒绝") { submit(.reject) }.buttonStyle(PhoneDecisionActionStyle(primary:false)).disabled(!model.canRespond(key)).accessibilityIdentifier("rejectApproval."+approval.id)
                    Button("批准") { submit(.once) }.buttonStyle(PhoneDecisionActionStyle(primary:true)).disabled(!model.canRespond(key)).accessibilityIdentifier("approveOnce."+approval.id) }
            }
            if model.pendingApprovals.count>1 { Text("还有 \(model.pendingApprovals.count-1) 个待批准").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            if model.pendingQuestionCount>0 { Text("处理审批后还有 \(model.pendingQuestionCount) 个问题").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            if let error=model.errors[key] { InlineNotice(message:error,isError:true) }
            if model.hasSaved(key) { Button("核对并继续原提交") { Task { await model.continueOriginal(key) } }.disabled(model.busy.contains(key)) }
        }.phoneDecisionCard().accessibilityElement(children:.contain).accessibilityIdentifier("approvalCard."+approval.id)
            .task(id:approval.id) { choice = .once; await model.readApprovalPresentation(approval,events:events) }
    }
    private func submit(_ choice: PhoneApprovalChoice) { Task { await model.decide(approval,outcome:choice.outcome,decisionScope:choice.scope(global:approval.offersAlwaysAllow)) } }
}
struct PhoneQuestionCard: View {
    @ObservedObject var model: TaskInteractionModel
    var batch: SessionQuestionBatch
    @FocusState private var writing: Bool
    private var draft: QuestionBarDraft { model.questionDrafts[batch.id] ?? .init() }
    private func update(_ change: (inout QuestionBarDraft) -> Void) { var value=draft; change(&value); model.questionDrafts[batch.id]=value }
    var body: some View {
        if !batch.questions.isEmpty {
            let index=min(draft.index,batch.questions.count-1),question=batch.questions[index],key="question:"+batch.id
            VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                WeftLabel(question.question,icon:"plan").font(AppleTokens.Fonts.headline).fixedSize(horizontal:false,vertical:true)
                let remaining=batch.questions.count-index-1+model.pendingQuestions.dropFirst().reduce(0) { $0+$1.questions.count }
                Text("还有 \(remaining) 个问题").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("questionRemaining")
                if question.header != nil || question.detail != nil {
                    DisclosureGroup("说明") {
                        if let header=question.header { Text(header).foregroundStyle(Weave.muted) }
                        if let detail=question.detail { Text(detail).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted) }
                    }.accessibilityIdentifier("questionDetails")
                }
                if question.multiSelect == true { Text("可多选，也可补充说明").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                if !model.hasSaved(key) {
                    ForEach(question.options ?? [],id:\.label) { option in
                        Button { writing=false; update { $0.select(option.label,question:question) } } label: {
                            VStack(alignment:.leading,spacing:AppleTokens.Space.p4) {
                                PhoneChoiceLabel(title:option.label,selected:draft.choices[question.id,default:[]].contains(option.label))
                                if let detail=option.description { Text(detail).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).padding(.leading,AppleTokens.Space.p32) }
                            }
                        }.buttonStyle(.plain).disabled(!model.canRespond(key)).accessibilityLabel(option.label).accessibilityIdentifier("questionOption."+question.id+"."+option.label)
                            .accessibilityValue(draft.choices[question.id,default:[]].contains(option.label) ? "已选择" : "未选择")
                    }
                    TextField((question.options ?? []).isEmpty ? "写下回答" : "其他…",text:Binding(get:{draft.custom[question.id] ?? ""},set:{text in update { $0.write(text,question:question) }}),axis:.vertical).lineLimit(1...3).weaveField().focused($writing).accessibilityIdentifier("questionCustom."+question.id)
                    HStack {
                        if index>0 { Button("上一题") { writing=false; update { $0.index -= 1 } }.accessibilityIdentifier("questionPrevious") }
                        Spacer()
                        if index<batch.questions.count-1 { Button("下一题") { writing=false; update { $0.index += 1 } }.disabled(!draft.complete(question) || !model.canRespond(key)).accessibilityIdentifier("questionNext") }
                        else { Button("确认") { writing=false; let value=draft; Task { await model.answer(batch,answers:batch.questions.map(value.answer)) } }.buttonStyle(PhoneDecisionActionStyle(primary:true)).disabled(!batch.questions.allSatisfy(draft.complete) || !model.canRespond(key)).accessibilityLabel("提交回答").accessibilityIdentifier("submitQuestion."+batch.id) }
                    }
                } else { Text("提交结果待核对，原请求已保留。").foregroundStyle(Weave.muted); Button("核对并继续原提交") { Task { await model.continueOriginal(key) } }.disabled(model.busy.contains(key)) }
                if let error=model.errors[key] { InlineNotice(message:error,isError:true) }
            }.phoneDecisionCard().accessibilityElement(children:.contain).accessibilityIdentifier("questionBar")
        }
    }
}
private struct PhoneChoiceLabel: View {
    var title: String; var selected: Bool
    var body: some View {
        HStack(spacing:AppleTokens.Space.p12) {
            ZStack { Circle().stroke(Weave.muted,lineWidth:AppleTokens.Space.p2); if selected { Circle().fill(Weave.ink).padding(AppleTokens.Space.p5) } }.frame(width:AppleTokens.Space.p24,height:AppleTokens.Space.p24)
            Text(title).font(AppleTokens.Fonts.body).fixedSize(horizontal:false,vertical:true); Spacer(minLength:AppleTokens.Space.p0)
        }.frame(minHeight:AppleTokens.Space.p44).contentShape(Rectangle())
    }
}
struct PhonePendingDecision: View {
    @ObservedObject var model: TaskInteractionModel
    var events: [TimelineEvent]
    var body: some View {
        if let approval=model.pendingApprovals.first { PhoneApprovalCard(model:model,approval:approval,events:events) }
        else if let question=model.pendingQuestions.first { PhoneQuestionCard(model:model,batch:question) }
        else if let question=model.questions.first(where:{($0.status == .answered || $0.status == .resolved || model.isRegistered("question:"+$0.id))}),let receipt=model.answeredSummary(question) { Text(receipt).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("answeredQuestion."+question.id) }
        else if let approval=model.approvals.first(where:{receipt($0) != nil}),let summary=receipt(approval) { WeftLabel(summary,icon:"approval").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).accessibilityIdentifier("approvalSummary."+approval.id) }
    }
    private func receipt(_ row: SessionApproval) -> String? {
        if row.isWorkSwitch {
            let outcome = row.decisionOutcome?.rawValue ?? (model.isRegistered("approval:"+row.id) ? model.savedApprovalOutcome(row)?.rawValue : nil)
            if outcome == "allowed-once" { return "已切换到工作，电脑操作仍按原来的权限询问。" }
            if outcome == "rejected" { return "继续对话，这次不操作电脑。" }
        }
        return PhoneDecisionReceiptPolicy.approval(status:row.status,summary:row.decisionSummary,registered:model.isRegistered("approval:"+row.id),savedOutcome:model.savedApprovalOutcome(row))
    }
}
struct PhonePendingDecisionNotice: View {
    @ObservedObject var model: TaskInteractionModel
    var open: () -> Void
    var body: some View {
        if !model.pendingApprovals.isEmpty || !model.pendingQuestions.isEmpty {
            Button("有一项等你决定",action:open).font(AppleTokens.Fonts.caption).buttonStyle(OutlineActionStyle()).accessibilityIdentifier("phone.pendingDecision.open")
        }
    }
}
private extension View {
    func phoneDecisionCard() -> some View {
        self.frame(maxWidth:.infinity,alignment:.leading).padding(AppleTokens.Space.p16)
            .background(Weave.surface,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r24))
            .overlay(RoundedRectangle(cornerRadius:AppleTokens.Radius.r24).strokeBorder(Weave.line))
    }
}

private struct PhoneDecisionActionStyle: ButtonStyle {
    var primary: Bool
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(AppleTokens.Fonts.callout.weight(.medium)).padding(.horizontal,AppleTokens.Space.p16)
            .frame(minWidth:AppleTokens.Space.p64,minHeight:AppleTokens.Space.p44)
            .foregroundStyle(primary ? Weave.onAccent : Weave.ink)
            .background(primary ? Weave.accent : Weave.surface,in:Capsule())
            .overlay(Capsule().strokeBorder(primary ? AppleTokens.Colors.clear : Weave.line))
            .opacity(!enabled ? AppleTokens.Opacity.disabled : configuration.isPressed ? AppleTokens.Opacity.pressed : 1)
    }
}
