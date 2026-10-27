import Foundation
import WeftMateCore

// Compiles the shared standalone product controller on macOS; UI, cloud and Keychain are absent.
final class PhoneCheckCredentials: CredentialStore, @unchecked Sendable {
    private let lock=NSLock()
    private var data: [String:Data]=[:]
    func load(key: String) -> Data? { lock.withLock { data[key] } }
    func save(_ value: Data,key: String) { lock.withLock { data[key]=value } }
    func delete(key: String) { lock.withLock { data[key]=nil } }
}
struct PhoneCheckSession { enum Verification { case verified };var verification: Verification = .verified;var hostId="synthetic-computer" }
@MainActor final class PhoneCheckCloud { var subject: String?="account-a";var authenticated=true }
@MainActor final class PhoneCheckOffline {
    var memoryItems: [OfflineMemory]=[]
    var memoryAccountID: String?="account-a"
    var memoryHostID: String? { ready ? hostID : nil }
    var hostID="synthetic-computer"
    var authorizations=0
    var memoryRevision: UUID?=UUID()
    var memoryErasure: OfflineReplicaErasure?
    var replicaHostID: String? { hostID }
    func acknowledgeMemoryErasure(_ id: String) { if memoryErasure?.id == id { memoryErasure=nil } }
    func authorizeMemory(control: (String) async throws -> OfflineAuthorization) async throws {
        authorizations += 1
        let authorization=try await control(hostID)
        guard authorization.authorized,authorization.hostId == hostID,authorization.accountId == memoryAccountID,authorization.generation == generation else { memoryItems=[];ready=false;memoryRevision=UUID();memoryErasure = .init(hostID:hostID,removedIDs:[],reset:true);throw OfflineFailure.authorization }
    }
    func erase() { enqueued=[];synced=[];memoryItems=[];ready=false }
    var generation: Int?=1
    var ready=true
    var memoryAuthorityReady=true
    var hostOffline=false
    var synced=Set<String>()
    var enqueued: [OfflineTurn]=[]
    func enqueuePhoneTurns(_ values: [OfflineTurn],generation: Int,handover: OfflineHandover? = nil) throws {
        guard generation == self.generation else { throw OfflineFailure.notReady }
        for value in values where !enqueued.contains(where: { $0.id == value.id }) { enqueued.append(value) }
    }
}
@MainActor final class AppleAppModel {
    var session: PhoneCheckSession?
    let cloudLogin=PhoneCheckCloud()
    let offline=PhoneCheckOffline()
    let healthStateDirectory: URL
    var phoneCredentialNamespace="synthetic-state-only"
    var phoneAccountIdentity: String { "https://cloud.example.com|"+(cloudLogin.subject ?? "device-local") }
    var controlGeneration=1
    init(directory: URL) { healthStateDirectory=directory.appendingPathComponent("Health") }
    func offlineAuthorization(_ host: String) async throws -> OfflineAuthorization {
        let json: [String:Any]=["authorized":true,"hostId":host,"accountId":cloudLogin.subject ?? "", "generation":controlGeneration]
        return try JSONDecoder().decode(OfflineAuthorization.self,from:JSONSerialization.data(withJSONObject:json))
    }
    func removeComputerReplica(_ host: String) { if offline.replicaHostID == host { offline.erase();offline.memoryRevision=UUID() } }
}
