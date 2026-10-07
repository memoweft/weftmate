import Foundation

struct MessageMarkdownPart: Identifiable, Equatable {
    enum Kind: Equatable { case text, code(language: String) }
    let id: Int
    let kind: Kind
    let text: String
}

enum MessageMarkdown {
    private struct Fence { let character: Character; let count: Int; let tail: String }

    static func parts(_ source: String) -> [MessageMarkdownPart] {
        var result: [MessageMarkdownPart] = []
        var text: [String] = []
        var code: [String] = []
        var open: Fence?
        func append(_ kind: MessageMarkdownPart.Kind, _ lines: [String]) {
            guard !lines.isEmpty else { return }
            result.append(.init(id: result.count, kind: kind, text: lines.joined(separator: "\n")))
        }
        for line in source.components(separatedBy: "\n") {
            if let opening = open {
                if let closing = fence(line), closing.character == opening.character,
                   closing.count >= opening.count, closing.tail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    append(.code(language: opening.tail.trimmingCharacters(in: .whitespacesAndNewlines)), code)
                    code = []; open = nil
                } else { code.append(line) }
            } else if let opening = fence(line),
                      !(opening.character == "`" && opening.tail.contains("`")) {
                append(.text, text); text = []; open = opening
            } else { text.append(line) }
        }
        if let opening = open { append(.code(language: opening.tail.trimmingCharacters(in: .whitespacesAndNewlines)), code) }
        else { append(.text, text) }
        return result
    }

    private static func fence(_ line: String) -> Fence? {
        let indent = line.prefix { $0 == " " }.count
        guard indent <= 3 else { return nil }
        let body = line.dropFirst(indent)
        guard let character = body.first, character == "`" || character == "~" else { return nil }
        let count = body.prefix { $0 == character }.count
        guard count >= 3 else { return nil }
        return Fence(character: character, count: count, tail: String(body.dropFirst(count)))
    }
}
