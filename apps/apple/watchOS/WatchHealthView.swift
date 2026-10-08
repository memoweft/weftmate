import SwiftUI
import WeftMateCore

/// Watch computes from its own authorized store; iPhone recomputes synced HealthKit data for the account-scoped upload.
/// No credentials or raw samples travel through WatchConnectivity.
@MainActor private final class WatchHealthModel: ObservableObject {
    @Published var latest: HealthDailySummary?
    @Published var busy = false
    @Published var message: String?
    private var preferences = HealthPreferences()
    private let reader = HealthKitReader()
    func authorize() async {
        guard !busy else { return }
        busy = true
        do {
            try await reader.requestRead(preferences.enabled)
            preferences.requested = preferences.enabled
            preferences.cloudChoiceMade = true; preferences.cloudModelAllowed = false
            latest = await reader.read(preferences: preferences, calendar: .current, deviceId: "watch-local").last
        } catch { message = "请在健康中检查读取权限后重试。" }
        busy = false
    }
}
struct WatchHealthView: View {
    @StateObject private var health = WatchHealthModel()
    var body: some View {
        List {
            if let latest = health.latest {
                Text("电量：\((latest.hourly?.last?.bodyBattery).map { String(format: "%.0f", $0) } ?? "数据不足")")
                Text("恢复：\((latest.derived?.recovery?.value).map { String(format: "%.0f", $0) } ?? "数据不足")")
                if let stress = latest.hourly?.last(where: { $0.stress != nil })?.stress {
                    Text("压力：\(stress.lower, specifier: "%.0f")–\(stress.upper, specifier: "%.0f")")
                    Text(stress.latestSampleAt).font(.caption)
                } else { Text("压力：数据不足") }
                Text("负荷：\((latest.derived?.load?.value).map { String(format: "%.1f", $0) } ?? "数据不足")")
                Text("睡眠：\(latest.sleep.map { String(format: "%.1f 小时", $0.totalMinutes / 60) } ?? "数据不足")")
            }
            Button("读取并更新健康指标") { Task { await health.authorize() } }.disabled(health.busy)
            Text("本地估算；同步到手机的记录由手机汇总并上传本人电脑。").font(.caption)
            if let message = health.message { Text(message).font(.caption) }
        }.navigationTitle("健康")
    }
}
