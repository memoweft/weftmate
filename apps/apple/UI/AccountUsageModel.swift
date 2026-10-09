import Combine
import Foundation
import WeftMateCore

@MainActor final class AccountUsageModel: ObservableObject {
    @Published private(set) var summary: UsageSummary?
    @Published private(set) var error: String?
    private weak var app: AppleAppModel?
    private var request = UUID()
    init(app: AppleAppModel) { self.app = app }
    func refresh() async {
        guard let app, app.session != nil else { summary = nil; return }
        let scope = app.uxScope, token = UUID(); request = token; summary = nil; error = nil
        do {
            let settings = try await app.assistantClient.usageSettings()
            guard request == token, app.uxScope == scope, !Task.isCancelled else { return }
            let zone = settings.timeZone ?? TimeZone.current.identifier
            let month = AccountUsagePresentation.month(at: Date(), timeZone: zone)
            let value = try await app.assistantClient.usage(month: month, timeZone: zone)
            guard request == token, app.uxScope == scope, !Task.isCancelled,
                  AccountUsagePresentation.matches(value, month: month, timeZone: zone) else { return }
            summary = value
        } catch { if request == token, app.uxScope == scope { self.error = "用量暂时无法读取" } }
    }
}
