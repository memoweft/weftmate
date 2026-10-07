import Foundation
import Testing
@testable import WeftMateCore

private let memoryOrigin = "https://memory.unit.weftmate.example:8443"
private func memoryJSON(_ value: [String: Any], status: Int = 200, headers: [String: String] = [:]) -> HTTPResponse {
    .init(status: status, headers: headers, body: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
}
private func memoryAuth(_ owner: String = "owner-A", device: String = "device-Mac") -> HTTPResponse {
    memoryJSON(["account": ["ownerId": owner, "username": "test", "displayName": "Test"],
        "device": ["id": device, "name": "Mac"], "csrfToken": String(repeating: "b", count: 43)],
        headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)])
}
private func memoryItem(_ id: String = "memory.1", kind: String = "cognition") -> [String: Any] {
    ["id": id, "kind": kind, "text": "synthetic memory", "truncated": false, "currentState": "current",
        "createdAt": "2026-10-05T00:00:00Z", "updatedAt": "2026-10-05T00:00:00Z",
        "lifecycle": ["invalidAt": NSNull(), "archivedAt": NSNull(), "mutedAt": NSNull()], "sourceCount": 1]
}
private func memoryCursor(owner: String = "owner-A", kind: String = "cognition", query: String = "", revision: Int = 4, offset: Int = 1) -> String {
    let data = try! JSONSerialization.data(withJSONObject: ["ownerId": owner, "kind": kind, "query": query, "worldRevision": revision, "offset": offset], options: [.sortedKeys])
    return data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}
private func memoryPage(_ items: [[String: Any]], revision: Int = 4, cursor: String? = nil) -> HTTPResponse {
    memoryJSON(["items": items, "worldRevision": revision, "nextCursor": cursor as Any? ?? NSNull(), "hasMore": cursor != nil, "searchScope": "account_snapshot"])
}
private func memoryStatusFixture(_ state: String = "disabled") -> HTTPResponse {
    memoryJSON(["state": state, "worldRevision": NSNull(), "capabilities": ["list": false, "source": false, "inject": false,
        "correct": false, "mute": false, "deleteEvidence": false, "deleteWorldItem": false],
        "pendingBoundaryCount": 0, "blockedBoundaryCount": 0, "discardedBoundaryCount": 0, "lastFailureCode": NSNull()])
}
private actor MemoryScriptTransport: HTTPTransport {
    struct Step: Sendable { let path: String; let response: HTTPResponse; var method = "GET"; var pause = false }
    private var steps: [Step]
    private var seen: [URLRequest] = []
    private var continuation: CheckedContinuation<Void, Never>?
    init(_ steps: [Step]) { self.steps = steps }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        seen.append(request)
        guard !steps.isEmpty else { throw APIFailure.invalidResponse }
        let step = steps.removeFirst()
        let path = (request.url?.path ?? "") + (request.url?.query.map { "?" + $0 } ?? "")
        guard path == "/personal/v1" + step.path && request.httpMethod == step.method else { throw APIFailure.invalidResponse }
        if step.pause { await withCheckedContinuation { continuation = $0 } }
        return step.response
    }
    func waitUntilPaused() async { while continuation == nil { await Task.yield() } }
    func release() { continuation?.resume(); continuation = nil }
    func requests() -> [URLRequest] { seen }
}
private func memoryLoginSteps() -> [MemoryScriptTransport.Step] {
    [.init(path: "/auth/login", response: memoryAuth(), method: "POST"), .init(path: "/status", response: memoryJSON(["ownerId": "owner-A", "hostId": "host-test"]))]
}
private func memoryLogin(_ client: PersonalClient) async throws -> AccountSession {
    try await client.login(server: ServerConfiguration(input: memoryOrigin), username: "test", password: "synthetic-only", deviceName: "Mac")
}
private func memoryScope() -> MemoryReadScope {
    MemoryReadScope(AccountSession(server: try! ServerConfiguration(input: memoryOrigin),
        account: AccountProfile(ownerId: "owner-A", username: "test", displayName: "Test", profileRevision: nil),
        device: DeviceRecord(id: "device-Mac", name: "Mac"), hostId: "host-test", verification: .verified))
}

struct MemorySDKTests {
    @Test func disabledStatusIsReportedWithoutAssumingReadyOrInjection() async throws {
        let transport = MemoryScriptTransport(memoryLoginSteps() + [.init(path: "/auth/me", response: memoryAuth()), .init(path: "/memory/status", response: memoryStatusFixture())])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await memoryLogin(client)
        let result = try await client.memoryStatus()
        #expect(result.status.state == .disabled && result.status.worldRevision == nil && !result.status.capabilities.inject)
        #expect(result.scope.ownerId == "owner-A" && result.scope.hostId == "host-test")
    }

    @Test func malformedStatusCapabilitiesAndNegativeRevisionsFail() throws {
        var fields = try #require(try JSONSerialization.jsonObject(with: memoryStatusFixture().body) as? [String: Any])
        fields["worldRevision"] = -1
        let invalid: MemoryServiceStatus = try MemoryValidation.decode(try JSONSerialization.data(withJSONObject: fields))
        #expect(throws: APIFailure.invalidResponse) { try invalid.validate() }
        fields["capabilities"] = ["list": true]
        #expect(throws: APIFailure.invalidResponse) { let _: MemoryServiceStatus = try MemoryValidation.decode(try JSONSerialization.data(withJSONObject: fields)) }
    }

    @Test func queryEncodingKeepsPlusAndDelimitersInSingleValueAndDoesNotReadSources() async throws {
        let query = "A+B&x=1?"
        let path = "/memory/items?kind=cognition&query=A%2BB%26x%3D1%3F&limit=50"
        let transport = MemoryScriptTransport(memoryLoginSteps() + [.init(path: "/auth/me", response: memoryAuth()), .init(path: path, response: memoryPage([memoryItem()]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await memoryLogin(client)
        let page = try await client.memoryItems(query: query)
        #expect(page.items.count == 1 && page.worldRevision == 4)
        #expect(await transport.requests().allSatisfy { !($0.url?.path.hasSuffix("/sources") ?? false) })
    }

    @Test func pagingUsesBoundOwnerFilterRevisionOffsetAndDoesNotMixItems() async throws {
        let token = memoryCursor()
        let transport = MemoryScriptTransport(memoryLoginSteps() + [.init(path: "/auth/me", response: memoryAuth()),
            .init(path: "/memory/items?kind=cognition&query=&limit=50", response: memoryPage([memoryItem()], cursor: token)),
            .init(path: "/auth/me", response: memoryAuth()),
            .init(path: "/memory/items?kind=cognition&query=&limit=50&after=\(token)", response: memoryPage([memoryItem("memory.2")]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await memoryLogin(client)
        let first = try await client.memoryItems()
        let cursor: MemoryPageCursor = try #require(first.nextCursor)
        let second = try await client.memoryItems(after: cursor)
        #expect(second.items.first?.id == "memory.2" && second.nextCursor == nil)
        let count = await transport.requests().count
        await #expect(throws: APIFailure.invalidResponse) { try await client.memoryItems(kind: .entity, after: first.nextCursor) }
        #expect(await transport.requests().count == count)
    }

    @Test func foreignMalformedStalledAndMismatchedCursorAreRejected() throws {
        for (token, expected) in [(memoryCursor(owner: "owner-B"), APIFailure.identityMismatch),
            (memoryCursor(kind: "entity"), .invalidResponse), (memoryCursor(query: "other"), .invalidResponse),
            (memoryCursor(revision: 5), .invalidResponse), (memoryCursor(offset: 0), .invalidResponse), ("not_valid_base64", .invalidResponse)] {
            #expect(throws: expected) { try MemoryItemsPage.decode(memoryPage([memoryItem()], cursor: token).body,
                scope: memoryScope(), kind: .cognition, query: "", limit: 50, previous: nil) }
        }
    }

    @Test func changedWorldRevisionOrDuplicateAcrossPagesRequiresFreshRead() throws {
        let first = try MemoryItemsPage.decode(memoryPage([memoryItem()], cursor: memoryCursor()).body,
            scope: memoryScope(), kind: .cognition, query: "", limit: 50, previous: nil)
        #expect(throws: APIFailure.server(status: 409, code: "MEMORY_REVISION_CHANGED")) {
            try MemoryItemsPage.decode(memoryPage([memoryItem("memory.2")], revision: 5).body, scope: memoryScope(), kind: .cognition, query: "", limit: 50, previous: first.nextCursor)
        }
        #expect(throws: APIFailure.invalidResponse) {
            try MemoryItemsPage.decode(memoryPage([memoryItem()]).body, scope: memoryScope(), kind: .cognition, query: "", limit: 50, previous: first.nextCursor)
        }
    }

    @Test func invalidQueryLimitAndItemPathFailBeforeAnyExtraRequest() async throws {
        let transport = MemoryScriptTransport(memoryLoginSteps())
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await memoryLogin(client)
        await #expect(throws: APIFailure.invalidResponse) { try await client.memoryItems(query: String(repeating: "a", count: 121)) }
        await #expect(throws: APIFailure.invalidResponse) { try await client.memoryItems(limit: 51) }
        for id in ["..", ".", "a/b", "a?x=1", "a%2fb"] {
            await #expect(throws: APIFailure.invalidResponse) { try await client.memoryDetail(kind: .cognition, itemID: id) }
        }
        #expect(await transport.requests().count == 2)
    }

    @Test func wrongItemIdentityUnavailableActionsAndRevisionAreValidated() throws {
        let actions: [String: Any] = ["correct": ["available": false, "reasonCode": "MEMORY_NOT_CURRENT"],
            "mute": ["available": false, "reasonCode": "MEMORY_NOT_CURRENT"], "delete": ["available": true]]
        let response = memoryJSON(["item": memoryItem(), "worldRevision": 4, "availableActions": actions])
        let detail = try MemoryItemDetail.decode(response.body, scope: memoryScope(), kind: .cognition, itemID: "memory.1", expectedRevision: 4)
        #expect(!detail.availableActions.correct.available && detail.availableActions.delete.available)
        #expect(throws: APIFailure.invalidResponse) { try MemoryItemDetail.decode(response.body, scope: memoryScope(), kind: .cognition, itemID: "other", expectedRevision: 4) }
        #expect(throws: APIFailure.server(status: 409, code: "MEMORY_REVISION_CHANGED")) { try MemoryItemDetail.decode(response.body, scope: memoryScope(), kind: .cognition, itemID: "memory.1", expectedRevision: 5) }
    }

    @Test func onlyExplicitSourcesReadReturnsPermissionScopedLocalBody() async throws {
        let source: [String: Any] = ["evidenceId": "evidence.1", "relation": "source", "currentnessState": "current",
            "permissions": ["allowLocalRead": false, "allowCloudRead": true, "allowInference": true], "contentAvailable": true,
            "summary": "withheld summary", "rawContent": "withheld raw source", "rawContentTruncated": false, "recordedAt": "2026-10-05T00:00:00Z"]
        let transport = MemoryScriptTransport(memoryLoginSteps() + [.init(path: "/auth/me", response: memoryAuth()),
            .init(path: "/memory/items/cognition/memory.1/sources", response: memoryJSON(["sources": [source], "worldRevision": 4]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await memoryLogin(client)
        let result = try await client.memorySources(kind: .cognition, itemID: "memory.1", expectedWorldRevision: 4)
        let item = try #require(result.sources.first)
        #expect(item.rawContent == nil && item.summary == nil && item.localContentWithheld)
        #expect(item.permissions.allowCloudRead && item.permissions.allowInference)
        #expect(await transport.requests().filter { $0.httpMethod == "POST" }.count == 1)
    }

    @Test func boundedItemAndSourceResponsesDoNotTruncateSilently() throws {
        #expect(throws: APIFailure.responseTooLarge) { try MemoryItemsPage.decode(Data(repeating: 32, count: 1_048_577), scope: memoryScope(), kind: .cognition, query: "", limit: 50, previous: nil) }
        #expect(throws: APIFailure.responseTooLarge) { try MemorySourcesSnapshot.decode(Data(repeating: 32, count: 262_145), scope: memoryScope(), kind: .cognition, itemID: "memory.1", expectedRevision: nil) }
        var oversized = memoryItem(); oversized["text"] = String(repeating: "a", count: 4_001)
        #expect(throws: APIFailure.invalidResponse) { try MemoryItemsPage.decode(memoryPage([oversized]).body, scope: memoryScope(), kind: .cognition, query: "", limit: 50, previous: nil) }
    }

    @Test func ownerSwitchRejectsOldCursorBeforeLookupAndLatePageBeforePublish() async throws {
        let token = memoryCursor()
        let transport = MemoryScriptTransport(memoryLoginSteps() + [.init(path: "/auth/me", response: memoryAuth()),
            .init(path: "/memory/items?kind=cognition&query=&limit=50", response: memoryPage([memoryItem()], cursor: token)),
            .init(path: "/auth/me", response: memoryAuth()),
            .init(path: "/memory/items?kind=cognition&query=&limit=50&after=\(token)", response: memoryPage([memoryItem("memory.2")]), pause: true),
            .init(path: "/auth/logout", response: memoryJSON([:]), method: "POST"),
            .init(path: "/auth/login", response: memoryAuth("owner-B", device: "device-B"), method: "POST"),
            .init(path: "/status", response: memoryJSON(["ownerId": "owner-B", "hostId": "host-test"]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await memoryLogin(client)
        let first = try await client.memoryItems()
        let operation = Task { try await client.memoryItems(after: first.nextCursor) }
        await transport.waitUntilPaused()
        try await client.logout(); _ = try await memoryLogin(client)
        await transport.release()
        await #expect(throws: APIFailure.accountChanged) { try await operation.value }
        let count = await transport.requests().count
        await #expect(throws: APIFailure.accountChanged) { try await client.memoryItems(after: first.nextCursor) }
        let current = await client.currentSession()
        #expect(await transport.requests().count == count && current?.account.ownerId == "owner-B")
    }

    @Test func JSNormalizationMatchesNFKCTrimLowerAndKeepsNonTrimNEL() throws {
        #expect(try MemoryValidation.normalizedQuery("\u{FEFF} ＡＢＣ \u{FEFF}") == "abc")
        #expect(try MemoryValidation.normalizedQuery("\u{0085}A\u{0085}") == "\u{0085}a\u{0085}")
    }
}
