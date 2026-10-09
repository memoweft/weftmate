import SwiftUI
import ServiceManagement
import WeftMateCore

@MainActor final class NativeLoginItemService: LoginItemService {
    private let service = SMAppService.mainApp
    var state: LoginItemState {
        switch service.status {
        case .notRegistered: .notRegistered
        case .enabled: .enabled
        case .requiresApproval: .requiresApproval
        case .notFound: .notFound
        @unknown default: .notFound
        }
    }
    func register() throws { try service.register() }
    func unregister() async throws { try await service.unregister() }
}
@MainActor final class MacLoginItemModel: ObservableObject {
    @Published private(set) var state: LoginItemState
    @Published private(set) var busy = false
    @Published private(set) var error: String?
    private let control: LoginItemControl
    init(service: any LoginItemService = NativeLoginItemService()) {
        control = LoginItemControl(service: service); state = control.state
    }
    func refresh() { control.refresh(); state = control.state }
    func setEnabled(_ value: Bool) async {
        guard !busy else { return }
        busy = true; error = nil
        await control.setEnabled(value)
        state = control.state; error = control.error; busy = false
    }
    func openSystemSettings() { SMAppService.openSystemSettingsLoginItems() }
}
