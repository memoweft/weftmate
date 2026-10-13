import Foundation
import CoreFoundation

public struct ServiceModel: Codable, Equatable, Identifiable, Sendable {
    public var id: String { modelId }
    public var modelId: String
    public var name: String
    public var enabled: Bool
    public var profileId: String?
    public var profileIds: [String]?
    public var capabilities: Capabilities?
    public var deepThinking: DeepThinking?
    public var capabilitySource: String?
    public var lastUsedAt: String?
    public var manual: Bool?
    public var pendingInstallation: Bool?
    public struct Capabilities: Codable, Equatable, Sendable { public var vision: Bool?; public var contextWindow: Int? }
    public struct DeepThinking: Codable, Equatable, Sendable { public var supported: Bool?; public var type: String? }
    public init(modelId: String, name: String? = nil, enabled: Bool = true, profileId: String? = nil) {
        self.modelId=modelId;if let name,!name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty { self.name=name } else { self.name=ModelCatalog.displayName(modelId) };self.enabled=enabled;self.profileId=profileId
    }
    public func matches(_ profile: String?) -> Bool { guard let profile else { return false };return profileId == profile || profileIds?.contains(profile) == true }
}
public struct ModelCatalogResult: Codable, Equatable, Sendable {
    public var status: String
    public var checkedAt: String?
    public var message: String
    public var httpStatus: Int?
    public var models: [ServiceModel]?
    public init(status: String = "unchecked", models: [ServiceModel]? = nil, httpStatus: Int? = nil) {
        self.status=status;self.models=models;self.httpStatus=httpStatus
        checkedAt=status == "unchecked" ? nil : ISO8601DateFormatter().string(from:Date())
        switch status {
        case "available": message="已查到模型清单。"
        case "authentication_failed": message="密钥不对或没有权限，请检查密钥。"
        case "unsupported": message="这个服务不提供模型清单，可以手填一个型号。"
        case "offline": message="暂时连不上这个服务，已有模型仍然保留。"
        case "unchecked": message="还没有查询模型清单。"
        default: message="暂时没能查到模型清单，已有模型仍然保留，可以重试或手填型号。"
        }
    }
    public var needsRefresh: Bool {
        guard let checkedAt,let date=HealthInputMath.parseISO(checkedAt) else { return true }
        return Date().timeIntervalSince(date) >= (status == "available" ? 3600 : 30)
    }
}
public struct ModelService: Codable, Equatable, Identifiable, Sendable {
    public var id: String { serviceId }
    public var serviceId: String
    public var name: String
    public var baseUrl: String
    public var interfaceType: String
    public var revision: Int
    public var models: [ServiceModel]
    public var selectedModelId: String?
    public var catalog: ModelCatalogResult
    public var createdAt: String?
    public var updatedAt: String?
    public init(serviceId: String = "model-service-"+UUID().uuidString.lowercased(), name: String, baseUrl: String, interfaceType: String = "openai-compatible", models: [ServiceModel] = []) {
        self.serviceId=serviceId;self.name=name;self.baseUrl=baseUrl;self.interfaceType=interfaceType;revision=1;self.models=models;selectedModelId=models.first?.modelId;catalog = .init()
    }
}
public struct ModelServiceSettings: Decodable, Sendable {
    public var defaultModelProfileId: String?
    public var backgroundModelProfileId: String?
    public var backgroundModelFallback: BackgroundModelFallback?
    public var currentChatModelProfileId: String?
}
public struct ModelServicesReply: Decodable, Sendable {
    public var services: [ModelService]
    public var canManage: Bool
    public var models: [SharedHostModel]?
    public var modelSettings: ModelServiceSettings?
}
public struct ModelServiceReply: Decodable, Sendable { public var service: ModelService }
public struct ModelServiceSelection: Decodable, Sendable { public var profileId: String; public var service: ModelService; public var models: [SharedHostModel] }
public struct ModelServiceWrite: Encodable, Sendable {
    public var requestId: String = "apple-model-service-"+UUID().uuidString.lowercased()
    public var expectedRevision: Int?
    public var name: String?
    public var baseUrl: String?
    public var apiKey: String?
    public var interfaceType: String?
    public var modelId: String?
    public var models: [Visibility]?
    public var selectedModelId: String?
    public struct Visibility: Encodable, Sendable { public var modelId: String;public var enabled: Bool;public init(modelId: String,enabled: Bool) { self.modelId=modelId;self.enabled=enabled } }
    public init(name: String? = nil,baseUrl: String? = nil,apiKey: String? = nil,interfaceType: String? = nil,modelId: String? = nil,expectedRevision: Int? = nil) {
        self.name=name;self.baseUrl=baseUrl;self.apiKey=apiKey;self.interfaceType=interfaceType;self.modelId=modelId;self.expectedRevision=expectedRevision
    }
}
public enum ModelCatalog {
    public static func displayName(_ id: String) -> String {
        if id.hasPrefix("mimo-") { return "MiMo " + id.dropFirst(5).split(separator:"-").map { $0.hasPrefix("v") ? String($0) : $0.capitalized }.joined(separator:" ") }
        let brands=["gpt":"GPT","claude":"Claude","deepseek":"DeepSeek","qwen":"Qwen","gemini":"Gemini","llama":"Llama"]
        return id.replacingOccurrences(of:"_",with:"-").split(separator:"-").map { part in brands[String(part).lowercased()] ?? (part.first?.isNumber == true ? String(part) : part.capitalized) }.joined(separator:" ")
    }
    public static func chatModel(_ id: String) -> Bool {
        let pattern = #"(?:^|[-_/.])(embedding|embeddings|embed|rerank|tts|stt|asr|audio|whisper|dall-e|moderation|image|imagegen|imagen|flux|stable-diffusion|video|veo|sora|speech|transcription)(?:$|[-_/.\d])"#
        return id.range(of:pattern,options:[.regularExpression,.caseInsensitive]) == nil
            && id.range(of:#"^(?:text-embedding|omni-moderation|gpt-image)"#,options:[.regularExpression,.caseInsensitive]) == nil
    }
    public static func menuModels(_ models: [ServiceModel], current: String?, all: Bool, query: String) -> [ServiceModel] {
        let enabled=models.filter { $0.enabled }
        if all || !query.isEmpty { return enabled.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) || $0.modelId.localizedCaseInsensitiveContains(query) } }
        if enabled.count <= 12 { return enabled }
        var ids=Set<String>();var result:[ServiceModel]=[]
        for item in enabled.filter({$0.matches(current) || $0.modelId == current}) + enabled.filter({$0.lastUsedAt != nil}).sorted(by: { ($0.lastUsedAt ?? "") > ($1.lastUsedAt ?? "") }) + enabled {
            if ids.insert(item.modelId).inserted { result.append(item) };if result.count == 8 { break }
        }
        return result
    }
    /// MODEL-1 selection rule: preserve an enabled preference, then flash/mini/haiku, then first enabled.
    public static func recommendedModel(_ models: [ServiceModel],preferred: String? = nil) -> String? {
        let enabled=models.filter(\.enabled)
        if let preferred,enabled.contains(where: {$0.modelId == preferred}) { return preferred }
        return enabled.first(where: {$0.modelId.range(of:"(?:flash|mini|haiku)(?:$|[-_.])",options:[.regularExpression,.caseInsensitive]) != nil})?.modelId ?? enabled.first?.modelId
    }
    public static func normalizedURL(_ raw: String,allowLoopback: Bool = false) throws -> URL {
        guard var parts=URLComponents(string:raw.trimmingCharacters(in:.whitespacesAndNewlines)),parts.user == nil,parts.password == nil,parts.query == nil,parts.fragment == nil,
              parts.host != nil,parts.scheme == "https" || (allowLoopback && parts.scheme == "http" && parts.host == "127.0.0.1") else { throw OfflineFailure.model }
        parts.host=parts.host?.lowercased();while parts.path.hasSuffix("/") { parts.path.removeLast() }
        guard let url=parts.url else { throw OfflineFailure.model };return url
    }
    /// JSON numbers/strings are unknown capability declarations, matching MODEL-1's boolean-only rule.
    public static func declaredBoolean(_ value: Any?) -> Bool? {
        guard let number=value as? NSNumber,CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }
    public static func query(baseUrl: String,apiKey: String,interfaceType: String,network: URLSession,allowLoopback: Bool = false) async -> ModelCatalogResult {
        do {
            let base=try normalizedURL(baseUrl,allowLoopback:allowLoopback)
            var values:[ServiceModel]=[],last: String?,seen=Set<String>()
            repeat {
                var parts=URLComponents(url:base.appendingPathComponent("models"),resolvingAgainstBaseURL:false)!
                if interfaceType == "anthropic" { parts.queryItems=[.init(name:"limit",value:"1000")];if let last { parts.queryItems?.append(.init(name:"after_id",value:last)) } }
                var request=URLRequest(url:parts.url!,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:30)
                if interfaceType == "anthropic" { request.setValue(apiKey,forHTTPHeaderField:"x-api-key");request.setValue("2023-06-01",forHTTPHeaderField:"anthropic-version") }
                else { request.setValue("Bearer "+apiKey,forHTTPHeaderField:"Authorization") }
                let (data,response)=try await network.data(for:request)
                guard let http=response as? HTTPURLResponse else { return .init(status:"failed") }
                if [401,403].contains(http.statusCode) { return .init(status:"authentication_failed",httpStatus:http.statusCode) }
                if [404,405,501].contains(http.statusCode) { return .init(status:"unsupported",httpStatus:http.statusCode) }
                guard (200...299).contains(http.statusCode),let object=try JSONSerialization.jsonObject(with:data) as? [String:Any],let rows=object["data"] as? [[String:Any]] else { return .init(status:"failed",httpStatus:http.statusCode) }
                for row in rows {
                    guard let id=row["id"] as? String,!id.isEmpty,chatModel(id),![(row["type"] as? String ?? ""),(row["task"] as? String ?? ""),(row["category"] as? String ?? "")].contains(where: { ["embedding","speech","audio","image","moderation","rerank","transcription"].contains($0.lowercased()) }),seen.insert(id).inserted else { continue }
                    var model=ServiceModel(modelId:id,name:row["display_name"] as? String ?? row["name"] as? String)
                    let caps=row["capabilities"] as? [String:Any]
                    let vision=declaredBoolean(caps?["vision"]) ?? declaredBoolean((caps?["image_input"] as? [String:Any])?["supported"]) ?? (row["input_modalities"] as? [String]).map {$0.contains("image")}
                    let thinking=declaredBoolean(caps?["reasoning"]) ?? declaredBoolean((caps?["thinking"] as? [String:Any])?["supported"]) ?? declaredBoolean(row["supports_reasoning"]) ?? declaredBoolean((row["deepThinking"] as? [String:Any])?["supported"])
                    if vision != nil || ["max_input_tokens","context_window","context_length","max_context_length"].contains(where: {row[$0] != nil}) || caps?["contextWindow"] != nil { model.capabilities = .init(vision:vision,contextWindow:row["max_input_tokens"] as? Int ?? row["context_window"] as? Int ?? row["context_length"] as? Int ?? row["max_context_length"] as? Int ?? caps?["contextWindow"] as? Int) }
                    if let thinking {
                        let types=(caps?["thinking"] as? [String:Any])?["types"] as? [String:Any]
                        let adaptive=declaredBoolean((types?["adaptive"] as? [String:Any])?["supported"]) == true && declaredBoolean((types?["enabled"] as? [String:Any])?["supported"]) != true
                        model.deepThinking = .init(supported:thinking,type:adaptive ? "adaptive" : (row["deepThinking"] as? [String:Any])?["type"] as? String ?? (caps?["thinking"] as? [String:Any])?["type"] as? String)
                    }
                    if model.capabilities != nil || model.deepThinking != nil { model.capabilitySource="catalog" }
                    values.append(model)
                }
                if interfaceType == "anthropic",declaredBoolean(object["has_more"]) == true {
                    guard let cursor=object["last_id"] as? String,cursor != last else { return .init(status:"failed") };last=cursor
                } else { last=nil }
            } while last != nil
            return .init(status:values.isEmpty ? "unsupported" : "available",models:values)
        } catch { return .init(status:"offline") }
    }
}

/// Secrets and pre-migration backup both remain in the existing device-only Keychain.
public struct PhoneModelService: Codable, Equatable, Sendable {
    public var service: ModelService
    public var apiKey: String
    public init(service: ModelService,apiKey: String) { self.service=service;self.apiKey=apiKey }
    public var configurations: [PhoneModelConfiguration] {
        service.models.map { model in
            var value=PhoneModelConfiguration(id:model.profileId ?? service.id+":"+model.modelId,name:service.name,baseURL:service.baseUrl,model:model.modelId,apiKey:apiKey)
            value.interfaceType=service.interfaceType == "anthropic" ? "anthropic" : nil;value.vision=model.capabilities?.vision;value.deepThinking=model.deepThinking;return value
        }
    }
}
public struct PhoneModelLibrary: Codable, Sendable {
    public var version=1
    public var services: [PhoneModelService]=[]
    public var selectedProfileId: String?
    public var threadSelections: [String:String]?
    public init() {}
    public static func migrate(_ old: [PhoneModelConfiguration]) throws -> Self {
        var next=Self()
        for config in old {
            let normalized=try ModelCatalog.normalizedURL(config.baseURL,allowLoopback:true).absoluteString
            var item=ServiceModel(modelId:config.model,name:ModelCatalog.displayName(config.model),profileId:config.id)
            if let i=next.services.firstIndex(where: { $0.service.baseUrl == normalized && $0.apiKey == config.apiKey }) {
                if let m=next.services[i].service.models.firstIndex(where: {$0.modelId == config.model}) {
                    var aliases=next.services[i].service.models[m].profileIds ?? [];aliases.append(config.id);next.services[i].service.models[m].profileIds=aliases
                } else { item.manual=true;next.services[i].service.models.append(item) }
            } else { item.manual=true;next.services.append(.init(service:.init(name:config.name,baseUrl:normalized,models:[item]),apiKey:config.apiKey)) }
        }
        next.selectedProfileId=old.first?.id;return next
    }
}
