import Foundation
import WeftMateCore

// Cloud/account shell only. Both product controllers and the encrypted replica run unchanged.
final class PhoneSyncKeys: CredentialStore,@unchecked Sendable {
    private let lock=NSLock();private var values: [String:Data]=[:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ value: Data,key: String) { lock.withLock { values[key]=value } }
    func delete(key: String) { lock.withLock { values[key]=nil } }
}
@MainActor final class PhoneSyncCloud { var subject: String?="account-test";var authenticated=true }
@MainActor final class AppleAppModel {
    var session: AccountSession?
    let cloudLogin=PhoneSyncCloud()
    var offline=OfflineChatModel()
    let healthStateDirectory: URL
    var phoneCredentialNamespace="phone-sync-synthetic"
    var phoneAccountIdentity: String { "https://cloud.example.invalid|"+(cloudLogin.subject ?? "device-local") }
    var generation=1
    var authorizationAvailable=true
    init(directory: URL) { healthStateDirectory=directory.appendingPathComponent("Health") }
    func offlineAuthorization(_ host: String) async throws -> OfflineAuthorization {
        guard authorizationAvailable else { throw APIFailure.transport(.unavailable) }
        return try JSONDecoder().decode(OfflineAuthorization.self,from:JSONSerialization.data(withJSONObject:["authorized":true,"hostId":host,"accountId":cloudLogin.subject ?? "","generation":generation]))
    }
    func removeComputerReplica(_ host: String) { offline.removeComputer(host) }
}
