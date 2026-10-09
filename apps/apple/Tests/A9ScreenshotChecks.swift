import AppKit
import Foundation

// Sample actual native screenshots without altering them. The expected accent
// comes from the source token file, encoded in the PNG profile, and must occupy
// an 8x8 patch in each button. PNG bytes and the embedded profile stay untouched.
let tokenURL = URL(fileURLWithPath: CommandLine.arguments[1])
let tokens = try JSONSerialization.jsonObject(with: Data(contentsOf: tokenURL)) as! [String: Any]
let colors = ((tokens["apple"] as! [String: Any])["colors"] as! [String: Any])["accent"] as! [String: String]
let theme = CommandLine.arguments[2]
let hex = UInt32(colors[theme]!.dropFirst(), radix: 16)!
let sourceRGB = [Int(hex >> 16 & 255), Int(hex >> 8 & 255), Int(hex & 255)]
var samples: [[String: Any]] = []
for path in CommandLine.arguments.dropFirst(3) {
    let bitmap = NSBitmapImageRep(data: try Data(contentsOf: URL(fileURLWithPath: path)))!
    let encodedColor = NSColor(srgbRed: Double(sourceRGB[0]) / 255, green: Double(sourceRGB[1]) / 255, blue: Double(sourceRGB[2]) / 255, alpha: 1).usingColorSpace(bitmap.colorSpace)!
    let expected = [encodedColor.redComponent, encodedColor.greenComponent, encodedColor.blueComponent].map { Int(($0 * 255).rounded()) }
    func rgb(_ x: Int, _ y: Int) -> [Int] {
        var pixel = [Int](repeating: 0, count: 4)
        bitmap.getPixel(&pixel, atX: x, y: y)
        return Array(pixel.prefix(3))
    }
    var patch: (Int, Int)?
    outer: for y in stride(from: bitmap.pixelsHigh * 35 / 100, to: bitmap.pixelsHigh * 97 / 100, by: 4) {
        for x in stride(from: bitmap.pixelsWide * 77 / 100, to: bitmap.pixelsWide * 95 / 100, by: 4) {
            guard rgb(x, y) == expected else { continue }
            if (0..<8).allSatisfy({ dy in (0..<8).allSatisfy { dx in rgb(x + dx, y + dy) == expected } }) { patch = (x, y); break outer }
        }
    }
    guard let patch else { fatalError("Expected theme accent patch missing in " + URL(fileURLWithPath: path).lastPathComponent) }
    samples.append(["file": URL(fileURLWithPath: path).lastPathComponent, "x": patch.0, "y": patch.1, "rgb": expected, "sourceTokenRGB": sourceRGB, "uniformPatchPixels": 64, "colorSpace": bitmap.colorSpace.localizedName ?? "unknown"])
}
print(String(data: try JSONSerialization.data(withJSONObject: ["theme": theme, "themeAccent": colors[theme]!, "matched": true, "samples": samples], options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
