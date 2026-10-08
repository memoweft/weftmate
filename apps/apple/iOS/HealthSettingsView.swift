import SwiftUI
import WeftMateCore

struct HealthSettingsView: View {
    @ObservedObject var model: HealthSettingsModel
    @ObservedObject var app: AppleAppModel
    @State private var choosingCloud = false
    @State private var deleting = false
    var body: some View {
        Form {
            HealthMetricsView(summaries: Array(model.state.summaries.values))
            Section {
                Text("只读取你选择的项目，在手机上计算指标，汇总为每日与小时摘要。手表记录会通过“健康”同步到 iPhone。")
                Text("Apple 不公开读取权限状态。若无数据或已撤权，请到“健康” → 头像 → App → WeftMate 检查权限。")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("选择读取权限") {
                    if model.state.preferences.cloudChoiceMade {
                        Task { await model.authorize(cloudAllowed: model.state.preferences.cloudModelAllowed, app: app) }
                    } else { choosingCloud = true }
                }.disabled(!model.reader.available || model.busy)
                    .accessibilityIdentifier("healthAuthorize")
            }
            Section("读取项目") {
                ForEach(HealthCategory.allCases, id: \.self) { category in
                    Toggle(isOn: Binding(get: { model.state.preferences.enabled.contains(category) }, set: { enabled in
                        var p = model.state.preferences
                        if enabled { p.enabled.insert(category) } else { p.enabled.remove(category) }
                        Task { await model.setPreferences(p, app: app) }
                    })) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(category.title)
                            Text(model.status(category).title).font(.caption).foregroundStyle(.secondary)
                        }
                    }.accessibilityIdentifier("healthCategory.\(category.rawValue)")
                }
            }
            Section("使用范围") {
                Toggle("健康数据可用于云端模型", isOn: Binding(get: { model.state.preferences.cloudModelAllowed }, set: { value in
                    var p = model.state.preferences; p.cloudChoiceMade = true; p.cloudModelAllowed = value
                    Task { await model.setPreferences(p, app: app) }
                })).accessibilityIdentifier("healthCloudAllowed")
                Text("设备端指标与小时摘要始终仅供本人电脑和本地模型使用，不进云。此选择仅适用于不含设备端指标的每日摘要。")
                    .font(.footnote).foregroundStyle(.secondary)
                Picker("自评频率", selection: Binding(get: { model.state.preferences.selfAssessmentFrequency }, set: { value in
                    var p = model.state.preferences; p.selfAssessmentFrequency = value
                    Task { await model.setPreferences(p, app: app) }
                })) { ForEach(SelfAssessmentFrequency.allCases, id: \.self) { Text($0.title).tag($0) } }
                Text("自评询问将在后续版本提供。").font(.footnote).foregroundStyle(.secondary)
            }
            Section("每日摘要") {
                if let summary = model.latest {
                    Text(summary.date)
                    if let sleep = summary.sleep { Text("睡眠 \(sleep.totalMinutes / 60, specifier: "%.1f") 小时") }
                    ForEach(summary.metrics.keys.sorted(), id: \.self) { key in
                        if key != "sleep", let metric = summary.metrics[key] {
                            VStack(alignment: .leading) {
                                Text("\(HealthCategory(rawValue: key)?.title ?? key)：\(metric.value, specifier: "%.1f") \(metric.unit)")
                                if let deviation = metric.deviationPercent {
                                    Text("较此前 14 天基线 \(deviation, specifier: "%+.0f")% · \(metric.baselineDays) 天有数据")
                                        .font(.caption).foregroundStyle(.secondary)
                                } else { Text("基线数据不足").font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                    if let count = summary.workoutCount { Text("锻炼 \(count) 次 · \(summary.workoutMinutes ?? 0, specifier: "%.0f") 分钟") }
                    Text("汇总于 \(summary.summarizedAt)").font(.caption).foregroundStyle(.secondary)
                } else { Text("还没有健康摘要") }
                Button("更新摘要") { Task { await model.refresh(app: app) } }.disabled(model.busy || model.uploading)
                if model.busy { ProgressView("正在读取…") }
                if let message = model.message { Text(message).foregroundStyle(.secondary) }
            }
            Section {
                Button("删除健康摘要并停止读取", role: .destructive) { deleting = true }
                Text(model.state.deleteAllPending ? "本地摘要已删除，服务器删除将在可用时重试。" : "删除摘要不会删除“健康”中的原始记录。系统读取权限可在“健康”中撤销。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("健康")
        .disabled(model.busy || model.uploading)
        .confirmationDialog("健康数据是否可用于云端模型？", isPresented: $choosingCloud, titleVisibility: .visible) {
            Button("仅供本地模型使用（默认）") { Task { await model.authorize(cloudAllowed: false, app: app) } }
            Button("允许云端模型使用") { Task { await model.authorize(cloudAllowed: true, app: app) } }
            Button("取消", role: .cancel) {}
        } message: { Text("只向本人电脑上传每日与小时摘要，不上传原始健康样本。设备端指标不进云。你可以随时在此更改。") }
        .confirmationDialog("删除此账号的全部健康摘要？", isPresented: $deleting, titleVisibility: .visible) {
            Button("删除摘要并停止读取", role: .destructive) { Task { await model.deleteAll(app: app) } }
        }
        .task { await model.activate(app: app) }
    }
}
