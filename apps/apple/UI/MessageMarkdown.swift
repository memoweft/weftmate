import Foundation

struct MessageMarkdownPart: Identifiable, Equatable {
    enum Kind: Equatable { case text, code(language: String), table }
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
        var expanded: [MessageMarkdownPart] = []
        for part in result {
            guard part.kind == .text else { expanded.append(.init(id:expanded.count,kind:part.kind,text:part.text)); continue }
            let lines=part.text.components(separatedBy:"\n")
            var start=0, index=0
            while index+1 < lines.count {
                let header=cells(lines[index]), separator=cells(lines[index+1])
                guard header.count > 1, separator.count == header.count,
                      separator.allSatisfy({ cell in
                          let value=cell.trimmingCharacters(in:CharacterSet(charactersIn:":"))
                          return value.count >= 3 && value.allSatisfy { $0 == "-" }
                      }) else { index += 1; continue }
                if index > start { expanded.append(.init(id:expanded.count,kind:.text,text:lines[start..<index].joined(separator:"\n"))) }
                var end=index+2
                while end < lines.count, cells(lines[end]).count == header.count { end += 1 }
                expanded.append(.init(id:expanded.count,kind:.table,text:lines[index..<end].joined(separator:"\n")))
                start=end; index=end
            }
            if start < lines.count { expanded.append(.init(id:expanded.count,kind:.text,text:lines[start...].joined(separator:"\n"))) }
        }
        return expanded
    }

    static func cells(_ line: String) -> [String] {
        var cells: [String]=[], cell="", escaped=false, code=false
        for character in line {
            if escaped { cell.append(character); escaped=false }
            else if character == "\\" { escaped=true; cell.append(character) }
            else if character == "`" { code.toggle(); cell.append(character) }
            else if character == "|" && !code { cells.append(cell.trimmingCharacters(in:.whitespaces)); cell="" }
            else { cell.append(character) }
        }
        cells.append(cell.trimmingCharacters(in:.whitespaces))
        if cells.first == "" { cells.removeFirst() }
        if cells.last == "" { cells.removeLast() }
        return cells
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
