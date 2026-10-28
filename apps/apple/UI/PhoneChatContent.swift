#if os(iOS)
import SwiftUI
import UIKit
import WeftMateCore

struct PhoneMessageBody: View, Equatable {
    let text: String
    let messageID: String
    let streaming: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p14) {
            ForEach(PhoneReplyPresentation.blocks(text, streaming: streaming)) { block in
                if block.complete {
                    MessageBodyContent(text: block.text, messageID: messageID + "." + String(block.id)).equatable()
                } else {
                    PhoneLiveBlock(text: block.text)
                        .accessibilityIdentifier("reply.live." + messageID)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct PhoneLiveBlock: View {
    let text: String
    private var lines: [String] { text.components(separatedBy:"\n") }
    private var fence: String? {
        let line=lines.first?.trimmingCharacters(in:.whitespaces) ?? ""
        return line.hasPrefix("```") || line.hasPrefix("~~~") ? line : nil
    }
    var body: some View {
        if let fence {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                HStack {
                    Text(String(fence.drop { $0 == "`" || $0 == "~" })).font(AppleTokens.Fonts.caption)
                    Spacer(); Text("正在生成代码…").font(AppleTokens.Fonts.caption)
                }.foregroundStyle(Weave.muted)
                let body=lines.dropFirst().filter { $0.trimmingCharacters(in:.whitespaces) != String(fence.prefix { $0 == "`" || $0 == "~" }) }.joined(separator:"\n")
                PhoneLiveReply(text:body,monospaced:true)
            }.padding(AppleTokens.Space.p14).background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12))
                .overlay(RoundedRectangle(cornerRadius:AppleTokens.Radius.r12).strokeBorder(Weave.line))
        } else if lines.count >= 2, lines[0].contains("|"), lines[1].contains("---") {
            ScrollView(.horizontal) {
                PhoneLiveReply(text:text,monospaced:true).frame(width:CGFloat(max(2,MessageMarkdown.cells(lines[0]).count))*140)
                    .padding(AppleTokens.Space.p12)
            }.background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12))
        } else { PhoneLiveReply(text:text) }
    }
}

/// TextKit owns the live tail. Appending never assigns the entire text storage,
/// never recreates a Markdown tree, and never animates the existing paragraph.
private struct PhoneLiveReply: UIViewRepresentable {
    let text: String
    var monospaced = false
    @Environment(\.phoneReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var typeSize
    func makeUIView(context: Context) -> LiveText { LiveText() }
    func updateUIView(_ view: LiveText, context: Context) {
        view.receive(text, color: UIColor(Weave.ink), monospaced:monospaced, reduceMotion: reduceMotion)
    }
    @MainActor func sizeThatFits(_ proposal: ProposedViewSize, uiView: LiveText, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }
    static func dismantleUIView(_ view: LiveText, coordinator: ()) { view.stop() }

    @MainActor final class LiveText: UITextView {
        private var buffer = PhoneReplyBuffer()
        private var link: CADisplayLink?
        private var ink = UIColor.label
        private var fades: [(NSRange, CFTimeInterval)] = []
        private var lastReveal: CFTimeInterval = 0
        // CADisplayLink retains its target. A weak proxy lets removal release this view.
        @MainActor private final class Tick: NSObject {
            weak var owner: LiveText?
            @objc func fire(_ link: CADisplayLink) { owner?.advanceFrame(link) }
        }
        private let tick = Tick()
        init() {
            super.init(frame: .zero, textContainer: nil)
            isEditable = false; isSelectable = true; isScrollEnabled = false
            backgroundColor = .clear; textContainerInset = .zero; textContainer.lineFragmentPadding = 0
            adjustsFontForContentSizeCategory = true
            setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            tick.owner = self
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        func receive(_ text: String, color: UIColor, monospaced:Bool, reduceMotion: Bool) {
            let base=UIFont.preferredFont(forTextStyle:.body,compatibleWith:traitCollection)
            let font = monospaced ? UIFont.monospacedSystemFont(ofSize:base.pointSize,weight:.regular) : base
            let resolved=color.resolvedColor(with:traitCollection)
            if ink != resolved || self.font != font {
                ink = resolved; self.font = font
                textStorage.addAttributes([.foregroundColor: ink, .font: font], range: NSRange(location: 0, length: textStorage.length))
            }
            buffer.receive(text)
            if reduceMotion { if let delta=buffer.finishDelta() { apply(delta,fade:false) }; stop() }
            else if buffer.pending && link == nil {
                let display = CADisplayLink(target: tick, selector: #selector(Tick.fire(_:)))
                link = display; display.add(to: .main, forMode: .common)
            }
        }
        func stop() { link?.invalidate(); link = nil; fades = [] }
        private func advanceFrame(_ link: CADisplayLink) {
            if buffer.pending, link.timestamp - lastReveal >= 0.028 || buffer.pending && textStorage.length == 0 {
                if let delta=buffer.nextDelta(limit:buffer.backlog > 8 ? 8 : 1) { apply(delta,fade:true) }; lastReveal = link.timestamp
            }
            let now = CACurrentMediaTime()
            for (range, start) in fades where NSMaxRange(range) <= textStorage.length {
                textStorage.addAttribute(.foregroundColor, value: ink.withAlphaComponent(CGFloat(min(1, 0.3 + (now - start) / 0.22 * 0.7))), range: range)
            }
            fades.removeAll { now - $0.1 >= 0.22 }
            if !buffer.pending && fades.isEmpty { stop() }
        }
        private func apply(_ delta: PhoneReplyDelta, fade: Bool) {
            let prefix=delta.retainedUTF16, suffix=delta.text
            guard prefix < textStorage.length || !suffix.isEmpty else { return }
            // Replacement is used only for a corrected cumulative suffix (including a
            // completed combining sequence); ordinary model deltas take the append path.
            let range = NSRange(location: prefix, length: textStorage.length - prefix)
            fades.removeAll { NSMaxRange($0.0) > prefix }
            let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = AppleTokens.Space.p6
            let value = NSAttributedString(string: suffix, attributes: [.font: font ?? UIFont.preferredFont(forTextStyle: .body), .foregroundColor: fade ? ink.withAlphaComponent(0.3) : ink, .paragraphStyle: paragraph])
            textStorage.replaceCharacters(in: range, with: value)
            if fade && value.length > 0 { fades.append((NSRange(location: prefix, length: value.length), CACurrentMediaTime())) }
            invalidateIntrinsicContentSize(); setNeedsLayout()
        }
    }
}

struct PhoneLatestReplyButton: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) { WeftLabel("回到最新回复", icon: "chevron", size: 16) }
            .font(AppleTokens.Fonts.caption).buttonStyle(OutlineActionStyle())
            .background(Weave.surface, in: Capsule()).padding(AppleTokens.Space.p12)
    }
}

extension View {
    func phoneChatComposer() -> some View {
        padding(AppleTokens.Space.p12)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Phone.composerRadius))
            .overlay(RoundedRectangle(cornerRadius: AppleTokens.Phone.composerRadius).strokeBorder(Weave.line, lineWidth: 0.5))
            .padding(.horizontal, AppleTokens.Space.p12).padding(.vertical, AppleTokens.Space.p8)
            .background(Weave.canvas)
    }
}
#endif
