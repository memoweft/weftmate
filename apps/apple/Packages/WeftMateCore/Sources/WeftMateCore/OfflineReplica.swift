import Foundation

/// Owns the disposable replica and encrypted outbox. Network completions carry an epoch;
/// clear/logout invalidates every in-flight result before it can re-create deleted data.
@MainActor public final class OfflineReplica {
    public private(set) var state: OfflineState
    public private(set) var busy = false
    public private(set) var revision = UUID()
    private let vault: OfflineVault
    private let transport: any HTTPTransport
    private let allowLoopback: Bool
    public var workAndChat = false
    private let phoneFirst: Bool
    private var modelTask: Task<HTTPResponse, any Error>?
    public init(vault: OfflineVault, transport: any HTTPTransport = URLSessionTransport(), allowLoopback: Bool = false, phoneFirst: Bool = false) throws {
        self.vault = vault; self.transport = transport; self.allowLoopback = allowLoopback; self.phoneFirst=phoneFirst
        do { state = try vault.load() } catch { try vault.clear(); state = OfflineState() }
    }
    public func clear() throws {
        suspend(); state = OfflineState()
        try vault.clear()
    }
    public func suspend() { revision=UUID();modelTask?.cancel();modelTask=nil }
    private func eraseDerived(reset: Bool,removedIDs: [String] = []) throws {
        suspend()
        if phoneFirst {
            let retired=(state.retiredPhoneTurnIDs ?? []).union(state.turns.map(\.id)).union(state.synced)
            let previous=state.erasure
            state.retiredPhoneTurnIDs=retired
            state.erasure = .init(hostID:vault.identity.hostId,removedIDs:Array(Set((previous?.removedIDs ?? [])+removedIDs)).sorted(),reset:reset || previous?.reset == true)
        }
        state.turns=[];state.contexts=[:]
        // A memory erasure is not a receipt for an independently queued command.
        // Keep its opaque ciphertext and identity until explicit completion or clear().
        state.phoneHandovers=nil;state.pendingSubmission=nil;state.phoneTurnFragments=nil
        if !phoneFirst { state.synced=[] }
        state.snapshot=nil
        try vault.clear()
        if phoneFirst { try vault.save(state) }
    }
    public func revoke() throws {
        if phoneFirst { try eraseDerived(reset:true) } else { try clear() }
    }
    public func acknowledgeErasure(_ id: String) throws {
        guard state.erasure?.id == id else { return };state.erasure=nil;try vault.save(state)
    }
    private func valid(_ ticket: UUID) throws {
        guard revision == ticket else { throw OfflineFailure.authorization }
        try Task.checkCancellation()
    }
    public func check(control: (String) async throws -> OfflineAuthorization) async throws {
        guard let snapshot = state.snapshot else { throw OfflineFailure.notReady }
        let ticket = revision
        let authorization: OfflineAuthorization
        do { authorization = try await control(vault.identity.hostId) }
        catch {
            try valid(ticket)
            let status: Int?
            if let failure = error as? AppAccountError { status = failure.status }
            else if case APIFailure.server(400, "invalid_grant") = error { status = 401 }
            else if case APIFailure.server(let code, _) = error { status = code }
            else { status = nil }
            if status.map({ [401, 403, 404].contains($0) }) == true || (error as? APIFailure) == .notAuthenticated {
                try revoke(); throw OfflineFailure.authorization
            }
            throw error
        }
        try valid(ticket)
        guard authorization.authorized, authorization.hostId == vault.identity.hostId,
              snapshot.control.hostId == vault.identity.hostId, !snapshot.control.accountId.isEmpty,
              authorization.accountId == snapshot.control.accountId,
              authorization.generation == snapshot.generation, snapshot.control.generation == snapshot.generation else {
            try revoke(); throw OfflineFailure.authorization
        }
    }
    public func excludeUnsubmittedPhoneTurns(_ exclusions: PhoneTranscriptSync) throws {
        let pending=state.turns.filter { !state.synced.contains($0.id) && exclusions.excludes(id:$0.id,text:$0.messages.first?.text ?? "") }
        guard !pending.isEmpty else { return }
        let ids=Set(pending.map(\.id))
        state.turns.removeAll { ids.contains($0.id) }
        if state.pendingSubmission?.turns.contains(where:{ ids.contains($0.id) }) == true ||
           state.pendingSubmission?.turnFragments?.contains(where:{ ids.contains($0.id) }) == true { state.pendingSubmission=nil }
        for id in ids { state.phoneTurnFragments?[id]=nil }
        state.phoneHandovers=state.phoneHandovers?.filter { Set($0.turnIDs).isDisjoint(with:ids) }
        try vault.save(state)
    }
    public func sync(identity: OfflineIdentity,
                     fetch: (OfflineSyncRequest) async throws -> OfflineEnvelope,
                     submit: (OfflineSubmission) async throws -> OfflineReceipts,
                     control: (String) async throws -> OfflineAuthorization) async throws {
        guard !busy else { throw OfflineFailure.busy }; busy = true
        defer { busy = false }
        var ticket = revision
        do {
            var request = OfflineSyncRequest(publicJwk: try vault.publicJwk(), generation: state.snapshot?.generation ?? 0, hashes: state.snapshot?.hashes ?? [:])
            request.phoneFirst=phoneFirst ? true : nil
            request.taskSupport=workAndChat ? 1 : nil
            let envelope=try await fetch(request)
            try valid(ticket)
            let delta = try vault.open(envelope, identity: identity)
            try merge(delta)
            ticket=revision
            try await check(control: control); try valid(ticket)
            try vault.save(state)
            // A model and a nonempty copy are unrelated to the computer's ability to receive originals.
            if phoneFirst && delta.memoryAuthority?.ready != true { return }
            while let submission=try nextSubmission(generation:delta.generation) {
                if let fragment=submission.turnFragments?.first,fragment.index == fragment.count-1 {
                    state.phoneTurnFragments?[fragment.id]?.sentComplete=true
                }
                state.pendingSubmission=submission;try vault.save(state)
                let result = try await submit(submission); try valid(ticket)
                try await check(control: control); try valid(ticket)
                guard result.generation == delta.generation else { try revoke(); throw OfflineFailure.authorization }
                let fragment=submission.turnFragments?.first
                let ids = Set(submission.turns.map(\.id)+(submission.turnFragments ?? []).map(\.id))
                guard result.receipts.allSatisfy({ ids.contains($0.id) && $0.state == "synced" }) else { throw OfflineFailure.invalid }
                let fragmentReceipts=result.fragmentReceipts ?? []
                guard fragmentReceipts.allSatisfy({ receipt in
                    receipt.id == fragment?.id && receipt.index == fragment?.index && receipt.state == "received" &&
                    (receipt.sha256 == nil || receipt.sha256 == fragment?.sha256)
                }) else { throw OfflineFailure.invalid }
                // A replay can complete before its last piece: the desktop may already hold
                // that piece from the lost final reply. First-attempt partials cannot do this.
                if let fragment, !result.receipts.isEmpty,
                   state.phoneTurnFragments?[fragment.id]?.sentComplete != true { throw OfflineFailure.invalid }
                state.synced.formUnion(result.receipts.map(\.id))
                let received=ids.isSubset(of:state.synced)
                var advanced=false
                if let fragment,!received,!fragmentReceipts.isEmpty {
                    // The desktop discards pieces once the whole turn has been stored. If the
                    // last full receipt was lost, replay all pieces after retrying that last one.
                    let final=fragment.index == fragment.count-1
                    state.phoneTurnFragments?[fragment.id]?.nextIndex=final ? 0 : fragment.index+1
                    state.pendingSubmission=nil
                    advanced = !final
                }
                if received {
                    state.pendingSubmission=nil
                    for id in ids { state.phoneTurnFragments?[id]=nil }
                    if let handover=submission.handover {
                        let synced=state.synced
                        state.phoneHandovers?.removeAll { $0.handover.id == handover.id && Set($0.turnIDs).isSubset(of:synced) }
                    }
                }
                try vault.save(state)
                // Partial/no acknowledgement retries the same complete request on the next poll.
                if !received && !advanced { break }
            }
        } catch {
            if revision == ticket {
                if case APIFailure.server(_, let code) = error, code == "OFFLINE_RESET_REQUIRED" { try revoke() }
                if case OfflineFailure.identity = error { try revoke() }
                if case APIFailure.server(let status, _) = error, [401, 403].contains(status) { try revoke() }
            }
            throw error
        }
    }
    private func nextSubmission(generation: Int) throws -> OfflineSubmission? {
        if let frozen=state.pendingSubmission { return frozen }
        let pending=state.turns.filter { !state.synced.contains($0.id) }
        let group=state.phoneHandovers?.first { group in pending.contains { group.turnIDs.contains($0.id) } }
        let eligible=pending.filter { group == nil || group!.turnIDs.contains($0.id) }
        var submission=OfflineSubmission(generation:generation,turns:[],handover:group?.handover)
        for turn in eligible.prefix(50) {
            var candidate=OfflineSubmission(generation:generation,turns:submission.turns+[turn],handover:group?.handover)
            candidate.handover=completedHandover(group,delivering:Set(candidate.turns.map(\.id)))
            let needsFragments=turn.messages.contains { $0.text.utf16.count > 16384 } || state.phoneTurnFragments?[turn.id] != nil
            let exceedsBudget=try candidate.encoded().count > 256*1024
            if needsFragments || exceedsBudget {
                if !submission.turns.isEmpty { break }
                if state.phoneTurnFragments?[turn.id] == nil {
                    if state.phoneTurnFragments == nil { state.phoneTurnFragments=[:] }
                    state.phoneTurnFragments?[turn.id]=try .init(turn:turn,generation:generation)
                }
                let progress=state.phoneTurnFragments![turn.id]!
                guard progress.generation == generation else { throw OfflineFailure.authorization }
                let fragment=progress.fragment
                var packet=OfflineSubmission(generation:generation,turns:[])
                packet.turnFragments=[fragment]
                packet.handover=completedHandover(group,delivering:fragment.index == fragment.count-1 ? [turn.id] : [])
                guard try packet.encoded().count <= 256*1024 else { throw OfflineFailure.invalid }
                return packet
            }
            submission=candidate
        }
        return submission.turns.isEmpty ? nil : submission
    }
    private func completedHandover(_ group: OfflinePhoneHandover?,delivering ids: Set<String>) -> OfflineHandover? {
        guard let group else { return nil }
        var handover=group.handover
        handover.complete=group.turnIDs.count == handover.totalTurns && Set(group.turnIDs).isSubset(of:state.synced.union(ids))
        return handover
    }
    func merge(_ delta: OfflineSnapshot) throws {
        guard delta.generation >= 0, delta.control.hostId == vault.identity.hostId,
              !delta.control.accountId.isEmpty, delta.control.generation == delta.generation,
              delta.memoryAuthority == nil || delta.memoryAuthority?.hostId == vault.identity.hostId, delta.items.count <= 500,
              delta.items.allSatisfy({ $0.currentState == "current" && $0.text.utf16.count <= 2000 }),
              delta.recent.count <= 10, delta.recent.allSatisfy({ $0.messages.count <= 20 && $0.messages.allSatisfy({ ["user", "assistant"].contains($0.role) && $0.text.utf16.count <= 4000 }) }) else { throw OfflineFailure.invalid }
        let reset = delta.reset || (state.snapshot != nil && state.snapshot?.generation != delta.generation)
        var items = Dictionary(uniqueKeysWithValues: (reset ? [] : state.snapshot?.items ?? []).map { ($0.id, $0) })
        if (reset || !delta.remove.isEmpty) && (state.snapshot != nil || !state.turns.isEmpty || state.pendingSubmission != nil) {
            try eraseDerived(reset:reset,removedIDs:delta.remove)
        }
        for id in delta.remove { items[id] = nil }
        for item in delta.items { items[item.id] = item }
        guard Set(items.keys) == Set(delta.hashes.keys), items.count <= 500 else { throw OfflineFailure.invalid }
        var next = delta; next.items = items.values.sorted { $0.id < $1.id }
        guard try JSONEncoder().encode(next).count <= 2 * 1024 * 1024 else { throw OfflineFailure.invalid }
        state.snapshot = next
        try vault.save(state)
    }
    public func retainWorkTask(_ task: OfflineWorkTask) throws {
        guard state.snapshot?.generation == task.generation, task.hostId == vault.identity.hostId else { throw OfflineFailure.identity }
        var tasks=state.workTasks ?? []
        if let prior=tasks.first(where: { $0.id == task.id }) {
            guard prior.envelope.aad == task.envelope.aad && prior.envelope.ciphertext == task.envelope.ciphertext else { throw OfflineFailure.identity }
        } else { tasks.append(task) }
        state.workTasks=tasks; try vault.save(state)
    }
    public func acknowledgeWorkTask(_ receipt: OfflineTaskReceipt) throws {
        guard let index=state.workTasks?.firstIndex(where: { $0.id == receipt.id && $0.hostId == receipt.hostId }) else { throw OfflineFailure.identity }
        if receipt.state == "canceled" || receipt.state == "completed" { state.workTasks?.remove(at:index) }
        else { state.workTasks?[index].state=receipt.state }
        try vault.save(state)
    }
    /// Independent phone messages and any later computer-memory references; never computer tools.
    public func enqueuePhoneTurns(_ turns: [OfflineTurn], generation: Int, handover: OfflineHandover? = nil) throws {
        guard !busy, state.snapshot?.generation == generation else { throw OfflineFailure.notReady }
        let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys]
        guard turns.allSatisfy({ state.retiredPhoneTurnIDs?.contains($0.id) != true }) else { return }
        for turn in turns {
            guard turn.memoryRefs.count <= 64,!turn.messages.isEmpty,turn.messages.first?.role == "user",
                  turn.messages.count <= 2,turn.messages.allSatisfy({ ["user","assistant"].contains($0.role) && !$0.text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty }) else { throw OfflineFailure.invalid }
            if let existing=state.turns.first(where: { $0.id == turn.id }) {
                guard try encoder.encode(existing) == encoder.encode(turn) else { throw OfflineFailure.invalid }
            } else { state.turns.append(turn) }
        }
        if let handover {
            if state.phoneHandovers == nil { state.phoneHandovers=[] }
            if let index=state.phoneHandovers?.firstIndex(where:{ $0.handover.id == handover.id }) {
                guard state.phoneHandovers?[index].handover == handover else { throw OfflineFailure.invalid }
            } else { state.phoneHandovers?.append(.init(handover:handover,turnIDs:turns.map(\.id))) }
        }
        try vault.save(state)
    }
    public func send(_ text: String, conversationID: String, recentID: String? = nil, fallbackModel: PhoneModelConfiguration? = nil,
                     control: (String) async throws -> OfflineAuthorization) async throws {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy else { throw OfflineFailure.busy }
        guard !text.isEmpty, text.utf16.count <= 16384 else { throw OfflineFailure.invalid }
        busy = true; defer { busy = false }; let ticket = revision
        try await check(control: control); try valid(ticket)
        guard let snapshot = state.snapshot else { throw OfflineFailure.notReady }
        let model: PhoneModelConfiguration
        if let configured=snapshot.model { model = .init(id:configured.profileId,name:configured.name,baseURL:configured.baseUrl,model:configured.modelId,apiKey:configured.apiKey) }
        else if let fallbackModel { model=fallbackModel }
        else { throw OfflineFailure.model }
        if let recentID, state.contexts[conversationID] == nil {
            state.contexts[conversationID] = snapshot.recent.first { $0.id == recentID }?.messages ?? []
        }
        let turns = state.turns.filter { $0.conversationId == conversationID }
        let history = Array(((state.contexts[conversationID] ?? []) + turns.flatMap(\.messages)).suffix(20))
        let memories = Self.recall(snapshot.items, query: text)
        let refs = Set(memories.map { OfflineMemoryRef(kind: $0.kind, id: $0.id) } + turns.suffix(20).flatMap(\.memoryRefs))
        let turn = OfflineTurn(id: UUID().uuidString.lowercased(), conversationId: conversationID,
            timestamp: Int64(Date().timeIntervalSince1970 * 1000), messages: [.init(role: "user", text: text)],
            memoryRefs: Array(refs).sorted { $0.kind + $0.id < $1.kind + $1.id }.prefix(64).map { $0 },
            dependencyComplete: (state.contexts[conversationID] ?? []).isEmpty && refs.count <= 64 && turns.suffix(20).allSatisfy(\.dependencyComplete))
        state.turns.append(turn); try vault.save(state)
        let prompt = ComputerMemoryContext.prompt(memories.map { ($0.text,$0.sources.map(\.id)) },computerOffline:true)
        let messages = [["role": "system", "content": prompt]] + history.map { ["role": $0.role, "content": $0.text] } + [["role": "user", "content": text]]
        let request=try model.request(messages:messages,stream:false,allowLoopback:allowLoopback)
        let finalRequest = request, transport = self.transport
        let task = Task { try await transport.send(finalRequest) }; modelTask = task
        defer { modelTask = nil }
        let response: HTTPResponse
        do { response = try await task.value }
        catch { try valid(ticket); try await check(control: control); throw OfflineFailure.model }
        try valid(ticket); try await check(control: control); try valid(ticket)
        guard (200...299).contains(response.status), response.body.count <= 1024 * 1024,
              let json = try JSONSerialization.jsonObject(with: response.body) as? [String: Any],
              let choices = json["choices"] as? [[String: Any]], let message = choices.first?["message"] as? [String: Any],
              (message["tool_calls"] as? [Any] ?? []).isEmpty, message["function_call"] == nil,
              let reply = message["content"] as? String, !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let index = state.turns.firstIndex(where: { $0.id == turn.id }) else { throw OfflineFailure.model }
        state.turns[index].messages.append(.init(role: "assistant", text: reply))
        try vault.save(state)
    }
    public static func recall(_ items: [OfflineMemory], query: String) -> [OfflineMemory] {
        func terms(_ input: String) -> Set<String> {
            let words = input.precomposedStringWithCompatibilityMapping.lowercased().split { !$0.isLetter && !$0.isNumber }
            return Set(words.flatMap { word -> [String] in
                let chars = Array(word)
                if chars.contains(where: { $0.unicodeScalars.contains { (0x3400...0x9fff).contains($0.value) } }) {
                    return chars.count > 1 ? (0..<(chars.count - 1)).map { String(chars[$0...($0 + 1)]) } : []
                }
                return word.count > 1 ? [String(word)] : []
            })
        }
        let queryTerms = terms(query)
        let scored: [(OfflineMemory, Int)] = items.map { item in (item, terms(item.text).intersection(queryTerms).count) }
        let relevant = scored.filter { $0.1 > 0 }
        let ranked = relevant.sorted { left, right in
            if left.1 == right.1 { return left.0.id < right.0.id }
            return left.1 > right.1
        }
        var result: [OfflineMemory] = [], used = 0
        for (item, _) in ranked where result.count < 8 {
            if used + item.text.utf16.count <= 6000 { result.append(item); used += item.text.utf16.count }
        }
        return result
    }
}
