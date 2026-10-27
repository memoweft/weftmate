import Foundation
import BackgroundTasks

/// The SDK task may be completed by either expiration or the worker, exactly once.
private final class HealthBackgroundCompletion: @unchecked Sendable {
    let task: BGTask
    private let lock=NSLock()
    private var completed=false
    init(_ task: BGTask) { self.task=task }
    func finish(_ success: Bool) {
        lock.lock(); guard !completed else { lock.unlock(); return }; completed=true; lock.unlock()
        task.expirationHandler=nil
        task.setTaskCompleted(success:success)
    }
}
private enum HealthBackgroundCallbacks {
    nonisolated static func launch() -> @Sendable (BGTask) -> Void {
        { @Sendable task in
            let owner=HealthBackgroundCompletion(task)
            Task { @MainActor in await DailyHealthBackground.run(owner) }
        }
    }
    nonisolated static func expiration(owner: HealthBackgroundCompletion,work: Task<Void,Never>,model: DailyHealthModel) -> @Sendable () -> Void {
        { @Sendable [weak model] in
            work.cancel(); owner.finish(false)
            Task { @MainActor in model?.cancelBackgroundRead() }
        }
    }
}
/// Called synchronously from App.init, before UIKit finishes launching. Models never register.
@MainActor enum DailyHealthBackground {
    private static var registered=false
    private(set) static var registrationCount=0
    private static weak var model: DailyHealthModel?
    static func register() {
        guard !registered else { return }
        registered=true; registrationCount += 1
        _=BGTaskScheduler.shared.register(forTaskWithIdentifier:DailyHealthModel.refreshID,using:nil,launchHandler:HealthBackgroundCallbacks.launch())
    }
    static func attach(_ model: DailyHealthModel) { self.model=model }
    fileprivate static func run(_ owner: HealthBackgroundCompletion) async {
        guard let model else { owner.finish(false); return }
        let work=Task { let success=await model.runBackgroundRefresh(); owner.finish(success) }
        owner.task.expirationHandler=HealthBackgroundCallbacks.expiration(owner:owner,work:work,model:model)
        await work.value
    }
}
