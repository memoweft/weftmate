// Explicit Debug UI-test fixture. No URLSession, Keychain, external account, model, or device action.
// Compiles to an empty file in Release and requires both --ui-testing and --task-progress-fixture.
#if DEBUG
import CryptoKit
import Foundation
import WeftMateCore

enum TaskProgressUIFixture {
    static func makeClient() -> PersonalClient {
        PersonalClient(credentialStore: Credentials(), transport: Transport(
            interactions: ProcessInfo.processInfo.arguments.contains("--interaction-flow-fixture")))
    }

    private final class Credentials: CredentialStore, @unchecked Sendable {
        private let lock = NSLock()
        private var values: [String: Data] = [:]
        func load(key: String) -> Data? { lock.withLock { values[key] } }
        func save(_ data: Data, key: String) { lock.withLock { values[key] = data } }
        func delete(key: String) { lock.withLock { values[key] = nil } }
    }

    private actor Transport: HTTPTransport {
        private let interactions: Bool
        private let approvalID = "e853ec16-12a9-4590-9dbb-c4b9a2ff84de"
        private let questionID = "fbfe3e79-8276-4900-bc75-1f78cb7bb844"
        private var decisionRequest: String?
        private var decisionOutcome: String?
        private var answerRequest: String?
        private var answer: [String: Any]?
        private var answerPayload: Data?
        private var approvalResolved = false
        private var questionResolved = false
        private var originalRequest: String?
        private var originalText = "受控测试请求"
        private var stopRequested = false
        private var stopObserved = false
        private let time = "2026-10-06T00:00:00Z"
        private let bytes = Data("# 受控界面成果\n这是测试文件，未调用真实模型。\n".utf8)

        init(interactions: Bool) { self.interactions = interactions }

        func send(_ request: URLRequest) async throws -> HTTPResponse {
            guard request.url?.host == "task-ui.unit.example", request.url?.scheme == "https" else {
                throw APIFailure.invalidResponse
            }
            let path = request.url!.path, method = request.httpMethod ?? "GET"
            let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            if path == "/personal/v1/auth/login", method == "POST" {
                return try json(auth(), headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)])
            }
            if path == "/personal/v1/sync/capabilities", method == "POST" {
                return try json(["deviceId": "device-fixture", "platform": body["platform"] ?? "ios", "sharedConversations": 1])
            }
            if path == "/personal/v1/commands", method == "POST" {
                guard body["kind"] as? String == "session.message", body["sessionId"] as? String == "session-fixture",
                      let requestId = body["requestId"] as? String, originalRequest == nil || originalRequest == requestId else {
                    throw APIFailure.invalidResponse
                }
                originalRequest = requestId
                originalText = body["text"] as? String ?? originalText
                return try json(["command": command()], status: 202)
            }
            if path == "/personal/v1/tasks/cmd-fixture/stop", method == "POST" {
                guard originalRequest != nil, let id = body["requestId"] as? String, UUID(uuidString: id) != nil else {
                    throw APIFailure.invalidResponse
                }
                stopRequested = true
                return try json(["task": task()], status: 202)
            }
            if interactions, path == "/personal/v1/sessions/session-fixture/approvals/" + approvalID, method == "POST" {
                guard originalRequest != nil, !stopRequested, Set(body.keys) == ["requestId", "outcome"],
                      let id = body["requestId"] as? String, UUID(uuidString: id) != nil,
                      let outcome = body["outcome"] as? String, ["allowed-once", "rejected"].contains(outcome),
                      decisionRequest == nil || (decisionRequest == id && decisionOutcome == outcome) else { throw APIFailure.invalidResponse }
                decisionRequest = id; decisionOutcome = outcome
                return try json(["approval": approval(resolved: false), "requestId": id])
            }
            if interactions, path == "/personal/v1/sessions/session-fixture/questions/" + questionID, method == "POST" {
                guard originalRequest != nil, !stopRequested, Set(body.keys) == ["requestId", "answer"],
                      let id = body["requestId"] as? String, UUID(uuidString: id) != nil,
                      let value = body["answer"] as? [String: Any] else {
                    throw APIFailure.invalidResponse
                }
                let encoded = try JSONSerialization.data(withJSONObject: value, options: .sortedKeys)
                guard answerRequest == nil || (answerRequest == id && answerPayload == encoded) else { throw APIFailure.invalidResponse }
                answerRequest = id; answer = value; answerPayload = encoded
                return try json(["question": question(resolved: false), "requestId": id])
            }
            guard method == "GET" else { throw APIFailure.invalidResponse }
            switch path {
            case "/personal/v1/auth/me": return try json(auth())
            case "/personal/v1/status": return try json(["ownerId": "owner-fixture", "hostId": "host-fixture", "backend": ["capabilities": ["desktopOpenApp": ["available": true]]]])
            case "/personal/v1/auth/devices":
                return try json(["devices": [["id": "device-fixture", "name": "受控测试设备", "current": true]]])
            case "/personal/v1/sync/events": return try json(["events": [], "nextSeq": 0, "hasMore": false])
            case "/personal/v1/sessions":
                return try json(["sessions": [["sessionId": "session-fixture", "title": "受控任务界面验收",
                    "modelProfileId": "model-fixture", "running": false, "sendAvailable": true]]])
            case "/personal/v1/models":
                return try json(["models": [["id": "model-fixture", "name": "受控测试模型", "model": "fixture-only", "configured": true]]])
            case "/personal/v1/sessions/session-fixture/events":
                let after = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?
                    .first(where: { $0.name == "afterSeq" })?.value.flatMap(Int.init) ?? -1
                let events: [[String: Any]] = after < 0 ? [["seq": 0, "type": "assistant.message", "at": time,
                    "data": ["text": interactions ? "这是受控审批和信息问答流程，未调用真实模型。" :
                        "这是受控界面记录。请在原对话补充所需说明。"]]] : []
                return try json(["events": events, "nextSeq": max(0, after), "hasMore": false])
            case "/personal/v1/sessions/session-fixture/approvals":
                if decisionRequest != nil { approvalResolved = true }
                return try json(["approvals": interactions && originalRequest != nil ? [approval(resolved: approvalResolved)] : [],
                                 "hasMore": false])
            case "/personal/v1/sessions/session-fixture/questions":
                if answerRequest != nil { questionResolved = true }
                return try json(["questions": interactions && originalRequest != nil ? [question(resolved: questionResolved)] : [],
                                 "hasMore": false])
            case "/personal/v1/commands":
                return try json(["commands": originalRequest == nil ? [] : [command()], "hasMore": false])
            case "/personal/v1/tasks/cmd-fixture":
                guard originalRequest != nil else { return try missing() }
                if stopRequested { stopObserved = true }
                return try json(task())
            case "/personal/v1/artifacts/artifact-fixture/preview":
                return try json(["artifact": artifact(), "text": String(decoding: bytes, as: UTF8.self)])
            case "/personal/v1/artifacts/artifact-fixture": return try json(["artifact": artifact()])
            case "/personal/v1/artifacts/artifact-fixture/download": return .init(status: 200, body: bytes)
            default:
                if path.hasPrefix("/personal/v1/commands/by-request/"),
                   path.components(separatedBy: "/").last == originalRequest { return try json(["command": command()]) }
                return try missing()
            }
        }
        private func auth() -> [String: Any] {
            ["account": ["ownerId": "owner-fixture", "username": "task_fixture", "displayName": "受控界面测试"],
             "device": ["id": "device-fixture", "name": "受控测试设备"], "csrfToken": String(repeating: "b", count: 43)]
        }
        private func command(_ id: String = "cmd-fixture", kind: String = "session.message") -> [String: Any] {
            ["commandId": id, "requestId": id == "cmd-fixture" ? originalRequest ?? "not-submitted" : "request-" + id,
             "kind": kind, "targetDeviceId": "host-fixture", "sessionId": "session-fixture", "state": "accepted_by_dsh",
             "receiptId": "receipt-" + id, "createdAt": time, "updatedAt": time]
        }
        private func artifact() -> [String: Any] {
            var value = command("cmd-artifact", kind: "desktop.write_artifact")
            value.merge(["state": "observed", "taskId": "cmd-fixture", "artifactId": "artifact-fixture", "fileName": "受控成果.md",
                "size": bytes.count, "sha256": SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(),
                "verification": ["status": "observed", "method": "sha256_readback", "observedAt": time]]) { _, next in next }
            return value
        }
        private func interaction(_ id: String, idField: String) -> [String: Any] {
            [idField: id, "sessionId": "session-fixture", "taskId": "cmd-fixture", "sourceCommandId": "cmd-fixture",
             "sourceReceiptId": "receipt-cmd-fixture", "turn": 0, "createdAt": time, "status": "pending"]
        }
        private func approval(resolved: Bool) -> [String: Any] {
            var row = interaction(approvalID, idField: "approvalId")
            row["callId"] = "call-fixture"; row["rootCallId"] = "root-call-fixture"
            row["toolName"] = "受控成果操作"; row["reason"] = "是否允许本次受控成果操作？"
            if let decisionRequest, let decisionOutcome {
                row["status"] = resolved ? "resolved" : "answered"
                row["decisionRequestId"] = decisionRequest; row["decisionOutcome"] = decisionOutcome; row["answeredAt"] = time
                if resolved { row["outcome"] = decisionOutcome; row["resolvedAt"] = time }
            }
            if stopRequested { row["status"] = "unavailable"; row["outcome"] = "cancelled"; row["resolvedAt"] = time }
            return row
        }
        private func question(resolved: Bool) -> [String: Any] {
            var row = interaction(questionID, idField: "questionRpcId")
            row["questions"] = [
                ["id": "format", "header": "呈现方式", "question": "希望结果如何呈现？", "options": [
                    ["label": "简短", "description": "突出主要内容"], ["label": "完整", "description": "保留详细说明"]]],
                ["id": "notes", "question": "还有什么需要补充？"]
            ]
            if let answerRequest, let answer {
                row["status"] = resolved ? "resolved" : "answered"
                row["answerRequestId"] = answerRequest; row["answer"] = answer; row["answeredAt"] = time
                if resolved { row["answerAcceptedAt"] = time; row["outcome"] = "answered"; row["resolvedAt"] = time }
            }
            if stopRequested { row["status"] = "unavailable"; row["outcome"] = "cancelled"; row["unavailableAt"] = time }
            return row
        }
        private func task() -> [String: Any] {
            let finished = interactions && approvalResolved && questionResolved
            var control: [String: Any] = ["state": stopRequested ? "stop_requested" : "active",
                "updatedAt": stopRequested ? "2026-10-06T00:01:00Z" : time,
                "canStop": !stopRequested && !finished, "canSupplement": !stopRequested && !finished, "canResume": stopObserved]
            if stopRequested {
                control["stopStatus"] = stopObserved ? "stopped" : "requested"
                control["pendingReceipts"] = stopObserved ? 0 : 1
            }
            var step = command("cmd-tool", kind: "tool.execute")
            step.merge(["taskId": "cmd-fixture", "state": interactions ? (finished ? "observed" : "pending") : "future_success",
                        "verification": ["futureProof": true]]) { _, next in next }
            return ["taskId": "cmd-fixture", "sessionId": "session-fixture", "sourceText": originalText, "source": command(),
                "steps": [step], "artifacts": !interactions || finished ? [artifact()] : [], "sources": [], "supplements": [], "resumes": [], "control": control,
                "replyEvidence": ["status": stopRequested ? "aborted" : (finished ? "completed" : "blocked"), "assistantChunks": 1, "textChunks": 1,
                    "reasoningChunks": 0, "assistantMessages": 1, "toolSaveObserved": true]]
        }
        private func missing() throws -> HTTPResponse { try json(["error": ["code": "NOT_FOUND"]], status: 404) }
        private func json(_ object: [String: Any], status: Int = 200, headers: [String: String] = [:]) throws -> HTTPResponse {
            .init(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: object))
        }
    }
}
#endif
