import Foundation

@main private struct MessageMarkdownChecks {
    static func main() {
        let mixed = MessageMarkdown.parts("说明\n```swift\nlet x = 1\n```\n结束")
        precondition(mixed.count == 3 && mixed[0].text == "说明" && mixed[1].text == "let x = 1" && mixed[2].text == "结束")
        precondition(mixed[1].kind == .code(language: "swift"))
        let partial = MessageMarkdown.parts("```python\n  value = 2\n")
        precondition(partial.count == 1 && partial[0].text == "  value = 2\n")
        let nested = MessageMarkdown.parts("````text\n```\nvalue\n````")
        precondition(nested.count == 1 && nested[0].text == "```\nvalue")
        let tilde = MessageMarkdown.parts("~~~json\n{\"ok\": true}\n~~~")
        precondition(tilde.count == 1 && tilde[0].kind == .code(language: "json"))
        let prose = MessageMarkdown.parts("inline `code` stays inline\n    ``` is indented text")
        precondition(prose.count == 1 && prose[0].kind == .text)
        let windows = MessageMarkdown.parts("```\r\nline\r\n```\r")
        precondition(windows.count == 1 && windows[0].text == "line\r")
        let table=MessageMarkdown.parts("说明\n\n| 名称 | 数量 |\n| --- | ---: |\n| 合成内容 | 2 |\n\n后记")
        precondition(table.count == 3 && table[1].kind == .table && table[2].text.contains("后记"))
        precondition(MessageMarkdown.cells("| a\\|b | `x|y` |").count == 2)
        print("8 Markdown boundary/table checks passed; GUI/clipboard: not run")
    }
}
