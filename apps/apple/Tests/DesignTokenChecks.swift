// Standalone native check: resolve every adaptive palette entry against the sole source.
// No App activation, accessibility permission, account data or network requests.
import Foundation
import SwiftUI
import AppKit

@main struct DesignTokenChecks {
    @MainActor static func main() throws {
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("design/tokens/tokens.json")
        let tokens = try JSONSerialization.jsonObject(with: Data(contentsOf: source)) as! [String: Any]
        let apple = tokens["apple"] as! [String: Any]
        let recipes = apple["colors"] as! [String: [String: String]]
        let colors: [String: Color] = ["accent": Weave.accent, "accentSoft": Weave.accentSoft,
            "ink": Weave.ink, "secondary": Weave.secondary, "muted": Weave.muted,
            "canvas": Weave.canvas, "surface": Weave.surface, "soft": Weave.soft,
            "line": Weave.line, "onAccent": Weave.onAccent, "status": Weave.status, "danger": Weave.danger]
        precondition(Set(recipes.keys) == Set(colors.keys), "Native palette differs from the source roles")
        var count = 0
        for (mode, appearanceName) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            let appearance = NSAppearance(named: appearanceName)!
            for role in colors.keys.sorted() {
                let value = UInt32(recipes[role]![mode]!.dropFirst(), radix: 16)!
                let expected = [CGFloat((value >> 16) & 255) / 255, CGFloat((value >> 8) & 255) / 255, CGFloat(value & 255) / 255]
                appearance.performAsCurrentDrawingAppearance {
                    let resolved = NSColor(colors[role]!).usingColorSpace(.sRGB)!
                    let actual = [resolved.redComponent, resolved.greenComponent, resolved.blueComponent]
                    precondition(zip(actual, expected).allSatisfy { abs($0 - $1) < 0.000001 }, "Incorrect \(mode) \(role)")
                    precondition(resolved.alphaComponent == 1, "Unexpected palette transparency")
                }
                count += 1
            }
        }
        print("\(count) native light/dark palette checks passed; external HTTP/model requests: 0; GUI: not run")
    }
}
