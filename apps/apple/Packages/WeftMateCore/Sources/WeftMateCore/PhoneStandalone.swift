import Foundation
import CryptoKit

public struct PhoneModelConfiguration: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var baseURL: String
    public var model: String
    public var apiKey: String
    public init(id: String = UUID().uuidString, name: String, baseURL: String, model: String, apiKey: String) {
        self.id=id; self.name=name; self.baseURL=baseURL; self.model=model; self.apiKey=apiKey
    }
    public func request(messages: [[String:String]], stream: Bool, allowLoopback: Bool = false) throws -> URLRequest {
        guard let base=URL(string:baseURL), base.user == nil, base.password == nil, base.query == nil, base.fragment == nil,
              base.scheme == "https" || (allowLoopback && base.scheme == "http" && base.host == "127.0.0.1"),
              !model.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty, !apiKey.isEmpty else { throw OfflineFailure.model }
        var r=URLRequest(url:base.appendingPathComponent("chat/completions"),cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:180)
        r.httpMethod="POST"; r.setValue("application/json",forHTTPHeaderField:"Content-Type"); r.setValue("Bearer "+apiKey,forHTTPHeaderField:"Authorization")
        r.httpBody=try JSONSerialization.data(withJSONObject:["model":model,"stream":stream,"messages":messages]); return r
    }
}
public struct PhoneChatMessage: Codable, Equatable, Identifiable, Sendable {
    public var id: String = UUID().uuidString
    public var role: String
    public var text: String
    public var date: Date = Date()
    public init(role: String, text: String) { self.role=role; self.text=text }
}
public struct PhoneChatThread: Codable, Equatable, Identifiable, Sendable {
    public var id: String = UUID().uuidString
    public var messages: [PhoneChatMessage] = []
    public init() {}
    public var title: String { messages.first(where: { $0.role == "user" })?.text ?? "新对话" }
}
public struct PhoneChatState: Codable, Sendable {
    public var threads: [PhoneChatThread] = []
    public var selected: String?
    public var migrations: [String:PhoneChatMigration]?
    public init() {}
}
/// Account identity is the cloud issuer and subject, never email or a computer ID.
public final class PhoneChatStore {
    private let credentials: any CredentialStore
    private let prefix: String
    private let aad: Data
    public let file: URL
    public init(account: String, directory: URL, credentials: any CredentialStore) throws {
        self.credentials=credentials; aad=Data(account.utf8)
        let digest=SHA256.hash(data:aad).map { String(format:"%02x",$0) }.joined()
        prefix="phone-chat.v1."+digest; file=directory.appendingPathComponent(digest+".sealed")
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        var dir=directory; var attrs=URLResourceValues(); attrs.isExcludedFromBackup=true; try dir.setResourceValues(attrs)
    }
    public func loadModels() throws -> [PhoneModelConfiguration] {
        guard let data=try credentials.load(key:prefix+".models") else { return [] }
        return try JSONDecoder().decode([PhoneModelConfiguration].self,from:data)
    }
    public func saveModels(_ values: [PhoneModelConfiguration]) throws { try credentials.save(JSONEncoder().encode(values),key:prefix+".models") }
    public func load() throws -> PhoneChatState {
        guard FileManager.default.fileExists(atPath:file.path) else { return .init() }
        guard let key=try credentials.load(key:prefix+".aes") else { throw APIFailure.credentialStorage }
        let data=try AES.GCM.open(AES.GCM.SealedBox(combined:Data(contentsOf:file)),using:SymmetricKey(data:key),authenticating:aad)
        return try JSONDecoder().decode(PhoneChatState.self,from:data)
    }
    public func save(_ state: PhoneChatState) throws {
        let key: SymmetricKey
        if let data=try credentials.load(key:prefix+".aes") { key=SymmetricKey(data:data) }
        else { key=SymmetricKey(size:.bits256); try credentials.save(key.withUnsafeBytes { Data($0) },key:prefix+".aes") }
        let sealed=try AES.GCM.seal(JSONEncoder().encode(state),using:key,authenticating:aad)
        try sealed.combined!.write(to:file,options:.atomic)
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
    }
}
public enum PhoneStreamDelta {
    public static func text(_ line: String) throws -> String? {
        guard line.hasPrefix("data:") else { return nil }
        let payload=line.dropFirst(5).trimmingCharacters(in:.whitespaces)
        if payload == "[DONE]" { return nil }
        let object=try JSONSerialization.jsonObject(with:Data(payload.utf8)) as? [String:Any]
        if object?["error"] != nil { throw OfflineFailure.model }
        guard let choices=object?["choices"] as? [[String:Any]], let delta=choices.first?["delta"] as? [String:Any] else { return nil }
        if delta["tool_calls"] != nil || delta["function_call"] != nil { throw OfflineFailure.model }
        return delta["content"] as? String
    }
}
public enum PhoneHealthText {
    public static func number(_ value: Double?, metric: String = "") -> String {
        guard let value, value.isFinite else { return "—" }
        let decimals=["wristTempC","respiratoryRateBrpm","vo2Max"].contains(metric) ? 1 : 0
        return value.formatted(.number.precision(.fractionLength(0...decimals)))
    }
    public static func time(_ value: String?, zone: TimeZone = .current) -> String {
        guard let value, let date=HealthInputMath.parseISO(value) else { return "—" }
        let f=DateFormatter(); f.timeZone=zone; f.dateFormat="H:mm"; return f.string(from:date)
    }
}

/// Frozen turns keep the exact body stable after a lost receipt or a local regeneration.
public struct PhoneChatMigration: Codable, Sendable {
    public var generation: Int
    public var turns: [OfflineTurn]
    public var accepted: Set<String>
    public var conversationIDs: Set<String>
}
extension PhoneChatState {
    public mutating func prepareMigration(host: String, generation: Int) -> [OfflineTurn] {
        applyMigrationGeneration(host:host,generation:generation)
        let prior=migrations?[host]
        var migration=prior ?? PhoneChatMigration(generation:generation,turns:[],accepted:[],conversationIDs:[])
        let offered=Set(migration.turns.map(\.id))
        for thread in threads {
            for (index,message) in thread.messages.enumerated() where message.role == "user" && !offered.contains(message.id) {
                var messages=[OfflineMessage(role:"user",text:message.text)]
                if thread.messages.indices.contains(index+1),thread.messages[index+1].role == "assistant",!thread.messages[index+1].text.isEmpty { messages.append(.init(role:"assistant",text:thread.messages[index+1].text)) }
                migration.turns.append(.init(id:message.id,conversationId:thread.id,timestamp:Int64(message.date.timeIntervalSince1970*1000),messages:messages,memoryRefs:[],dependencyComplete:true))
                migration.conversationIDs.insert(thread.id)
            }
        }
        if migrations == nil { migrations=[:] };migrations?[host]=migration
        return migration.turns.filter { !migration.accepted.contains($0.id) }
    }
    public mutating func applyMigrationGeneration(host: String,generation: Int) {
        guard let existing=migrations?[host],existing.generation != generation else { return }
        threads.removeAll { existing.conversationIDs.contains($0.id) }
        if !threads.contains(where: { $0.id == selected }) { selected=nil }
        migrations?[host]=PhoneChatMigration(generation:generation,turns:[],accepted:[],conversationIDs:[])
    }
    public mutating func acknowledgeMigration(host: String, ids: Set<String>) {
        guard var value=migrations?[host] else { return };value.accepted.formUnion(ids.intersection(Set(value.turns.map(\.id))));migrations?[host]=value
    }
}

public enum PhoneCurrencyText {
    public static func money(_ cost: Double) -> String { cost == 0 ? "¥0" : String(format:"¥%.2f",cost) }
}
