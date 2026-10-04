#!/usr/bin/env swift
// Runs a real Mac UI regression through the host's existing Accessibility grant.
// It never requests a grant, changes TCC, uses a proxy, or touches another app.
import AppKit
import ApplicationServices
import Foundation

struct Failure: Error { let message: String }
let arguments = CommandLine.arguments
func argument(_ name: String) throws -> String {
    guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else {
        throw Failure(message: "Missing argument: " + name)
    }
    return arguments[index + 1]
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success ? result : nil
}
func string(_ element: AXUIElement, _ name: String) -> String {
    attribute(element, name) as? String ?? ""
}
struct Node { let element: AXUIElement; let ancestors: [AXUIElement] }
func descendants(_ element: AXUIElement, _ ancestors: [AXUIElement] = [], _ depth: Int = 0) -> [Node] {
    guard depth < 18 else { return [] }
    var result = [Node(element: element, ancestors: ancestors)]
    for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
        result += descendants(child, ancestors + [element], depth + 1)
        if result.count > 2000 { break }
    }
    return result
}
func windows(_ process: pid_t) -> [AXUIElement] {
    attribute(AXUIElementCreateApplication(process), kAXWindowsAttribute) as? [AXUIElement] ?? []
}
func allNodes(_ process: pid_t) -> [Node] { windows(process).flatMap { descendants($0) } }
func identifier(_ node: Node) -> String { string(node.element, "AXIdentifier") }
func text(_ node: Node) -> String {
    // Secure fields are never read, even in failure diagnostics.
    if identifier(node) == "password" || string(node.element, kAXSubroleAttribute) == "AXSecureTextField" { return "" }
    return [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute].map { string(node.element, $0) }.joined(separator: " ")
}
func wait(_ timeout: TimeInterval = 45, _ condition: () -> Bool) throws {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
        if condition() { return }
        RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    } while Date() < deadline
    throw Failure(message: "Timed out waiting for real app UI.")
}
func find(_ process: pid_t, _ id: String, timeout: TimeInterval = 30) throws -> Node {
    var match: Node?
    try wait(timeout) { match = allNodes(process).first { identifier($0) == id }; return match != nil }
    return match!
}
func press(_ node: Node) throws {
    var names: CFArray?
    if AXUIElementCopyActionNames(node.element, &names) == .success,
       (names as? [String] ?? []).contains(kAXPressAction) {
        let status = AXUIElementPerformAction(node.element, kAXPressAction as CFString)
        try record("ax-action-result", ["identifier": identifier(node), "status": status.rawValue])
        // A confirmation can disappear while AXPress is returning. Observe the
        // caller's required UI postcondition; do not replay an uncertain action.
        guard status == .success || status == .cannotComplete || status == .invalidUIElement else {
            throw Failure(message: "AXPress failed: " + String(status.rawValue))
        }
        return
    }
    for element in ([node.element] + node.ancestors.reversed()) where string(element, kAXRoleAttribute) == kAXRowRole {
        if AXUIElementSetAttributeValue(element, kAXSelectedAttribute as CFString, kCFBooleanTrue) == .success { return }
    }
    // Observed app-window geometry is the fallback for a SwiftUI text row.
    guard let rawPoint = attribute(node.element, kAXPositionAttribute),
          let rawSize = attribute(node.element, kAXSizeAttribute),
          CFGetTypeID(rawPoint) == AXValueGetTypeID(), CFGetTypeID(rawSize) == AXValueGetTypeID() else {
        throw Failure(message: "App control has no supported activation action or bounds.")
    }
    var point = CGPoint.zero, size = CGSize.zero
    AXValueGetValue(rawPoint as! AXValue, .cgPoint, &point)
    AXValueGetValue(rawSize as! AXValue, .cgSize, &size)
    guard size.width > 0, size.height > 0 else { throw Failure(message: "App control has empty bounds.") }
    let center = CGPoint(x: point.x + size.width / 2, y: point.y + size.height / 2)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: center, mouseButton: .left)?.post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: center, mouseButton: .left)?.post(tap: .cghidEventTap)
}
func fill(_ node: Node, _ value: String) throws {
    guard AXUIElementSetAttributeValue(node.element, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success,
          AXUIElementSetAttributeValue(node.element, kAXValueAttribute as CFString, value as CFString) == .success else {
        throw Failure(message: "App field does not support Accessibility text entry.")
    }
}
func require(_ condition: Bool, _ message: String) throws { if !condition { throw Failure(message: message) } }
func fixture(_ url: URL, required: [String]) throws -> [String: String] {
    let values = try FileManager.default.attributesOfItem(atPath: url.path)
    guard values[.type] as? FileAttributeType == .typeRegular,
          (values[.posixPermissions] as? NSNumber)?.intValue == 0o600,
          (values[.ownerAccountID] as? NSNumber)?.uint32Value == getuid() else {
        throw Failure(message: "Fixture must be a user-owned regular file with permissions 0600.")
    }
    let json = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
    guard let result = json as? [String: String], required.allSatisfy({ !(result[$0] ?? "").isEmpty }) else {
        throw Failure(message: "Private fixture is missing required fields.")
    }
    return result
}

var activeApp: NSRunningApplication?
var reportURL: URL?
var events: [[String: Any]] = []
func record(_ event: String, _ extras: [String: Any] = [:]) throws {
    var value = extras; value["event"] = event; value["time"] = ISO8601DateFormatter().string(from: Date())
    events.append(value)
    if let reportURL {
        try JSONSerialization.data(withJSONObject: events, options: [.prettyPrinted, .sortedKeys]).write(to: reportURL, options: .atomic)
    }
    print("Mac AX: " + event)
    fflush(stdout)
}

do {
    guard AXIsProcessTrusted() else { throw Failure(message: "Existing host Accessibility permission is unavailable; no grant was requested.") }
    let appURL = URL(fileURLWithPath: try argument("--debug-app")).standardizedFileURL
    let credentialURL = URL(fileURLWithPath: try argument("--credentials")).standardizedFileURL.resolvingSymlinksInPath()
    let artifactURL = URL(fileURLWithPath: try argument("--artifacts")).standardizedFileURL.resolvingSymlinksInPath()
    var sourceRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).standardizedFileURL
    var ancestor = sourceRoot
    while ancestor.path != "/" {
        if FileManager.default.fileExists(atPath: ancestor.appendingPathComponent("AGENTS.md").path) {
            sourceRoot = ancestor; break
        }
        ancestor.deleteLastPathComponent()
    }
    try require(!credentialURL.path.hasPrefix(sourceRoot.path + "/") && !artifactURL.path.hasPrefix(sourceRoot.path + "/"),
                "Credentials and validation artifacts must be outside the source tree.")
    try FileManager.default.createDirectory(at: artifactURL, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try require((try FileManager.default.attributesOfItem(atPath: artifactURL.path)[.posixPermissions] as? NSNumber)?.intValue == 0o700,
                "Private artifacts directory must have permissions 0700.")
    reportURL = artifactURL.appendingPathComponent("mac-ax-events.json")
    try require(!FileManager.default.fileExists(atPath: reportURL!.path), "Choose a new artifact directory; old evidence is preserved.")
    guard let info = NSDictionary(contentsOf: appURL.appendingPathComponent("Contents/Info.plist")) as? [String: Any],
          info["CFBundleIdentifier"] as? String == "com.weftmate.apple.weftmatemac",
          let executableName = info["CFBundleExecutable"] as? String else {
        throw Failure(message: "Only the WeftMate Mac app is supported.")
    }
    let executableURL = appURL.appendingPathComponent("Contents/MacOS/" + executableName)
    // Release intentionally ignores test arguments. Refuse it to protect normal
    // credentials, rather than attempting to access a production namespace.
    let debugLibraryURL = appURL.appendingPathComponent("Contents/MacOS/" + executableName + ".debug.dylib")
    var codeFiles = [executableURL]
    if FileManager.default.fileExists(atPath: debugLibraryURL.path) { codeFiles.append(debugLibraryURL) }
    // Xcode 26 puts Debug code in a .debug.dylib and leaves a small launcher.
    let supportsIsolation = try codeFiles.contains { url in
        try Data(contentsOf: url).range(of: Data("--ui-testing-namespace".utf8)) != nil
    }
    try require(supportsIsolation,
                "This harness requires the Debug app with isolated test namespace support.")
    let primary = try fixture(credentialURL, required: ["server", "username", "password", "conversationID", "marker"])
    let secondaryURL = URL(fileURLWithPath: credentialURL.path + ".second-account.json")
    let secondary = FileManager.default.fileExists(atPath: secondaryURL.path)
        ? try fixture(secondaryURL, required: ["server", "username", "password"]) : nil
    try require(primary["server"] == "https://home.weftmate.com:8443" || primary["server"] == "https://home.weftmate.com:8443/",
                "Use the existing formal server origin and default transport.")
    if let secondary { try require(secondary["server"] == primary["server"], "Fixture accounts must use the same formal server.") }
    let namespace = try argument("--namespace")
    try require(namespace.range(of: "^[A-Za-z0-9._-]{1,64}$", options: .regularExpression) != nil, "Invalid isolated namespace.")
    var resumeDevice: String?
    if arguments.contains("--resume-after-primary-logout") {
        let priorURL = URL(fileURLWithPath: try argument("--resume-from"))
        let prior = try JSONSerialization.jsonObject(with: Data(contentsOf: priorURL)) as? [[String: Any]] ?? []
        try require(prior.contains { $0["event"] as? String == "started" && $0["namespace"] as? String == namespace }
            && prior.contains { $0["event"] as? String == "primary-login" }
            && !prior.contains { $0["event"] as? String == "second-account-isolation" },
                    "Resume requires the same namespace's completed primary-account checkpoint.")
        resumeDevice = prior.last { $0["event"] as? String == "restarted-same-device-original-history" }?["currentDevice"] as? String
        try require(resumeDevice != nil && secondary != nil, "Resume requires a verified restart and the existing second account.")
    }
    func launch() throws -> pid_t {
        let launchedAt = Date()
        let launcher = Process()
        launcher.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        launcher.arguments = ["-n", appURL.path, "--args", "-NSTreatUnknownArgumentsAsOpen", "NO",
                              "--ui-testing", "--ui-testing-namespace", namespace,
                              "--server-url", primary["server"]!]
        try launcher.run(); launcher.waitUntilExit()
        try require(launcher.terminationStatus == 0, "Launch Services failed to open the isolated app.")
        var app: NSRunningApplication?
        try wait(15) {
            app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.weftmate.apple.weftmatemac")
                .first { $0.executableURL?.standardizedFileURL == executableURL && ($0.launchDate ?? .distantPast) >= launchedAt.addingTimeInterval(-1) }
            return app != nil
        }
        activeApp = app; app!.activate(options: [.activateAllWindows])
        return app!.processIdentifier
    }
    func terminate() throws {
        guard let app = activeApp else { return }
        try require(app.terminate(), "The test app refused termination.")
        try wait(10) { app.isTerminated }
        activeApp = nil
    }
    func screenshot(_ process: pid_t, _ name: String) throws {
        let items = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        guard let item = items.first(where: { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == process
            && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
            && (($0[kCGWindowBounds as String] as? [String: Any])?["Height"] as? NSNumber)?.doubleValue ?? 0 > 100 }),
              let number = item[kCGWindowNumber as String] as? NSNumber else {
            throw Failure(message: "App-only screenshot window was not found.")
        }
        let capture = Process()
        capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        capture.arguments = ["-x", "-l", number.stringValue, artifactURL.appendingPathComponent(name + ".png").path]
        try capture.run(); capture.waitUntilExit()
        try require(capture.terminationStatus == 0, "App-only screenshot failed; no Screen Recording grant was requested.")
    }
    func login(_ process: pid_t, _ account: [String: String]) throws {
        let usernameField = try find(process, "username")
        let passwordField = try find(process, "password")
        try record("login-form-visible")
        try fill(usernameField, account["username"]!)
        try fill(passwordField, account["password"]!)
        try press(try find(process, "loginButton"))
        _ = try find(process, "conversationList", timeout: 45)
    }
    func readHistory(_ process: pid_t) throws {
        let id = "conversationRow." + primary["conversationID"]!
        let row = try find(process, id)
        if let title = primary["conversationTitle"] { try require(text(row).contains(title), "Original conversation title mismatch.") }
        try press(row)
        _ = try find(process, "conversationDetail")
        try wait(30) { allNodes(process).contains { text($0).contains(primary["marker"]!) } }
    }
    func device(_ process: pid_t) throws -> String {
        try press(try find(process, "devicesNavigation"))
        _ = try find(process, "devicesList")
        var current: String?
        try wait(30) { current = allNodes(process).map(identifier).first { $0.hasPrefix("currentDevice.") }; return current != nil }
        return current!
    }
    func verifyAccount(_ process: pid_t, _ account: [String: String]) throws {
        try press(try find(process, "settingsNavigation"))
        let owner = try find(process, "accountUsername")
        try require(text(owner).contains(account["username"]!), "Displayed account does not match isolated fixture.")
    }
    func logout(_ process: pid_t) throws {
        try press(try find(process, "settingsNavigation"))
        try press(try find(process, "signOutButton"))
        var confirmation: Node?
        try wait(5) { confirmation = allNodes(process).first { string($0.element, kAXRoleAttribute) == kAXButtonRole
            && (string($0.element, kAXTitleAttribute) == "退出登录" || string($0.element, kAXDescriptionAttribute) == "退出登录") }; return confirmation != nil }
        try press(confirmation!)
        _ = try find(process, "username")
        try wait(15) {
            let nodes = allNodes(process)
            return !nodes.contains { text($0).contains("正在连接…") || string($0.element, kAXRoleAttribute) == kAXProgressIndicatorRole }
        }
        try require(!allNodes(process).contains { identifier($0) == "authError" }, "Sign-out displayed an incomplete-result error.")
        try record("logout-ui-confirmed")
    }
    try record("started", ["method": "native Accessibility", "namespace": namespace, "proxy": false,
                           "configuration": "Debug", "bundleVersion": info["CFBundleVersion"] ?? "unknown"])
    var process = try launch()
    let firstDevice: String
    if let resumeDevice {
        _ = try find(process, "username")
        try require(!allNodes(process).contains { identifier($0) == "conversationList" }, "Resume expected an already signed-out app.")
        firstDevice = resumeDevice
        try screenshot(process, "primary-logout-restored-signed-out")
        try record("primary-logout-observed-after-restart", ["priorCurrentDevice": firstDevice])
    } else {
        try login(process, primary)
        try record("primary-login")
        try readHistory(process)
        try screenshot(process, "original-history")
        try record("original-id-title-message")
        firstDevice = try device(process)
        try screenshot(process, "server-devices")
        try verifyAccount(process, primary)
        try record("current-device-account", ["currentDevice": firstDevice])
        try terminate()
        try record("terminated")
        process = try launch()
        _ = try find(process, "conversationList", timeout: 45)
        try require(!allNodes(process).contains { identifier($0) == "username" }, "Restart returned to the login form.")
        let restoredDevice = try device(process)
        try require(firstDevice == restoredDevice, "Restart created a different server device.")
        try readHistory(process)
        try screenshot(process, "restored-history")
        try record("restarted-same-device-original-history", ["currentDevice": restoredDevice])
    }
    if let secondary {
        if resumeDevice == nil { try logout(process) }
        try login(process, secondary)
        try wait(30) { allNodes(process).contains { text($0).contains("这个账户还没有已同步的对话。") } }
        try require(!allNodes(process).contains { identifier($0) == "conversationRow." + primary["conversationID"]! || text($0).contains(primary["marker"]!) },
                    "Primary account history leaked after switching accounts.")
        try require(try device(process) != firstDevice, "Second account reused the first account's device.")
        try verifyAccount(process, secondary)
        try screenshot(process, "second-account-isolation")
        try record("second-account-isolation")
        try logout(process)
        try login(process, primary)
        try readHistory(process)
        try record("primary-return")
    } else {
        try record("second-account-isolation-not-run")
    }
    try logout(process)
    try screenshot(process, "signed-out")
    try terminate()
    process = try launch()
    _ = try find(process, "username")
    try require(!allNodes(process).contains { identifier($0) == "conversationList" }, "Logged-out credential restored after restart.")
    try record("logout-and-restart-signed-out")
    try terminate()
    try record("passed", ["modelRequests": 0, "toolRequests": 0, "xctestPassed": false])
} catch {
    let message = (error as? Failure)?.message ?? "Validation failed; inspect private artifacts without logging credentials."
    try? record("failed", ["reason": message])
    // Only close the app instance launched by this harness, never another app.
    if let activeApp, !activeApp.isTerminated { _ = activeApp.terminate() }
    fputs("Mac AX validation: " + message + "\n", stderr)
    exit(1)
}
