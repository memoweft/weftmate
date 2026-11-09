// 保护：设备选择不能把解释问题变成电脑操作，重复请求和后台回答不能覆盖手机草稿。
import Foundation
import Testing
@testable import WeftMateCore

@Test func watchRoutesActionsSeparatelyFromQuestions() {
    for text in ["打开电脑上的文件夹", "帮我修改这个项目的代码", "帮我写一个 Python 脚本", "run the test script"] {
        #expect(WatchContentRouting.rule(text) == .computer)
    }
    for text in ["什么是代码", "解释为什么要运行测试", "为什么电脑上会出现文件夹", "帮我查今天的天气", "hello"] {
        #expect(WatchContentRouting.rule(text) == .phone)
    }
    #expect(WatchContentRouting.rule("帮我处理一下") == nil)
    #expect(WatchContentRouting.rule("继续",previous:.computer) == .computer)
    #expect(WatchContentRouting.rule("继续",previous:.phone) == .phone)
}

@Test func watchExplicitChoiceWinsAndModelCannotInjectAnAction() {
    #expect(WatchContentRouting.rule("让手机来：解释这个项目") == .phone)
    #expect(WatchContentRouting.explicit("让电脑来，打开文件")?.text == "打开文件")
    #expect(WatchContentRouting.modelChoice("computer\n执行删除") == nil)
}

@Test func watchQueuePreservesSelectedConversationAndDraft() throws {
    var state=PhoneChatState(),thread=PhoneChatThread()
    thread.messages=[.init(role:"user",text:"正在手机上聊")]
    state.threads=[thread]; state.selected=thread.id; state.pending = .init(); state.pending?.text="未发送的手机草稿"
    let request=WatchChatRequest(conversationID:UUID().uuidString,accountKey:"account-a",text:"你好")
    let reply=try state.enqueueWatch(.init(request:request,text:"你好",device:.phone))
    #expect(state.selected == thread.id && state.pending?.text == "未发送的手机草稿")
    #expect(reply.threadID != thread.id && state.threads[0].messages.count == 1)
    #expect(state.watchRequests?.first?.replyID == reply.replyID)
}

@Test func watchDurableRequestRejectsChangedBodyAfterReload() throws {
    var state=PhoneChatState()
    let request=WatchChatRequest(conversationID:UUID().uuidString,accountKey:"account-a",text:"你好")
    try state.retainWatch(.init(request:request,text:"你好",device:.phone))
    state=try JSONDecoder().decode(PhoneChatState.self,from:JSONEncoder().encode(state))
    let changed=WatchChatRequest(id:request.id,conversationID:request.conversationID,accountKey:request.accountKey,text:"打开文件")
    #expect(throws:WatchChatFailure.conflict) { try state.retainWatch(.init(request:changed,text:changed.text)) }
    #expect(state.watchRequests?.count == 1)
}

@Test func watchCannotContinueDeletedPhoneThread() throws {
    var state=PhoneChatState()
    let request=WatchChatRequest(conversationID:UUID().uuidString,accountKey:"account-a",text:"继续")
    var record=WatchChatRecord(request:request,text:"继续",device:.phone);record.threadID=UUID().uuidString
    #expect(throws:WatchChatFailure.noConversation) { try state.enqueueWatch(record) }
    #expect(state.threads.isEmpty)
}

@Test func watchBoundsInputAndReplyPayload() throws {
    let request=WatchChatRequest(conversationID:UUID().uuidString,accountKey:"account-a",text:String(repeating:"字",count:2049))
    #expect(throws:WatchChatFailure.invalidInput) { try request.validate() }
    let bytes=try WatchChatSnapshot(accountKey:"account-a",answer:String(repeating:"字",count:20000)).encoded()
    #expect(bytes.count < 32768)
}

@Test func watchSnapshotNeverExportsPersistedComputerCommand() throws {
    let request=WatchChatRequest(conversationID:UUID().uuidString,accountKey:"account-a",text:"打开文件")
    var record=WatchChatRecord(request:request,text:request.text,device:.computer)
    record.command=try .init(server:ServerConfiguration(input:"https://example.com"),ownerId:"owner-a",hostId:"host-a",
                            payload:SharedCommandPayload(requestId:"watch-test",kind:.create,targetDeviceId:"host-a",modelProfileId:"mimo").encoded())
    let encoded=try WatchChatSnapshot(accountKey:request.accountKey,record:record).encoded()
    #expect(try JSONDecoder().decode(WatchChatSnapshot.self,from:encoded).record?.command == nil)
}
