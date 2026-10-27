import Testing
@testable import WeftMateCore

@Test func liveReplyPreservesClosedParagraphAndFenceIdentity() {
    let first = PhoneReplyPresentation.blocks("已有段落。\n\n```swift\nlet a = 1\n\n", streaming: true)
    #expect(first.count == 2)
    #expect(first[0].complete && !first[1].complete)
    let next = PhoneReplyPresentation.blocks("已有段落。\n\n```swift\nlet a = 1\n\n```\n\n新文字", streaming: true)
    #expect(first[0] == next[0])
    #expect(first[1].id == next[1].id && next[1].complete)
    #expect(!next[2].complete)
    let final = PhoneReplyPresentation.blocks("已有段落。\n\n```swift\nlet a = 1\n\n```\n\n新文字", streaming: false)
    #expect(next.map(\.id) == final.map(\.id))
    #expect(final.allSatisfy(\.complete))
}
@Test func liveReplyNeverSplitsGraphemesAndCatchesUpInBatches() {
    var buffer = PhoneReplyBuffer()
    let text = "👨‍👩‍👧‍👦e\u{301}🇨🇳你好，继续生成一段文字。"
    buffer.receive(text)
    #expect(buffer.advance(limit: 1) == "👨‍👩‍👧‍👦")
    #expect(buffer.advance(limit: 1) == "👨‍👩‍👧‍👦e\u{301}")
    let before = buffer.displayed.count
    buffer.advance()
    #expect(buffer.displayed.count - before == 8)
    #expect(buffer.finish() == text && !buffer.pending)
}
@Test func liveReplyCombiningSuffixAndAuthoritativeReplacement() {
    var buffer = PhoneReplyBuffer()
    buffer.receive("e"); buffer.finish()
    buffer.receive("e\u{301}🙂")
    #expect(buffer.advance(limit: 1) == "e\u{301}")
    #expect(buffer.advance(limit: 1) == "e\u{301}🙂")
    buffer.receive("")
    #expect(buffer.finish().isEmpty)
}
@Test func textStorageReceivesOnlyTheNewSuffix() throws {
    var buffer=PhoneReplyBuffer()
    buffer.receive("已有文字")
    let first=try #require(buffer.finishDelta())
    #expect(first.retainedUTF16 == 0 && first.text == "已有文字")
    buffer.receive("已有文字👨‍👩‍👧‍👦")
    let appended=try #require(buffer.nextDelta(limit:1))
    #expect(appended.retainedUTF16 == 4 && appended.text == "👨‍👩‍👧‍👦")
    #expect(buffer.nextDelta() == nil)
    buffer.receive("")
    let cleared=try #require(buffer.finishDelta())
    #expect(cleared.retainedUTF16 == 0 && cleared.text.isEmpty)
}

@Test func queueOnlyWithdrawsUnstartedSlotsAndPreservesOtherMessages() throws {
    var state=PhoneChatState()
    let active=try #require(state.enqueueReply(text:"正在回答的原话"))
    state.updateReply(active,text:"已经收到的字",status:.replying)
    let queued=try #require(state.enqueueReply(text:"排队的原话"))
    #expect(state.withdrawQueuedReply(active.replyID) == nil)
    let original=try #require(state.withdrawQueuedReply(queued.replyID))
    #expect(original.text == "排队的原话")
    #expect(state.threads[0].messages.count == 2)
    #expect(state.threads[0].messages.last?.text == "已经收到的字")
    #expect(state.withdrawQueuedReply(queued.replyID) == nil)
    state.updateReply(active,status:.complete)
    #expect(state.withdrawQueuedReply(active.replyID) == nil)
}

@Test func newContentNeverReenablesReadingFollow() {
    var follow=ConversationFollowState()
    follow.userScrolled(distanceFromBottom:49)
    for _ in 0..<100 { #expect(!follow.contentChanged()) }
    #expect(!follow.following && follow.hasNewContent)
    follow.userScrolled(distanceFromBottom:48)
    #expect(follow.following && !follow.hasNewContent)
    follow.userScrolled(distanceFromBottom:1000)
    follow.returnToBottom()
    #expect(follow.contentChanged())
}

@Test func whitespaceDraftUsesTheSingleStopPosition() {
    #expect(PhoneComposerPrimaryAction.resolve(running:true,draft:" \n",attachmentCount:0) == .stop)
    #expect(PhoneComposerPrimaryAction.resolve(running:true,draft:"下一条",attachmentCount:0) == .send)
    #expect(PhoneComposerPrimaryAction.resolve(running:true,draft:"",attachmentCount:1) == .send)
}
