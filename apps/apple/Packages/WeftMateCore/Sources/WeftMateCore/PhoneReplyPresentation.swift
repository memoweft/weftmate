import Foundation

/// Presentation-only segmentation. Completed paragraphs/fences keep their offset identity;
/// only the unfinished block receives live text. Never parses Markdown on a display tick.
public struct PhoneReplyBlock: Identifiable, Equatable, Sendable {
    public let id: Int
    public let text: String
    public let complete: Bool
}
public enum PhoneReplyPresentation {
    public static func blocks(_ text: String, streaming: Bool) -> [PhoneReplyBlock] {
        var blocks: [PhoneReplyBlock] = [], lines: [String] = []
        var offset = 0, start = 0
        var fence: (Character, Int)?
        let source = text.components(separatedBy: "\n")
        func flush(complete: Bool) {
            let body = lines.joined(separator: "\n")
            if !body.isEmpty { blocks.append(.init(id: start, text: body, complete: complete)) }
            lines = []; start = offset
        }
        for (index, line) in source.enumerated() {
            let body = line.drop { $0 == " " }
            let indent = line.count - body.count
            let character = body.first
            let count = character.map { c in body.prefix { $0 == c }.count } ?? 0
            let isFence = indent <= 3 && (character == "`" || character == "~") && count >= 3
            // The final line may still be growing, including a closing fence.
            let ended = index < source.count - 1 || !streaming
            if ended, isFence, let character {
                if let open = fence {
                    if character == open.0 && count >= open.1 && body.dropFirst(count).trimmingCharacters(in: .whitespaces).isEmpty { fence = nil }
                } else if !(character == "`" && body.dropFirst(count).contains("`")) {
                    if !lines.isEmpty { flush(complete:true) }
                    fence = (character, count)
                }
            }
            lines.append(line); offset += line.utf16.count + 1
            if ended, fence == nil, line.isEmpty { flush(complete: true) }
        }
        flush(complete: !streaming)
        return blocks
    }
}

/// A cumulative snapshot can finish an emoji/combining sequence from the preceding
/// snapshot. Compare Character boundaries, then replace only that changed suffix.
public struct PhoneReplyDelta: Equatable, Sendable {
    public let retainedUTF16: Int
    public let text: String
}
public struct PhoneReplyBuffer: Sendable {
    public private(set) var displayed = ""
    private var target: [Character] = []
    private var count = 0
    private var utf16Count = 0
    private var replacement: Int?
    public init() {}
    public mutating func receive(_ text: String) {
        let next=Array(text)
        guard next != target else { return }
        let visible=Array(displayed)
        let shared=zip(visible,next).prefix { $0.0 == $0.1 }.count
        if shared < count {
            displayed=String(visible.prefix(shared)); count=shared; utf16Count=displayed.utf16.count
            replacement=utf16Count
        }
        target=next
    }
    public var pending: Bool { count != target.count || replacement != nil }
    public var backlog: Int { max(0, target.count-count) }
    public mutating func nextDelta(limit: Int = 8) -> PhoneReplyDelta? {
        guard pending else { return nil }
        let retained=replacement ?? utf16Count
        let end=min(target.count,count+max(0,limit))
        let text=String(target[count..<end])
        displayed.append(contentsOf:text); count=end; utf16Count += text.utf16.count; replacement=nil
        return .init(retainedUTF16:retained,text:text)
    }
    @discardableResult public mutating func advance(limit: Int = 8) -> String { _=nextDelta(limit:limit); return displayed }
    @discardableResult public mutating func finish() -> String {
        _=nextDelta(limit:target.count); return displayed
    }
    public mutating func finishDelta() -> PhoneReplyDelta? { nextDelta(limit:target.count) }
}
