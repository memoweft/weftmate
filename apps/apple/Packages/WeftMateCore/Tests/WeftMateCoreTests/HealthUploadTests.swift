import Foundation
import Testing
@testable import WeftMateCore

private actor HealthTransport: HTTPTransport {
    var uploads: [URLRequest] = []
    var outcomes: [Int]
    init(_ outcomes: [Int] = [404, 501, 503, 200]) { self.outcomes = outcomes }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        let csrf = String(repeating: "b", count: 43)
        if path.hasSuffix("/auth/login") || path.hasSuffix("/auth/me") {
            return .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)],
                body: Data("{\"account\":{\"ownerId\":\"health-owner\",\"username\":\"fixture\",\"displayName\":\"Fixture\"},\"device\":{\"id\":\"test-phone\",\"name\":\"Test\"},\"csrfToken\":\"\(csrf)\"}".utf8))
        }
        if path.hasSuffix("/status") { return .init(status: 200, body: Data("{\"ownerId\":\"health-owner\",\"hostId\":\"test-host\"}".utf8)) }
        uploads.append(request)
        let status = outcomes.removeFirst()
        return .init(status: status, body: Data((status == 200 ? "{}" : "{\"error\":{\"code\":\"NOT_IMPLEMENTED\"}}").utf8))
    }
    func recorded() -> [URLRequest] { uploads }
}
@Test func healthUpload404And501AndServerFailureKeepExactQueueUntilSuccessfulRetry() async throws {
    let transport = HealthTransport()
    let client = PersonalClient(credentialStore: MemoryStore(), transport: transport, platform: .iOS)
    let server = try ServerConfiguration(input: "https://health.invalid")
    let session = try await client.login(server: server, username: "fixture", password: "fixture-password-only", deviceName: "Test")
    let scope = try LocalAccountScope(server: server, ownerId: session.account.ownerId)
    let day = Date(timeIntervalSince1970: 1_790_000_000)
    let summary = HealthSummaryCalculator.summarize(days: [.init(day: day, values: [.hrv: 40])], sleep: [], workouts: [],
        preferences: .init(), calendar: Calendar(identifier: .gregorian), deviceId: "test-phone", now: day)[0]
    var queue = HealthLocalState(); queue.enqueue([summary])
    for _ in 0..<2 {
        let result = try await client.uploadHealthSummary(summary, account: scope)
        if case .uploaded = result { queue.acknowledge(summary) }
        #expect(queue.pending.count == 1)
    }
    await #expect(throws: APIFailure.server(status: 503, code: "NOT_IMPLEMENTED")) {
        try await client.uploadHealthSummary(summary, account: scope)
    }
    #expect(queue.pending.count == 1)
    if case .uploaded = try await client.uploadHealthSummary(summary, account: scope) { queue.acknowledge(summary) }
    #expect(queue.pending.isEmpty)
    let requests = await transport.recorded()
    #expect(requests.count == 4)
    #expect(Set(requests.compactMap(\.httpBody)).count == 1)
    #expect(requests.allSatisfy { $0.httpMethod == "POST" && $0.url?.path == "/personal/v1/health/daily-summaries" })
    #expect(requests[0].value(forHTTPHeaderField: "Origin") == server.originString)
    #expect(requests[0].value(forHTTPHeaderField: "X-WeftMate-CSRF") != nil)
    let other = try LocalAccountScope(server: server, ownerId: "other")
    await #expect(throws: APIFailure.identityMismatch) { try await client.uploadHealthSummary(summary, account: other) }
    #expect(await transport.recorded().count == 4)
}

@Test func healthDeleteDraftUsesAccountScopedDateAndAllPathsAndDefersUnimplemented() async throws {
    let transport = HealthTransport([404, 204])
    let client = PersonalClient(credentialStore: MemoryStore(), transport: transport, platform: .iOS)
    let server = try ServerConfiguration(input: "https://health.invalid")
    let session = try await client.login(server: server, username: "fixture", password: "fixture-password-only", deviceName: "Test")
    let account = try LocalAccountScope(server: server, ownerId: session.account.ownerId)
    if case .uploaded = try await client.deleteHealthSummaries(account: account, date: "2026-10-06") { Issue.record("404 must defer deletion") }
    if case .deferred = try await client.deleteHealthSummaries(account: account) { Issue.record("204 must complete deletion") }
    let requests = await transport.recorded()
    #expect(requests.map { $0.url!.path } == ["/personal/v1/health/daily-summaries/2026-10-06", "/personal/v1/health/daily-summaries"])
    #expect(requests.allSatisfy { $0.httpMethod == "DELETE" })
    await #expect(throws: APIFailure.invalidResponse) { try await client.deleteHealthSummaries(account: account, date: "../other") }
}
