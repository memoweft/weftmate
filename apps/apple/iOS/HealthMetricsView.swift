import SwiftUI
import Charts
import WeftMateCore

/// Standard Form / Text / Charts only; presentation tokens and component appearance remain owned by DS-1b.
struct HealthMetricsView: View {
    let summaries: [HealthDailySummary]
    @State private var trendDays = 7
    private var latest: HealthDailySummary? { summaries.max { $0.date < $1.date } }
    private var trend: [HealthDailySummary] { Array(summaries.sorted { $0.date < $1.date }.suffix(trendDays)) }
    private func value(_ value: Double?) -> String { value.map { String(format: "%.0f", $0) } ?? "数据不足" }
    var body: some View {
        Section("最新健康指标") {
            if let latest {
                Text("\(latest.date) · \(latest.timeZone)").font(AppleTokens.Fonts.caption).foregroundStyle(AppleTokens.Styles.secondary)
                Text("身体电量：\(value(latest.hourly?.last?.bodyBattery)) / 100").accessibilityIdentifier("healthMetric.battery")
                Text("恢复度：\(value(latest.derived?.recovery?.value)) / 100").accessibilityIdentifier("healthMetric.recovery")
                if let recovery = latest.derived?.recovery {
                    Text("依据 \(recovery.inputs.compactMap { HealthCategory(rawValue: $0)?.title }.joined(separator: "、")) · 基线 \(recovery.baselineDays) 天")
                        .font(AppleTokens.Fonts.caption).foregroundStyle(AppleTokens.Styles.secondary)
                }
                Text("负荷：\(value(latest.derived?.load?.value)) 相对单位").accessibilityIdentifier("healthMetric.load")
                if let load = latest.derived?.load {
                    if let ratio = load.ratio { Text("近 7 天 / 28 天负荷比：\(ratio, specifier: "%.2f")") }
                    else { Text("负荷比数据不足 · 7 天窗 \(load.acuteDays)/7 · 28 天窗 \(load.chronicDays)/28").font(AppleTokens.Fonts.caption) }
                }
                if let hour = latest.hourly?.last(where: { $0.stress != nil }), let stress = hour.stress {
                    Text("压力：\(stress.lower, specifier: "%.0f")–\(stress.upper, specifier: "%.0f") / 100").accessibilityIdentifier("healthMetric.stress")
                    Text("最近采样 \(stress.latestSampleAt) · \(stress.sampleCount) 组 · \(stress.confidence == "sparse" ? "采样稀疏" : "离散采样")")
                        .font(AppleTokens.Fonts.caption).foregroundStyle(AppleTokens.Styles.secondary)
                } else { Text("压力：数据不足").accessibilityIdentifier("healthMetric.stress") }
                Text("睡眠：\(latest.sleep.map { String(format: "%.1f 小时", $0.totalMinutes / 60) } ?? "数据不足")").accessibilityIdentifier("healthMetric.sleep")
                if let sleep = latest.derived?.sleep {
                    Text("睡眠连续度 \(sleep.continuityPercent, specifier: "%.0f")%")
                    if let deviation = sleep.midpointDeviationMinutes { Text("作息中点较个人基线偏移 \(deviation, specifier: "%.0f") 分钟") }
                    ForEach(sleep.stageMinutes.keys.sorted(), id: \.self) { stage in
                        Text("\(["core": "核心", "deep": "深睡", "rem": "快速眼动", "unspecified": "未分期"][stage] ?? stage)：\(sleep.stageMinutes[stage]!, specifier: "%.0f") 分钟")
                    }
                }
                Text("本地陪伴估算；缺失输入不补零，压力代表有采样时的区间。").font(AppleTokens.Fonts.footnote).foregroundStyle(AppleTokens.Styles.secondary)
            } else { Text("授权并更新摘要后查看指标") }
        }
        Section("身体电量与压力 · 小时趋势") {
            Text("折线为电量；竖线为压力区间。时间按摘要时区显示。").font(AppleTokens.Fonts.caption).foregroundStyle(AppleTokens.Styles.secondary)
            if let hours = latest?.hourly, !hours.isEmpty {
                Chart {
                    ForEach(hours, id: \.start) { hour in
                        if let date = ISO8601DateFormatter().date(from: hour.end) {
                            if let battery = hour.bodyBattery { LineMark(x: .value("时间", date), y: .value("电量", battery)) }
                            if let stress = hour.stress {
                                RuleMark(x: .value("时间", date), yStart: .value("压力下界", stress.lower), yEnd: .value("压力上界", stress.upper))
                            }
                        }
                    }
                }.chartYScale(domain: 0...100)
                    .chartXScale(range: .plotDimension(padding: AppleTokens.Space.p16))
                    .chartXAxis {
                        AxisMarks(values: .automatic) { axis in
                            AxisGridLine(); AxisTick()
                            AxisValueLabel {
                                if let date = axis.as(Date.self) { Text(axisLabel(date, format: "HH:mm")).fixedSize() }
                            }
                        }
                    }
                    .environment(\.timeZone, TimeZone(identifier: latest?.timeZone ?? "UTC") ?? .current).accessibilityIdentifier("healthHourlyTrend")
            } else { Text("尚无小时聚合") }
        }
        Section("每日趋势") {
            Picker("趋势范围", selection: $trendDays) {
                Text("7 天").tag(7); Text("30 天").tag(30)
            }.accessibilityIdentifier("healthTrendRange")
            ForEach(["recovery", "sleep", "load"], id: \.self) { kind in
                Text(["recovery": "恢复度 / 100", "sleep": "睡眠 / 小时", "load": "负荷 / 相对单位"][kind]!)
                Chart {
                    ForEach(trend, id: \.date) { summary in
                        if let date = trendDate(summary), let number = trendValue(summary, kind) {
                            PointMark(x: .value("日期", date), y: .value("数值", number))
                        }
                    }
                }.chartXScale(range: .plotDimension(padding: AppleTokens.Space.p16)).chartXAxis {
                    AxisMarks(values: .automatic) { axis in
                        AxisGridLine(); AxisTick()
                        AxisValueLabel {
                            if let date = axis.as(Date.self) { Text(axisLabel(date, format: "M/d")).fixedSize() }
                        }
                    }
                }.environment(\.timeZone, TimeZone(identifier: latest?.timeZone ?? "UTC") ?? .current).accessibilityIdentifier("healthDailyTrend.\(kind)")
            }
        }
    }
    // Charts' automatic axis formatting uses the system zone even with a timeZone environment.
    // Format axis ticks explicitly so a travelled / historical summary keeps its own local dates.
    private func axisLabel(_ date: Date, format: String) -> String {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: latest?.timeZone ?? "UTC")
        formatter.dateFormat = format
        return formatter.string(from: date)
    }
    private func trendDate(_ summary: HealthDailySummary) -> Date? {
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: summary.timeZone)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return formatter.date(from: summary.date + "T12:00:00")
    }
    private func trendValue(_ summary: HealthDailySummary, _ kind: String) -> Double? {
        switch kind {
        case "recovery": summary.derived?.recovery?.value
        case "sleep": summary.sleep.map { $0.totalMinutes / 60 }
        default: summary.derived?.load?.value
        }
    }
}
