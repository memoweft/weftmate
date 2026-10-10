import Foundation
import Vision

// Offline pixel text check. Original screenshots are only read, never transformed.
let root = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let urls = (FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)!.allObjects as! [URL])
    .filter { $0.pathExtension == "png" && !$0.path.contains("/attempts/") && !$0.path.contains("/menu-polish/") && !$0.lastPathComponent.hasPrefix("failure") }
    .sorted { $0.path < $1.path }
var frames: [[String: String]] = []
for file in urls {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(url: file).perform([request])
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    let path = String(file.path.dropFirst(root.path.count + 1))
    frames.append(["source": "ocr:" + path, "scene": file.deletingPathExtension().lastPathComponent,
                   "surface": path.contains("iphone") || path.contains("large-text") ? "iphone" : path.contains("watch") ? "watch" : "mac",
                   "theme": path.contains("dark") ? "dark" : "light", "text": lines.joined(separator: "\n")])
}
let result: [String: Any] = ["syntheticOnly": true, "method": "Offline Vision OCR of original native PNGs", "frames": frames]
try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: output)
print("Pixel text scanned:", frames.count)
