import XCTest
@testable import WeftMateCore

final class Apple3ReplyTests: XCTestCase {
    private func page(_ text: String?, watermark: Int, final: Bool = false) throws -> TimelinePage {
        let live: [[String: Any]] = text.map { [["seq": 2, "type": "assistant.delta", "data": ["text": $0, "cursor": watermark, "streaming": !final]]] } ?? []
        let events: [[String: Any]] = final ? [["seq": 9, "type": "assistant.message", "data": ["text": text ?? "", "streamSeq": 2]]] : []
        return try TimelinePage.decode(JSONSerialization.data(withJSONObject: ["events": events,"nextSeq": final ? 9 : 1,"hasMore": false,"liveSeq": watermark,"liveEvents": live]))
    }
    func testCumulativeReplacementStaleRecoveryAndFinalIdentity() throws {
        var window = TimelineWindow()
        window.apply(try page("你好", watermark: 3))
        let firstID = TimelineProjection.entries(window.displayEvents).first?.id
        window.apply(try page("你好，世界", watermark: 6))
        window.apply(try page("你好", watermark: 3))
        XCTAssertEqual(window.displayEvents.count, 1)
        XCTAssertEqual(window.displayEvents.first?.data["text"]?.string, "你好，世界")
        window.apply(try page("你好，世界。", watermark: 10, final: true))
        XCTAssertEqual(window.displayEvents.count, 1)
        XCTAssertEqual(window.displayEvents.first?.data["text"]?.string, "你好，世界。")
        XCTAssertEqual(TimelineProjection.entries(window.displayEvents).first?.id, firstID)
        let bytes = try JSONEncoder().encode(window)
        XCTAssertFalse(String(decoding: bytes, as: UTF8.self).contains("assistant.delta"))
    }
    func testOlderReadDoesNotChangeSnapshotAndEmptyClears() throws {
        var window = TimelineWindow()
        window.apply(try page("暂态文字", watermark: 6))
        window.apply(try page("旧文字", watermark: 99), older: true)
        XCTAssertEqual(window.liveSeq, 6)
        window.apply(try page(nil, watermark: 7))
        XCTAssertTrue(window.liveEvents.isEmpty)
        window.apply(try page("另一个身份", watermark: 1), replace: true)
        XCTAssertEqual(window.liveSeq, 1)
    }
    func testLogicalStreamUsesIndependentWatermarkAndSessionIdentity() throws {
        func chatPage(_ text: String, _ watermark: Int) throws -> ChatPage {
            let row: [String: Any] = ["eventId":"transient", "chatId":"main", "orderKey":"002", "revision":1, "type":"assistant.delta", "sourceRef":["sessionId":"s1","seq":2], "data":["text":text,"cursor":watermark]]
            return try JSONDecoder().decode(ChatPage.self, from: JSONSerialization.data(withJSONObject: ["items":[],"hasOlder":false,"hasNewer":false,"syncCursor":"history-1","contentRevision":1,"indexState":"ready","timeZone":"UTC","liveEvents":[row],"liveRevision":watermark]))
        }
        var window = ChatWindow()
        try window.apply(chatPage("第一段", 2), replace: true)
        try window.apply(chatPage("第一段第二段", 4))
        try window.apply(chatPage("第一段", 2))
        XCTAssertEqual(window.syncCursor, "history-1")
        XCTAssertEqual(window.displayEvents.first?.text, "第一段第二段")
        XCTAssertTrue(window.events.isEmpty)
        window.reset()
        XCTAssertTrue(window.displayEvents.isEmpty)
        XCTAssertEqual(window.liveRevision, -1)
        XCTAssertEqual(ReplySnapshots.pollDelay(streaming: true, running: true), 0.25)
        XCTAssertEqual(ReplySnapshots.pollDelay(streaming: true, running: true, failed: true), 1.5)
    }
}
