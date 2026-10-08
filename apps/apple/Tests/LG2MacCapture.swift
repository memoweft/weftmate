import AppKit
import Foundation
import Security

/// Capture only the newly launched native app window. No Accessibility or permission prompt.
@main enum LG2MacCapture {
    @MainActor static func main() async throws {
        let executable = URL(fileURLWithPath: CommandLine.arguments[1])
        let destination = URL(fileURLWithPath: CommandLine.arguments[2])
        let name = "lg2-mac-" + UUID().uuidString.prefix(8)
        let service = "com.weftmate.apple.ui-tests." + name
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let app = Process(); app.executableURL = executable
        app.arguments = ["--ui-testing", "--lg2-capture", "-ApplePersistenceIgnoreState", "YES", "--ui-testing-namespace", name,
                         "--ui-testing-data-dir", root.path, "--server-url", "https://host.example.com", "--s1c-cloud-url", "https://cloud.example.com"]
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
              let png = Data(base64Encoded: String(line.dropFirst("LG2_CAPTURE:".count))) else { throw CocoaError(.fileReadUnknown) }
        try png.write(to: destination)
        print("Native Mac login screenshot captured; temporary app state removed.")
    }
}
