import Foundation
import Darwin
import SwiftUI
import WeftMateCore
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif
#if !os(watchOS)
import MetricKit
#endif

@MainActor final class RunLogRuntime: ObservableObject {
    static let shared = RunLogRuntime()
    let store: RunLog
    @Published var snapshot: RunLogSnapshot?
    @Published var watchSnapshot: RunLogSnapshot?
    @Published var notify = false
    private var boot: Task<Void, Never>?
    private var lastConnection: String?
    #if !os(watchOS)
    private var metrics: LocalMetricSubscriber?
    #endif
    private init() {
        #if os(macOS)
        let platform = RunPlatform.macos
        #elseif os(iOS)
        let platform = RunPlatform.ios
        #else
        let platform = RunPlatform.watchos
        #endif
        let args = ProcessInfo.processInfo.arguments
        var root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LocalRunLog", isDirectory: true)
        #if DEBUG
        if args.contains("--ui-testing") || Bundle.main.bundleIdentifier == nil {
            let index = args.firstIndex(of: "--ui-testing-namespace")
            let namespace = index.flatMap { args.indices.contains($0 + 1) ? args[$0 + 1] : nil } ?? UUID().uuidString
            root = FileManager.default.temporaryDirectory.appendingPathComponent("diag3-" + namespace.filter { $0.isLetter || $0.isNumber || $0 == "-" }, isDirectory: true)
        }
        #endif
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
        let os = ProcessInfo.processInfo.operatingSystemVersion
        #if DEBUG
        if args.contains("--ui-testing"), args.contains("--diag3-read-failure") { root = root.appendingPathComponent("blocked") }
        #endif
        store = RunLog(directory: root, platform: platform, appVersion: version, osVersion: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)", policy: platform == .watchos ? .watch : .standard)
        let store = store
        let logRoot = root
        boot = Task { [weak self] in
            #if DEBUG
            if args.contains("--ui-testing"), args.contains("--diag3-read-failure") {
                let blocked = logRoot
                await Task.detached { try? FileManager.default.createDirectory(at: blocked.deletingLastPathComponent(), withIntermediateDirectories: true); try? Data([0]).write(to: blocked) }.value
            }
            #endif
            #if DEBUG
            if args.contains("--ui-testing"), args.contains("--diag3-disable-logging") { return }
            #endif
            let result = await store.start()
            self?.snapshot = result; self?.notify = result.shouldNotify
            #if DEBUG
            if args.contains("--diag3-inject") { await store.diagnostic(.crash, fields: ["signal": "6", "exceptionCode": "0"]) }
            #endif
        }
        #if !os(watchOS)
        // A C exception callback does not inherit the UI actor. The emergency sink contains constants only.
        EmergencyRunFailure.configure(directory: root, platform: platform, version: version, osVersion: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)")
        NSSetUncaughtExceptionHandler { _ in EmergencyRunFailure.record() }
        metrics = LocalMetricSubscriber(store: store)
        #endif
    }
    func ready() async { await boot?.value }
    func reload() async {
        await ready(); snapshot = await store.start()
        #if os(iOS)
        watchSnapshot = await store.snapshot(peer: true)
        #endif
    }
    func phase(_ value: ScenePhase) {
        let state = value == .background ? "background" : value == .active ? "foreground" : "inactive"
        Task { await ready(); await store.state(state); await reload() }
    }
    func connection(_ status: String, code: String? = nil) {
        guard status != lastConnection else { return }; lastConnection = status
        var fields = ["status": status]; if let code { fields["code"] = code }
        record(.connection, fields)
    }
    func record(_ event: RunEvent, _ fields: [String: String]) {
        Task { await ready(); await store.record(event, fields: fields) }
    }
    func failure(_ event: RunEvent, error: Error, phase: String, file: String = #fileID, line: UInt = #line) {
        guard !(error is CancellationError), (error as? APIFailure) != .transport(.cancelled) else { return }
        var fields = RunLogPrivacy.location(module: "WeftMateCore", file: file, line: line)
        fields["phase"] = phase
        #if os(macOS)
        fields["module"] = "WeftMateMac"
        #elseif os(iOS)
        fields["module"] = "WeftMatePhone"
        #else
        fields["module"] = "WeftMateWatch"
        #endif
        fields["errorType"] = error is APIFailure ? "api" : error is URLError ? "network" : "unknown"
        fields["code"] = "UNAVAILABLE"
        if let api = error as? APIFailure {
            switch api {
            case .notAuthenticated, .server(401, _): fields["code"] = "AUTH_REQUIRED"; connection("login_required", code: "AUTH_REQUIRED")
            case .transport(.certificate): fields["code"] = "CERTIFICATE_ERROR"; connection("certificate_error", code: "CERTIFICATE_ERROR")
            case .transport(.unavailable), .transport(.timeout): fields["code"] = "UNAVAILABLE"
            case .server(_, let code) where ["RELAY_UNAVAILABLE", "HOST_UNREACHABLE"].contains(code): fields["code"] = "RELAY_UNAVAILABLE"; connection("relay_unavailable", code: "RELAY_UNAVAILABLE")
            case .credentialStorage: fields["code"] = "STORAGE_FAILED"
            default: break
            }
        }
        if case APIFailure.server(let status, _) = error { fields["errorCode"] = String(status) }
        if let error = error as? URLError { fields["errorCode"] = String(error.code.rawValue) }
        else if !(error is APIFailure) { fields["errorCode"] = String((error as NSError).code) }
        record(event, fields)
    }
}

#if !os(watchOS)
/// Exception handling is best effort; never reads exception reason, userInfo or full stack.
private final class EmergencyRunFailure: @unchecked Sendable {
    static let shared = EmergencyRunFailure()
    private let lock = NSLock()
    private var configuration: (URL, RunPlatform, String, String)?
    static func configure(directory: URL, platform: RunPlatform, version: String, osVersion: String) {
        shared.lock.lock(); defer { shared.lock.unlock() }
        shared.configuration = (directory, platform, version, osVersion)
    }
    static func record() {
        shared.lock.lock(); defer { shared.lock.unlock() }
        guard let (root, platform, version, osVersion) = shared.configuration,
              let marker = try? JSONDecoder().decode(RunLogMarker.self, from: Data(contentsOf: root.appendingPathComponent("run-state.json"))) else { return }
        let at = RunLog.timestamp(Date())
        let object: [String: Any] = ["at": at, "event": "app.failure", "runId": marker.runId, "platform": platform.rawValue,
            "appVersion": version, "osVersion": osVersion, "fields": ["errorType": "objc_exception", "phase": "task", "code": "UNAVAILABLE", "module": platform == .ios ? "WeftMatePhone" : "WeftMateMac", "file": "RunLogRuntime.swift", "line": String(#line)]]
        guard var data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
        data.append(10)
        let path = root.appendingPathComponent("run-" + at.prefix(10) + ".jsonl")
        let descriptor = Darwin.open(path.path, O_WRONLY | O_APPEND)
        guard descriptor >= 0 else { return }
        defer { Darwin.close(descriptor) }
        _ = data.withUnsafeBytes { Darwin.write(descriptor, $0.baseAddress, $0.count) }
        _ = Darwin.fsync(descriptor)
    }
}
private final class LocalMetricSubscriber: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
    let store: RunLog
    init(store: RunLog) { self.store = store; super.init(); MXMetricManager.shared.add(self) }
    nonisolated func didReceive(_ payloads: [MXDiagnosticPayload]) {
        // Convert SDK objects to Sendable, whitelisted value projections before crossing executors.
        var rows: [(RunEvent, [String: String], Data, Date, Date, String)] = []
        for payload in payloads {
            for diagnostic in payload.crashDiagnostics ?? [] {
                var fields: [String: String] = ["terminationReason": Self.reason(diagnostic.terminationReason)]
                if let value = diagnostic.signal { fields["signal"] = value.stringValue }
                if let value = diagnostic.exceptionCode { fields["exceptionCode"] = value.stringValue }
                if let value = diagnostic.exceptionType { fields["exceptionType"] = value.stringValue }
                rows.append((.crash, fields, diagnostic.callStackTree.jsonRepresentation(), payload.timeStampBegin, payload.timeStampEnd, diagnostic.applicationVersion))
            }
            for diagnostic in payload.hangDiagnostics ?? [] { rows.append((.hang, [:], diagnostic.callStackTree.jsonRepresentation(), payload.timeStampBegin, payload.timeStampEnd, diagnostic.applicationVersion)) }
            for diagnostic in payload.cpuExceptionDiagnostics ?? [] { rows.append((.cpu, [:], diagnostic.callStackTree.jsonRepresentation(), payload.timeStampBegin, payload.timeStampEnd, diagnostic.applicationVersion)) }
            for diagnostic in payload.diskWriteExceptionDiagnostics ?? [] { rows.append((.disk, [:], diagnostic.callStackTree.jsonRepresentation(), payload.timeStampBegin, payload.timeStampEnd, diagnostic.applicationVersion)) }
        }
        let values = rows, store = store
        Task { for (event, fields, tree, begin, end, version) in values { await store.diagnostic(event, fields: fields, tree: tree, begin: begin, end: end, diagnosticVersion: version) } }
    }
    private static func reason(_ value: String?) -> String {
        guard let value else { return "unknown" }
        if value.lowercased().contains("watchdog") { return "watchdog" }
        if value.lowercased().contains("memory") { return "memory_pressure" }
        if value.lowercased().contains("signal") { return "signal" }
        return "unknown"
    }
}
#endif
