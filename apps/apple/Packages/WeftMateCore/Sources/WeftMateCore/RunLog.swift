import Foundation
import Darwin

public enum RunPlatform: String, Codable, Sendable { case ios, macos, watchos }
public enum RunEvent: String, Codable, Sendable {
    case start = "app.start", exit = "app.exit", previousUncleanExit = "app.previous_unclean_exit"
    case failure = "app.failure", state = "app.state", connection = "connection.change"
    case syncFailure = "sync.failure", approvalFailure = "approval.failure"
    case crash = "diagnostic.crash", hang = "diagnostic.hang", cpu = "diagnostic.cpu", disk = "diagnostic.disk"
    case reports = "diagnostic.reports"
    public var abnormal: Bool { self != .start && self != .exit && self != .state && self != .connection && self != .reports }
}
public struct RunLogPolicy: Codable, Sendable, Equatable {
    public var retentionDays: Int
    public var maxBytes: Int
    public static let standard = RunLogPolicy(retentionDays: 7, maxBytes: 2 * 1024 * 1024)
    public static let watch = RunLogPolicy(retentionDays: 7, maxBytes: 256 * 1024)
    public init(retentionDays: Int, maxBytes: Int) { self.retentionDays = max(1, retentionDays); self.maxBytes = max(1024, maxBytes) }
}
/// Closed vocabulary. Arbitrary identifiers, error descriptions and business strings never enter storage.
public enum RunLogPrivacy {
    private static let vocabulary: [String: Set<String>] = [
        "reason": ["user_quit", "system_termination", "update", "suspected_foreground_crash", "terminated_in_background"],
        "state": ["foreground", "background", "inactive"], "launchKind": ["cold", "resume"],
        "status": ["online", "offline", "login_required", "certificate_error", "relay_unavailable", "connecting"],
        "phase": ["connection", "sync", "approval", "notification", "watch_transfer", "storage", "task", "lifecycle"],
        "errorType": ["api", "network", "storage", "objc_exception", "unknown"],
        "code": ["UNAVAILABLE", "UNCONFIRMED", "AUTH_REQUIRED", "CERTIFICATE_ERROR", "RELAY_UNAVAILABLE", "STORAGE_FAILED", "CANCELED"],
        "terminationReason": ["signal", "watchdog", "memory_pressure", "unknown"],
        "association": ["previous_run_candidate", "unavailable"]
    ]
    public static func fields(_ input: [String: String]) -> [String: String] {
        input.filter { key, value in
            if let words = vocabulary[key] { return words.contains(value) }
            if ["exitCode", "signal", "exceptionCode", "exceptionType", "errorCode", "reportCount", "line", "recordIndex"].contains(key) {
                return value.count <= 20 && value.range(of: "^-?[0-9]+$", options: .regularExpression) != nil
            }
            if key == "module" { return modules.contains(value) }
            if key == "file" { return sourceFiles.contains(value) }
            return false
        }
    }
    public static let modules: Set<String> = ["WeftMateCore", "WeftMatePhone", "WeftMateMac", "WeftMateWatch"]
    // Source locations are compile-time names, never user file names.
    public static let sourceFiles: Set<String> = ["AppleAppModel.swift", "TaskInteractionModel.swift", "MainChatModel.swift", "WatchHomeView.swift", "RunLogRuntime.swift", "PhoneWatchTimelineBridge.swift"]
    public static func location(module: String, file: String, line: UInt) -> [String: String] {
        fields(["module": module, "file": file.split(separator: "/").last.map(String.init) ?? "", "line": String(line)])
    }
    /// MetricKit often provides unsymbolicated offsets. Keep only our known binary and numeric offset.
    public static func ownFrames(_ tree: Data) -> [String] {
        guard tree.count <= 4 * 1024 * 1024, let object = try? JSONSerialization.jsonObject(with: tree) else { return [] }
        var frames: [String] = []
        func visit(_ value: Any) {
            guard frames.count < 8 else { return }
            if let dictionary = value as? [String: Any] {
                if let binary = dictionary["binaryName"] as? String, modules.contains(binary.replacingOccurrences(of: ".debug.dylib", with: "")),
                   let offset = dictionary["offsetIntoBinaryTextSegment"] as? NSNumber {
                    frames.append(binary.replacingOccurrences(of: ".debug.dylib", with: "") + "+" + offset.stringValue)
                }
                for key in dictionary.keys.sorted() where key != "binaryName" { if let child = dictionary[key] { visit(child) } }
            } else if let array = value as? [Any] { array.forEach(visit) }
        }
        visit(object); return frames
    }
}
public struct RunReportReference: Codable, Sendable, Equatable {
    public let name: String
    public let at: String
    public init(name: String, at: String) { self.name = name; self.at = at }
}
public struct RunLogRecord: Codable, Sendable, Equatable {
    public let at: String
    public let event: RunEvent
    public let runId: String
    public let platform: RunPlatform
    public let appVersion: String
    public let osVersion: String
    public var fields: [String: String]
    public var previousRunId: String?
    public var lastAt: String?
    public var lastEvent: RunEvent?
    public var frames: [String]?
    public var reports: [RunReportReference]?
    public var diagnosticBeginAt: String?
    public var diagnosticEndAt: String?
    public var diagnosticAppVersion: String?
}
public struct RunLogMarker: Codable, Sendable, Equatable {
    public let runId: String
    public let startedAt: String
    public var lastAt: String
    public var lastEvent: RunEvent
    public var state: String
    public var clean: Bool
    public var reason: String?
    public var highWaterAt: String?
}
public struct RunLogSummary: Codable, Sendable {
    public let platform: RunPlatform
    public let appVersion: String
    public let osVersion: String
    public let generatedAt: String
    public let recentAbnormalRecords: [RunLogRecord]
    public let abnormalCountsLast7Days: [String: Int]
    public let retentionPolicy: RunLogPolicy
}
public struct RunLogSnapshot: Sendable {
    public var current: RunLogMarker?
    public var previous: RunLogMarker?
    public var summary: RunLogSummary
    public var readable: Bool
    public var shouldNotify: Bool { previous?.clean == false && (summary.platform == .macos || previous?.state != "background") }
}
/// All filesystem work is actor-isolated, away from MainActor. No throwing public write API.
public actor RunLog {
    public let directory: URL
    public let platform: RunPlatform
    public let policy: RunLogPolicy
    private let appVersion: String
    private let osVersion: String
    private let now: @Sendable () -> Date
    private var marker: RunLogMarker?
    private var previous: RunLogMarker?
    private var readable = true
    private var highWater: Date?
    private let encoder: JSONEncoder
    private var sequence = 0
    private var resumePending = false
    public init(directory: URL, platform: RunPlatform, appVersion: String, osVersion: String,
                policy: RunLogPolicy = .standard, now: @escaping @Sendable () -> Date = { Date() }) {
        self.directory = directory; self.platform = platform; self.policy = policy; self.now = now
        // Versions come from trusted bundle / OS metadata, not user input.
        self.appVersion = Self.version(appVersion); self.osVersion = Self.version(osVersion)
        encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    }
    private static func version(_ value: String) -> String {
        value.count <= 32 && value.range(of: "^[0-9]+(?:[. ][0-9]+)*$", options: .regularExpression) != nil ? value : "unknown"
    }
    public static func timestamp(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
    private var markerURL: URL { directory.appendingPathComponent("run-state.json") }
    private func prepare() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var url = directory
        var resources = URLResourceValues(); resources.isExcludedFromBackup = true
        try url.setResourceValues(resources)
    }
    @discardableResult public func start() -> RunLogSnapshot {
        guard marker == nil else { return snapshot() }
        do {
            try prepare()
            if FileManager.default.fileExists(atPath: markerURL.path) {
                previous = try JSONDecoder().decode(RunLogMarker.self, from: Data(contentsOf: markerURL))
            }
            let date = now(), at = Self.timestamp(date)
            highWater = max(date, previous.flatMap { ISO8601DateFormatter().date(from: $0.highWaterAt ?? $0.lastAt) } ?? date)
            marker = RunLogMarker(runId: UUID().uuidString.lowercased(), startedAt: at, lastAt: at,
                                  lastEvent: .start, state: "foreground", clean: false)
            try saveMarker() // durable before first event; no in-memory-only crash flag
            if let previous, !previous.clean {
                write(.previousUncleanExit, fields: ["reason": previous.state == "background" && platform != .macos ? "terminated_in_background" : "suspected_foreground_crash", "state": previous.state], previous: previous)
            }
            write(.start, fields: ["launchKind": "cold"])
        } catch { readable = false }
        return snapshot()
    }
    public func record(_ event: RunEvent, fields: [String: String] = [:]) { write(event, fields: fields) }
    public func state(_ value: String) {
        guard ["foreground", "background", "inactive"].contains(value), marker != nil else { return }
        if value == "background" { resumePending = true }
        let resumed = value == "foreground" && resumePending
        if value == "foreground" { resumePending = false }
        if !(value == "inactive" && resumePending) { marker?.state = value }
        write(resumed ? .start : .state,
              fields: resumed ? ["state": value, "launchKind": "resume"] : ["state": value])
    }
    public func exit(reason: String, code: Int? = nil) {
        guard RunLogPrivacy.fields(["reason": reason])["reason"] != nil else { return }
        var fields = ["reason": reason]; if let code { fields["exitCode"] = String(code) }
        guard write(.exit, fields: fields) else { return }
        marker?.clean = true; marker?.reason = reason
        do { try saveMarker() } catch { readable = false }
    }
    public func diagnostic(_ event: RunEvent, fields: [String: String], tree: Data = Data(), begin: Date? = nil, end: Date? = nil, diagnosticVersion: String? = nil) {
        guard [.crash, .hang, .cpu, .disk].contains(event) else { return }
        if marker == nil { _ = start() } // MetricKit may deliver immediately while the UI boot task is still scheduled.
        var fields = fields
        fields["association"] = previous == nil ? "unavailable" : "previous_run_candidate"
        write(event, fields: fields, previous: previous, frames: RunLogPrivacy.ownFrames(tree), begin: begin, end: end, diagnosticVersion: diagnosticVersion)
    }
    private func saveMarker() throws {
        guard let marker else { return }
        try encoder.encode(marker).write(to: markerURL, options: .atomic)
        let handle = try FileHandle(forWritingTo: markerURL); try handle.synchronize(); try handle.close()
        let descriptor = Darwin.open(directory.path, O_RDONLY)
        if descriptor >= 0 { _ = Darwin.fsync(descriptor); Darwin.close(descriptor) }
    }
    public func reportInventory(_ reports: [RunReportReference]) {
        let safe = reports.filter {
            $0.name.range(of: "^WeftMateMac-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}(?:[.][0-9]{3})?[.]ips$", options: .regularExpression) != nil && ISO8601DateFormatter().date(from: $0.at) != nil
        }
        write(.reports, fields: ["reportCount": String(safe.count)], reports: Array(safe.suffix(50)))
    }
    @discardableResult private func write(_ event: RunEvent, fields: [String: String], previous: RunLogMarker? = nil, frames: [String]? = nil, reports: [RunReportReference]? = nil, begin: Date? = nil, end: Date? = nil, diagnosticVersion: String? = nil) -> Bool {
        guard let current = marker else { return false }
        do {
            let date = now(); highWater = max(date, highWater ?? date)
            let at = Self.timestamp(date)
            sequence += 1
            var safeFields = RunLogPrivacy.fields(fields); safeFields["recordIndex"] = String(sequence)
            let row = RunLogRecord(at: at, event: event, runId: current.runId, platform: platform,
                                   appVersion: appVersion, osVersion: osVersion, fields: safeFields,
                                   previousRunId: previous?.runId, lastAt: event == .previousUncleanExit ? previous?.lastAt : nil,
                                   lastEvent: event == .previousUncleanExit ? previous?.lastEvent : nil, frames: frames, reports: reports,
                                   diagnosticBeginAt: begin.map(Self.timestamp), diagnosticEndAt: end.map(Self.timestamp), diagnosticAppVersion: diagnosticVersion.map(Self.version))
            var bytes = try encoder.encode(row); bytes.append(10)
            // Partition by actual UTC day, but clean by monotonic persisted high-water time on rollback.
            let url = directory.appendingPathComponent("run-" + String(at.prefix(10)) + ".jsonl")
            if !FileManager.default.fileExists(atPath: url.path) { try Data().write(to: url); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path) }
            let descriptor = Darwin.open(url.path, O_WRONLY | O_APPEND)
            guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
            defer { Darwin.close(descriptor) }
            let written = bytes.withUnsafeBytes { Darwin.write(descriptor, $0.baseAddress, $0.count) }
            guard written == bytes.count, Darwin.fsync(descriptor) == 0 else { throw CocoaError(.fileWriteUnknown) }
            marker?.lastAt = at; marker?.highWaterAt = Self.timestamp(highWater ?? date); marker?.lastEvent = event
            try saveMarker(); try cleanup(); readable = true; return true
        } catch { readable = false; return false }
    }
    private func files() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])
            .filter { $0.lastPathComponent.range(of: "^run-[0-9]{4}-[0-9]{2}-[0-9]{2}\\.jsonl$", options: .regularExpression) != nil }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
    private func cleanup() throws {
        let date = highWater ?? now()
        let cutoff = String(Self.timestamp(date.addingTimeInterval(-Double(policy.retentionDays - 1) * 86400)).prefix(10))
        for url in try files() where String(url.lastPathComponent.dropFirst(4).prefix(10)) < cutoff { try FileManager.default.removeItem(at: url) }
        var all = try files()
        // Reserve room for state and paired-watch inbox. Delete oldest whole files; no partial JSON rows.
        var size = try all.reduce(0) { try $0 + $1.resourceValues(forKeys: [.fileSizeKey]).fileSize! }
        let inbox = (try? directory.appendingPathComponent("watch-inbox.json").resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let ceiling = max(0, policy.maxBytes - 4096 - inbox)
        while size > ceiling, !all.isEmpty {
            let url = all.removeFirst(); size -= (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            try FileManager.default.removeItem(at: url)
        }
    }
    public func records() -> [RunLogRecord] {
        guard marker != nil else { return [] }
        do {
            let rows = try files().flatMap { url in
                try Data(contentsOf: url).split(separator: 10).map { try JSONDecoder().decode(RunLogRecord.self, from: Data($0)) }
            }
            readable = true; return rows
        } catch { readable = false; return [] }
    }
    public func snapshot(peer: Bool = false) -> RunLogSnapshot {
        let rows = peer ? loadPeer() : records()
        let cutoff = now().addingTimeInterval(-7 * 86400)
        let anomalies = rows.filter { $0.event.abnormal }
        var counts: [String: Int] = [:]
        for row in anomalies where (ISO8601DateFormatter().date(from: row.at) ?? .distantPast) >= cutoff {
            counts[row.event.rawValue, default: 0] += 1
        }
        return RunLogSnapshot(current: peer ? nil : marker, previous: peer ? nil : previous,
            summary: RunLogSummary(platform: peer ? .watchos : platform, appVersion: peer ? rows.last?.appVersion ?? "unknown" : appVersion,
                osVersion: peer ? rows.last?.osVersion ?? "unknown" : osVersion, generatedAt: Self.timestamp(now()),
                recentAbnormalRecords: Array(anomalies.suffix(20)), abnormalCountsLast7Days: counts, retentionPolicy: peer ? .watch : policy), readable: readable)
    }
    public func summaryJSON(peer: Bool = false) -> String {
        let pretty = JSONEncoder(); pretty.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? pretty.encode(snapshot(peer: peer).summary)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
    // The retained Watch log is the bounded, durable outbox. Replay is idempotent on iPhone.
    public func transferBytes() -> Data? { try? encoder.encode(Array(records().suffix(150))) }
    public func deliverWatch(using channel: @Sendable (Data) async -> Bool) async -> Bool {
        guard platform == .watchos, let bytes = transferBytes() else { return false }
        let accepted = await channel(bytes)
        if !accepted { write(.syncFailure, fields: ["phase": "watch_transfer", "code": "UNCONFIRMED"]) }
        // No deletion on ACK: bounded retention is the outbox; replay on reconnect is idempotent.
        return accepted
    }
    public func receiveWatch(_ data: Data) -> Bool {
        guard platform == .ios, data.count <= 256 * 1024,
              let incoming = try? JSONDecoder().decode([RunLogRecord].self, from: data), incoming.count <= 150,
              incoming.allSatisfy({ row in
                  row.platform == .watchos && UUID(uuidString: row.runId) != nil &&
                  row.fields == RunLogPrivacy.fields(row.fields) && row.frames == nil && row.reports == nil && row.diagnosticBeginAt == nil && row.diagnosticEndAt == nil && row.diagnosticAppVersion == nil &&
                  Self.version(row.appVersion) == row.appVersion && Self.version(row.osVersion) == row.osVersion &&
                  ISO8601DateFormatter().date(from: row.at) != nil &&
                  (row.previousRunId == nil || UUID(uuidString: row.previousRunId!) != nil) &&
                  (row.lastAt == nil || ISO8601DateFormatter().date(from: row.lastAt!) != nil)
              }) else { return false }
        let existing = loadPeer()
        var combined = existing
        for row in incoming where !combined.contains(row) { combined.append(row) }
        let cutoff = now().addingTimeInterval(-7 * 86400)
        combined = combined.filter { (ISO8601DateFormatter().date(from: $0.at) ?? .distantPast) >= cutoff }
            .sorted { $0.at < $1.at }
        combined = Array(combined.suffix(150))
        do {
            try prepare()
            var bytes = try encoder.encode(combined)
            while bytes.count > 128 * 1024 && !combined.isEmpty { combined.removeFirst(); bytes = try encoder.encode(combined) }
            try bytes.write(to: directory.appendingPathComponent("watch-inbox.json"), options: .atomic)
            try cleanup(); return true
        } catch { readable = false; return false }
    }
    private func loadPeer() -> [RunLogRecord] {
        let url = directory.appendingPathComponent("watch-inbox.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        do { return try JSONDecoder().decode([RunLogRecord].self, from: Data(contentsOf: url)) }
        catch { readable = false; return [] }
    }
    public func export() -> URL? {
        do {
            let rows = records(); guard readable else { return nil }
            var bytes = Data()
            for row in rows { bytes.append(try encoder.encode(row)); bytes.append(10) }
            let exportRoot = FileManager.default.temporaryDirectory.appendingPathComponent("WeftMateRunLogExport", isDirectory: true)
            try FileManager.default.createDirectory(at: exportRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            var excluded = exportRoot; var values = URLResourceValues(); values.isExcludedFromBackup = true; try excluded.setResourceValues(values)
            let url = exportRoot.appendingPathComponent("shared-run-log.jsonl")
            try bytes.write(to: url, options: .atomic); return url
        } catch { readable = false; return nil }
    }
}
