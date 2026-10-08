// Build: swiftc -O Tests/compare_design_token_screenshots.swift -o Build/ds1b-compare
// Run: Build/ds1b-compare Tests/Evidence/DS-1b
// Decode both unmodified XCTest PNGs into the same sRGB RGBA representation.
import Foundation
import CoreGraphics
import ImageIO

struct Raster {
    let width: Int
    let height: Int
    let bytes: [UInt8]
    init(_ path: URL) throws {
        guard let source = CGImageSourceCreateWithURL(path as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw NSError(domain: "ScreenshotDecode", code: 1, userInfo: [NSLocalizedDescriptionKey: path.lastPathComponent])
        }
        width = image.width; height = image.height
        var storage = [UInt8](repeating: 0, count: width * height * 4)
        let width = width, height = height
        storage.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        bytes = storage
    }
}
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
let scenarios = ["list", "running", "approval", "outputs-sources", "completed", "source", "output", "keyboard"]
var rows: [[String: Any]] = []
for style in ["light", "dark"] {
    for scenario in scenarios {
        let name = "\(style)-\(scenario)"
        let before = try Raster(directory.appendingPathComponent("before-\(name).png"))
        let after = try Raster(directory.appendingPathComponent("after-\(name).png"))
        precondition(before.width == after.width && before.height == after.height, "Size changed: \(name)")
        var different = 0, maxChannelDelta = 0
        var minX = before.width, minY = before.height, maxX = -1, maxY = -1
        for pixel in 0..<(before.width * before.height) {
            var delta = 0
            for channel in 0..<4 {
                let offset = pixel * 4 + channel
                delta = max(delta, abs(Int(before.bytes[offset]) - Int(after.bytes[offset])))
            }
            if delta > 0 {
                different += 1; maxChannelDelta = max(maxChannelDelta, delta)
                let x = pixel % before.width, y = before.height - 1 - pixel / before.width
                minX = min(minX, x); minY = min(minY, y); maxX = max(maxX, x); maxY = max(maxY, y)
            }
        }
        var row: [String: Any] = ["name": name, "width": before.width, "height": before.height,
            "differentPixels": different, "maxChannelDelta": maxChannelDelta,
            "before": "before-\(name).png", "after": "after-\(name).png"]
        if different > 0 { row["differenceBounds"] = [minX, minY, maxX, maxY] }
        rows.append(row)
        print("\(name): \(different) different pixels; maximum channel delta \(maxChannelDelta)")
    }
}
let report: [String: Any] = ["method": "Unmodified full-frame XCTest screenshots decoded as sRGB RGBA; no masks, alignment, tolerance or resized images", "pairs": rows]
try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    .write(to: directory.appendingPathComponent("comparison.json"))
