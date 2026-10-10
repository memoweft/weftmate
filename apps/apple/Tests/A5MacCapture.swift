import AppKit
import Foundation
import Security

/// Capture only the newly launched native app window. No Accessibility or permission prompt.
@main enum A5MacCapture {
    @MainActor static func main() async {
        do { try await capture() }
        catch {
            FileHandle.standardError.write(Data(("Native Mac capture failed: " + error.localizedDescription + "\n").utf8))
            exit(1)
        }
    }
    @MainActor private static func capture() async throws {
        let executable = URL(fileURLWithPath: CommandLine.arguments[1])
        let destination = URL(fileURLWithPath: CommandLine.arguments[2])
        // Match the existing Mac AX harness: Xcode's small Debug launcher keeps
        // the implementation in a sibling dylib. Reject Release before launch,
        // because Release intentionally ignores the isolated UI-test switches.
        let images = [executable, executable.deletingLastPathComponent().appendingPathComponent(executable.lastPathComponent + ".debug.dylib")]
        let captureEnabled = images.contains { image in
            guard let code = try? Data(contentsOf: image, options: .mappedIfSafe) else { return false }
            return code.range(of: Data("--ui-testing-namespace".utf8)) != nil
                && code.range(of: Data("CGWindowListCreateImageFromArray".utf8)) != nil
        }
        guard captureEnabled else { throw NSError(domain: "A5MacCapture", code: 2, userInfo: [NSLocalizedDescriptionKey: "Requires capture-enabled Debug app; no app was launched."]) }
        let name = "a5-mac-" + UUID().uuidString.prefix(8)
        let scene = CommandLine.arguments[3], theme = CommandLine.arguments[4], host = CommandLine.arguments[5], cloud = CommandLine.arguments[6]
        let service = "com.weftmate.apple.ui-tests." + name
        // Keep synthetic local state inside the signed app's sandbox container.
        let bundleID = scene == "a12-login" ? "com.weftmate.apple.a12loginitem" : "com.weftmate.apple.weftmatemac"
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Containers/" + bundleID + "/Data/Library/Application Support/WeftMate/UITests", isDirectory: true)
            .appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let app = Process(); app.executableURL = executable
        app.arguments = ["--ui-testing", "--lg2-capture", "-ApplePersistenceIgnoreState", "YES", "--ui-testing-namespace", name,
                         "--ui-testing-data-dir", root.path, "--server-url", host, "--s1c-cloud-url", cloud, "--a5-review-scene", scene, "--a5-theme", theme, scene == "login" ? "--lg2-cloud" : "--a5-local-server"]
        if let flag = CommandLine.arguments.dropFirst(7).first(where: { $0.hasPrefix("a11-local-host=") }) {
            app.arguments?.append(contentsOf: ["--a11-local-host-id", String(flag.dropFirst("a11-local-host=".count)), "--a11-folder", root.appendingPathComponent("A11Folder").path])
            try FileManager.default.createDirectory(at: root.appendingPathComponent("A11Folder"), withIntermediateDirectories: true)
            try Data("Synthetic A11 folder retained after project removal.".utf8).write(to: root.appendingPathComponent("A11Folder/brief.md"))
        }
        if CommandLine.arguments.count > 7, CommandLine.arguments[7] == "a8" { app.arguments?.append("--a8-flow") }
        if CommandLine.arguments.dropFirst(7).contains("ephemeral") { app.arguments?.append("--a10-ephemeral-credentials") }
        if let driver = CommandLine.arguments.dropFirst(7).first(where: { $0.hasPrefix("a13-driver=") }) { app.arguments?.append(contentsOf: ["--a13-driver", String(driver.dropFirst("a13-driver=".count))]) }
        if let driver = CommandLine.arguments.dropFirst(7).first(where: { $0.hasPrefix("a14-driver=") }) { app.arguments?.append(contentsOf: ["--a14-driver", String(driver.dropFirst("a14-driver=".count))]) }
        if let driver = CommandLine.arguments.dropFirst(7).first(where: { $0.hasPrefix("a15-driver=") }) { app.arguments?.append(contentsOf: ["--a15-driver", String(driver.dropFirst("a15-driver=".count)), "--a15-synthetic-media"]) }
        if let driver = CommandLine.arguments.dropFirst(7).first(where: { $0.hasPrefix("a16-driver=") }) { app.arguments?.append(contentsOf: ["--a16-driver", String(driver.dropFirst("a16-driver=".count))]) }
        let output = Pipe(); app.standardOutput = output; app.standardError = output
        try app.run()
        defer {
            if app.isRunning { app.terminate(); app.waitUntilExit() }
            for suffix in [".credentials", ".cloud", ".cloud.pins", ".cloud.offline"] {
                SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service + suffix] as CFDictionary)
            }
            SecItemDelete([kSecClass: kSecClassKey, kSecAttrApplicationTag: Data((service + ".cloud.p256").utf8)] as CFDictionary)
            UserDefaults().removePersistentDomain(forName: service)
            try? FileManager.default.removeItem(at: root)
        }
        var bytes = Data(), pending = Data()
        while true {
            let chunk = output.fileHandleForReading.availableData
            if chunk.isEmpty { break }
            bytes.append(chunk); pending.append(chunk)
            while let newline = pending.firstIndex(of: 10) {
                let line = String(decoding: pending[..<newline], as: UTF8.self)
                pending.removeSubrange(...newline)
                if scene == "a16-all", line.hasPrefix("A10_REPORT:") {
                    try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
                    try Data(line.dropFirst("A10_REPORT:".count).utf8).write(to: destination.appendingPathComponent("native-report.json"))
                }
                if line.hasPrefix("A17_TEXT:") {
                    try Data(line.dropFirst("A17_TEXT:".count).utf8).write(to: destination.deletingPathExtension().appendingPathExtension("text.json"))
                }
                if line.hasPrefix("A14_SCAN:") {
                    try Data(line.dropFirst("A14_SCAN:".count).utf8).write(to: destination.appendingPathComponent("storage-scan.json"))
                }
                if line.hasPrefix("A13_TEXT:") {
                    try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
                    let entry = try JSONSerialization.jsonObject(with: Data(line.dropFirst("A13_TEXT:".count).utf8)) as! [String: Any]
                    try JSONSerialization.data(withJSONObject: entry, options: [.prettyPrinted, .sortedKeys]).write(to: destination.appendingPathComponent((entry["scene"] as! String) + "-text.json"))
                }
                if line.hasPrefix("A16_STEP:") || line.hasPrefix("A14_DEBUG:") || line.hasPrefix("A11_STEP:") || line.hasPrefix("A13_NATIVE:") || line.hasPrefix("A13_RESPONDER:") || line.hasPrefix("A13_KEY_STATE:") { FileHandle.standardOutput.write(Data((line + "\n").utf8)) }
                if ["a16-all", "a15-all", "a14-all", "a13-all", "a10-all", "a11-all", "a11-remote", "a12-login"].contains(scene), line.hasPrefix("A10_CAPTURE:") {
                    let parts = line.split(separator: ":", maxSplits: 2)
                    guard parts.count == 3, let png = Data(base64Encoded: String(parts[2])) else { throw CocoaError(.fileReadCorruptFile) }
                    try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
                    try png.write(to: destination.appendingPathComponent(String(parts[1]) + ".png"))
                    FileHandle.standardOutput.write(Data(("Captured native Mac " + parts[1] + "\n").utf8))
                }
            }
        }
        app.waitUntilExit()
        if ["a16-all", "a15-all", "a14-all", "a13-all", "a10-all", "a11-all", "a11-remote", "a12-login"].contains(scene), let text = String(data: bytes, encoding: .utf8), app.terminationStatus == 0 {
            try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
            for line in text.split(separator: "\n") where line.hasPrefix("A10_CAPTURE:") {
                let parts = line.split(separator: ":", maxSplits: 2)
                guard parts.count == 3, let png = Data(base64Encoded: String(parts[2])) else { throw CocoaError(.fileReadCorruptFile) }
                try png.write(to: destination.appendingPathComponent(String(parts[1]) + ".png"))
            }
            guard let report = text.split(separator: "\n").first(where: { $0.hasPrefix("A10_REPORT:") }) else { throw NSError(domain: "A5MacCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Native flow produced no completion report."]) }
            try Data(report.dropFirst("A10_REPORT:".count).utf8).write(to: destination.appendingPathComponent("native-report.json"))
            print("A10 native flow captured; temporary app state removed.")
            return
        }
        guard app.terminationStatus == 0, let text = String(data: bytes, encoding: .utf8),
              let line = text.split(separator: "\n").first(where: { $0.hasPrefix("LG2_CAPTURE:") }),
              let png = Data(base64Encoded: String(line.dropFirst("LG2_CAPTURE:".count))) else {
            let diagnostic = String(data: bytes, encoding: .utf8)?.split(separator: "\n").first(where: { $0.hasPrefix("A5_CAPTURE_FAILED:") })
            throw NSError(domain: "A5MacCapture", code: Int(app.terminationStatus), userInfo: [NSLocalizedDescriptionKey: diagnostic.map(String.init) ?? "Native app produced no PNG (exit \(app.terminationStatus))."])
        }
        try png.write(to: destination)
        print("Native Mac screenshot captured; temporary app state removed.")
    }
}
