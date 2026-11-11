#if DEBUG && targetEnvironment(simulator)
import Foundation
import WeftMateCore

struct WatchRoutingPreview {
    let scene: String
    var snapshot: WatchChatSnapshot
    var draft=""
    var reachable=true
    var approval: WatchTimelineSnapshot? {
        guard scene == "approval" else { return nil }
        return .init(accountKey:"synthetic-watch",sessionID:"synthetic-session",taskID:nil,progress:"等待批准",running:true,
                     assistantSummary:"",approvals:[.init(id:"synthetic-approval",summary:"运行合成脚本")],completedTaskIDs:[])
    }
    static var current: Self? {
        let args=ProcessInfo.processInfo.arguments
        guard let i=args.firstIndex(of:"--watch-routing-preview"),args.indices.contains(i+1) else { return nil }
        let scene=args[i+1]
        let request=WatchChatRequest(conversationID:UUID().uuidString,accountKey:"synthetic-watch",text:scene == "choose" ? "帮我处理一下" : "解释一下什么是彩虹")
        var record=WatchChatRecord(request:request,text:request.text,device:.phone)
        record.phase = scene == "loading" ? .running : scene == "choose" ? .chooseDevice : scene == "error" || scene == "offline" ? .failed : .complete
        if scene == "choose" { record.device=nil;record.notice="这句话由谁回答？" }
        if scene == "error" { record.notice="这次没能完成回复，可以重新发送。" }
        if scene == "offline" { record.device = .computer;record.notice=WatchChatFailure.unavailable.errorDescription }
        return .init(scene:scene,snapshot:.init(accountKey:request.accountKey,record:scene == "empty" ? nil : record,
                     answer:scene == "answer" ? "彩虹来自阳光在水滴中的折射和反射。" : ""),draft:scene == "empty" ? "你好" : "")
    }
    static func reply(_ request: WatchChatRequest) -> WatchChatSnapshot {
        var record=WatchChatRecord(request:request,text:request.text,device:request.device ?? WatchContentRouting.rule(request.text))
        record.phase = record.device == nil ? .chooseDevice : .complete
        return .init(accountKey:request.accountKey,record:record,answer:record.device == nil ? "" : "合成回复：已收到这句话。")
    }
}
#endif
