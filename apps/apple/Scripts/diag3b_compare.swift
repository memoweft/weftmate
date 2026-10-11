import AppKit
import Foundation

// Side-by-side evidence only: preserve both complete captures at native resolution.
// Left = About, right = Run Log. No crops, overlays, masks, or resized screens.
let args = CommandLine.arguments
precondition(args.count == 4, "Expected About PNG, Run Log PNG, output PNG")
func read(_ path: String) -> CGImage {
    let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil)!
    return CGImageSourceCreateImageAtIndex(source, 0, nil)!
}
let left = read(args[1]), right = read(args[2])
let width = left.width + right.width, height = max(left.height, right.height)
let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                        bytesPerRow: width * 4, space: left.colorSpace!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
context.draw(left, in: CGRect(x: 0, y: height - left.height, width: left.width, height: left.height))
context.draw(right, in: CGRect(x: left.width, y: height - right.height, width: right.width, height: right.height))
let data = NSBitmapImageRep(cgImage: context.makeImage()!).representation(using: .png, properties: [:])!
try data.write(to: URL(fileURLWithPath: args[3]))
print("Native side-by-side \(width) × \(height)")
