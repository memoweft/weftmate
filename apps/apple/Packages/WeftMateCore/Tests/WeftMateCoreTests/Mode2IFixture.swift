#if DEBUG
import Foundation
import WeftMateCore

// An in-process contract transport shared by behavior tests and the real iPhone UI.
// It performs no network, model, filesystem, or computer operation.
final class Mode2IKeys: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ value: Data, key: String) { lock.withLock { values[key] = value } }
    func delete(key: String) { lock.withLock { values[key] = nil } }
    func rsaBytes() -> Data? { lock.withLock { values.first { $0.key.hasSuffix(".rsa") }?.value } }
}

actor Mode2ITransport: HTTPTransport {
    private let version: Int?
    private let host: String
    private let proposalEndsTurn: Bool
    private let pagedHistory: Bool
    private var loseCreationBeforeAccept = false
    private var loseCreationAfterAccept = false
    func loseNextCreation(beforeAccept: Bool) { loseCreationBeforeAccept=beforeAccept;loseCreationAfterAccept = !beforeAccept }
    private var decision: [String: Any]?
    private var commands: [String: [String: Any]] = [:]
    private var created: [[String: Any]] = []
    private var requests: [URLRequest] = []
    init(version: Int? = 1, host: String = "host-fixture", proposalEndsTurn: Bool = true, pagedHistory: Bool = false) {
        self.version = version; self.host = host; self.proposalEndsTurn = proposalEndsTurn; self.pagedHistory=pagedHistory
    }
    func recorded() -> [URLRequest] { requests }
    private let time = ISO8601DateFormatter().string(from: Date())
    private func json(_ value: [String: Any], status: Int = 200, headers: [String: String] = [:]) throws -> HTTPResponse {
        .init(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
    }
    private func project(_ id: String) -> [String: Any] {
        ["projectId": id, "name": id == "project-a" ? "合成资料" : "合成周报", "revision": 1,
         "revoked": false, "permission": "read-only", "createdAt": time]
    }
    private func chat(_ id: String, work: Bool = false, main: Bool = false, projectID: String = "project-a") -> [String: Any] {
        var row: [String: Any] = ["chatId": id, "kind": main ? "main" : "side", "title": main ? "小纬" : work ? "整理资料" : "旅行清单",
            "activeSessionId": "session-" + id, "modelProfileId": "fixture", "timeZone": "UTC", "revision": 1,
            "contentRevision": 1, "running": false, "sendAvailable": true, "taskAvailable": true,
            "pinned": false, "archived": false, "unread": false, "logicalHistory": true]
        if version == 1 { row["mode"] = work ? "work" : "chat"; if main { row["displayTitle"] = "小纬" } }
        if work {
            row["projectId"] = projectID; row["projectName"] = project(projectID)["name"]
            row["workHostId"] = host; row["workDirectory"] = ["projectId": projectID, "name": project(projectID)["name"]!]
        }
        return row
    }
    private func chats() -> [[String: Any]] {
        [chat("main", main: true), chat("work", work: true), chat("side")] + created
    }
    private func approval() -> [String: Any] {
        var row: [String: Any] = ["approvalId": "approval-mode", "sessionId": "session-main", "taskId": "cmd-root",
            "sourceCommandId": "cmd-root", "sourceReceiptId": "rpc:receipt-mode", "turn": 1, "callId": "call-mode",
            "toolName": "desktop.read", "reason": "这件事需要在电脑上做。要切换到工作吗？", "createdAt": time,
            "status": decision == nil ? "pending" : "answered", "intent": "work-switch"]
        if let decision {
            row["decisionOutcome"] = decision["outcome"]; row["decisionRequestId"] = decision["requestId"]; row["answeredAt"] = time
            if decision["outcome"] as? String == "allowed-once" {
                row["workSessionId"] = "session-proposal-work"; row["workCreateCommandId"] = "cmd-proposal-work"
            }
        }
        return row
    }
    private func events(_ id: String) -> [[String: Any]] {
        [("user.message", "请整理这份合成资料"), ("assistant.message", "先确认在哪个文件夹继续。")].enumerated().map { index, value in
            ["eventId": id + "-event-" + String(index), "chatId": id, "orderKey": String(index), "revision": 1,
             "type": value.0, "at": time, "sourceRef": ["sessionId": "session-" + id, "seq": index], "data": ["text": value.1]]
        }
    }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        guard request.url?.host == "a2-ui.unit.example" else { throw APIFailure.invalidResponse }
        requests.append(request)
        let path = request.url!.path.replacingOccurrences(of: "/personal/v1", with: ""), method = request.httpMethod ?? "GET"
        let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        if path == "/auth/login" || path == "/auth/me" {
            return try json(["account": ["ownerId": "owner-fixture", "username": "synthetic", "displayName": "合成"],
                "device": ["id": "device-fixture", "name": "Synthetic"], "csrfToken": String(repeating: "b", count: 43)],
                headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)])
        }
        if path == "/status" {
            var caps: [String: Any] = ["chats": 1, "chatTimeline": 1, "chatSend": 1, "chatSearch": 1, "sideChats": 1, "chatResources": 1, "chatLifecycle": 1]
            if let version { caps["workAndChat"] = version }
            return try json(["ownerId": "owner-fixture", "hostId": host, "executionAccount": true, "personalCapabilities": caps])
        }
        if path == "/projects" { return try json(["projects": [project("project-a"), project("project-b")], "canManage": false]) }
        if path == "/sessions", method == "GET" {
            return try json(["sessions": chats().map { row in
                var row = row; row["sessionId"] = row["activeSessionId"]; row["hostId"] = host; return row
            }])
        }
        if path == "/chats" { return try json(["items": chats().filter { $0["kind"] as? String == "side" }, "hasMore": false]) }
        if path.hasPrefix("/chats/"), path.hasSuffix("/events") {
            let id = path.split(separator: "/")[1]
            if pagedHistory, id == "main" {
                let older=URLComponents(url:request.url!,resolvingAgainstBaseURL:false)?.queryItems?.contains { $0.name == "before" } == true
                if older { try await Task.sleep(for:.seconds(3)) }
                let rows=(older ? 0..<8 : 8..<16).map { index -> [String:Any] in
                    ["eventId":"history-\(index)","chatId":"main","orderKey":String(format:"%03d",index),"revision":1,
                     "type":index.isMultiple(of:2) ? "user.message":"assistant.message","at":time,
                     "sourceRef":["sessionId":"session-main","seq":index],
                     "data":["text":(index<8 ? "较早记录 ":"较近记录 ")+String(index)+" · 合成消息，用来核对往上滑动后的阅读位置。"]]
                }
                var page:[String:Any]=["items":rows,"hasOlder":!older,"hasNewer":false,"syncCursor":"history-sync","contentRevision":1,"indexState":"ready","timeZone":"UTC"]
                if !older { page["olderCursor"]="history-before-8" }
                return try json(page)
            }
            return try json(["items": events(String(id)), "hasOlder": false, "hasNewer": false, "syncCursor": "cursor-mode",
                             "contentRevision": 1, "indexState": "ready", "timeZone": "UTC"])
        }
        if path.hasPrefix("/chats/"), path.hasSuffix("/changes") {
            return try json(["upserts": [], "removals": [], "hasMore": false, "nextCursor": "cursor-mode", "contentRevision": 1, "indexState": "ready", "timeZone": "UTC"])
        }
        if path.hasPrefix("/chats/"), path.hasSuffix("/dates") { return try json(["days": [["date": String(time.prefix(10)), "count": 2]], "contentRevision": 1, "indexState": "ready", "timeZone": "UTC"]) }
        if path.hasPrefix("/chats/"), path.split(separator: "/").count == 2 {
            let id = request.url!.lastPathComponent
            guard let row = chats().first(where: { $0["chatId"] as? String == id }) else { return try json(["error": ["code": "NOT_FOUND"]], status: 404) }
            return try json(["chat": row])
        }
        if path == "/sessions/session-main/approvals" { return try json(["approvals": [approval()], "hasMore": false]) }
        if path == "/sessions/session-main/approvals/approval-mode", method == "POST" {
            guard body["outcome"] as? String == "rejected" || body["workProjectId"] as? String == "project-a" || body["workProjectId"] as? String == "project-b" else { return try json(["error": ["code": "PROJECT_NOT_SELECTED"]], status: 409) }
            decision = body
            if body["outcome"] as? String == "allowed-once", !created.contains(where: { $0["chatId"] as? String == "proposal-work" }) {
                created.append(chat("proposal-work", work: true, projectID: body["workProjectId"] as! String))
            }
            return try json(["approval": approval(), "requestId": body["requestId"]!])
        }
        if path == "/settings/approvals" || path.hasSuffix("/approval-mode") { return try json(["mode":"ask", "allowedCategories":[]]) }
        if path.hasSuffix("/approvals") { return try json(["approvals": [], "hasMore": false]) }
        if path.hasSuffix("/questions") { return try json(["questions": [], "hasMore": false]) }
        if path == "/commands/cmd-proposal-work" {
            return try json(["command":["commandId":"cmd-proposal-work","requestId":"work-approval-mode","kind":"session.create",
                "targetDeviceId":host,"state":"accepted_by_dsh","sessionId":"session-proposal-work"]])
        }
        if path == "/tasks/cmd-root" {
            return try json(["taskId":"cmd-root", "sessionId":"session-main", "sourceText":"请整理这份合成资料",
                "source":["commandId":"cmd-root", "requestId":"request-root", "kind":"session.message", "targetDeviceId":host,
                    "state":"accepted_by_dsh", "createdAt":time, "updatedAt":time, "sessionId":"session-main", "receiptId":"rpc:receipt-mode"],
                "artifacts":[], "steps":[], "sources":[], "supplements":[], "resumes":[],
                "control":["state":"active", "updatedAt":time, "backgroundJobs":["active":0,"unconfirmed":0], "canSupplement":false,"canStop":false,"canResume":false],
                "replyEvidence":["status":proposalEndsTurn ? "completed":"unconfirmed", "turn":1, "assistantChunks":1, "textChunks":1, "reasoningChunks":0, "assistantMessages":1, "toolSaveObserved":false]])
        }
        if path.hasPrefix("/commands/by-request/") {
            if let command = commands[request.url!.lastPathComponent] { return try json(["command": command]) }
            return try json(["error": ["code": "NOT_FOUND"]], status: 404)
        }
        if method == "POST", path == "/commands" || path.hasSuffix("/sessions") {
            let target = body["targetDeviceId"] as? String
            guard let requestID = body["requestId"] as? String, (path.hasPrefix("/projects/") || target == host) else { throw APIFailure.identityMismatch }
            if loseCreationBeforeAccept { loseCreationBeforeAccept=false;throw APIFailure.transport(.timeout) }
            let kind = body["kind"] as? String ?? "session.create"
            let id = "created-" + String(created.count)
            let chatID = body["chatId"] as? String ?? id
            let boundSessionID = chats().first(where: { $0["chatId"] as? String == chatID })?["activeSessionId"] as? String
            let sessionID = body["sessionId"] as? String ?? boundSessionID ?? "session-" + id
            let command: [String: Any] = ["commandId": "cmd-" + id, "requestId": requestID, "kind": kind, "targetDeviceId": host,
                "state": "accepted_by_dsh", "sessionId": sessionID, "chatId": chatID, "receiptId": "rpc:" + id]
            commands[requestID] = command
            if kind != "session.message" && kind != "chat.message" {
                let projectID = body["projectId"] as? String ?? path.split(separator: "/").dropFirst().first.map(String.init)
                created.append(chat(id, work: kind == "session.create", projectID: projectID ?? "project-a"))
            }
            if loseCreationAfterAccept { loseCreationAfterAccept=false;throw APIFailure.transport(.timeout) }
            return try json(["command": command], status: 202)
        }
        if path == "/health/overview" { return try json(["day":"2026-10-14","connected":true,"vitals":[],"insight":["headline":"合成健康解读","text":"合成健康追问内容","suggestions":[]]]) }
        if path == "/models" { return try json(["models": [["id": "fixture", "name": "合成模型", "model": "fixture", "configured": true]]]) }
        if path == "/model-services" { return try json(["error": ["code": "NOT_FOUND"]], status: 404) }
        if path == "/sync/capabilities" { return try json(["deviceId": "device-fixture", "platform": body["platform"] ?? "ios", "sharedConversations": 1]) }
        if path == "/sync/events" { return try json(["events": [], "nextSeq": 0, "hasMore": false]) }
        if path == "/auth/devices" { return try json(["devices": [["id": "device-fixture", "name": "Synthetic", "current": true]]]) }
        if path == "/session-groups" { return try json(["groups": []]) }
        if path.hasSuffix("/thinking") { return try json(["sessionId": request.url!.deletingLastPathComponent().lastPathComponent, "supported": false, "enabled": false]) }
        return try json(["error": ["code": "NOT_FOUND"]], status: 404)
    }
}
#endif
