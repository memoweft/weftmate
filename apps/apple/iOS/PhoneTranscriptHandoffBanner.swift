import SwiftUI

/// Large original-transcript transfers ask before enqueue, independently of memory access.
struct PhoneTranscriptHandoffBanner: View {
    @ObservedObject var model: PhoneStandaloneModel
    var body: some View {
        if model.handoffHost != nil,!model.handoffDeferred,(model.handoffCount >= 100 || model.handoffBytes >= 256*1024) {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                Text("约 \(model.handoffCount) 轮原话、\(ByteCountFormatter.string(fromByteCount:Int64(model.handoffBytes),countStyle:.file))，可以交给电脑整理记忆。")
                HStack { Button("现在交") { model.handoffNow() };Button("稍后") { model.handoffLater() } }
            }.font(AppleTokens.Fonts.callout).padding(AppleTokens.Space.p12).background(Weave.soft)
        }
    }
}
