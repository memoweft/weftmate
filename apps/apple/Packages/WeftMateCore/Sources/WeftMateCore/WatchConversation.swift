import Foundation

public enum WatchAnswerDevice: String, Codable, Sendable {
    case phone, computer
    public var title: String { self == .phone ? "手机" : "电脑" }
}

public struct WatchChatRequest: Codable, Equatable, Sendable {
    public let id: String
    public let conversationID: String
    public let accountKey: String
    public let text: String
    public let device: WatchAnswerDevice?
    public init(id: String = UUID().uuidString.lowercased(), conversationID: String, accountKey: String, text: String, device: WatchAnswerDevice? = nil) {
        self.id=id; self.conversationID=conversationID; self.accountKey=accountKey; self.text=text; self.device=device
    }
    public func validate() throws {
        guard UUID(uuidString:id) != nil, UUID(uuidString:conversationID) != nil,
              !accountKey.isEmpty, accountKey.utf8.count <= 512,
              !text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty, text.utf16.count <= 2048 else { throw WatchChatFailure.invalidInput }
    }
}

public enum WatchChatPhase: String, Codable, Sendable {
    case routing, sending, running, complete, failed, chooseDevice, uncertain
    public var active: Bool { self == .routing || self == .sending || self == .running }
}

/// Persist only references to answers; the existing conversation remains their source.
public struct WatchChatRecord: Codable, Equatable, Sendable {
    public let request: WatchChatRequest
    public var text: String
    public var device: WatchAnswerDevice?
    public var phase: WatchChatPhase = .routing
    public var threadID: String?
    public var replyID: String?
    public var hostID: String?
    public var command: SharedCommandIntent?
    public var notice: String?
    public init(request: WatchChatRequest, text: String, device: WatchAnswerDevice? = nil) {
        self.request=request; self.text=text; self.device=device
    }
}

public struct WatchChatSnapshot: Codable, Equatable, Sendable {
    public let accountKey: String
    public var record: WatchChatRecord?
    public var answer: String
    public init(accountKey: String, record: WatchChatRecord? = nil, answer: String = "") {
        self.accountKey=accountKey; self.record=record; self.answer=answer
    }
    /// Credentials and persisted command payloads never cross to the watch.
    public func encoded() throws -> Data {
        var value=self; value.record?.command=nil
        if value.answer.utf8.count > 16_000 {
            var prefix=Data(value.answer.utf8.prefix(16_000))
            while String(data:prefix,encoding:.utf8) == nil { prefix.removeLast() }
            value.answer=String(data:prefix,encoding:.utf8)!+"\n完整回复请在手机对话中查看。"
        }
        return try JSONEncoder().encode(value)
    }
}

public enum WatchChatFailure: Error, LocalizedError, Equatable {
    case invalidInput, accountChanged, conflict, unavailable, busy, uncertain, noModel, noConversation
    public var errorDescription: String? {
        switch self {
        case .invalidInput: "这句话没能发送，请缩短后再试。"
        case .accountChanged: "手机状态已变化，请刷新后再发。"
        case .conflict: "原请求内容已变化，请重新发送。"
        case .unavailable: "电脑现在不在线。这次没有排队，在线后可以重新发送。"
        case .busy: "上一句话还在处理，请等回复后再发。"
        case .uncertain: "送达情况待核对，请刷新；不会重复发送。"
        case .noModel: "先在手机上选择一个可用模型。"
        case .noConversation: "这段对话已不可用，请新建对话。"
        }
    }
}

public enum WatchContentRouting {
    public static func explicit(_ text: String) -> (device: WatchAnswerDevice, text: String)? {
        let text=text.trimmingCharacters(in:.whitespacesAndNewlines)
        for (prefix,device) in [("让电脑来",WatchAnswerDevice.computer),("交给电脑",.computer),("让手机来",.phone),("交给手机",.phone),("让手机回答",.phone)] {
            if text.hasPrefix(prefix) {
                return (device,String(text.dropFirst(prefix.count)).trimmingCharacters(in:CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters)))
            }
        }
        return nil
    }
    public static func rule(_ text: String, previous: WatchAnswerDevice? = nil) -> WatchAnswerDevice? {
        if let selected=explicit(text) { return selected.device }
        let value=text.lowercased()
        if let previous,["继续","接着说","然后呢","再试一次","再来一次","continue","try again"].contains(value.trimmingCharacters(in:.whitespacesAndNewlines.union(.punctuationCharacters))) { return previous }
        if value.range(of:#"^(为什么|什么是|解释|介绍|怎么理解|why\b|what is\b|explain\b)"#,options:.regularExpression) != nil,
           value.range(of:#"(然后|并且|并帮|再帮|and then)"#,options:.regularExpression) == nil { return .phone }
        // Execution and local resources win over a question mark at the end.
        let computer=[#"(打开|启动|运行|执行|关闭|安装|卸载|删除|修改|整理|重命名|保存|读取|搜索|查找|写).{0,12}(文件|文件夹|目录|代码|项目|脚本|终端|软件|程序|浏览器|电脑|桌面|仓库)"#,
                      #"(电脑上|桌面上|本地文件|我的文件|这个项目|这个仓库|运行测试|提交代码|修复.{0,8}(bug|代码))"#,
                      #"\b(open|run|edit|delete|install|rename|save|read|find)\b.{0,30}\b(file|folder|directory|code|script|terminal|app|program|repository|repo)\b"#]
        if computer.contains(where: { value.range(of:$0,options:.regularExpression) != nil }) { return .computer }
        let question=[#"^(你好|您好|谢谢|早上好|晚安|查一下|查查|帮我查|搜索一下|解释|介绍|翻译|请问|为什么|什么是|怎么理解|告诉我)"#,
                      #"(是什么|为什么|什么意思|的区别|天气|汇率|百科)"#,
                      #"^(hello|hi\b|what\b|why\b|explain\b|translate\b|tell me\b)"#]
        if question.contains(where: { value.range(of:$0,options:.regularExpression) != nil }) { return .phone }
        return nil
    }
    public static func modelChoice(_ text: String) -> WatchAnswerDevice? {
        WatchAnswerDevice(rawValue:text.trimmingCharacters(in:.whitespacesAndNewlines).lowercased())
    }
}

extension PhoneChatState {
    public mutating func retainWatch(_ record: WatchChatRecord) throws {
        try record.request.validate()
        if let index=watchRequests?.firstIndex(where: { $0.request.id == record.request.id }) {
            guard watchRequests?[index].request == record.request else { throw WatchChatFailure.conflict }
            watchRequests?[index]=record
        } else {
            if watchRequests == nil { watchRequests=[] }
            watchRequests?.append(record)
        }
    }
    public mutating func enqueueWatch(_ original: WatchChatRecord) throws -> PhoneQueuedReply {
        var record=original
        guard record.replyID == nil else { throw WatchChatFailure.conflict }
        let selectedBefore=selected
        defer { selected=selectedBefore }
        if let thread=record.threadID {
            guard threads.contains(where: { $0.id == thread }) else { throw WatchChatFailure.noConversation }
            selected=thread
        } else { selected=nil }
        guard let reply=enqueueReply(text:record.text) else { throw WatchChatFailure.noConversation }
        record.threadID=reply.threadID; record.replyID=reply.replyID; record.phase = .running
        try retainWatch(record)
        return reply
    }
}
