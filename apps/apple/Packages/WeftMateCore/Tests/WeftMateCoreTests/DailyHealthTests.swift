import Foundation
import Testing
@testable import WeftMateCore

private func dailyCalendar(_ zone: String = "America/Los_Angeles") -> Calendar {
    var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: zone)!; return c
}
private func dailyDate(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }
@Test func dailyHealthLocalDaysFollowZoneAndBothDSTTransitions() {
    let calendar = dailyCalendar("America/New_York")
    for (value, hours) in [("2027-03-14T12:00:00Z", 23.0), ("2026-11-01T12:00:00Z", 25.0)] {
        let days = DailyHealthCalendar.days(now: dailyDate(value), calendar: calendar)
        #expect(days.count == 7)
        #expect(calendar.date(byAdding: .day, value: 1, to: days.last!)!.timeIntervalSince(days.last!) == hours * 3600)
        #expect(days.allSatisfy { calendar.component(.hour, from: $0) == 0 })
    }
    #expect(DailyHealthCalendar.key(dailyDate("2026-10-12T06:59:59Z"), calendar: dailyCalendar()) == "2026-10-11")
    #expect(DailyHealthCalendar.key(dailyDate("2026-10-12T07:00:00Z"), calendar: dailyCalendar()) == "2026-10-12")
}
@Test func dailyHealthSleepUnionAttributesWholeNightToFinalWakeDay() {
    let c = dailyCalendar("UTC")
    let sleep = DailyHealthCalendar.sleep([
        DateInterval(start: dailyDate("2026-10-10T22:00:00Z"), end: dailyDate("2026-10-11T04:00:00Z")),
        DateInterval(start: dailyDate("2026-10-11T00:00:00Z"), end: dailyDate("2026-10-11T06:00:00Z")),
        DateInterval(start: dailyDate("2026-10-11T00:00:00Z"), end: dailyDate("2026-10-11T06:00:00Z")),
        DateInterval(start: dailyDate("2026-10-11T13:00:00Z"), end: dailyDate("2026-10-11T14:00:00Z"))], calendar: c)
    #expect(sleep == ["2026-10-11": 540])
    let crossing = DailyHealthCalendar.sleep([
        DateInterval(start: dailyDate("2026-10-10T22:00:00Z"), end: dailyDate("2026-10-10T23:59:00Z")),
        DateInterval(start: dailyDate("2026-10-10T23:50:00Z"), end: dailyDate("2026-10-11T06:00:00Z"))], calendar: c)
    #expect(crossing == ["2026-10-11": 480])
    #expect(DailyHealthCalendar.sleep([], calendar: c).isEmpty)
}
@Test func dailyHealthSleepStagesAndAwakeGapDoNotSplitWakeDateOrCountAwakeTime() {
    let c = dailyCalendar("UTC")
    let stages = [DateInterval(start: dailyDate("2026-10-10T22:00:00Z"), end: dailyDate("2026-10-10T23:00:00Z")),
                  DateInterval(start: dailyDate("2026-10-10T23:00:00Z"), end: dailyDate("2026-10-10T23:59:00Z")),
                  DateInterval(start: dailyDate("2026-10-11T00:01:00Z"), end: dailyDate("2026-10-11T06:00:00Z"))]
    let awake = DateInterval(start: dailyDate("2026-10-10T23:59:00Z"), end: dailyDate("2026-10-11T00:01:00Z"))
    #expect(DailyHealthCalendar.sleep(stages, calendar: c, sessions: [awake]) == ["2026-10-11": 478])
    #expect(DailyHealthCalendar.sleep([], calendar: c, sessions: [awake]).isEmpty)
}
@Test func dailyHealthSleepAndWorkoutsUseElapsedTimeOnDSTAndPauses() {
    let c = dailyCalendar("America/New_York")
    let a = dailyDate("2026-11-01T02:00:00Z"), b = dailyDate("2026-11-01T12:00:00Z")
    #expect(DailyHealthCalendar.sleep([DateInterval(start: a, end: b)], calendar: c)["2026-11-01"] == 600)
    let start = dailyDate("2026-10-10T23:30:00Z"), end = dailyDate("2026-10-11T00:30:00Z")
    #expect(DailyHealthCalendar.workoutMinutes(start: start, end: end, duration: 1800, day: dailyDate("2026-10-11T00:00:00Z"), calendar: dailyCalendar("UTC")) == 15)
}
@Test func dailyHealthEncodingKeepsNullDistinctFromZeroAndOnlyContractKeys() throws {
    let empty = try JSONSerialization.jsonObject(with: JSONEncoder().encode(DailyHealth())) as! [String: Any]
    #expect(Set(empty.keys) == ["version", "status", "steps", "sleepMinutes", "restingHeartRateBpm", "exerciseMinutes", "workouts"])
    #expect(empty["steps"] is NSNull && empty["sleepMinutes"] is NSNull && empty["exerciseMinutes"] is NSNull)
    let zero = try JSONSerialization.jsonObject(with: JSONEncoder().encode(DailyHealth(steps: 0))) as! [String: Any]
    #expect((zero["steps"] as? Int) == 0)
    let body = try JSONDecoder().decode(DailyHealth.self, from: JSONEncoder().encode(DailyHealth.unavailable))
    #expect(body == .unavailable && body.status == "unavailable" && body.workouts.isEmpty)
}
@Test func dailyHealthDeliveryChangesRetryAndDisableRedaction() {
    let day = "2026-10-11", value = DailyHealth(steps: 1200, sleepMinutes: 480)
    var state = DailyHealthState(); state.connected = true; state.enabled = true
    state.enqueue([day: value]); state.enqueue([day: value]); #expect(state.pending.count == 1)
    // Failure has no acknowledgement: the identical aggregate remains available next time.
    #expect(state.pending[day] == value)
    state.acknowledge(day: day, value: value, now: Date()); state.enqueue([day: value]); #expect(state.pending.isEmpty)
    state.enqueue([day: DailyHealth(steps: 1500)]); #expect(state.pending.count == 1)
    state.disable(); #expect(!state.enabled && state.needsRemoteClear && state.pending[day] == .unavailable)
    state.clearRemote(["2026-10-09"]); #expect(state.pending.count == 2 && !state.needsRemoteClear)
    state.acknowledge(day: day, value: .unavailable, now: Date()); #expect(state.pending[day] == nil)
    var cleared = DailyHealthState(); cleared.delivered[day] = .unavailable; cleared.disable()
    #expect(cleared.pending.isEmpty) // Already-cleared dates are not sent again on another disable.
    // A late old success cannot erase the newer clear operation.
    state.pending[day] = .unavailable; state.acknowledge(day: day, value: value, now: Date()); #expect(state.pending[day] == .unavailable)
}
@Test func dailyHealthRetentionMatchesComputerInclusiveDateLimitAndStorageIsolation() throws {
    var state = DailyHealthState(); state.retentionDays = 7
    state.enqueue(["2026-10-04": DailyHealth(steps: 1), "2026-10-05": DailyHealth(steps: 2), "2026-10-13": DailyHealth(steps: 3)])
    state.prune(now: dailyDate("2026-10-12T12:00:00Z"), calendar: dailyCalendar("UTC"))
    #expect(Set(state.pending.keys) == ["2026-10-05"])
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let server = try ServerConfiguration(input: "https://health.example.com")
    let store = DailyHealthStore(directory: dir, account: try LocalAccountScope(server: server, ownerId: "synthetic-one"))
    let other = DailyHealthStore(directory: dir, account: try LocalAccountScope(server: server, ownerId: "synthetic-two"))
    try store.save(state); #expect(try store.load().pending == state.pending); #expect(try other.load().pending.isEmpty)
}
@Test func dailyHealthLogHasNoHealthMeasurementsOrIdentity() {
    let fields = RunLogPrivacy.fields(["phase": "health_delivery", "dayCount": "7", "result": "failure", "errorType": "network",
        "steps": "1234", "sleepMinutes": "480", "heartRate": "63", "ownerId": "synthetic", "deviceName": "synthetic"])
    #expect(fields == ["phase": "health_delivery", "dayCount": "7", "result": "failure", "errorType": "network"])
}

private actor DailyHealthTransport: HTTPTransport {
    var uploads: [URLRequest] = []; var fail = true
    func send(_ r: URLRequest) async throws -> HTTPResponse {
        if r.url!.path.hasSuffix("/auth/login") || r.url!.path.hasSuffix("/auth/me") {
            return .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)],
                body: Data(("{\"account\":{\"ownerId\":\"synthetic\",\"username\":\"fixture\",\"displayName\":\"Fixture\"},\"device\":{\"id\":\"test-phone\",\"name\":\"Test\"},\"csrfToken\":\"" + String(repeating: "b", count: 43) + "\"}").utf8))
        }
        if r.url!.path.hasSuffix("/status") { return .init(status: 200, body: Data("{\"ownerId\":\"synthetic\",\"hostId\":\"synthetic-host\"}".utf8)) }
        uploads.append(r); if fail { fail = false; return .init(status: 503, body: Data("{\"error\":{\"code\":\"UNAVAILABLE\"}}".utf8)) }
        return .init(status: 200, body: Data("{}".utf8))
    }
    func recorded() -> [URLRequest] { uploads }
}
@Test func dailyHealthRealClientUsesAuthenticatedPutAndIdenticalRetryBody() async throws {
    let transport = DailyHealthTransport(); let client = PersonalClient(credentialStore: MemoryStore(), transport: transport, platform: .iOS)
    let server = try ServerConfiguration(input: "https://health.example.com")
    let session = try await client.login(server: server, username: "fixture", password: "synthetic-only", deviceName: "Test")
    let scope = try LocalAccountScope(server: server, ownerId: session.account.ownerId)
    let value = DailyHealth(steps: 1234, sleepMinutes: 480, restingHeartRateBpm: 63, workouts: [.init(type: "步行", minutes: 30)])
    await #expect(throws: APIFailure.server(status: 503, code: "UNAVAILABLE")) { try await client.putDailyHealth(day: "2026-10-11", health: value, account: scope) }
    try await client.putDailyHealth(day: "2026-10-11", health: value, account: scope)
    let requests = await transport.recorded()
    #expect(requests.count == 2 && requests[0].httpBody == requests[1].httpBody)
    #expect(requests.allSatisfy { $0.httpMethod == "PUT" && $0.url?.path == "/personal/v1/daily-summaries/2026-10-11/health" && $0.value(forHTTPHeaderField: "X-WeftMate-CSRF") != nil })
    await #expect(throws: APIFailure.identityMismatch) { try await client.putDailyHealth(day: "2026-10-11", health: value, account: LocalAccountScope(server: server, ownerId: "other")) }
    #expect(await transport.recorded().count == 2)
}
