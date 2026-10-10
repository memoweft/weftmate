import Foundation

extension OperationNames {
    public static func tool(_ name: String) -> String {
        if let label = tools[name] { return label }
        for (parts, label) in [("search|grep|glob", "搜索内容"), ("read", "读取文件"), ("write|save", "写入文件"), ("edit|patch", "修改文件"), ("web|browser|fetch", "访问网页")] {
            if name.range(of: parts, options: .regularExpression) != nil { return label }
        }
        return "扩展服务"
    }
    public static func field(_ name: String, index: Int) -> String { fields[name] ?? "附加信息 \(index + 1)" }
    public static func text(_ value: String) -> String {
        if tools[value] != nil { return tool(value) }
        if let field = fields[value] { return field }
        if value.hasPrefix("mcp__"), value.range(of: "^mcp__[A-Za-z0-9_]+$", options: .regularExpression) != nil { return tool(value) }
        var result = value.replacingOccurrences(of: "Weave组件", with: "界面扩展")
        let regex = try! NSRegularExpression(pattern: "(?:执行工具|调用工具|调用)(?:[:：]\\s*|\\s+)([A-Za-z][A-Za-z0-9_.:-]*)")
        for match in regex.matches(in: result, range: NSRange(result.startIndex..., in: result)).reversed() {
            guard let range = Range(match.range, in: result), let name = Range(match.range(at: 1), in: result) else { continue }
            result.replaceSubrange(range, with: tool(String(result[name])))
        }
        return result
    }
}

public enum DeviceDateText {
    public static func messageTimestamp(_ value: String?, timeZone: TimeZone, now: Date = Date()) -> String {
        guard let date = ChatDay.date(value) else { return "时间未记录" }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "zh_CN"); formatter.timeZone = timeZone
        formatter.dateFormat = calendar.isDate(date, inSameDayAs: now) ? "HH:mm" : "M月d日 HH:mm"
        return formatter.string(from: date)
    }
    public static func relativeTimestamp(_ value: String?, now: Date = Date()) -> String {
        guard let date = ChatDay.date(value) else { return "时间未记录" }
        let minutes = max(0, Int(now.timeIntervalSince(date) / 60))
        if minutes < 1 { return "刚刚" }
        if minutes < 60 { return "\(minutes) 分" }
        if minutes < 1440 { return "\(minutes / 60) 小时" }
        return "\(minutes / 1440) 天"
    }
    public static func chatDay(_ value: String, timeZone: TimeZone, now: Date = Date()) -> String {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        if value == ChatDay.key(now, timeZone: timeZone.identifier) { return "今天" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), value == ChatDay.key(yesterday, timeZone: timeZone.identifier) { return "昨天" }
        return day(value)
    }

    public static func timestamp(_ date: Date, timeZone: TimeZone = .current) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN"); f.calendar = Calendar(identifier: .gregorian); f.timeZone = timeZone
        f.dateFormat = "yyyy 年 M 月 d 日 HH:mm"; return f.string(from: date)
    }
    public static func timestamp(_ value: String, timeZone: TimeZone = .current) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = f.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return "未记录" }
        return timestamp(date, timeZone: timeZone)
    }
    public static func monthKey(_ date: Date, timeZone: TimeZone = .current) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.calendar = Calendar(identifier: .gregorian); f.timeZone = timeZone; f.dateFormat = "yyyy-MM"; return f.string(from: date)
    }
    public static func month(_ value: String) -> String {
        let parts = value.split(separator: "-"); guard parts.count == 2, let year = Int(parts[0]), let month = Int(parts[1]), (1...12).contains(month) else { return "未记录" }
        return "\(year) 年 \(month) 月"
    }
    public static func day(_ value: String) -> String {
        let parts = value.split(separator: "-"); guard parts.count == 3, let day = Int(parts[2]), (1...31).contains(day) else { return "未记录" }
        return month(parts.prefix(2).joined(separator: "-")) + " \(day) 日"
    }
    public static func months(now: Date = Date(), timeZone: TimeZone = .current, selected: String? = nil) -> [String] {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        let current = calendar.component(.year, from: now)
        let chosen = selected.flatMap { Int($0.prefix(4)) } ?? current
        // Match UX-1: six complete calendar years plus the selected year;
        // year navigation can reach any historical/future month.
        return stride(from: max(current, chosen), through: min(current - 5, chosen), by: -1).flatMap { year in
            stride(from: 12, through: 1, by: -1).map { String(format: "%04d-%02d", year, $0) }
        }
    }
    public static func shiftYear(_ month: String, by delta: Int) -> String {
        let pieces = month.split(separator: "-")
        guard pieces.count == 2, let year = Int(pieces[0]), let number = Int(pieces[1]), (1...12).contains(number) else { return month }
        return String(format: "%04d-%02d", year + delta, number)
    }
}

/// Drafts stay in the interaction model while approval temporarily owns the shared bar.
public struct QuestionBarDraft: Equatable, Sendable {
    public var index = 0
    public var choices: [String: Set<String>] = [:]
    public var custom: [String: String] = [:]
    public init() {}
    public mutating func select(_ label: String, question: SessionQuestion) {
        if question.multiSelect == true {
            var values = choices[question.id] ?? []; if !values.insert(label).inserted { values.remove(label) }; choices[question.id] = values
        } else { choices[question.id] = [label]; custom[question.id] = "" }
    }
    public mutating func write(_ value: String, question: SessionQuestion) {
        custom[question.id] = value; if question.multiSelect != true && !value.isEmpty { choices[question.id] = [] }
    }
    public func answer(_ question: SessionQuestion) -> QuestionAnswerItem {
        let value = custom[question.id] ?? ""
        return .init(id: question.id, selected: (question.options ?? []).map(\.label).filter { choices[question.id, default: []].contains($0) }, custom: value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : value)
    }
    public func complete(_ question: SessionQuestion) -> Bool { let a = answer(question); return !a.selected.isEmpty || a.custom != nil }
    public static func visible(pending: Bool, registered: Bool, approvals: Int) -> Bool { pending && !registered && approvals == 0 }
}
