import Foundation
import Testing
import XCTest
@testable import WeftMateCore

struct PhoneStandaloneTests {
    @Test func encryptedHistoryAndAccountIsolation() throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:dir) }
        let keys=MemoryStore()
        let a=try PhoneChatStore(account:"issuer|account-a",directory:dir,credentials:keys)
        var state=PhoneChatState(); var thread=PhoneChatThread(); thread.messages=[.init(role:"user",text:"synthetic-private-message")]; state.threads=[thread]; state.selected=thread.id
        try a.save(state)
        #expect(try a.load().threads == state.threads)
        #expect(String(data:try Data(contentsOf:a.file),encoding:.utf8)?.contains("synthetic-private-message") != true)
        let b=try PhoneChatStore(account:"issuer|account-b",directory:dir,credentials:keys)
        #expect(try b.load().threads.isEmpty)
        let reopened=try PhoneChatStore(account:"issuer|account-a",directory:dir,credentials:keys)
        #expect(try reopened.load().threads == state.threads)
        let model=PhoneModelConfiguration(name:"synthetic",baseURL:"https://model.example.com/v1",model:"test",apiKey:"synthetic-key")
        try a.saveModels([model]); #expect(try b.loadModels().isEmpty); #expect(try reopened.loadModels() == [model])
        #expect(try Data(contentsOf:a.file).range(of:Data(model.apiKey.utf8)) == nil)
        var bytes=try Data(contentsOf:a.file); bytes[bytes.count-1] ^= 1; try bytes.write(to:a.file)
        #expect(throws:(any Error).self) { try reopened.load() }
    }
    @Test func transferFreezesBodiesAndRetiresDeletedGeneration() throws {
        var state=PhoneChatState(),thread=PhoneChatThread();thread.messages=[.init(role:"user",text:"synthetic preference"),.init(role:"assistant",text:"synthetic answer")];state.threads=[thread];state.selected=thread.id
        let initial=state.prepareMigration(host:"computer-a",generation:1)
        #expect(initial.count == 1);#expect(initial[0].memoryRefs.isEmpty);#expect(initial[0].dependencyComplete)
        state.threads[0].messages[1].text="regenerated reply"
        let retry=state.prepareMigration(host:"computer-a",generation:1)
        #expect(retry[0].id == initial[0].id);#expect(retry[0].messages == initial[0].messages)
        state.acknowledgeMigration(host:"computer-a",generation:1,ids:Set(initial.map(\.id)))
        #expect(state.prepareMigration(host:"computer-a",generation:1).isEmpty)
        #expect(state.prepareMigration(host:"computer-a",generation:2).isEmpty)
        #expect(state.threads.isEmpty);#expect(state.selected == nil)
    }
    @Test func deletionGenerationKeepsUnsharedIndependentThreads() {
        var state=PhoneChatState(),shared=PhoneChatThread(),independent=PhoneChatThread()
        shared.messages=[.init(role:"user",text:"already shared")];independent.messages=[.init(role:"user",text:"never shared")]
        state.threads=[shared];_=state.prepareMigration(host:"computer-a",generation:1)
        state.threads.append(independent);state.selected=independent.id
        state.applyMigrationGeneration(host:"computer-a",generation:2)
        #expect(state.threads == [independent]);#expect(state.selected == independent.id)
        #expect(state.migrations?["computer-a"]?.turns.isEmpty == true)
    }
    @Test func streamParsesContentAndRejectsTools() throws {
        #expect(try PhoneStreamDelta.text("data: {\"choices\":[{\"delta\":{\"content\":\"你好🌿\"}}]}") == "你好🌿")
        #expect(try PhoneStreamDelta.text("data: [DONE]") == nil)
        #expect(try PhoneStreamDelta.text(":keepalive") == nil)
        #expect(throws:(any Error).self) { try PhoneStreamDelta.text("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"run\"}}]}}]}") }
        #expect(throws:(any Error).self) { try PhoneStreamDelta.text("data: {\"error\":{\"code\":\"failed\"}}") }
    }
    @Test func mimoCapturedNullFirstChunkThenContent() throws {
        // BASE-A stream-probe.json: the exact first SSE line, with no credential data.
        let first = #"data: {"id":"92739613-ea4f-4fd7-880b-9cb01c25a7cf_be29a647856b42239634a8ad1f4d4f73","choices":[{"delta":{"content":"","role":"assistant","tool_calls":null,"reasoning_content":null},"finish_reason":null,"index":0}],"created":1791984146,"model":"mimo-v2.6-flash","object":"chat.completion.chunk"}"#
        #expect(try PhoneStreamDelta.text(first) == nil)
        let lines = [first,
                     #"data: {"choices":[{"delta":{"content":"BASE-A","tool_calls":null,"reasoning_content":null}}]}"#,
                     #"data: {"choices":[{"delta":{"content":"聊天成功","tool_calls":null}}]}"#,
                     #"data: {"choices":[],"usage":{"completion_tokens":4}}"#,
                     "data: [DONE]"]
        #expect(try lines.compactMap { try PhoneStreamDelta.text($0) }.joined() == "BASE-A聊天成功")
    }
    @Test func contentOnlyStreamThroughModelConfiguration() throws {
        let config = PhoneModelConfiguration(name:"synthetic",baseURL:"https://model.example.com/v1",model:"test",apiKey:"synthetic-key")
        let lines = [#"data: {"choices":[{"delta":{"content":"你"}}]}"#,
                     #"data: {"choices":[{"delta":{"content":"好🌿"}}]}"#,
                     "data: [DONE]"]
        #expect(try lines.compactMap { try config.streamText($0) }.joined() == "你好🌿")
    }
    @Test func reasoningStreamKeepsOnlyBody() throws {
        let lines = [#"data: {"choices":[{"delta":{"reasoning_content":"内部推理","content":null}}]}"#,
                     #"data: {"choices":[{"delta":{"reasoning_content":"","content":"正文"}}]}"#,
                     #"data: {"choices":[{"delta":{"reasoning_content":null,"content":" 继续"}}]}"#]
        #expect(try PhoneStreamDelta.text(lines[0]) == nil)
        #expect(try lines.compactMap { try PhoneStreamDelta.text($0) }.joined() == "正文 继续")
    }
    @Test func finishReasonOnlyEndsWithoutText() throws {
        let lines = [#"data: {"choices":[{"delta":{"content":"完整回复"}}]}"#,
                     #"data: {"choices":[{"finish_reason":"stop","index":0}]}"#]
        #expect(try PhoneStreamDelta.text(lines[1]) == nil)
        #expect(try PhoneStreamDelta.text(#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#) == nil)
        #expect(try lines.compactMap { try PhoneStreamDelta.text($0) }.joined() == "完整回复")
    }
    @Test func emptyOptionalFieldsAreAbsent() throws {
        let deltas = [#"{"content":null,"tool_calls":null,"function_call":null,"reasoning_content":null}"#,
                      #"{"content":"","tool_calls":[],"function_call":{},"reasoning_content":""}"#,
                      #"{"content":"","tool_calls":"","function_call":""}"#]
        for delta in deltas {
            #expect(try PhoneStreamDelta.text("data: {\"choices\":[{\"delta\":" + delta + "}]}") == nil)
        }
        #expect(try PhoneStreamDelta.text(#"data: {"choices":[{"delta":{"content":" ","tool_calls":[],"function_call":{}}}]}"#) == " ")
    }
    @Test func emptyErrorsAndAnthropicTextAreAbsent() throws {
        #expect(try PhoneStreamDelta.text(#"data: {"error":null,"choices":[{"delta":{"content":"正文"}}]}"#) == "正文")
        #expect(try PhoneStreamDelta.text(#"data: {"error":{},"choices":[{"delta":{"content":"正文"}}]}"#) == "正文")
        var config = PhoneModelConfiguration(name:"synthetic",baseURL:"https://model.example.com/v1",model:"test",apiKey:"synthetic-key")
        config.interfaceType = "anthropic"
        #expect(try config.streamText(#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":""}}"#) == nil)
        #expect(try config.streamText(#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":null}}"#) == nil)
        #expect(try config.streamText(#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"正文"}}"#) == "正文")
        #expect(throws:(any Error).self) { try config.streamText(#"data: {"type":"error","error":{"type":"overloaded_error"}}"#) }
    }
    @Test func actualFunctionCallsStillFail() throws {
        #expect(throws:(any Error).self) {
            try PhoneStreamDelta.text(#"data: {"choices":[{"delta":{"function_call":{"name":"run","arguments":"{}"}}}]}"#)
        }
    }
    @Test func requestAndDisplayPolicy() throws {
        var config=PhoneModelConfiguration(name:"synthetic",baseURL:"https://model.example.com/v1",model:"test",apiKey:"synthetic-key")
        let request=try config.request(messages:[["role":"user","content":"hello"]],stream:true)
        #expect(request.url?.absoluteString == "https://model.example.com/v1/chat/completions")
        #expect(request.value(forHTTPHeaderField:"Authorization") == "Bearer synthetic-key")
        config.baseURL="http://model.example.com/v1"
        #expect(throws:(any Error).self) { try config.request(messages:[],stream:true) }
        config.baseURL="http://127.0.0.1:9999/v1"
        #expect(throws:(any Error).self) { try config.request(messages:[],stream:true) }
        #expect(try config.request(messages:[],stream:true,allowLoopback:true).url?.host == "127.0.0.1")
        #expect(PhoneCurrencyText.money(0) == "¥0")
        #expect(PhoneCurrencyText.money(1.23456) == "¥1.23")
        #expect(PhoneHealthText.number(74.1) == "74")
        #expect(PhoneHealthText.number(56.6,metric:"restingHeartRateBpm") == "57")
        #expect(PhoneHealthText.number(47.6,metric:"hrvSdnnMs") == "48")
        #expect(PhoneHealthText.time("2026-10-11T23:05:00Z",zone:TimeZone(identifier:"Asia/Shanghai")!) == "7:05")
        #expect(PhoneHealthText.time("2026-10-11T23:05:00Z",zone:TimeZone(identifier:"America/Los_Angeles")!) == "16:05")
    }
}

@Test func nativeJSONIntegerConversionRejectsUnrepresentableValues() {
    #expect(JSONValue.number(.infinity).int == nil)
    #expect(JSONValue.number(-1).int == nil)
    #expect(JSONValue.number(1.5).int == nil)
    #expect(JSONValue.number(2_147_483_647).int == 2_147_483_647)
    #if arch(arm64_32)
    #expect(JSONValue.number(2_147_483_648).int == nil)
    #else
    #expect(JSONValue.number(2_147_483_648).int == 2_147_483_648)
    #endif
    #expect(JSONValue.number(9_007_199_254_740_992).int == nil)
}


@MainActor final class StandaloneSendTests: XCTestCase {
    func testThreeSendsRetainOrderedRepliesAndHistory() throws {
        var state=PhoneChatState()
        let oneValue=state.enqueueReply(text:"一");let one=try XCTUnwrap(oneValue)
        state.updateReply(one,text:"第一片",status:.replying)
        let twoValue=state.enqueueReply(text:"二");let two=try XCTUnwrap(twoValue)
        let threeValue=state.enqueueReply(text:"三");let three=try XCTUnwrap(threeValue)
        XCTAssertTrue(state.threads[0].messages.map(\.role) == ["user","assistant","user","assistant","user","assistant"])
        XCTAssertTrue(state.replyHistory(one).map(\.text) == ["一"])
        state.updateReply(one,text:"答一",status:.complete)
        XCTAssertTrue(state.nextReply == two)
        XCTAssertTrue(state.replyHistory(two).map(\.text) == ["一","答一","二"])
        state.updateReply(two,text:"答二",status:.complete)
        XCTAssertTrue(state.nextReply == three)
        XCTAssertTrue(state.replyHistory(three).map(\.text) == ["一","答一","二","答二","三"])
        state.updateReply(three,text:"答三",status:.complete)
        XCTAssertTrue(state.nextReply == nil)
        XCTAssertTrue(state.threads[0].messages.map(\.text) == ["一","答一","二","答二","三","答三"])
        let restored=try JSONDecoder().decode(PhoneChatState.self,from:JSONEncoder().encode(state))
        XCTAssertTrue(restored.threads == state.threads)
    }
    func testInterruptedQueueKeepsQuestionsAndCanRegenerate() throws {
        var state=PhoneChatState()
        let firstValue=state.enqueueReply(text:"一");let first=try XCTUnwrap(firstValue)
        state.updateReply(first,text:"部分正文",status:.replying)
        _=state.enqueueReply(text:"二")
        state.interruptReplies()
        XCTAssertTrue(state.nextReply == nil)
        XCTAssertTrue(state.threads[0].messages.map(\.text) == ["一","部分正文","二",""])
        XCTAssertTrue(state.threads[0].messages.filter { $0.role == "assistant" }.allSatisfy { $0.replyStatus == .failed })
        let firstRetryValue=state.retryReply(first.replyID);let firstRetry=try XCTUnwrap(firstRetryValue)
        XCTAssertTrue(firstRetry == first && state.nextReply == first)
        XCTAssertTrue(state.replyHistory(firstRetry).map(\.text) == ["一"])
        state.updateReply(firstRetry,text:"重试第一条",status:.complete)
        let retryValue=state.enqueueReply(text:"",regenerate:true);let retry=try XCTUnwrap(retryValue)
        XCTAssertTrue(state.nextReply == retry)
        XCTAssertTrue(state.replyHistory(retry).last?.text == "二")
        XCTAssertTrue(state.threads[0].messages.count == 4)
    }
    func testStalledReplyTimesOutAndCanRetry() async throws {
        let model=PhoneModelConfiguration(name:"fixture",baseURL:"https://model.example.com/v1",model:"test",apiKey:"synthetic-key")
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[StalledReplyProtocol.self]
        var state=PhoneChatState();let replyValue=state.enqueueReply(text:"超时问题");let reply=try XCTUnwrap(replyValue)
        state.updateReply(reply,status:.replying)
        var request=try model.request(messages:[["role":"user","content":"超时问题"]],stream:true)
        request.url=URL(string:"https://model.example.com/stall")!
        let start=Date()
        do {
            for try await _ in PhoneReplyStream.lines(request:request,model:model,timeout:0.1,configuration:config) {}
            XCTFail("A stalled stream must fail")
        } catch {
            XCTAssertTrue((error as? URLError)?.code == .timedOut)
            state.updateReply(reply,status:.failed)
        }
        XCTAssertTrue(Date().timeIntervalSince(start) < 2)
        XCTAssertTrue(PhoneReplyStatus.failed.placeholder == "这次没回复，可以重试。")
        let retryValue=state.enqueueReply(text:"",regenerate:true);let retry=try XCTUnwrap(retryValue)
        request.url=URL(string:"https://model.example.com/finish")!
        var text=""
        for try await line in PhoneReplyStream.lines(request:request,model:model,timeout:1,configuration:config) {
            if let delta=try model.streamText(line) { text += delta }
        }
        state.updateReply(retry,text:text,status:.complete)
        XCTAssertTrue(text == "重试成功")
        XCTAssertTrue(state.threads[0].messages.map(\.text) == ["超时问题","重试成功"])
    }
    func testTerminalMarkersCloseStreamsWithoutWaitingForSocketEOF() throws {
        var model=PhoneModelConfiguration(name:"fixture",baseURL:"https://model.example.com/v1",model:"test",apiKey:"synthetic-key")
        XCTAssertTrue(model.streamFinished("data: [DONE]"))
        XCTAssertTrue(model.streamFinished(#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#))
        XCTAssertTrue(!model.streamFinished(#"data: {"choices":[{"delta":{"content":"正文"},"finish_reason":null}]}"#))
        model.interfaceType="anthropic"
        XCTAssertTrue(model.streamFinished(#"data: {"type":"message_stop"}"#))
    }
}
private final class StalledReplyProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"text/event-stream"])!,cacheStoragePolicy:.notAllowed)
        if request.url?.path == "/finish" {
            client?.urlProtocol(self,didLoad:Data("data: {\"choices\":[{\"delta\":{\"content\":\"重试成功\"}}]}\n\ndata: {\"choices\":[{\"finish_reason\":\"stop\"}]}\n\n".utf8))
            // Deliberately leave the HTTP response open after finish_reason.
        }
    }
    override func stopLoading() {}
}
