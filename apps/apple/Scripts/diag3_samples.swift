import Foundation
import WeftMateCore

@main struct DIAG3Samples {
    static func main() async throws {
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("diag3-synthetic-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let clock = Date(timeIntervalSince1970: 1_791_590_400)
        func log(_ name: String, _ platform: RunPlatform = .ios) -> RunLog {
            RunLog(directory: temporary.appendingPathComponent(name), platform: platform, appVersion: "0.1.0", osVersion: "26.3", policy: platform == .watchos ? .watch : .standard, now: { clock })
        }
        func save(_ store: RunLog, _ name: String) async throws {
            let rows = await store.records(), encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            var data = Data(); for row in rows { data.append(try encoder.encode(row)); data.append(10) }
            try data.write(to: output.appendingPathComponent(name + ".jsonl"))
        }
        let normal = log("normal", .macos); await normal.start(); await normal.exit(reason: "user_quit", code: 0); try await save(normal, "sample-normal")
        let killed = log("killed"); await killed.start(); await killed.record(.syncFailure, fields: ["phase": "sync", "code": "UNAVAILABLE"])
        let restarted = log("killed"); await restarted.start(); try await save(restarted, "sample-forced")
        let metric = log("metric"); await metric.start()
        let metricNext = log("metric"); await metricNext.start()
        let tree = try JSONSerialization.data(withJSONObject: ["callStacks": [["binaryName": "WeftMateCore", "offsetIntoBinaryTextSegment": 128, "symbol": "excluded", "private": "excluded"]]])
        await metricNext.diagnostic(.crash, fields: ["signal": "6", "exceptionCode": "0", "terminationReason": "signal"], tree: tree, begin: clock.addingTimeInterval(-3600), end: clock, diagnosticVersion: "0.1.0")
        try await save(metricNext, "sample-injected-metric")
        let watch = log("watch", .watchos); await watch.start(); await watch.record(.approvalFailure, fields: ["phase": "approval", "code": "UNCONFIRMED"])
        let watchNext = log("watch", .watchos); await watchNext.start(); try await save(watchNext, "sample-watch")
        let summary = await metricNext.summaryJSON(); try Data(summary.utf8).write(to: output.appendingPathComponent("sample-summary.json"))
        let phone = log("phone"); await phone.start()
        guard let bytes = await watchNext.transferBytes(), await phone.receiveWatch(bytes), await phone.receiveWatch(bytes) else { throw NSError(domain: "SyntheticTransfer", code: 1) }
        try Data(await phone.summaryJSON(peer: true).utf8).write(to: output.appendingPathComponent("sample-watch-on-phone-summary.json"))
    }
}
