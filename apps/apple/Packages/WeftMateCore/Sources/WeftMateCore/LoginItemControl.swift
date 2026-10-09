import Foundation

public enum LoginItemState: String, Sendable {
    case notRegistered, enabled, requiresApproval, notFound
    public var isOn: Bool { self == .enabled || self == .requiresApproval }
    public var explanation: String {
        switch self {
        case .notRegistered: "已关闭。"
        case .enabled: "已开启，下次登录这台 Mac 时启动。"
        case .requiresApproval: "等待系统批准。请在系统设置 → 通用 → 登录项中允许 WeftMate。"
        case .notFound: "系统未找到此 App，请将完整 App 放入应用程序文件夹后重试。"
        }
    }
}
@MainActor public protocol LoginItemService {
    var state: LoginItemState { get }
    func register() throws
    func unregister() async throws
}
/// Always read system state after a write (including failure), never persist an optimistic toggle.
@MainActor public final class LoginItemControl {
    public private(set) var state: LoginItemState
    public private(set) var error: String?
    public private(set) var busy = false
    private let service: any LoginItemService
    public init(service: any LoginItemService) { self.service = service; state = service.state }
    public func refresh() { state = service.state }
    public func setEnabled(_ enabled: Bool) async {
        guard !busy else { return }
        busy = true; error = nil
        defer { state = service.state; busy = false }
        do {
            if enabled { try service.register() } else { try await service.unregister() }
            let result = service.state
            if enabled && !result.isOn || !enabled && result.isOn {
                error = "系统尚未确认更改，请刷新登录项状态后重试。"
            }
        } catch {
            self.error = "更改开机自启失败（\((error as NSError).domain) \((error as NSError).code)）。请检查系统登录项权限后重试。"
        }
    }
}
