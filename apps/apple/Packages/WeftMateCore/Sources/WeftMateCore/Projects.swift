import Foundation

public enum ProjectPermission: String, Codable, CaseIterable, Sendable {
    case readOnly = "read-only", write
    public var title: String { self == .readOnly ? "只读" : "可写" }
}

/// Public projection deliberately contains no host filesystem path.
public struct Project: Codable, Identifiable, Equatable, Sendable {
    public var id: String { projectId }
    public let projectId: String
    public let name: String
    public let instructions: String
    public let permission: ProjectPermission
    public let revision: Int
    public let revoked: Bool
    public let createdAt: String
    public let revokedAt: String?
    enum CodingKeys: String, CodingKey { case projectId, name, instructions, permission, revision, revoked, createdAt, revokedAt }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        projectId = try c.decode(String.self, forKey: .projectId)
        name = try c.decode(String.self, forKey: .name)
        instructions = try c.decodeIfPresent(String.self, forKey: .instructions) ?? ""
        permission = try c.decodeIfPresent(ProjectPermission.self, forKey: .permission) ?? .readOnly
        revision = try c.decode(Int.self, forKey: .revision)
        revoked = try c.decode(Bool.self, forKey: .revoked)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        revokedAt = try c.decodeIfPresent(String.self, forKey: .revokedAt)
        try SharedValidation.require(SharedValidation.id(projectId) && revision > 0)
    }
}
public struct ProjectsReply: Decodable, Sendable { public let projects: [Project]; public let canManage: Bool }
public struct ProjectReply: Decodable, Sendable { public let project: Project }
public struct ProjectRemovalReply: Decodable, Sendable { public let deleted: Bool; public let projectId: String }

public struct ProjectDraft: Sendable {
    public var name = ""
    public var instructions = ""
    public var permission: ProjectPermission = .write
    public var rootPath = ""
    public var requestId = "apple-project-" + UUID().uuidString.lowercased()
    public init(project: Project? = nil) {
        if let project { name = project.name; instructions = project.instructions; permission = project.permission }
    }
    public mutating func selectFolder(_ url: URL) {
        rootPath = url.path
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { name = url.lastPathComponent }
    }
    public var normalizedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping }
    public var valid: Bool { !normalizedName.isEmpty && normalizedName.utf16.count <= 80 && instructions.utf16.count <= 16_000 }
}

public enum ProjectPresentation {
    public static let moveNotice = "从下一回合使用项目文件夹，之前的文件与经验保留在原目录。"
    public static let removalNotice = "只移除项目登记，不删除文件夹里的任何文件。对话保留，并从下一回合使用各自的独立工作目录。"
    public static let restrictedNotice = "这台电脑已有执行账号。当前账号仅可聊天，不能操作电脑或读取原账号资料；请在电脑退出后登录原账号。"
    /// Account management does not identify the machine. Only an embedded host's
    /// trusted identity may enable a local picker; URL/loopback is not proof.
    public static func canChooseLocalFolder(canManage: Bool, hostID: String?, localHostID: String?, platform: ApplePlatform) -> Bool {
        platform == .macOS && canManage && hostID != nil && hostID == localHostID
    }
    public static func taskEnabled(taskAvailable: Bool?, executionAccount: Bool?) -> Bool {
        taskAvailable != false && executionAccount != false
    }
    public static func error(_ error: Error) -> String {
        switch (error as? APIFailure)?.safeCode {
        case "PROJECT_REVISION_CHANGED": "项目已在其他设备更新，请关闭并重新打开设置。"
        case "SESSION_BUSY": "项目对话仍在运行，请结束后再修改项目。"
        case "PROJECT_REVOKED": "项目已移除，请刷新列表。"
        case "MODEL_UNAVAILABLE": "所选模型不可用，请重新选择。"
        case "PROJECT_UNSAFE_PATH", "PROJECT_ROOT_CHANGED": "文件夹不可用，请选择本机已有文件夹。"
        case "PROJECT_WINDOWS_REQUIRED": "请在宿主电脑上创建项目。"
        default: (error as? LocalizedError)?.errorDescription ?? "项目操作未完成，请重试。"
        }
    }
}

extension PersonalClient {
    public func projects() async throws -> ProjectsReply { try await parityRequest(path: "/projects") }
    public func createProject(_ draft: ProjectDraft) async throws -> Project {
        struct Body: Encodable { let requestId: String; let name: String; let rootPath: String; let instructions: String; let permission: ProjectPermission }
        let reply: ProjectReply = try await parityRequest(path: "/projects", method: "POST", body: JSONEncoder().encode(Body(requestId: draft.requestId, name: draft.normalizedName, rootPath: draft.rootPath, instructions: draft.instructions, permission: draft.permission)))
        return reply.project
    }
    public func updateProject(_ project: Project, draft: ProjectDraft) async throws -> Project {
        struct Body: Encodable { let expectedRevision: Int; let name: String; let instructions: String; let permission: ProjectPermission }
        let reply: ProjectReply = try await parityRequest(path: "/projects/\(project.id)", method: "PATCH", body: JSONEncoder().encode(Body(expectedRevision: project.revision, name: draft.normalizedName, instructions: draft.instructions, permission: draft.permission)))
        return reply.project
    }
    public func removeProject(_ project: Project) async throws -> ProjectRemovalReply {
        struct Body: Encodable { let expectedRevision: Int }
        return try await parityRequest(path: "/projects/\(project.id)", method: "DELETE", body: JSONEncoder().encode(Body(expectedRevision: project.revision)))
    }
}
