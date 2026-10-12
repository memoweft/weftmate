import Testing
@testable import WeftMateCore

@Test func phoneComposerFocusDraftAttachmentsAndKeyboard() {
    var state = PhoneComposerState()
    #expect(!state.expanded && state.showsNavigation && state.maximumLines == 1)
    state.focused = true; state.keyboardVisible = true
    #expect(state.expanded && !state.showsNavigation && state.maximumLines == 6)
    state.draft = "第一行\n第二行"; state.focused = false; state.keyboardVisible = false
    #expect(state.expanded && state.showsNavigation)
    state.draft = ""; state.attachmentCount = 1
    #expect(state.expanded)
    state.attachmentCount = 0
    #expect(!state.expanded)
    state.keyboardVisible = true // A keyboard in another control must not expand an empty composer.
    #expect(!state.expanded && !state.showsNavigation)
}
@Test func phoneComposerRespectsReducedMotionAndWhitespaceDraft() {
    #expect(PhoneComposerState(draft: " ").expanded)
    #expect(PhoneComposerState(reduceMotion: true).animates == false)
    #expect(PhoneComposerState().animates)
}
