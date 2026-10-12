import Testing
@testable import WeftMateCore

@Test func apple5AttachmentCardKeepsDraftAndKeyboardIndependent() {
    let attachment=PhoneComposerState(attachmentCount:2,keyboardVisible:false)
    #expect(attachment.expanded && attachment.maximumLines == 3 && attachment.showsNavigation)
    #expect(PhoneComposerState(draft:"草稿",keyboardVisible:false).expanded)
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
