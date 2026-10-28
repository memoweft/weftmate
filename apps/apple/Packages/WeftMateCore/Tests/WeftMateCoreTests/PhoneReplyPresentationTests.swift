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
    let allComplete = final.allSatisfy(\.complete)
    #expect(allComplete)
}
@Test func liveReplyNeverSplitsGraphemesAndCatchesUpInBatches() {
    var buffer = PhoneReplyBuffer()
    let text = "👨‍👩‍👧‍👦e\u{301}🇨🇳你好，继续生成一段文字。"
    buffer.receive(text)
    let family = buffer.advance(limit: 1)
    #expect(family == "👨‍👩‍👧‍👦")
    let accented = buffer.advance(limit: 1)
    #expect(accented == "👨‍👩‍👧‍👦e\u{301}")
    let before = buffer.displayed.count
    buffer.advance()
    #expect(buffer.displayed.count - before == 8)
    let finished = buffer.finish()
    #expect(finished == text && !buffer.pending)
}
@Test func liveReplyCombiningSuffixAndAuthoritativeReplacement() {
    var buffer = PhoneReplyBuffer()
    buffer.receive("e"); buffer.finish()
    buffer.receive("e\u{301}🙂")
    let accented = buffer.advance(limit: 1)
    #expect(accented == "e\u{301}")
    let emoji = buffer.advance(limit: 1)
    #expect(emoji == "e\u{301}🙂")
    buffer.receive("")
    let cleared = buffer.finish()
    #expect(cleared.isEmpty)
}
@Test func textStorageReceivesOnlyTheNewSuffix() throws {
    var buffer=PhoneReplyBuffer()
    buffer.receive("已有文字")
    let firstValue = buffer.finishDelta()
    let first=try #require(firstValue)
    #expect(first.retainedUTF16 == 0 && first.text == "已有文字")
    buffer.receive("已有文字👨‍👩‍👧‍👦")
    let appendedValue = buffer.nextDelta(limit:1)
    let appended=try #require(appendedValue)
    #expect(appended.retainedUTF16 == 4 && appended.text == "👨‍👩‍👧‍👦")
    let exhausted = buffer.nextDelta()
    #expect(exhausted == nil)
    buffer.receive("")
    let clearedValue = buffer.finishDelta()
    let cleared=try #require(clearedValue)
    #expect(cleared.retainedUTF16 == 0 && cleared.text.isEmpty)
}

@Test func queueOnlyWithdrawsUnstartedSlotsAndPreservesOtherMessages() throws {
    var state=PhoneChatState()
    let activeValue = state.enqueueReply(text:"正在回答的原话")
    let active=try #require(activeValue)
    state.updateReply(active,text:"已经收到的字",status:.replying)
    let queuedValue = state.enqueueReply(text:"排队的原话")
    let queued=try #require(queuedValue)
    let activeWithdrawal = state.withdrawQueuedReply(active.replyID)
    #expect(activeWithdrawal == nil)
    let withdrawn = state.withdrawQueuedReply(queued.replyID)
    let original=try #require(withdrawn)
    #expect(original.text == "排队的原话")
    #expect(state.threads[0].messages.count == 2)
    #expect(state.threads[0].messages.last?.text == "已经收到的字")
    let repeated = state.withdrawQueuedReply(queued.replyID)
    #expect(repeated == nil)
    state.updateReply(active,status:.complete)
    let completedWithdrawal = state.withdrawQueuedReply(active.replyID)
    #expect(completedWithdrawal == nil)
}

@Test func newContentNeverReenablesReadingFollow() {
    var follow=ConversationFollowState()
    follow.userScrolled(distanceFromBottom:49)
    for _ in 0..<100 { let changed = follow.contentChanged(); #expect(!changed) }
    #expect(!follow.following && follow.hasNewContent)
    follow.userScrolled(distanceFromBottom:48)
    #expect(follow.following && !follow.hasNewContent)
    follow.userScrolled(distanceFromBottom:1000)
    follow.returnToBottom()
    let changed = follow.contentChanged()
    #expect(changed)
}

@Test func whitespaceDraftUsesTheSingleStopPosition() {
    #expect(PhoneComposerPrimaryAction.resolve(running:true,draft:" \n",attachmentCount:0) == .stop)
    #expect(PhoneComposerPrimaryAction.resolve(running:true,draft:"下一条",attachmentCount:0) == .send)
    #expect(PhoneComposerPrimaryAction.resolve(running:true,draft:"",attachmentCount:1) == .send)
}

@Test func completedFenceStaysFixedWhileImmediateProseStreams() throws {
    let code = "```swift\nlet answer = 42\n```"
    let first = PhoneReplyPresentation.blocks(code + "\n后续文字", streaming: true)
    #expect(first.count == 2)
    let completed = try #require(first.first)
    #expect(completed.complete)
    #expect(completed.text == code)
    let next = PhoneReplyPresentation.blocks(code + "\n后续文字继续到达", streaming: true)
    #expect(next.first == completed)
}
