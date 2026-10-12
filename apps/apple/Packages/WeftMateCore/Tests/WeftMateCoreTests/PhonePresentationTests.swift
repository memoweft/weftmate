import Testing
@testable import WeftMateCore

@Test func phoneTitleUsesAssistantForMainAndConversationForSide() {
    #expect(PhonePresentation.title(main: true, assistant: "小纬", conversation: "主对话") == "小纬")
    #expect(PhonePresentation.title(main: false, conversation: "周末计划") == "周末计划")
    #expect(PhonePresentation.title(main: false, conversation: "  ") == "对话")
    #expect(PhonePresentation.title(main: true, assistant: "", conversation: "主对话") == "WeftMate")
}
@Test func phoneControlDisabledAndPressedOverrideSelection() {
    #expect(PhonePresentation.controlState(selected: true, pressed: true, enabled: false) == "disabled")
    #expect(PhonePresentation.controlState(selected: true, pressed: true, enabled: true) == "pressed")
    #expect(PhonePresentation.controlState(selected: true, pressed: false, enabled: true) == "selected")
    #expect(PhonePresentation.controlState(selected: false, pressed: false, enabled: true) == "normal")
}
@Test func phoneApprovalKeepsBothActionsOnNarrowRow() {
    for width in [320.0, 375, 390] {
        let headline = PhonePresentation.approvalHeadlineWidth(width: width, inset: 36, gap: 8, actionWidth: 64)
        #expect(headline >= 104)
        #expect(headline + 72 + 16 + 128 == width)
    }
}
@Test func phoneFiveTabsHaveRoomForLongestLabelAtMinimumWidth() {
    #expect(PhoneTab.allCases.map(\.title) == ["聊天", "动态", "健康", "目标", "成果库"])
    let width = PhonePresentation.tabWidth(width: 320, inset: 16, gap: 4)
    #expect(width >= 44)
    #expect(width >= Double(PhoneTab.resources.title.count) * 12)
    #expect(Set(PhoneTab.allCases.map(\.id)).count == 5)
}
