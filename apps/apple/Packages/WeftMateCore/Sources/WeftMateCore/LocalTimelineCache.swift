import Foundation
import CryptoKit

/// Account/host/session scoped event cache. It stores only public projections, never raw tool output.
public actor LocalTimelineCache {
    public struct Record: Codable, Sendable {
        public let account: LocalAccountScope
        public let hostID: String
        public let sessionID: String
        public let window: TimelineWindow
        public let cachedAt: Date
    }
    private let directory: URL
    public init(directory: URL) { self.directory = directory }
    private func file(_ account: LocalAccountScope, _ host: String, _ session: String) -> URL {
        let hash = SHA256.hash(data: Data((account.cacheKey + "|" + host + "|" + session).utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(hash + ".json")
    }
    public func read(account: LocalAccountScope, hostID: String, sessionID: String) throws -> Record? {
        let url = file(account, hostID, sessionID)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let record = try JSONDecoder().decode(Record.self, from: Data(contentsOf: url))
        guard record.account == account, record.hostID == hostID, record.sessionID == sessionID else { throw APIFailure.identityMismatch }
        return record
    }
    public func save(account: LocalAccountScope, hostID: String, sessionID: String, window: TimelineWindow) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let record = Record(account: account, hostID: hostID, sessionID: sessionID, window: window, cachedAt: Date())
        let url = file(account, hostID, sessionID)
        try JSONEncoder().encode(record).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
