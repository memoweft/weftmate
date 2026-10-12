import Foundation
import Vision
let directory=URL(fileURLWithPath:CommandLine.arguments[1])
var frames:[[String:Any]]=[]
for url in try FileManager.default.contentsOfDirectory(at:directory,includingPropertiesForKeys:nil).filter({$0.pathExtension=="png"}).sorted(by:{$0.lastPathComponent < $1.lastPathComponent}) {
    let request=VNRecognizeTextRequest();request.recognitionLanguages=["zh-Hans","en-US"];request.recognitionLevel = .accurate
    request.usesCPUOnly=true
    try VNImageRequestHandler(url:url,options:[:]).perform([request])
    let values=(request.results ?? []).compactMap{$0.topCandidates(1).first?.string}
    frames.append(["surface":"iPhone","theme":url.lastPathComponent.contains("-dark-") ? "dark" : "light","scene":url.deletingPathExtension().lastPathComponent,"text":values.joined(separator:"\n")])
}
try JSONSerialization.data(withJSONObject:["syntheticOnly":true,"frames":frames],options:[.prettyPrinted,.sortedKeys]).write(to:directory.appendingPathComponent("screenshot-text.json"))
print("CPU screenshot review: \(frames.count) frames")
