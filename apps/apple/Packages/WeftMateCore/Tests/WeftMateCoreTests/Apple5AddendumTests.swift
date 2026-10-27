import Testing
@testable import WeftMateCore

@Test func apple5AttachmentCardKeepsDraftAndKeyboardIndependent() {
    #expect(PhoneComposerPrimaryAction.resolve(running:false,draft:"",attachmentCount:0) == .voice)
    #expect(PhoneComposerPrimaryAction.resolve(running:false,draft:"",attachmentCount:1) == .send)
    #expect(PhoneComposerPrimaryAction.resolve(running:true,draft:"",attachmentCount:0) == .stop)
    // Preserve the existing ability to send guidance while a reply is running.
    #expect(PhoneComposerPrimaryAction.resolve(running:true,draft:"继续补充",attachmentCount:0) == .send)
}
@Test func apple5ApprovalChoiceMapsOnlyToExistingDecisionScopes() {
    #expect(PhoneApprovalChoice.once.outcome == .allowedOnce && PhoneApprovalChoice.once.scope(global:true) == .once)
    #expect(PhoneApprovalChoice.category.scope(global:true) == .globalCategory)
    #expect(PhoneApprovalChoice.category.scope(global:false) == .conversationCategory)
    #expect(PhoneApprovalChoice.reject.outcome == .rejected && PhoneApprovalChoice.reject.scope(global:true) == nil)
    #expect(PhoneApprovalChoice.allCases.map(\.title) == ["仅这一次","以后这类都允许","拒绝"])
}

@Test func apple5ReceiptRequiresVerifiedRegistrationAndDoesNotClaimExecution() {
    #expect(PhoneDecisionReceiptPolicy.approval(status:.pending,summary:"需要审批",registered:false,savedOutcome:.rejected) == nil)
    #expect(PhoneDecisionReceiptPolicy.approval(status:.pending,summary:"需要审批",registered:true,savedOutcome:.rejected) == "已拒绝 · 等待电脑确认")
    #expect(PhoneDecisionReceiptPolicy.approval(status:.pending,summary:"需要审批",registered:true,savedOutcome:.allowedOnce) == "已允许 · 等待电脑确认")
    #expect(PhoneDecisionReceiptPolicy.approval(status:.resolved,summary:"已拒绝",registered:true,savedOutcome:.rejected) == "已拒绝")
}
