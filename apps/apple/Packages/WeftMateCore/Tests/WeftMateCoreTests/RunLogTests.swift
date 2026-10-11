import Foundation
import Testing
@testable import WeftMateCore

private final class LogClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value = Date(timeIntervalSince1970: 1_791_590_400)
    func now() -> Date { lock.lock(); defer { lock.unlock() }; return value }
    func advance(_ seconds: Double) { lock.lock(); defer { lock.unlock() }; value = value.addingTimeInterval(seconds) }
}
@Suite struct RunLogTests {
    private func root() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("run-log-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true); return url
    }
    private func logger(_ root: URL, _ platform: RunPlatform = .ios, clock: LogClock = LogClock(), policy: RunLogPolicy = .standard) -> RunLog {
        RunLog(directory: root, platform: platform, appVersion: "0.1.0", osVersion: "26.3", policy: policy, now: { clock.now() })
    }
    @Test func forcedTerminationAndDurableMarker() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let first = logger(url); let initial = await first.start()
        await first.record(.syncFailure, fields: ["phase": "sync", "code": "UNAVAILABLE"])
        let second = logger(url); let result = await second.start()
        #expect(result.shouldNotify)
        #expect(result.previous?.runId == initial.current?.runId)
        let row = await second.records().first { $0.event == .previousUncleanExit }
        #expect(row?.previousRunId == initial.current?.runId)
        #expect(row?.lastEvent == .syncFailure)
        #expect(row?.lastAt != nil)
    }
    @Test func cleanQuit() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let first = logger(url, .macos); await first.start(); await first.exit(reason: "user_quit", code: 0)
        let second = logger(url, .macos); let result = await second.start()
        #expect(!result.shouldNotify); #expect(result.previous?.clean == true)
        #expect(await second.records().filter { $0.event == .previousUncleanExit }.isEmpty)
    }
    @Test func backgroundReclamationIsNotCrashNotice() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let first = logger(url); await first.start(); await first.state("background")
        let second = logger(url); let result = await second.start()
        #expect(!result.shouldNotify)
        #expect(await second.records().first { $0.event == .previousUncleanExit }?.fields["reason"] == "terminated_in_background")
    }
    @Test func resumeIsDistinctAndDoesNotCreateNewRun() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let log = logger(url); let initial = await log.start(); await log.state("background"); await log.state("inactive"); await log.state("foreground")
        #expect(await log.records().last?.fields["launchKind"] == "resume")
        #expect(await log.snapshot().current?.runId == initial.current?.runId)
    }
    @Test func dailyRotationAndRetention() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let clock = LogClock(), log = logger(url, clock: clock, policy: .init(retentionDays: 2, maxBytes: 20_000))
        await log.start(); clock.advance(86400); await log.record(.state)
        #expect(try FileManager.default.contentsOfDirectory(atPath: url.path).filter { $0.hasSuffix("jsonl") }.count == 2)
        clock.advance(2 * 86400); await log.record(.state)
        #expect(try FileManager.default.contentsOfDirectory(atPath: url.path).filter { $0.hasSuffix("jsonl") }.count == 1)
    }
    @Test func totalSizeBound() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let log = logger(url, policy: .init(retentionDays: 7, maxBytes: 8192)); await log.start()
        for _ in 0..<80 { await log.record(.failure, fields: ["code": "UNAVAILABLE"]) }
        let size = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.fileSizeKey]).reduce(0) { try $0 + ($1.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) }
        #expect(size <= 8192)
    }
    @Test func rollbackDoesNotResurrectOldFilesOrForgetRun() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let clock = LogClock(), log = logger(url, clock: clock); await log.start()
        clock.advance(10 * 86400); await log.record(.syncFailure)
        clock.advance(-20 * 86400); await log.record(.failure)
        let second = logger(url, clock: clock); let result = await second.start()
        #expect(result.shouldNotify)
        #expect(try FileManager.default.contentsOfDirectory(atPath: url.path).filter { $0.hasSuffix("jsonl") }.count <= 1)
    }
    @Test func unavailableDiskNeverThrowsOrClaimsHealthy() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let file = url.appendingPathComponent("blocked"); try Data([1]).write(to: file)
        let log = logger(file); let initial = await log.start(); await log.record(.failure); await log.exit(reason: "user_quit")
        #expect(!initial.readable); #expect(await log.export() == nil)
    }
    @Test func corruptMarkerShowsReadFailure() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        try Data("invalid".utf8).write(to: url.appendingPathComponent("run-state.json"))
        let log = logger(url); #expect(await log.start().readable == false)
    }
    @Test func privateContentRejectedForEveryField() {
        let privateValues = ["a conversation", "prompt text", "model output", "file contents", "notes.pdf", "account-name", "person@example.com", "device-name", "https://example.com/?token=secret", "example.com", "127.0.0.1", "secret-key", "Bearer abc", "Cookie=session", String(repeating: "a", count: 100), "/Users/<user>/project/file.swift"]
        for value in privateValues {
            for key in ["reason", "state", "phase", "code", "module", "file", "errorType", "errorCode", "url", "account", "message"] {
                #expect(RunLogPrivacy.fields([key: value]).isEmpty)
            }
        }
        #expect(RunLogPrivacy.fields(["phase": "sync", "code": "UNAVAILABLE", "errorCode": "503", "state": "background"]).count == 4)
        #expect(RunLogPrivacy.fields(["unknown": "UNAVAILABLE"]).isEmpty)
    }
    @Test func safeSourceLocation() {
        let location = RunLogPrivacy.location(module: "WeftMateCore", file: "/Users/<user>/AppleAppModel.swift", line: 25)
        #expect(location == ["module": "WeftMateCore", "file": "AppleAppModel.swift", "line": "25"])
        #expect(RunLogPrivacy.location(module: "UserModule", file: "user.pdf", line: 1) == ["line": "1"])
    }
    @Test func metricProjectionOwnFramesOnlyAndBounded() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let tree = try JSONSerialization.data(withJSONObject: ["callStacks": Array(repeating: ["binaryName": "WeftMateCore", "offsetIntoBinaryTextSegment": 123, "symbol": "private prompt", "path": "/Users/<user>"], count: 20) + [["binaryName": "Other", "offsetIntoBinaryTextSegment": 42]]])
        #expect(RunLogPrivacy.ownFrames(tree) == Array(repeating: "WeftMateCore+123", count: 8))
        let first = logger(url); await first.start()
        let second = logger(url); await second.start(); await second.diagnostic(.crash, fields: ["signal": "6", "terminationReason": "watchdog", "payload": "private"], tree: tree)
        let rows = await second.records(); let record = try #require(rows.last)
        #expect(record.previousRunId != nil); #expect(record.fields["payload"] == nil)
        #expect(record.fields["association"] == "previous_run_candidate")
        let summary = await second.summaryJSON(); #expect(!summary.contains("private")); #expect(summary.contains("diagnostic.crash"))
    }
    @Test func watchReplayIdempotentPersistentAndBounded() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let watch = logger(url.appendingPathComponent("watch"), .watchos, policy: .watch); await watch.start()
        await watch.record(.approvalFailure, fields: ["phase": "approval", "code": "UNCONFIRMED"])
        let phoneRoot = url.appendingPathComponent("phone"), phone = logger(phoneRoot); await phone.start()
        let bytes = try #require(await watch.transferBytes())
        #expect(await phone.receiveWatch(bytes)); #expect(await phone.receiveWatch(bytes))
        let restored = logger(phoneRoot); await restored.start()
        #expect(await restored.snapshot(peer: true).summary.recentAbnormalRecords.count == 1)
        #expect(await restored.snapshot(peer: true).summary.platform == .watchos)
    }
    @Test func watchRejectsMalformedOrNonWatchPayload() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let phone = logger(url); await phone.start()
        #expect(await phone.receiveWatch(Data("private".utf8)) == false)
        let data = try #require(await phone.transferBytes()); #expect(await phone.receiveWatch(data) == false)
    }
    @Test func summaryCountsOnlyFailuresAndHasCommonStructure() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let log = logger(url); await log.start(); await log.record(.connection, fields: ["status": "offline"]); await log.record(.approvalFailure, fields: ["phase": "approval"])
        let json = await log.summaryJSON(), object = try #require(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        #expect(Set(object.keys) == Set(["platform", "appVersion", "osVersion", "generatedAt", "recentAbnormalRecords", "abnormalCountsLast7Days", "retentionPolicy"]))
        #expect(await log.snapshot().summary.abnormalCountsLast7Days == ["approval.failure": 1])
    }
    @Test func reportNamesAreSystemMetadataOnly() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let log = logger(url, .macos); await log.start()
        await log.reportInventory([.init(name: "WeftMateMac-2026-10-09-053026.ips", at: "2026-10-09T05:30:26Z"), .init(name: "personal-notes.pdf", at: "2026-10-09T05:30:26Z")])
        let rows = await log.records(); #expect(rows.last?.reports?.count == 1)
        #expect(rows.last?.fields["reportCount"] == "1")
    }
    @Test func backupExclusionAndJSONLineIntegrity() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let log = logger(url); await log.start(); await log.exit(reason: "system_termination", code: 0)
        #expect(try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
        for file in try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil) where file.pathExtension == "jsonl" {
            let bytes = try Data(contentsOf: file); #expect(bytes.last == 10)
            for line in bytes.split(separator: 10) { #expect(try JSONDecoder().decode(RunLogRecord.self, from: Data(line)).at.count > 0) }
        }
    }
    @Test func injectedMetricTimeAndVersion() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let clock = LogClock(), log = logger(url, clock: clock); await log.start()
        await log.diagnostic(.hang, fields: [:], begin: clock.now().addingTimeInterval(-3600), end: clock.now(), diagnosticVersion: "0.0.9")
        let rows = await log.records(); #expect(rows.last?.diagnosticBeginAt != nil); #expect(rows.last?.diagnosticAppVersion == "0.0.9")
        #expect(rows.last?.fields["association"] == "unavailable")
    }

    @Test func injectedChannelFailureRetainsWatchLogAndReplays() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let watchRoot = url.appendingPathComponent("watch"), watch = logger(watchRoot, .watchos, policy: .watch)
        await watch.start(); await watch.record(.approvalFailure, fields: ["phase": "approval", "code": "UNCONFIRMED"])
        #expect(await watch.deliverWatch { _ in false } == false)
        let reopened = logger(watchRoot, .watchos, policy: .watch); await reopened.start()
        let phone = logger(url.appendingPathComponent("phone")); await phone.start()
        #expect(await reopened.deliverWatch { bytes in await phone.receiveWatch(bytes) })
        #expect(await reopened.deliverWatch { bytes in await phone.receiveWatch(bytes) })
        let peer = await phone.snapshot(peer: true)
        #expect(peer.summary.abnormalCountsLast7Days["approval.failure"] == 1)
        #expect(peer.summary.abnormalCountsLast7Days["sync.failure"] == 1)
        #expect(peer.summary.abnormalCountsLast7Days["app.previous_unclean_exit"] == 1)
    }

    @Test func sameSecondFailuresRemainDistinctAcrossReplay() async throws {
        let url = try root(); defer { try? FileManager.default.removeItem(at: url) }
        let watch = logger(url.appendingPathComponent("watch"), .watchos); await watch.start()
        for _ in 0..<3 { await watch.record(.approvalFailure, fields: ["phase": "approval", "code": "UNCONFIRMED"]) }
        let phone = logger(url.appendingPathComponent("phone")); await phone.start()
        #expect(await watch.deliverWatch { await phone.receiveWatch($0) })
        #expect(await watch.deliverWatch { await phone.receiveWatch($0) })
        #expect(await phone.snapshot(peer: true).summary.abnormalCountsLast7Days["approval.failure"] == 3)
    }

}
