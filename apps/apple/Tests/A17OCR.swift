import Foundation
import Vision

// Offline pixel text check. Original screenshots are only read, never transformed.
let root = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
let output = URL(fileURLWithPath: CommandLine.arguments[2])
var frames: [[String: String]] = []
if CommandLine.arguments.count > 3 {
    let prior = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3]))) as! [String: Any]
    frames = prior["frames"] as! [[String: String]]
}
let existing = Set(frames.compactMap { $0["source"] })
let urls = (FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)!.allObjects as! [URL])
    .filter { $0.pathExtension == "png" && !$0.path.contains("/attempts/") && !$0.path.contains("/menu-polish/") && !$0.lastPathComponent.hasPrefix("failure") }
    .filter { !existing.contains("ocr:" + String($0.path.dropFirst(root.path.count + 1))) || $0.path.contains("/large-text/") }
    .sorted { $0.path < $1.path }
for file in urls {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(url: file).perform([request])
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    let path = String(file.path.dropFirst(root.path.count + 1))
    frames.removeAll { $0["source"] == "ocr:" + path }
    frames.append(["source": "ocr:" + path, "scene": file.deletingPathExtension().lastPathComponent,
                   "surface": path.contains("iphone") || path.contains("large-text") ? "iphone" : path.contains("watch") ? "watch" : "mac",
                   "theme": path.contains("dark") ? "dark" : "light", "text": lines.joined(separator: "\n")])
}
let result: [String: Any] = ["syntheticOnly": true, "method": "Offline Vision OCR of original native PNGs", "frames": frames]
try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: output)
print("New or refreshed pixel frames:", urls.count, "; total:", frames.count)
