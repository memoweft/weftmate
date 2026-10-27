import SwiftUI
import WeftMateCore

struct DailyHealthSettingsRow: View {
    @EnvironmentObject private var health: DailyHealthModel
    @ObservedObject var app: AppleAppModel
    var showsReview = true
    var showsHealth = true
    var body: some View {
        Section(showsReview ? "回顾与洞察" : "健康数据") {
            if showsReview, let review = health.review {
                Toggle("回顾与洞察", isOn: Binding(get: { health.review?.reviewEnabled ?? review.reviewEnabled }, set: { value in
                    Task { await health.setReview(value, app: app) }
                })).accessibilityIdentifier("dailyReviewToggle")
            }
            if showsHealth {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                HStack {
                    Text("健康数据")
                    Spacer()
                    if health.state.connected {
                        Toggle("健康数据", isOn: Binding(get: { health.state.enabled }, set: { value in
                            Task { await health.setEnabled(value, app: app) }
                        })).labelsHidden().accessibilityIdentifier("dailyHealthToggle")
                    } else if health.reader.available {
                        Button("接上") { Task { await health.connect(app: app) } }
                            .disabled(health.busy).accessibilityIdentifier("dailyHealthConnect")
                    }
                }
                Text(health.status).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    .accessibilityIdentifier("dailyHealthStatus")
                Text("读取步数、睡眠、静息心率和运动，只把每天的汇总送到你自己的电脑，随时可以关。")
                    .font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
            }.accessibilityElement(children: .contain)
            NavigationLink {
                Form {
                    Section("读取项目") {
                        ForEach(["步数","睡眠与分期","静息心率与心率变异性","呼吸频率、血氧与手腕温度","运动、能量与最大摄氧量"],id:\.self) { Text($0) }
                        Text("只读不写。每项读取权限由系统健康面板管理；没有测量时保留空白。").font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
                        Button("选择读取权限") { Task { await health.expand(app:app) } }.disabled(health.busy || !health.reader.available).accessibilityIdentifier("health.readItemsAuthorize")
                    }
                }.navigationTitle("选择读取项目")
            } label: { Text("选择读取项目") }
            Button("更新摘要") { Task { await health.activate(app:app) } }.disabled(health.busy || !health.state.enabled).accessibilityIdentifier("health.updateSummary")
            if health.busy { ProgressView("正在读取…") }
            }
        }
    }
}

/// Only the existing weekly review is used for the optional, dismissible HealthKit invitation.
@MainActor final class DailyReviewModel: ObservableObject {
    @Published var items: [HealthActivity] = []
    @Published var unavailable = false
    @Published var nextCursor: String?
    @Published var loading = false
    func refresh(app: AppleAppModel, more: Bool = false) async {
        guard !loading else { return }; loading = true; defer { loading = false }
        let epoch = app.accountEpoch
        do {
            let result = try await app.assistantClient.healthActivity(cursor: more ? nextCursor : nil)
            guard epoch == app.accountEpoch else { items = []; return }
            items = more ? items + result.items.filter { new in !items.contains { $0.id == new.id } } : result.items
            nextCursor = result.hasMore ? result.nextCursor : nil; unavailable = false
        } catch { if epoch == app.accountEpoch { unavailable = true } }
    }
}
struct DailyReviewView: View {
    @ObservedObject var app: AppleAppModel
    @EnvironmentObject private var health: DailyHealthModel
    @StateObject private var review = DailyReviewModel()
    var body: some View {
        List {
            ForEach(review.items) { item in
                Section {
                    Text(item.title).font(AppleTokens.Fonts.headline)
                    Text(item.weeklyInsight?.text ?? item.summary)
                    if item.id == review.items.first(where: { $0.weeklyInsight != nil })?.id, health.showsHint {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                            Text("接上健康数据后，这里还会有睡眠和运动").font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
                            HStack {
                                Button("接上") { Task { await health.connect(app: app) } }.disabled(health.busy)
                                    .buttonStyle(PrimaryActionStyle(fillsWidth: false))
                                    .accessibilityIdentifier("dailyHealthHintConnect")
                                Button("不用") { health.dismissHint(app: app) }
                                    .buttonStyle(OutlineActionStyle())
                                    .accessibilityIdentifier("dailyHealthHintDismiss")
                            }
                        }.accessibilityElement(children: .contain)
                    }
                }
            }
            if review.items.isEmpty { Text(review.unavailable ? "电脑暂时连不上，稍后再来看看。" : "每周的回顾会出现在这里。") }
            if review.nextCursor != nil { Button("查看更多") { Task { await review.refresh(app: app, more: true) } } }
        }.navigationTitle("动态")
            .task(id: app.accountEpoch) { await review.refresh(app: app) }
            .refreshable { await review.refresh(app: app) }
    }
}
