import SwiftUI
import WeftMateCore

@MainActor final class UsageModel: ObservableObject {
    @Published var summary: UsageSummary?
    @Published var settings: UsageSettings?
    @Published var loading = false
    @Published var error: String?
    @Published var monthlyInput = ""
    @Published var temporaryInput = ""
    @Published var month = DeviceDateText.monthKey(Date())
    private weak var app: AppleAppModel?
    private let epoch: UUID
    private let host: String?
    private let device: String?
    let sessionID: String?
    init(app: AppleAppModel, sessionID: String? = nil) { self.app = app; epoch = app.accountEpoch; host = app.session?.hostId; device = app.session?.device.id; self.sessionID = sessionID }
    var current: Bool { app?.accountEpoch == epoch && app?.session?.hostId == host && app?.session?.device.id == device }
    func refresh() async {
        guard !loading, current, let app else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let preferences = try await app.assistantClient.usageSettings()
            guard current, !Task.isCancelled else { return }
            let zone = preferences.timeZone ?? TimeZone.current.identifier
            let requestedMonth = month
            let value = try await app.assistantClient.usage(month: requestedMonth, sessionID: sessionID, timeZone: zone)
            guard current, !Task.isCancelled, month == requestedMonth, value.month == requestedMonth, value.timeZone == zone, value.sessionId == sessionID else { return }
            summary = value; settings = preferences
            monthlyInput = preferences.monthlyLimit.map(String.init(describing:)) ?? ""
            temporaryInput = preferences.temporaryMonth == value.month ? preferences.temporaryLimit.map(String.init(describing:)) ?? "" : ""
        } catch { if current { self.error = "用量未读取，请重试。" } }
    }
    func save(temporary: Bool) async {
        guard !loading, current, let app else { return }
        let text = (temporary ? temporaryInput : monthlyInput).trimmingCharacters(in: .whitespacesAndNewlines)
        let value = text.isEmpty ? nil : Double(text)
        guard text.isEmpty || value.map({ $0.isFinite && $0 >= 0 }) == true else { error = "请输入非负金额，留空表示不限或清除临时上限。"; return }
        loading = true; error = nil
        do {
            let result = try await app.assistantClient.setUsageLimit(value, temporary: temporary, timeZone: settings?.timeZone ?? TimeZone.current.identifier)
            guard current else { loading = false; return }
            settings = result; loading = false; await refresh()
        } catch { if current { self.error = "上限未保存，请重试。" }; loading = false }
    }
    func sessionName(_ id: String?) -> String {
        guard let id else { return "后台请求" }
        return app?.conversations.first { $0.sessionId == id }?.title ?? "已删除或未读取的对话"
    }
    func modelName(_ id: String?) -> String { settings?.models.first { $0.id == id }?.name ?? id ?? "未指定模型" }
    static func money(_ cost: Double) -> String { String(format: "¥%.6f", cost) }
}

struct UsageView: View {
    @StateObject private var model: UsageModel
    init(app: AppleAppModel, sessionID: String? = nil) { _model = StateObject(wrappedValue: UsageModel(app: app, sessionID: sessionID)) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                HStack {
                    UsageMonthPicker(month: $model.month)
                    Button("读取月份") { Task { await model.refresh() } }.disabled(model.loading).accessibilityIdentifier("readUsageMonth")
                }
                if let value = model.summary {
                    WeaveCard {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                            Text(DeviceDateText.month(value.month) + " · " + (TimeZone(identifier: value.timeZone)?.localizedName(for: .generic, locale: Locale(identifier: "zh_CN")) ?? "设备时区")).font(AppleTokens.Fonts.headline)
                            LabeledContent("本月合计", value: UsageModel.money(value.total.cost)).accessibilityIdentifier("usageTotalCost")
                            LabeledContent("输入", value: "\(value.total.inputTokens)")
                            LabeledContent("缓存命中", value: "\(value.total.cachedInputTokens)")
                            LabeledContent("输出", value: "\(value.total.outputTokens)")
                            LabeledContent("请求", value: "\(value.total.requests)")
                            if let notice = value.total.uncertaintyNotice { Text(notice).foregroundStyle(Weave.muted) }
                            if let notice = value.budget.notice { InlineNotice(message: notice, isError: value.budget.state == "blocked").accessibilityIdentifier("usageBudgetNotice") }
                        }
                    }
                    DisclosureGroup("按天") { ForEach(value.days) { row in usageRow(DeviceDateText.day(row.day ?? ""), totals: row.totals) } }
                    DisclosureGroup("按对话排行") { ForEach(value.sessions) { row in usageRow(model.sessionName(row.sessionId), totals: row.totals) } }
                    DisclosureGroup("按模型排行") { ForEach(value.models) { row in usageRow(model.modelName(row.profileId), totals: row.totals) } }
                }
                if let settings = model.settings {
                    WeaveCard {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                            Text("月度上限").font(AppleTokens.Fonts.headline)
                            TextField("每月金额（元，留空不限）", text: $model.monthlyInput).accessibilityIdentifier("usageMonthlyLimit")
                            Button("保存月度上限") { Task { await model.save(temporary: false) } }.disabled(!settings.canManage || model.loading)
                            TextField("仅本月金额（元）", text: $model.temporaryInput).accessibilityIdentifier("usageTemporaryLimit")
                            Button("临时提高本月上限") { Task { await model.save(temporary: true) } }.disabled(!settings.canManage || model.loading)
                            Text("达到 80% 时提示；达到 100% 后暂停新的云端请求。本地模型不受限。临时金额仅覆盖当前账号时区的月份，留空清除覆盖。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        }
                    }
                    DisclosureGroup("模型单价 · 元 / 百万令牌") {
                        ForEach(settings.models) { row in
                            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                                Text(row.name + (row.local ? " · 本地" : ""))
                                if let price = row.price { Text("缓存 \(price.cachedInput) · 输入 \(price.input) · 输出 \(price.output)").font(AppleTokens.Fonts.caption) }
                                else { Text("费用未知，尚未定价").foregroundStyle(Weave.muted) }
                            }
                        }
                    }
                }
                if model.loading { ProgressView("正在读取…") }
                if let error = model.error { InlineNotice(message: error, isError: true) }
                Button("刷新用量") { Task { await model.refresh() } }.disabled(model.loading)
            }.padding(AppleTokens.Space.p24).frame(maxWidth: 700).frame(maxWidth: .infinity)
        }.background(Weave.canvas).navigationTitle("用量").task { await model.refresh() }.accessibilityIdentifier("usagePage")
    }
    private func usageRow(_ name: String, totals: UsageTotals) -> some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p5) {
            LabeledContent(name, value: UsageModel.money(totals.cost))
            Text("\(totals.requests) 次 · 输入 \(totals.inputTokens) · 缓存 \(totals.cachedInputTokens) · 输出 \(totals.outputTokens)").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
        }.padding(.vertical, AppleTokens.Space.p8)
    }
}

struct UsageMonthPicker: View {
    @Binding var month: String
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            Picker("月份", selection: $month) {
                ForEach(DeviceDateText.months(selected: month), id: \.self) { key in Text(DeviceDateText.month(key)).tag(key) }
            }.accessibilityIdentifier("usageMonth")
            HStack(spacing: AppleTokens.Space.p8) {
                Button("上一年") { month = DeviceDateText.shiftYear(month, by: -1) }.accessibilityIdentifier("usagePreviousYear")
                Button("下一年") { month = DeviceDateText.shiftYear(month, by: 1) }.accessibilityIdentifier("usageNextYear")
            }.buttonStyle(OutlineActionStyle())
        }

    }
}
