import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct MessageBodyView: View {
    let text: String
    let messageID: String
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p14) {
            ForEach(MessageMarkdown.parts(text)) { part in
                switch part.kind {
                case .text:
                    Text(markdown(part.text)).textSelection(.enabled).lineSpacing(AppleTokens.Space.p6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                case .code(let language):
                    MessageCodeView(code: part.text, language: language,
                                    identifier: "copyCode.\(messageID).\(part.id)")
                }
            }
        }
    }
    private func markdown(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}

private struct MessageCodeView: View {
    let code: String
    let language: String
    let identifier: String
    @State private var feedback: String?
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
            HStack {
                Text(language.isEmpty ? "代码" : language).font(AppleTokens.Fonts.caption).lineLimit(1)
                Spacer(minLength: AppleTokens.Space.p8)
                Button(feedback ?? "复制代码") { copy() }
                    .buttonStyle(.borderless).font(AppleTokens.Fonts.caption)
                    .accessibilityIdentifier(identifier)
            }.foregroundStyle(Weave.muted)
            ScrollView(.horizontal) {
                Text(code).font(.system(AppleTokens.TextStyle.callout, design: .monospaced)).textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(AppleTokens.Space.p14).background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
        .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r12).strokeBorder(Weave.line))
    }
    private func copy() {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        feedback = NSPasteboard.general.setString(code, forType: .string) ? "已复制" : "复制未完成"
        #else
        UIPasteboard.general.string = code
        feedback = "已复制"
        #endif
    }
}
