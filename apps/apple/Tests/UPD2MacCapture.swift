import AppKit
import Foundation
import Security

/// Capture only the newly launched native app window. No Accessibility or permission prompt.
@main enum UPD2MacCapture {
    @MainActor static func main() async throws {
        let executable = URL(fileURLWithPath: CommandLine.arguments[1])
        let destination = URL(fileURLWithPath: CommandLine.arguments[2])
        let name = "upd2-mac-" + UUID().uuidString.prefix(8)
        let service = "com.weftmate.apple.ui-tests." + name
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let app = Process(); app.executableURL = executable
        app.arguments = ["--ui-testing", "--lg2-capture", "-ApplePersistenceIgnoreState", "YES", "--ui-testing-namespace", name,
                         "--ui-testing-data-dir", root.path, "--server-url", "https://a2-ui.unit.example", "--s1c-cloud-url", "https://cloud.example.com", "--apple-contract-fixture", "--upd2-about",
                         "--a5-review-scene", "settings-about", "--upd2-auto-check"]
        app.arguments = (app.arguments ?? []) + Array(CommandLine.arguments.dropFirst(3))
        let output = Pipe(); app.standardOutput = output; app.standardError = FileHandle.nullDevice
        try app.run()
        defer {
            if app.isRunning { app.terminate(); app.waitUntilExit() }
            for suffix in [".credentials", ".cloud", ".cloud.pins"] {
                SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service + suffix] as CFDictionary)
            }
            SecItemDelete([kSecClass: kSecClassKey, kSecAttrApplicationTag: Data((service + ".cloud.p256").utf8)] as CFDictionary)
            UserDefaults().removePersistentDomain(forName: service)
            try? FileManager.default.removeItem(at: root)
        }
        let bytes = output.fileHandleForReading.readDataToEndOfFile()
        app.waitUntilExit()
        guard let text = String(data: bytes, encoding: .utf8),
              let line = text.split(separator: "\n").first(where: { $0.hasPrefix("LG2_CAPTURE:") }),
              let png = Data(base64Encoded: String(line.dropFirst("LG2_CAPTURE:".count))) else {
            FileHandle.standardError.write(Data("Capture unavailable; app exit status: \(app.terminationStatus); output bytes: \(bytes.count)\n".utf8))
            for line in (String(data: bytes, encoding: .utf8) ?? "").split(separator: "\n") where line.hasPrefix("UPD2_") { FileHandle.standardError.write(Data((line + "\n").utf8)) }
            throw CocoaError(.fileReadUnknown)
        }
        try png.write(to: destination)
        for status in text.split(separator: "\n") where status.hasPrefix("UPD2_STATUS:") { print(status) }
        print("Native Mac About screenshot captured; temporary app state removed.")
    }
}
