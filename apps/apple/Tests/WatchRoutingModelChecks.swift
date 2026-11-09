// 保护：真实手机模型与电脑接口不能重复收单，离线或换账号后不能继续执行原任务。
import Foundation
import WeftMateCore

@main struct WatchRoutingModelChecks {
    @MainActor static func main() async {
        do { try await run() } catch { print("FAIL WatchRoutingModelChecks: \(error)");exit(1) }
    }
    @MainActor static func run() async throws {
        let root=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true),process=Process(),output=Pipe()
        process.executableURL=URL(fileURLWithPath:"/usr/bin/env")
        process.arguments=["node",URL(fileURLWithPath:#filePath).deletingLastPathComponent().appendingPathComponent("watch_routing_fixture.mjs").path]
        process.standardOutput=output;try process.run()
        defer { if process.isRunning { process.terminate();process.waitUntilExit() } }
        var line=Data()
        while true { let byte=output.fileHandleForReading.readData(ofLength:1);guard !byte.isEmpty else { throw WatchChatFailure.unavailable };if byte == Data([10]) { break };line.append(byte) }
        let ready=try JSONSerialization.jsonObject(with:line) as! [String:String]
        let app=AppleAppModel(directory:root),keys=PhoneCheckCredentials()
        app.phoneChat=PhoneStandaloneModel(testCredentials:keys,testLoopback:true);app.phoneChat.activate(app:app)
        try app.phoneChat.saveModel(.init(name:"合成手机模型",baseURL:ready["model"]!+"/v1",model:"synthetic",apiKey:"synthetic-watch-key"))
        app.phoneChat.newThread();app.phoneChat.draft="手机未发送的草稿"
        let selected=app.phoneChat.state.selected
        let router=PhoneWatchConversationModel(app:app)
        func deliver(_ request: WatchChatRequest, to receiver: PhoneWatchConversationModel? = nil) async throws {
            let data=try await (receiver ?? router).receive(JSONEncoder().encode(request))
            let reply=try JSONDecoder().decode(WatchChatSnapshot.self,from:data)
            guard reply.accountKey == request.accountKey else { throw WatchChatFailure.accountChanged }
        }
        func require(_ value: Bool,_ name: String) throws { guard value else { throw NSError(domain:name,code:1) };print("PASS "+name) }
        func request(_ text: String,conversation: String = UUID().uuidString) -> WatchChatRequest { .init(conversationID:conversation,accountKey:router.accountKey!,text:text) }
        func settled(_ request: WatchChatRequest) async throws -> WatchChatSnapshot {
            for _ in 0..<160 {
                let value=try await router.snapshot(requestID:request.id)
                if let record=value.record,!record.phase.active { return value }
                try await Task.sleep(for:.milliseconds(50))
            }
            throw NSError(domain:"WatchReplyTimeout",code:1)
        }
        func counts() async throws -> [String:Int] {
            let (data,_)=try await URLSession.shared.data(from:URL(string:ready["model"]!+"/report")!)
            return try JSONSerialization.jsonObject(with:data) as! [String:Int]
        }
        let phone=request("你好");try await deliver(phone);try await deliver(phone)
        let phoneReply=try await settled(phone)
        try require(phoneReply.record?.phase == .complete && phoneReply.record?.device == .phone && phoneReply.answer.contains("手机已经回答"),"phone HTTP streamed answer")
        try require(app.phoneChat.draft == "手机未发送的草稿" && app.phoneChat.state.selected == selected,"phone draft and selection retained")
        try await deliver(phone)
        try require(try await counts()["questions"] == 1,"duplicate delivery never repeats model call")
        let phoneFollowup=request("然后呢",conversation:phone.conversationID);try await deliver(phoneFollowup)
        let continuedPhone=try await settled(phoneFollowup)
        try require(continuedPhone.record?.device == .phone && continuedPhone.record?.threadID == phoneReply.record?.threadID,"phone follow-up keeps its conversation")
        let ambiguous=request("帮我处理一下");try await deliver(ambiguous);let classified=try await settled(ambiguous)
        try require(classified.record?.device == .phone && classified.record?.phase == .complete,"ambiguous input classified before generation")
        let unknown=request("无效分类");try await deliver(unknown);let choice=try await settled(unknown)
        try require(choice.record?.phase == .chooseDevice,"invalid classification asks for device")
        app.session=try await app.assistantClient.login(server:ServerConfiguration(input:ready["host"]!,allowLoopbackHTTP:true),username:"watch-tester",password:"synthetic-watch-only",deviceName:"合成手机")
        let pc=request("打开电脑上的文件");try await deliver(pc);let pcReply=try await settled(pc)
        try require(pcReply.record?.device == .computer && pcReply.record?.phase == .complete && !pcReply.answer.isEmpty,"computer real command and matching reply")
        let pcFollowup=request("继续",conversation:pc.conversationID);try await deliver(pcFollowup)
        let continuedPC=try await settled(pcFollowup)
        try require(continuedPC.record?.device == .computer && continuedPC.record?.threadID == pcReply.record?.threadID,"computer follow-up keeps its conversation")
        let long=request("打开电脑上的长历史文件");try await deliver(long);let longReply=try await settled(long)
        try require(longReply.record?.phase == .complete && longReply.answer.contains("合成任务完成"),"reply beyond the first history page remains bound to its request")
        let afterPC=try await counts();try await deliver(pc)
        try require(try await counts()["sends"] == afterPC["sends"],"computer duplicate receipt does not execute again")
        app.offline.hostOffline=true
        let offline=request("打开电脑软件");try await deliver(offline);let unavailable=try await settled(offline)
        try require(unavailable.record?.phase == .failed && unavailable.record?.command == nil,"offline computer keeps no pending command")
        app.offline.hostOffline=false;_ = try await router.snapshot(requestID:offline.id)
        try require(try await counts()["sends"] == afterPC["sends"],"reconnect does not replay offline task")
        app.phoneChat=PhoneStandaloneModel(testCredentials:keys,testLoopback:true);app.phoneChat.activate(app:app)
        let restarted=PhoneWatchConversationModel(app:app);try await deliver(phone,to:restarted);try await deliver(pc,to:restarted)
        let afterRestart=try await counts()
        try require(afterRestart["sends"] == afterPC["sends"] && afterRestart["questions"] == afterPC["questions"],"durable duplicate protection after controller restart")
        let switched=request("慢速模糊请求");try await deliver(switched,to:restarted)
        try await Task.sleep(for:.milliseconds(100));app.cloudLogin.subject="account-b";app.phoneChat.activate(app:app)
        try await Task.sleep(for:.milliseconds(600))
        let finalCounts=try await counts()
        try require(app.phoneChat.state.watchRequests?.isEmpty != false && app.phoneChat.state.threads.isEmpty && finalCounts["questions"] == afterRestart["questions"],"late classifier result cannot cross accounts")
        try app.phoneChat.saveModel(.init(name:"合成手机模型",baseURL:ready["model"]!+"/v1",model:"synthetic",apiKey:"synthetic-watch-key"))
        let clearing=request("慢速清空检查");try await deliver(clearing,to:restarted)
        try await Task.sleep(for:.milliseconds(100));app.phoneChat.clearLocalData()
        try await Task.sleep(for:.milliseconds(600))
        do { try await deliver(clearing,to:restarted);throw NSError(domain:"OldWatchRequestSurvivedClear",code:1) }
        catch WatchChatFailure.accountChanged {}
        try require(app.phoneChat.state.watchRequests?.isEmpty != false && app.phoneChat.state.threads.isEmpty,"cleared storage rejects delayed and replayed watch request")
        let report: [String:Any]=["passed":true,"realPhoneHTTP":true,"realPersonalHost":true,"compiledComputerRuntime":false,"watchConnectivityPairing":false,"counts":try await counts()]
        try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]).write(to:root.appendingPathComponent("watch-routing-report.json"))
    }
}
