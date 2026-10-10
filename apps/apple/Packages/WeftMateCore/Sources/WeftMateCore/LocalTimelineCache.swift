import Foundation
import CryptoKit

/// Public projections only. Indexed blocks let offline tail/upward reads avoid decoding the whole history.
public actor LocalTimelineCache {
    public struct CachedPage: Sendable {
        public let page: TimelinePage
        public let cachedAt: Date
    }
    private struct Metadata: Codable {
        let account: LocalAccountScope
        let hostID: String
        let sessionID: String
        let nextSeq: Int
        let cachedAt: Date
    }
    private let directory: URL
    public init(directory: URL) { self.directory = directory }
    private func folder(_ account: LocalAccountScope, _ host: String, _ session: String) -> URL {
        let hash = SHA256.hash(data: Data((account.cacheKey + "|" + host + "|" + session).utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(hash, isDirectory: true)
    }
    public func readPage(account: LocalAccountScope, hostID: String, sessionID: String,
                         beforeSeq: Int? = nil, limit: Int = 100) throws -> CachedPage? {
        _ = try TimelinePage.query(beforeSeq: beforeSeq, afterSeq: nil, limit: limit)
        let location = folder(account, hostID, sessionID), metaFile = location.appendingPathComponent("metadata.json")
        guard FileManager.default.fileExists(atPath: metaFile.path) else { return nil }
        let meta = try JSONDecoder().decode(Metadata.self, from: Data(contentsOf: metaFile))
        guard meta.account == account, meta.hostID == hostID, meta.sessionID == sessionID else { throw APIFailure.identityMismatch }
        let files = try FileManager.default.contentsOfDirectory(at: location, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("block-") && $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
        var selected: [TimelineEvent] = []
        // Read at most the necessary blocks plus one earlier block to determine hasOlder.
        for file in files {
            let name = file.deletingPathExtension().lastPathComponent.dropFirst(6)
            guard let block = Int(name) else { throw APIFailure.invalidResponse }
            if let beforeSeq, block > beforeSeq / 100 { continue }
            let events = try JSONDecoder().decode([TimelineEvent].self, from: Data(contentsOf: file))
            selected.insert(contentsOf: events.filter { event in beforeSeq.map { event.seq < $0 } ?? true }, at: 0)
            if selected.count > limit { break }
        }
        let slice = Array(selected.suffix(limit))
        let page = TimelinePage(events: slice, nextSeq: meta.nextSeq, hasMore: false,
            nextBeforeSeq: slice.first?.seq, hasOlder: selected.count > limit, latestSeq: meta.nextSeq)
        return .init(page: page, cachedAt: meta.cachedAt)
    }
    public func save(account: LocalAccountScope, hostID: String, sessionID: String, window: TimelineWindow) throws {
        let location = folder(account, hostID, sessionID)
        try FileManager.default.createDirectory(at: location, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        for (block, events) in Dictionary(grouping: window.events, by: { $0.seq / 100 }) {
            let file = location.appendingPathComponent(String(format: "block-%016lld.json", Int64(block)))
            let previous = FileManager.default.fileExists(atPath: file.path) ? try Data(contentsOf: file) : nil
            var bySeq = Dictionary(uniqueKeysWithValues: try previous.map { try JSONDecoder().decode([TimelineEvent].self, from: $0) }?.map { ($0.seq, $0) } ?? [])
            for event in events { bySeq[event.seq] = event }
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            let bytes = try encoder.encode(bySeq.values.sorted { $0.seq < $1.seq })
            if bytes != previous { try write(bytes, file: file) }
        }
        let meta = Metadata(account: account, hostID: hostID, sessionID: sessionID, nextSeq: window.nextSeq, cachedAt: Date())
        try write(JSONEncoder().encode(meta), file: location.appendingPathComponent("metadata.json"))
    }
    public func remove(account: LocalAccountScope, hostID: String, sessionID: String) throws {
        let location = folder(account, hostID, sessionID)
        if FileManager.default.fileExists(atPath: location.path) { try FileManager.default.removeItem(at: location) }
    }
    private func write(_ bytes: Data, file: URL) throws {
        try bytes.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}
