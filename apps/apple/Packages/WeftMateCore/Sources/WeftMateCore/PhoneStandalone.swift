import Foundation
import CryptoKit

public struct PhoneModelConfiguration: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var baseURL: String
    public var model: String
    public var apiKey: String
    public var interfaceType: String?
    public var vision: Bool?
    public var deepThinking: ServiceModel.DeepThinking?
    public var thinkingEnabled: Bool?
    public init(id: String = UUID().uuidString, name: String, baseURL: String, model: String, apiKey: String) {
        self.id=id; self.name=name; self.baseURL=baseURL; self.model=model; self.apiKey=apiKey
    }
    public func request(messages: [[String:String]], stream: Bool, allowLoopback: Bool = false, maxTokens: Int? = nil) throws -> URLRequest {
        guard let base=URL(string:baseURL), base.user == nil, base.password == nil, base.query == nil, base.fragment == nil,
              base.scheme == "https" || (allowLoopback && base.scheme == "http" && base.host == "127.0.0.1"),
              !model.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty, !apiKey.isEmpty else { throw OfflineFailure.model }
        var r=URLRequest(url:base.appendingPathComponent("chat/completions"),cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:180)
        r.httpMethod="POST"; r.setValue("application/json",forHTTPHeaderField:"Content-Type"); r.setValue("Bearer "+apiKey,forHTTPHeaderField:"Authorization")
        var body: [String:Any]=["model":model,"stream":stream,"messages":messages]
        if let maxTokens { body["max_tokens"]=maxTokens }
        r.httpBody=try JSONSerialization.data(withJSONObject:body); return try adaptRequest(r)
    }
}
extension PhoneModelConfiguration {
    public func adaptRequest(_ source: URLRequest) throws -> URLRequest {
        guard interfaceType == "anthropic" else {
            var request=source
            if deepThinking?.supported == true,let enabled=thinkingEnabled,let data=request.httpBody,var body=try JSONSerialization.jsonObject(with:data) as? [String:Any] {
                if enabled {
                    switch URL(string:baseURL)?.host {
                    case "api.xiaomimimo.com","api.deepseek.com": body["thinking"]=["type":"enabled"]
                    case "dashscope.aliyuncs.com": body["enable_thinking"]=true
                    default: body["reasoning_effort"]="high"
                    }
                };request.httpBody=try JSONSerialization.data(withJSONObject:body)
            };return request
        }
        var request=source;request.url=try ModelCatalog.normalizedURL(baseURL,allowLoopback:source.url?.scheme == "http").appendingPathComponent("messages")
        request.setValue(nil,forHTTPHeaderField:"Authorization");request.setValue(apiKey,forHTTPHeaderField:"x-api-key");request.setValue("2023-06-01",forHTTPHeaderField:"anthropic-version")
        guard let data=source.httpBody,var body=try JSONSerialization.jsonObject(with:data) as? [String:Any] else { throw OfflineFailure.model }
        let messages=body["messages"] as? [[String:Any]] ?? []
        body["system"]=messages.filter {$0["role"] as? String == "system"}.compactMap {$0["content"] as? String}.joined(separator:"\n")
        body["messages"]=try messages.filter {$0["role"] as? String != "system"}.map { message in
            var message=message
            if let content=message["content"] as? [[String:Any]] {
                message["content"]=try content.map { part -> [String:Any] in
                    guard part["type"] as? String == "image_url",let image=part["image_url"] as? [String:Any],let dataURL=image["url"] as? String,let comma=dataURL.firstIndex(of:",") else { return part }
                    guard dataURL.hasPrefix("data:image/jpeg;base64,") else { throw OfflineFailure.model }
                    return ["type":"image","source":["type":"base64","media_type":"image/jpeg","data":String(dataURL[dataURL.index(after:comma)...])]]
                }
            };return message
        }
        body["max_tokens"]=body["max_tokens"] ?? 4096
        if deepThinking?.supported == true,thinkingEnabled == true {
            body["thinking"]=deepThinking?.type == "adaptive" ? ["type":"adaptive"] : ["type":"enabled","budget_tokens":1024]
        }
        request.httpBody=try JSONSerialization.data(withJSONObject:body);return request
    }
    public func responseText(_ data: Data) throws -> String? {
        guard let object=try JSONSerialization.jsonObject(with:data) as? [String:Any] else { return nil }
        if interfaceType == "anthropic" { return (object["content"] as? [[String:Any]])?.filter {$0["type"] as? String == "text"}.compactMap {$0["text"] as? String}.joined() }
        return ((object["choices"] as? [[String:Any]])?.first?["message"] as? [String:Any])?["content"] as? String
    }
    public func streamText(_ line: String) throws -> String? {
        if interfaceType != "anthropic" { return try PhoneStreamDelta.text(line) }
        guard line.hasPrefix("data:"),let object=try JSONSerialization.jsonObject(with:Data(line.dropFirst(5).utf8)) as? [String:Any] else { return nil }
        if object["type"] as? String == "error" { throw OfflineFailure.model }
        let delta=object["delta"] as? [String:Any]
        guard delta?["type"] as? String == "text_delta", let text=delta?["text"] as? String, !text.isEmpty else { return nil }
        return text
    }
}

public struct PhoneChatMessage: Codable, Equatable, Identifiable, Sendable {
    public var id: String = UUID().uuidString
    public var role: String
    public var text: String
    public var date: Date = Date()
    public var attachments: [PhoneAttachment]?
    public var memoryRefs: [OfflineMemoryRef]?
    public var dependencyComplete: Bool?
    public init(role: String, text: String) { self.role=role; self.text=text }
}
public struct PhoneChatThread: Codable, Equatable, Identifiable, Sendable {
    public var id: String = UUID().uuidString
    public var messages: [PhoneChatMessage] = []
    public init() {}
    public var title: String {
        guard let message=messages.first(where: { $0.role == "user" }) else { return "新对话" }
        return message.text.isEmpty ? message.attachments?.first?.name ?? "新对话" : message.text
    }
}
public struct PhoneChatState: Codable, Sendable {
    public var threads: [PhoneChatThread] = []
    public var selected: String?
    public var migrations: [String:PhoneChatMigration]?
    public var pending: PhoneChatDraft?
    public var reminders: [LocalReminder]?
    public var computerReminders: [String:[LocalReminder]]?
    public var memory: PhoneMemoryState?
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
    public func clear() throws {
        if FileManager.default.fileExists(atPath:file.path) { try FileManager.default.removeItem(at:file) }
        try credentials.delete(key:prefix+".aes");try credentials.delete(key:prefix+".models");try credentials.delete(key:prefix+".services");try credentials.delete(key:prefix+".models.before")
    }
    public func loadModels() throws -> [PhoneModelConfiguration] {
        guard let data=try credentials.load(key:prefix+".models") else { return [] }
        return try JSONDecoder().decode([PhoneModelConfiguration].self,from:data)
    }
    public func saveModels(_ values: [PhoneModelConfiguration]) throws { try credentials.save(JSONEncoder().encode(values),key:prefix+".models") }
    public func loadLibrary() throws -> PhoneModelLibrary {
        if let data=try credentials.load(key:prefix+".services") {
            do { return try JSONDecoder().decode(PhoneModelLibrary.self,from:data) } catch { /* Preserve the old library if migration data is unreadable. */ }
        }
        let old=try loadModels()
        let next=try PhoneModelLibrary.migrate(old)
        if try credentials.load(key:prefix+".models.before") == nil,let original=try credentials.load(key:prefix+".models") { try credentials.save(original,key:prefix+".models.before") }
        try saveLibrary(next)
        return next
    }
    public func saveLibrary(_ library: PhoneModelLibrary) throws { try credentials.save(JSONEncoder().encode(library),key:prefix+".services") }
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
        if hasValue(object?["error"]) { throw OfflineFailure.model }
        guard let choices=object?["choices"] as? [[String:Any]], let delta=choices.first?["delta"] as? [String:Any] else { return nil }
        if hasValue(delta["tool_calls"]) || hasValue(delta["function_call"]) { throw OfflineFailure.model }
        guard let content=delta["content"] as? String, !content.isEmpty else { return nil }
        return content
    }
    private static func hasValue(_ value: Any?) -> Bool {
        // JSON null is NSNull, and compatible providers also send empty placeholders.
        guard let value, !(value is NSNull) else { return false }
        if let array=value as? [Any] { return !array.isEmpty }
        if let object=value as? [String:Any] { return !object.isEmpty }
        if let text=value as? String { return !text.isEmpty }
        return true
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
            guard !(migrations ?? [:]).contains(where: { $0.key != host && $0.value.conversationIDs.contains(thread.id) }) else { continue }
            for (index,message) in thread.messages.enumerated() where message.role == "user" && !offered.contains(message.id) {
                var messages=[OfflineMessage(role:"user",text:([message.text]+(message.attachments ?? []).map(\.placeholder)).filter { !$0.isEmpty }.joined(separator:"\n"))]
                if thread.messages.indices.contains(index+1),thread.messages[index+1].role == "assistant",!thread.messages[index+1].text.isEmpty { messages.append(.init(role:"assistant",text:thread.messages[index+1].text)) }
                migration.turns.append(.init(id:message.id,conversationId:thread.id,timestamp:Int64(message.date.timeIntervalSince1970*1000),messages:messages,memoryRefs:thread.messages.indices.contains(index+1) ? thread.messages[index+1].memoryRefs ?? [] : [],dependencyComplete:thread.messages.indices.contains(index+1) ? thread.messages[index+1].dependencyComplete ?? true : true))
                migration.conversationIDs.insert(thread.id)
            }
        }
        if migrations == nil { migrations=[:] };migrations?[host]=migration
        return migration.turns.filter { !migration.accepted.contains($0.id) }
    }
    public mutating func applyMigrationGeneration(host: String,generation: Int) {
        guard let existing=migrations?[host],existing.generation != generation else { return }
        memory?.items.removeAll { existing.conversationIDs.contains($0.threadID ?? "") }
        threads.removeAll { existing.conversationIDs.contains($0.id) }
        reminders?.removeAll { existing.conversationIDs.contains($0.sessionID ?? "") }
        computerReminders?[host]=nil
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
