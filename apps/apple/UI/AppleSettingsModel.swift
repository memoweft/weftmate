import SwiftUI
import WeftMateCore

/// All host reads/writes live here. Views never construct network requests.
@MainActor final class AppleSettingsModel: ObservableObject {
    @Published var schedules: [ManagedSchedule] = []
    @Published var backups: HostBackups?
    @Published var backupPreferences: BackupPreferences?
    @Published var models: [SharedHostModel] = []
    @Published var prices: [WeftMateCore.UsageModel] = []
    @Published var status: HostSettingsStatus?
    @Published var busy = false
    @Published var error: String?
    @Published var notice: String?
    private weak var app: AppleAppModel?
    private let epoch: UUID
    init(app: AppleAppModel) { self.app = app; epoch = app.accountEpoch }
    private var current: Bool { app?.accountEpoch == epoch }
    func refresh(_ category: String) async {
        await perform {
            guard let app = self.app else { return }
            switch category {
            case "schedules":
                let reply = try await app.assistantClient.settingsSchedules()
                if self.current { self.schedules = reply.items }
            case "backups":
                let reply = try await app.assistantClient.settingsBackups()
                if self.current { self.backups = reply; self.backupPreferences = reply.settings }
            case "models":
                let models = try await app.assistantClient.hostModels()
                let prices = try await app.assistantClient.usageSettings()
                if self.current { self.models = models; self.prices = prices.models }
            case "system":
                let reply = try await app.assistantClient.settingsStatus()
                if self.current { self.status = reply }
            default: break
            }
        }
    }
    func schedule(_ item: ManagedSchedule, action: ScheduleAction) async {
        await perform { try await self.app?.assistantClient.manageSchedule(sessionID: item.sessionId, id: item.id, action: action) }
        if current { await refresh("schedules") }
    }
    func saveBackups() async {
        guard let backupPreferences else { return }
        await perform { try await self.app?.assistantClient.setBackupPreferences(backupPreferences) }
        if current { await refresh("backups") }
    }
    func backup() async {
        await perform {
            guard let result = try await self.app?.assistantClient.createBackup(), self.current else { return }
            self.notice = result.state == "succeeded" ? "备份完成。" : "备份状态：" + result.state
        }
        if current { await refresh("backups") }
    }
    func restore(_ item: HostBackup) async {
        await perform {
            guard let result = try await self.app?.assistantClient.restoreBackup(id: item.id), self.current else { return }
            self.notice = result.requiresLogin ? "恢复已受理，电脑将重启；完成后请重新登录。" : "恢复状态：" + result.state
        }
    }
    private func perform(_ work: () async throws -> Void) async {
        guard !busy, current else { return }
        busy = true; error = nil
        defer { busy = false }
        do { try await work() }
        catch { if current, !Task.isCancelled { self.error = "操作未完成，请刷新确认当前状态后重试。" } }
    }
    func summary(_ category: String) -> String {
        guard let app else { return "" }
        switch category {
        case "general": return "简体中文"
        case "appearance": return AppleAppearance(rawValue: app.appearanceMode)?.title ?? "跟随系统"
        case "account": return app.cloudLogin.authenticated ? app.cloudLogin.email : app.accountName
        case "devices": return "\(app.cloudLogin.devices.count) 台设备"
        case "usage": return "本月费用与上限"
        case "models": return "主模型与单价"
        case "approvals": return "新对话默认模式"
        case "memory": return "记忆与来源"
        case "schedules": return "提醒与任务"
        case "system": return app.verificationPending ? "等待连接" : "已连接"
        case "backups": return "电脑本地备份"
        default: return Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1"
        }
    }
}
