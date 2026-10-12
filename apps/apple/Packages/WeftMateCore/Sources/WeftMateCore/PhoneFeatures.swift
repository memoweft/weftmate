import Foundation

public struct PhoneSource: Codable, Sendable {
    public var sessionId: String?; public var chatId: String?; public var taskId: String?; public var seq: Int?; public var eventId: String?
    public var category: String?; public var id: String?; public var artifactId: String?; public var scheduleId: String?
}
public struct PhoneActivity: Codable, Identifiable, Sendable {
    public struct Action: Codable, Sendable { public var kind: String; public var label: String; public var target: PhoneSource }
    public var id: String; public var at: String; public var type: String; public var title: String; public var summary: String
    public var source: PhoneSource; public var actions: [Action]; public var state: String; public var read: Bool; public var attentionRevision: Int
    public var weeklyInsight: JSONValue?; public var memoryDigest: JSONValue?
}
public struct PhoneActivityPage: Codable, Sendable {
    public var items: [PhoneActivity]; public var nextCursor: String?; public var hasMore: Bool; public var unreadCount: Int; public var actionableCount: Int
    public var timeZone: String; public var snapshotCursor: String?; public var syncCursor: String?
}
public struct PhoneTask: Codable, Identifiable, Sendable {
    public var id: String { taskId }; public var taskId: String; public var source: PhoneSource; public var title: String; public var conversationTitle: String
    public var status: String; public var step: String; public var elapsedSeconds: Double; public var canStop: Bool
    public var createdAt: String?; public var startedAt: String?; public var finishedAt: String?
}
public struct PhoneTaskPage: Codable, Sendable { public var items: [PhoneTask]; public var recent: [PhoneTask]; public var timeZone: String }
public struct PhoneGoal: Codable, Identifiable, Sendable {
    public var id: String; public var revision: Int; public var title: String; public var description: String?; public var phase: String; public var progress: String
    public var conversationTitle: String; public var source: PhoneSource; public var scheduleIds: [String]?
}
public struct PhoneGoalPage: Codable, Sendable { public var items: [PhoneGoal] }
public enum PhoneGoalAction: String, Sendable { case complete, archive }
public struct PhoneLibraryItem: Codable, Identifiable, Sendable {
    public var id: String; public var fileName: String; public var type: String; public var size: Int; public var createdAt: String; public var modifiedAt: String?; public var exists: Bool
    public var projectName: String?; public var source: PhoneSource
}
public struct PhoneLibraryPage: Codable, Sendable {
    public var items: [PhoneLibraryItem]; public var total: Int; public var hasMore: Bool; public var nextCursor: String?; public var revision: String? = nil
    // Host revisions may be numeric. Only paging needs the cursor, so the revision remains opaque.
    enum CodingKeys: String, CodingKey { case items,total,hasMore,nextCursor }
}
public struct PhoneLibraryDetail: Codable, Sendable { public var item: PhoneLibraryItem }
public struct PhoneLibraryPreview: Codable, Sendable {
    public var item: PhoneLibraryItem; public var kind: String; public var text: String?; public var contentType: String?; public var data: String?; public var reason: String?
    public var exportData: Data? {
        if ["markdown","text","code"].contains(kind), let text { return Data(text.utf8) }
        if ["image","pdf"].contains(kind), let data { return Data(base64Encoded:data) }
        return nil
    }
}
public enum PhoneFeaturePolicy {
    public static func supported(_ capabilities: [String:Int], _ key: String) -> Bool { capabilities[key] == 1 }
    public static func needsConfirmation(_ action: ScheduleAction) -> Bool { action == .delete }
    public static func taskStatus(_ status: String) -> String {
        switch status { case "running": "进行中"; case "queued": "排队中"; case "approval": "等你批准"; case "question": "等你回答"; case "completed": "已完成"; case "failed": "没有完成"; case "stopped": "已停止"; case "stopping": "正在停止"; default: "等待核对" }
    }
    public static func goalStatus(_ phase: String) -> String {
        switch phase { case "active": "进行中"; case "paused": "已暂停"; case "blocked": "等待处理"; case "complete": "已完成"; default: "等待核对" }
    }
    public static func fileType(_ type: String) -> String {
        switch type { case "document": "文档"; case "spreadsheet": "表格"; case "image": "图片"; case "code": "代码"; default: "其他" }
    }
    public static func files(_ items: [PhoneLibraryItem], type: String, search: String) -> [PhoneLibraryItem] {
        items.filter { (type.isEmpty || $0.type == type) && (search.isEmpty || $0.fileName.localizedCaseInsensitiveContains(search)) }
    }
    public static func size(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) 字节" }
        if bytes < 1024*1024 { return String(format:"%.1f KB",Double(bytes)/1024) }
        return String(format:"%.1f MB",Double(bytes)/(1024*1024))
    }
    public static func supportedAction(_ kind: String) -> Bool {
        ["open_chat","answer_question","respond_approval","view_library","view_memory","view_settings"].contains(kind)
    }
    public static func failure(_ error: any Error) -> String {
        if case APIFailure.server(409,_) = error { return "内容刚更新，请刷新后再试。" }
        return "电脑暂时连不上，请稍后重试。"
    }
}
extension PersonalClient {
    private func phoneID(_ id: String) throws -> String {
        guard !id.isEmpty, let result=id.addingPercentEncoding(withAllowedCharacters:.alphanumerics.union(CharacterSet(charactersIn:"-._:"))) else { throw APIFailure.invalidResponse }; return result
    }
    private func phoneQuery(_ path: String, _ values: [(String,String?)]) -> String {
        var c=URLComponents(); c.queryItems=values.compactMap { key,value in value.flatMap { $0.isEmpty ? nil : URLQueryItem(name:key,value:$0) } }
        return path + (c.percentEncodedQuery.map { "?"+$0 } ?? "")
    }
    public func phoneActivity(filter: String = "all", cursor: String? = nil) async throws -> PhoneActivityPage {
        try await parityRequest(path:phoneQuery("/activity",[("filter",filter),("limit","50"),("cursor",cursor)]))
    }
    public func phoneMarkRead(_ item: PhoneActivity, requestID: String) async throws {
        let _: JSONValue = try await parityRequest(path:"/activity/" + phoneID(item.id) + "/read",method:"PATCH",body:JSONSerialization.data(withJSONObject:["read":true,"requestId":requestID,"attentionRevision":item.attentionRevision]))
    }
    public func phoneTasks() async throws -> PhoneTaskPage { try await parityRequest(path:"/tasks") }
    public func phoneGoals() async throws -> PhoneGoalPage { try await parityRequest(path:"/goals") }
    public func phoneManageGoal(_ item: PhoneGoal, action: PhoneGoalAction, requestID: String) async throws {
        guard let session=item.source.sessionId else { throw APIFailure.invalidResponse }
        let _: JSONValue = try await parityRequest(path:"/goals/"+phoneID(session)+"/"+action.rawValue,method:"POST",body:JSONSerialization.data(withJSONObject:["requestId":requestID,"ref":["id":item.id,"revision":item.revision]]))
    }
    public func phoneManageSchedule(_ item: ManagedSchedule, action: ScheduleAction, requestID: String) async throws {
        let path=try "/schedules/"+phoneID(item.sessionId)+"/"+phoneID(item.id)
        let _: JSONValue = try await parityRequest(path:path+(action == .delete ? "" : "/"+action.rawValue),method:action == .delete ? "DELETE" : "POST",body:action == .delete ? nil : JSONSerialization.data(withJSONObject:["requestId":requestID]))
    }
    public func phoneLibrary(type: String = "", search: String = "", cursor: String? = nil) async throws -> PhoneLibraryPage {
        try await parityRequest(path:phoneQuery("/library",[("type",type),("search",search),("cursor",cursor),("limit","50")]))
    }
    public func phoneLibraryDetail(_ id: String) async throws -> PhoneLibraryDetail { try await parityRequest(path:"/library/"+phoneID(id)) }
    public func phoneLibraryPreview(_ id: String) async throws -> PhoneLibraryPreview { try await parityRequest(path:"/library/"+phoneID(id)+"/preview") }
}
