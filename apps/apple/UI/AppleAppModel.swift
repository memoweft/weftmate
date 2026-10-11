import Combine
import Foundation
import WeftMateCore
#if os(iOS)
import UIKit
#endif

struct AppleProjectEditor: Identifiable {
    let id = UUID()
    let project: Project?
    var draft: ProjectDraft
    init(project: Project?) { self.project = project; draft = .init(project: project) }
}

protocol AppleDraftPersisting: Sendable {
    func loadDrafts(account: LocalAccountScope) async throws -> [String: String]
    func saveDraft(account: LocalAccountScope, conversationId: String, text: String) async throws
}

extension AppleAppModel {
    func adoptionRows(for conversation: ConversationSummary) -> [ConversationAdoptionPresentation] {
        guard let id = conversation.conversationId else { return [] }
        return adoptionPresentations.values.filter { $0.record.intent.conversationId == id }
            .sorted { $0.record.createdAt < $1.record.createdAt }
    }

    func canAdopt(_ conversation: ConversationSummary) -> Bool {
        let key = Self.draftKey(for: conversation)
        guard session?.verification == .verified, !verificationPending, endpointStore != nil,
              selectedConversation?.id == conversation.id,
              !authBusy, !preparingAdoptions.contains(key), adoptionProjections[key]?.canAdoptWithConfirmation == true else { return false }
        return !adoptionRows(for: conversation).contains { $0.record.state != .rejected }
    }

    func adoptionNeedsConfirmation(_ conversation: ConversationSummary) -> Bool {
        adoptionProjections[Self.draftKey(for: conversation)]?.requiresLocalTurnConfirmation == true
    }

    func adopt(_ conversation: ConversationSummary, profileID: String, accountEpoch: UUID,
               acknowledgeUncertainLocalTurn: Bool = false) async {
        guard accountEpoch == epoch, canAdopt(conversation), let session, let local = endpointStore,
              let conversationID = conversation.conversationId else { return }
        let key = Self.draftKey(for: conversation)
        guard adoptionChoices[key]?.contains(where: { $0.id == profileID && $0.configured }) == true,
              let projection = adoptionProjections[key] else { return }
        guard !projection.requiresLocalTurnConfirmation || acknowledgeUncertainLocalTurn else { return }
        preparingAdoptions.insert(key)
        defer { if accountEpoch == epoch { preparingAdoptions.remove(key) } }
        do {
            let intent = try SharedAdoptionIntent(session: session, conversationID: conversationID,
                requestID: "apple-adopt-" + UUID().uuidString.lowercased(), modelProfileID: profileID,
                expectedSyncSeq: projection.syncThroughSeq, acknowledgeUncertainLocalTurn: acknowledgeUncertainLocalTurn)
            let record = try await local.persist(intent)
            guard accountEpoch == epoch else { return }
            publishAdoption(record, note: "已保存明确选择的模型和原采用请求。", accountEpoch: accountEpoch)
            await runAdoption(record, allowSubmission: true, conversation: conversation, accountEpoch: accountEpoch)
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            guard accountEpoch == epoch else { return }
            adoptionError = (error as? LocalizedError)?.errorDescription ?? "采用准备未完成，原记录和草稿保留。"
        }
    }

    func reconcileAdoptionRequest(_ requestID: String, accountEpoch: UUID) async {
        guard accountEpoch == epoch, let row = adoptionPresentations[requestID], let conversation = selectedConversation else { return }
        guard adoptionTargetMatches(row.record, conversation: conversation, accountEpoch: accountEpoch) else { return }
        await runAdoption(row.record, allowSubmission: false, conversation: conversation, accountEpoch: accountEpoch)
    }

    func continueAdoptionRequest(_ requestID: String, accountEpoch: UUID) async {
        guard accountEpoch == epoch, let row = adoptionPresentations[requestID], row.lookupNotFound,
              row.record.knownCommandId == nil, row.record.state == .queued || row.record.state == .uncertain,
              let conversation = selectedConversation else { return }
        guard adoptionTargetMatches(row.record, conversation: conversation, accountEpoch: accountEpoch) else { return }
        await runAdoption(row.record, allowSubmission: true, conversation: conversation, accountEpoch: accountEpoch)
    }

    private func runAdoption(_ record: LocalEndpointOperationRecord, allowSubmission: Bool,
                             conversation: ConversationSummary, accountEpoch: UUID) async {
        let id = record.intent.requestId
        guard adoptionTargetMatches(record, conversation: conversation, accountEpoch: accountEpoch),
              adoptionWorkers[id] == nil, let local = endpointStore else { return }
        adoptingRequests.insert(id)
        let worker = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.epoch == accountEpoch { self.adoptionWorkers[id] = nil; self.adoptingRequests.remove(id) }
            }
            do {
                if allowSubmission { try await self.client.declareSharedCapabilities() }
                let result = try await self.client.reconcileAdoption(record.intent, allowSubmission: allowSubmission,
                    knownBindingRevision: record.knownBindingRevision)
                switch result {
                case .notFound:
                    let retryable = record.knownCommandId == nil && (record.state == .queued || record.state == .uncertain)
                    self.publishAdoption(record, note: retryable ? "服务端尚未找到采用请求。可明确继续原请求。"
                        : "本机已有采用回执，服务当前未找到原请求。未重发，请核对原会话。",
                        lookupNotFound: retryable, accountEpoch: accountEpoch)
                case .found(let receipt):
                    let prior = try await local.operation(for: record.intent) ?? record
                    let saved = try await local.recordReceipt(receipt, for: record.intent, expectedRevision: prior.revision)
                    guard self.adoptionTargetMatches(record, conversation: conversation, accountEpoch: accountEpoch) else { return }
                    self.publishAdoption(saved, freshlyVerified: true, accountEpoch: accountEpoch)
                    if receipt.validationLevel == .bindingMatched, receipt.projection.status == .active {
                        guard self.epoch == accountEpoch else { return }
                        self.confirmedModels[Self.draftKey(for: conversation)] = record.intent.modelProfileId
                        await self.refresh()
                        guard self.epoch == accountEpoch else { return }
                        await self.prepareContinuation(conversation, accountEpoch: accountEpoch)
                    } else if receipt.command.state != .rejected {
                        self.observeAdoption(saved, conversation: conversation, accountEpoch: accountEpoch)
                    }
                }
            } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
                var saved = (try? await local.operation(for: record.intent)) ?? record
                if case APIFailure.server(409, let code) = error,
                   ["CONVERSATION_SYNC_CHANGED", "LOCAL_TURN_UNCONFIRMED"].contains(code), saved.knownCommandId == nil {
                    if let updated = try? await local.markRejected(saved.intent, expectedRevision: saved.revision,
                        errorCode: code) { saved = updated }
                    self.publishAdoption(saved, note: code == "LOCAL_TURN_UNCONFIRMED" ? "上一条本地消息是否已送达无法确定，请确认后继续。" : "原上下文已更新，请重新选择模型。",
                                         freshlyVerified: true, accountEpoch: accountEpoch)
                    if self.epoch == accountEpoch { await self.prepareContinuation(conversation, accountEpoch: accountEpoch) }
                    return
                } else if saved.state == .queued || saved.state == .uncertain {
                    if let updated = try? await local.markUncertain(saved.intent, expectedRevision: saved.revision,
                        errorCode: (error as? APIFailure)?.safeCode ?? "ADOPTION_UNCONFIRMED") { saved = updated }
                }
                self.publishAdoption(saved, note: "采用结果未确认。" + self.friendly(error), accountEpoch: accountEpoch)
            }
        }
        adoptionWorkers[id] = worker
        await worker.value
    }

    private func adoptionTargetMatches(_ record: LocalEndpointOperationRecord, conversation: ConversationSummary,
                                       accountEpoch: UUID) -> Bool {
        guard accountEpoch == epoch, let session else { return false }
        return record.intent.conversationId == conversation.conversationId && selectedConversation?.id == conversation.id
            && record.intent.ownerId == session.account.ownerId && record.intent.server == session.server
            && record.intent.hostId == session.hostId
    }

    private func publishAdoption(_ record: LocalEndpointOperationRecord, note: String? = nil,
                                 lookupNotFound: Bool = false, freshlyVerified: Bool = false, accountEpoch: UUID) {
        guard epoch == accountEpoch else { return }
        adoptionPresentations[record.intent.requestId] = .init(record: record, note: note,
            lookupNotFound: lookupNotFound, freshlyVerified: freshlyVerified)
    }

    private func observeAdoption(_ record: LocalEndpointOperationRecord, conversation: ConversationSummary, accountEpoch: UUID) {
        guard epoch == accountEpoch, foreground, selectedConversation?.id == conversation.id else { return }
        let id = record.intent.requestId
        let previous = historyWorkers[id] ?? retiringHistoryWorkers.removeValue(forKey: id)
        previous?.cancel()
        let observation = UUID()
        historyWorkerTokens[id] = observation
        historyWorkers[id] = Task { [weak self] in
            await previous?.value
            guard let self, !Task.isCancelled else { return }
            defer {
                if self.epoch == accountEpoch, self.historyWorkerTokens[id] == observation {
                    self.historyWorkers[id] = nil; self.historyWorkerTokens[id] = nil
                }
            }
            var current = record
            var policy = ConversationPollingPolicy()
            do {
                while self.observationVisible(conversation, accountEpoch: accountEpoch) {
                    guard let local = self.endpointStore else { return }
                    let result = try await self.client.reconcileAdoption(current.intent,
                        knownBindingRevision: current.knownBindingRevision)
                    guard self.epoch == accountEpoch, !Task.isCancelled else { return }
                    guard case .found(let receipt) = result else {
                        self.publishAdoption(current, note: "当前采用状态未找到，未重发。请重新核对。", accountEpoch: accountEpoch)
                        return
                    }
                    let prior = try await local.operation(for: current.intent) ?? current
                    let changed = prior.receipt != receipt
                    current = try await local.recordReceipt(receipt, for: current.intent, expectedRevision: prior.revision)
                    guard self.observationVisible(conversation, accountEpoch: accountEpoch), self.historyWorkerTokens[id] == observation else { return }
                    self.publishAdoption(current, freshlyVerified: true, accountEpoch: accountEpoch)
                    if receipt.command.state == .rejected { return }
                    if receipt.validationLevel == .bindingMatched, receipt.projection.status == .active {
                        self.confirmedModels[Self.draftKey(for: conversation)] = current.intent.modelProfileId
                        await self.refresh()
                        guard self.epoch == accountEpoch else { return }
                        await self.prepareContinuation(conversation, accountEpoch: accountEpoch)
                        return
                    }
                    try await Task.sleep(nanoseconds: policy.delayNanoseconds(madeProgress: changed))
                }
            } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
                guard self.epoch == accountEpoch, !Task.isCancelled else { return }
                self.publishAdoption(current, note: "连接中断，采用核对已暂停；原请求保留。", accountEpoch: accountEpoch)
            }
        }
    }

    func canEditDraft(for conversation: ConversationSummary) -> Bool {
        draftsReady && !authBusy && !draftFlushBusy && !clearingDraftKeys.contains(Self.draftKey(for: conversation))
    }

    func commandRows(for conversation: ConversationSummary) -> [ConversationCommandPresentation] {
        let id = sendTargets[Self.draftKey(for: conversation)]?.sessionID ?? conversation.sessionId
        guard let id else { return [] }
        return commandPresentations.values.filter { $0.record.intent.kind == .message && $0.record.intent.sessionId == id }
            .sorted { $0.record.createdAt < $1.record.createdAt }
    }

    func optimisticRows(for conversation: ConversationSummary) -> [ConversationCommandPresentation] {
        let received = observedUserReceipts.union(timeline.events.filter { $0.type == "user.message" }.compactMap { $0.data["receiptId"]?.string })
        return commandRows(for: conversation).filter { row in
            row.receipt?.receiptId.map { !received.contains($0) } ?? true
        }
    }
    func retryMessage(_ requestID: String, accountEpoch: UUID) async {
        await reconcileSavedRequest(requestID, accountEpoch: accountEpoch)
        await continueSavedRequest(requestID, accountEpoch: accountEpoch)
    }
    func isSupplement(_ receiptID: String, in conversation: ConversationSummary) -> Bool {
        commandRows(for: conversation).contains { $0.receipt?.receiptId == receiptID && $0.receipt?.taskAction == "supplement" }
    }
    func commandStatusRows(for conversation: ConversationSummary) -> [ConversationCommandPresentation] {
        let received = Set(timeline.events.filter { $0.type == "user.message" }.compactMap { $0.data["receiptId"]?.string })
        return commandRows(for: conversation).filter { !$0.ended && !($0.receipt?.taskAction == "supplement" && $0.receipt?.receiptId.map { received.contains($0) } == true) }
    }

    /// Read-only task navigation uses an observed session identity, independently of send/model readiness.
    func taskSessionID(for conversation: ConversationSummary, accountEpoch: UUID) -> String? {
        guard tasksAvailable(conversation), accountEpoch == epoch, let session, let selected = selectedConversation,
              selected.id == conversation.id, selected.conversationId == conversation.conversationId,
              selected.sessionId == conversation.sessionId else { return nil }
        let candidate = knownBoundSessions[Self.draftKey(for: selected)] ?? selected.sessionId
        guard let candidate, taskControlSessions.contains(candidate) else { return nil }
        if let bound = knownBoundSessions[Self.draftKey(for: selected)] { return bound }
        if let cachedHost = cachedConversationHosts[selected.id], cachedHost != session.hostId { return nil }
        return selected.sessionId
    }

    func canSend(_ conversation: ConversationSummary) -> Bool {
        let key = Self.draftKey(for: conversation)
        guard !conversation.archived, canEditDraft(for: conversation), commandStore != nil, session?.verification == .verified,
              selectedConversation?.id == conversation.id,
              !verificationPending, sendTargets[key] != nil, !preparingConversations.contains(key),
              (!(drafts[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !(attachmentDrafts[key] ?? []).isEmpty),
              !loadingAttachments.contains(key) else { return false }
        return !commandRows(for: conversation).contains { $0.record.state == .queued || $0.record.state == .uncertain }
    }

    func confirmBoundModel(for conversation: ConversationSummary, accountEpoch: UUID) async {
        guard accountEpoch == epoch, let model = modelsToConfirm[Self.draftKey(for: conversation)], model.configured else { return }
        confirmedModels[Self.draftKey(for: conversation)] = model.id
        await prepareContinuation(conversation, accountEpoch: accountEpoch)
    }

    private func prepareContinuation(_ conversation: ConversationSummary, accountEpoch: UUID) async {
        guard accountEpoch == epoch else { return }
        let key = Self.draftKey(for: conversation)
        sendTargets[key] = nil
        modelsToConfirm[key] = nil
        adoptionChoices[key] = nil
        adoptionProjections[key] = nil
        continuationNotices[key] = "正在核对原会话和模型…"
        do {
            let sessions = try await client.sharedSessions(includeArchived: true)
            guard accountEpoch == epoch else { return }
            let sessionID: String
            let profileID: String
            var original: SharedOriginalModel?
            if let conversationID = conversation.conversationId {
                let projection = try await client.sharedConversation(conversationID: conversationID)
                guard accountEpoch == epoch else { return }
                guard projection.status == .active, let binding = projection.binding else {
                    if projection.status == .unbound, projection.canAdoptWithConfirmation, projection.syncThroughSeq > 0 {
                        let catalogue = try await client.hostModels()
                        guard accountEpoch == epoch else { return }
                        let choices = catalogue.filter { model in
                            guard model.configured else { return false }
                            guard let original = projection.originalModel else { return true }
                            if original.modelId != model.model { return false }
                            return original.routeFingerprint.map { $0 == model.routeFingerprint } ?? true
                        }
                        adoptionChoices[key] = choices
                        adoptionProjections[key] = projection
                        continuationNotices[key] = projection.originalModel == nil
                            ? "原模型身份缺失。请明确选择本次接续要用的电脑模型。"
                            : "请选择与原模型身份匹配的电脑配置，再接通原会话。"
                        if choices.isEmpty { continuationNotices[key] = "暂无符合原模型身份的已配置模型，请先完成电脑端模型配置。" }
                    } else {
                        continuationNotices[key] = "原会话尚未绑定可续聊的电脑会话；原记录和草稿保留。"
                    }
                    return
                }
                sessionID = binding.sessionId
                profileID = binding.modelProfileId
                original = projection.originalModel
            } else {
                guard let id = conversation.sessionId,
                      let record = sessions.first(where: { $0.sessionId == id }), let profile = record.modelProfileId else {
                    continuationNotices[key] = "原会话缺少模型身份，请先在电脑端补充配置。"
                    return
                }
                sessionID = id; profileID = profile
            }
            taskControlSessions = try await client.taskControlSessionIDs(includeArchived: true)
            guard accountEpoch == epoch else { return }
            knownBoundSessions[key] = sessionID
            adoptionChoices[key] = nil
            adoptionProjections[key] = nil
            guard let record = sessions.first(where: { $0.sessionId == sessionID }), record.sendAvailable,
                  record.unavailable != true, record.modelProfileId == profileID else {
                continuationNotices[key] = "当前电脑会话暂不能接收消息。草稿保留在本机。"
                return
            }
            let catalogue = try await client.hostModels()
            guard accountEpoch == epoch else { return }
            guard let model = catalogue.first(where: { $0.id == profileID }), model.configured else {
                continuationNotices[key] = "原会话模型尚未配置，请先在电脑端完成该模型配置。"
                return
            }
            if conversation.conversationId != nil {
                if let original, original.modelId != model.model ||
                    (original.routeFingerprint != nil && original.routeFingerprint != model.routeFingerprint) {
                    continuationNotices[key] = "当前绑定模型和原对话身份不同，请先在电脑端核对。"
                    return
                }
                let matches = original.map {
                    if let hostProfile = $0.hostProfileId, hostProfile != profileID { return false }
                    guard let fingerprint = $0.routeFingerprint else { return false }
                    return fingerprint == model.routeFingerprint && $0.modelId == model.model
                } ?? false
                if !matches, confirmedModels[key] != profileID {
                    modelsToConfirm[key] = model
                    continuationNotices[key] = "原模型身份未能完整匹配。请明确确认使用这段会话已绑定的模型。"
                    return
                }
            }
            sendTargets[key] = .init(sessionID: sessionID, modelProfileID: profileID,
                                    modelName: model.name)
            continuationNotices[key] = nil
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            guard accountEpoch == epoch else { return }
            continuationNotices[key] = friendly(error)
        }
    }

    func canAddAttachments(_ conversation: ConversationSummary) -> Bool {
        let key = Self.draftKey(for: conversation)
        return canEditDraft(for: conversation) && selectedConversation?.id == conversation.id &&
            sendTargets[key] != nil && !preparingConversations.contains(key) && !loadingAttachments.contains(key) &&
            (attachmentDrafts[key]?.count ?? 0) < 4
    }
    func addAttachments(_ files: [URL], to conversation: ConversationSummary, accountEpoch: UUID) async {
        guard accountEpoch == epoch, canAddAttachments(conversation) else { return }
        let key = Self.draftKey(for: conversation)
        guard (attachmentDrafts[key]?.count ?? 0) + files.count <= 4 else {
            continuationNotices[key] = "每条消息最多添加 4 个附件。"; return
        }
        loadingAttachments.insert(key)
        defer { if accountEpoch == epoch { loadingAttachments.remove(key) } }
        do {
            let prepared = try await Task.detached { @Sendable () throws -> [ConversationAttachmentDraft] in
                var drafts: [ConversationAttachmentDraft] = []
                do { for file in files { drafts.append(try .prepare(file: file)) }; return drafts }
                catch { drafts.forEach { $0.removeTemporaryFiles() }; throw error }
            }.value
            guard accountEpoch == epoch, selectedConversation?.id == conversation.id else { prepared.forEach { $0.removeTemporaryFiles() }; return }
            attachmentDrafts[key, default: []].append(contentsOf: prepared)
            attachmentAttempts[key] = nil; continuationNotices[key] = nil
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            guard accountEpoch == epoch else { return }
            continuationNotices[key] = (error as? LocalizedError)?.errorDescription ?? "文件未添加，请重新选择。"
        }
    }
    func removeAttachment(_ id: String, from conversation: ConversationSummary, accountEpoch: UUID) {
        guard accountEpoch == epoch, !preparingConversations.contains(Self.draftKey(for: conversation)) else { return }
        let key = Self.draftKey(for: conversation)
        attachmentDrafts[key]?.first { $0.id == id }?.removeTemporaryFiles()
        attachmentDrafts[key]?.removeAll { $0.id == id }; attachmentAttempts[key] = nil
        if attachmentDrafts[key]?.isEmpty == true { attachmentMessageIDs[key] = nil; attachmentSessionIDs[key] = nil }
    }

    func send(_ conversation: ConversationSummary, accountEpoch: UUID, intent explicitIntent: MessageIntent? = nil) async {
        guard accountEpoch == epoch, canSend(conversation), let accountSession = session,
              let local = commandStore, let target = sendTargets[Self.draftKey(for: conversation)] else { return }
        let intent = explicitIntent ?? runningMessageMode.intent(running: conversation.running)
        let key = Self.draftKey(for: conversation)
        let text = drafts[key] ?? ""
        guard text.utf16.count <= 8_192 else {
            continuationNotices[key] = "消息太长，请缩短后发送。"
            return
        }
        preparingConversations.insert(key)
        preparingMessages[key] = ChatMessage(id: "sending-" + UUID().uuidString, role: .user, text: text,
            occurredAt: nil, sourceDeviceId: nil, attachmentCount: attachmentDrafts[key]?.count ?? 0, truncated: false, pendingContext: false)
        defer { if accountEpoch == epoch { preparingConversations.remove(key); preparingMessages[key] = nil } }
        do {
            guard await flushDrafts(), accountEpoch == epoch else { return }
            var selectedFiles = attachmentDrafts[key] ?? []
            if !selectedFiles.isEmpty {
                if let previousSession = attachmentSessionIDs[key], previousSession != target.sessionID {
                    selectedFiles = try selectedFiles.map { file in
                        .init(original: try OriginalAttachment(attachmentID: "attachment-" + UUID().uuidString.lowercased(),
                            name: file.original.name, contentType: file.original.contentType, size: file.original.size, sha256: file.original.sha256),
                            file: file.file, display: file.display)
                    }
                    attachmentDrafts[key] = selectedFiles; attachmentAttempts[key] = nil; attachmentMessageIDs[key] = nil
                }
                attachmentSessionIDs[key] = target.sessionID
                if attachmentMessageIDs[key] == nil { attachmentMessageIDs[key] = UUID().uuidString.lowercased() }
            }
            var payload: SharedCommandPayload
            if selectedFiles.isEmpty {
                payload = try SharedCommandPayload(requestId: "apple-" + UUID().uuidString.lowercased(), kind: .message,
                    targetDeviceId: accountSession.hostId, sessionId: target.sessionID, text: text, intent: intent)
            } else {
                let attempt: ConversationAttachmentAttempt
                if let prior = attachmentAttempts[key], prior.drafts == selectedFiles, prior.payload.text == text,
                   prior.payload.sessionId == target.sessionID, prior.payload.intent == intent { attempt = prior }
                else {
                    var staged: [StagedConversationAttachment] = [], textBytes = 0, bytes = 0
                    for file in selectedFiles {
                        if let item = try file.stage(remainingTextBytes: AttachmentLimits.textBytes - textBytes,
                                                     remainingBytes: AttachmentLimits.messageBytes - bytes) {
                            staged.append(item); bytes += item.metadata.size
                            if AttachmentLimits.textTypes.contains(item.metadata.contentType) { textBytes += item.metadata.size }
                        }
                    }
                    let messageID = attachmentMessageIDs[key]!
                    let body = try SharedCommandPayload(requestId: "apple-" + UUID().uuidString.lowercased(), kind: .message,
                        targetDeviceId: accountSession.hostId, sessionId: target.sessionID, text: text,
                        attachments: staged.isEmpty ? nil : staged.map(\.metadata),
                        originalAttachments: selectedFiles.map(\.original), attachmentMessageId: messageID, intent: intent)
                    _ = try body.encoded() // Byte check before any upload or command request.
                    attempt = .init(requestID: body.requestId, messageID: messageID, drafts: selectedFiles, staged: staged, payload: body)
                    attachmentAttempts[key] = attempt
                }
                continuationNotices[key] = "正在上传附件…"
                // The existing desktop contract scopes originals to the host session ID.
                for file in attempt.drafts {
                    try await client.uploadOriginalAttachment(file.original, file: file.file,
                        conversationID: target.sessionID, messageID: attempt.messageID)
                    guard accountEpoch == epoch else { return }
                    if let display = file.display, file.original.isImage {
                        try await client.uploadAttachmentDisplay(file.original, file: display,
                            conversationID: target.sessionID, messageID: attempt.messageID)
                        guard accountEpoch == epoch else { return }
                    }
                }
                for item in attempt.staged {
                    try await client.uploadSessionAttachment(item.metadata, file: item.file,
                        sessionID: target.sessionID, requestID: attempt.requestID)
                    guard accountEpoch == epoch else { return }
                }
                payload = attempt.payload
            }
            let intent = try SharedCommandIntent(session: accountSession, command: payload)
            let record = try await local.persist(intent)
            guard accountEpoch == epoch else { return }
            if !selectedFiles.isEmpty {
                attachmentDrafts[key] = nil; attachmentAttempts[key] = nil
                attachmentMessageIDs[key] = nil; attachmentSessionIDs[key] = nil
                selectedFiles.forEach { $0.removeTemporaryFiles() }
            }
            publish(record, note: "已保存原请求，正在核对服务端。", accountEpoch: accountEpoch)
            preparingMessages[key] = nil
            await runCommand(record, allowSubmission: true, conversation: conversation, accountEpoch: accountEpoch)
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            guard accountEpoch == epoch else { return }
            continuationNotices[key] = (error as? LocalizedError)?.errorDescription ?? "发送准备未完成，草稿保留。"
        }
    }

    func reconcileSavedRequest(_ requestID: String, accountEpoch: UUID) async {
        guard accountEpoch == epoch, let row = commandPresentations[requestID] else { return }
        await runCommand(row.record, allowSubmission: false, conversation: selectedConversation, accountEpoch: accountEpoch)
    }

    func continueSavedRequest(_ requestID: String, accountEpoch: UUID) async {
        guard accountEpoch == epoch, let row = commandPresentations[requestID], row.lookupNotFound,
              row.record.state == .queued || row.record.state == .uncertain,
              row.receipt?.state.isAccepted != true,
              let conversation = selectedConversation,
              sendTargets[Self.draftKey(for: conversation)]?.sessionID == row.record.intent.sessionId else { return }
        await runCommand(row.record, allowSubmission: true, conversation: conversation, accountEpoch: accountEpoch)
    }

    private func runCommand(_ record: LocalCommandRecord, allowSubmission: Bool,
                            conversation: ConversationSummary?, accountEpoch: UUID) async {
        let id = record.intent.requestId
        guard commandTargetMatches(record, conversation: conversation, accountEpoch: accountEpoch),
              commandWorkers[id] == nil, let local = commandStore else { return }
        reconcilingRequests.insert(id)
        let worker = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.epoch == accountEpoch {
                    self.commandWorkers[id] = nil
                    self.reconcilingRequests.remove(id)
                }
            }
            do {
                if allowSubmission { try await self.client.declareSharedCapabilities() }
                let result = try await self.client.reconcileCommand(record.intent, allowSubmission: allowSubmission)
                switch result {
                case .notFound:
                    let retryable = (record.state == .queued || record.state == .uncertain) && record.receipt?.state.isAccepted != true
                    self.publish(record, note: retryable ? "服务端尚未找到此请求。继续发送会复用原身份和内容。"
                        : "本机已有原回执，服务端当前未找到请求。请核对原会话，未重发。",
                                 lookupNotFound: retryable, accountEpoch: accountEpoch)
                case .found(let receipt):
                    let prior = try await local.command(for: record.intent) ?? record
                    let saved = try await local.recordReceipt(receipt, for: record.intent, expectedRevision: prior.revision)
                    guard self.commandTargetMatches(record, conversation: conversation, accountEpoch: accountEpoch) else { return }
                    self.publish(saved, accountEpoch: accountEpoch)
                    if let conversation, receipt.state != .rejected {
                        if receipt.state.isAccepted {
                            await self.clearSubmittedDraft(intent: record.intent, conversation: conversation, accountEpoch: accountEpoch)
                        }
                        self.observeTurn(saved, receipt: receipt, conversation: conversation, accountEpoch: accountEpoch)
                    }
                }
            } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
                // The SDK deliberately does not expose a guessed submission stage. A lost reply remains uncertain.
                var saved = (try? await local.command(for: record.intent)) ?? record
                if saved.state == .queued || saved.state == .uncertain {
                    let code = (error as? APIFailure)?.safeCode ?? "REQUEST_UNCONFIRMED"
                    if let updated = try? await local.transition(saved.intent, expectedRevision: saved.revision, to: .uncertain, errorCode: code) {
                        saved = updated
                    }
                }
                self.publish(saved, note: "当前结果未确认，请核对原请求。" + self.friendly(error), accountEpoch: accountEpoch)
            }
        }
        commandWorkers[id] = worker
        await worker.value
    }

    private func commandTargetMatches(_ record: LocalCommandRecord, conversation: ConversationSummary?,
                                      accountEpoch: UUID) -> Bool {
        guard accountEpoch == epoch, let session, let conversation, selectedConversation?.id == conversation.id else { return false }
        let target = sendTargets[Self.draftKey(for: conversation)]?.sessionID
            ?? knownBoundSessions[Self.draftKey(for: conversation)] ?? conversation.sessionId
        return record.intent.kind == .message && record.intent.sessionId == target
            && record.intent.ownerId == session.account.ownerId && record.intent.server == session.server
            && record.intent.hostId == session.hostId
    }

    private func publish(_ record: LocalCommandRecord, note: String? = nil, lookupNotFound: Bool = false,
                         accountEpoch: UUID) {
        guard accountEpoch == epoch else { return }
        commandPresentations[record.intent.requestId] = .init(record: record, receipt: record.receipt,
            progress: nil, note: note, lookupNotFound: lookupNotFound)
    }

    private func clearSubmittedDraft(intent: SharedCommandIntent, conversation: ConversationSummary,
                                     accountEpoch: UUID) async {
        guard accountEpoch == epoch, let text = intent.text, let local = commandStore, let account = draftAccount else { return }
        let key = Self.draftKey(for: conversation)
        guard drafts[key] == text else { return }
        clearingDraftKeys.insert(key)
        defer { if accountEpoch == epoch { clearingDraftKeys.remove(key) } }
        if let worker = draftWorkers[key] { await worker.value }
        guard accountEpoch == epoch, drafts[key] == text else { return }
        do {
            let cleared = try await local.clearDraft(account: account, conversationId: key, ifMatchingText: text)
            guard accountEpoch == epoch, cleared, drafts[key] == text else { return }
            drafts[key] = nil; pendingDrafts[key] = nil; draftRevisions[key] = UUID(); draftSaveStates[key] = nil
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            guard accountEpoch == epoch else { return }
            draftError = "请求已受理，但本机草稿清理未完成。原请求和草稿均保留。"
        }
    }

    private func observeTurn(_ record: LocalCommandRecord, receipt: SharedCommandReceipt,
                             conversation: ConversationSummary, accountEpoch: UUID) {
        guard accountEpoch == epoch, foreground, selectedConversation?.id == conversation.id,
              let sessionID = record.intent.sessionId else { return }
        let id = record.intent.requestId
        let previous = historyWorkers[id] ?? retiringHistoryWorkers.removeValue(forKey: id)
        previous?.cancel()
        let observation = UUID()
        historyWorkerTokens[id] = observation
        historyWorkers[id] = Task { [weak self] in
            await previous?.value
            guard let self, !Task.isCancelled else { return }
            defer {
                if self.epoch == accountEpoch, self.historyWorkerTokens[id] == observation {
                    self.historyWorkers[id] = nil
                    self.historyWorkerTokens[id] = nil
                }
            }
            do {
                var currentRecord = record
                var currentReceipt = receipt
                var policy = ConversationPollingPolicy()
                if !currentReceipt.state.isAccepted {
                    while !currentReceipt.state.isAccepted {
                        try Task.checkCancellation()
                        guard self.observationVisible(conversation, accountEpoch: accountEpoch), let local = self.commandStore else { return }
                        let result = try await self.client.reconcileCommand(record.intent)
                        guard self.epoch == accountEpoch, !Task.isCancelled else { return }
                        guard case .found(let observed) = result else {
                            self.publish(currentRecord, note: "原请求当前未找到，未自动重发。请核对。", lookupNotFound: true,
                                         accountEpoch: accountEpoch)
                            return
                        }
                        let prior = try await local.command(for: record.intent) ?? currentRecord
                        currentRecord = try await local.recordReceipt(observed, for: record.intent, expectedRevision: prior.revision)
                        let changed = currentReceipt != observed
                        currentReceipt = observed
                        self.publish(currentRecord, accountEpoch: accountEpoch)
                        if observed.state == .rejected { return }
                        if observed.state.isAccepted {
                            await self.clearSubmittedDraft(intent: record.intent, conversation: conversation, accountEpoch: accountEpoch)
                            break
                        }
                        try await Task.sleep(nanoseconds: policy.delayNanoseconds(madeProgress: changed))
                    }
                }
                let tail = try await self.client.timelinePage(sessionID: sessionID)
                let seedAfter = (tail.events.first?.seq ?? (tail.nextSeq + 1)) - 1
                var tracker = try SharedTurnTracker(sessionID: sessionID, afterSeq: seedAfter)
                let seed = try SharedHistoryPage.decode(JSONEncoder().encode(tail), sessionID: sessionID, afterSeq: seedAfter)
                try tracker.apply(seed)
                let seedMessages = try await self.client.timelineMessages(tail.events, sessionID: sessionID)
                let seedIDs = await self.client.cachedTimelineMessageIDs(sessionID: sessionID)
                guard self.observationVisible(conversation, accountEpoch: accountEpoch), !Task.isCancelled else { return }
                self.timeline.apply(tail)
                self.timelineMessageIDs = seedIDs
                for message in seedMessages {
                    if let index = self.messages.firstIndex(where: { $0.id == message.id }) { self.messages[index] = message }
                    else { self.messages.append(message) }
                }
                while self.observationVisible(conversation, accountEpoch: accountEpoch) {
                    try Task.checkCancellation()
                    let page = try await self.client.sharedHistory(sessionID: sessionID, afterSeq: tracker.nextSeq)

                    try tracker.apply(page)
                    guard self.epoch == accountEpoch, !Task.isCancelled else { return }
                    self.observedUserReceipts.formUnion((seed.events + page.events).filter { $0.type == "user.message" }.compactMap { $0.data.receiptId })
                    let progress = tracker.progress(for: currentReceipt)
                    self.commandPresentations[id] = .init(record: currentRecord, receipt: currentReceipt, progress: progress,
                        note: nil, lookupNotFound: false)
                    // Bound sync transcripts are merged by the paged timeline, not a second host-only alias.
                    if self.selectedConversation?.id == conversation.id, conversation.conversationId == nil {
                        let known = Set(self.messages.map(\.id))
                        self.messages.append(contentsOf: tracker.messages.filter { !known.contains($0.id) })
                        self.historyCachedAt = nil
                        if self.historyCacheAllowed, page.cacheAllowed != false, conversation.temporaryState.cacheAllowed,
                           self.liveConversations[conversation.id]?.temporaryState.cacheAllowed != false,
                           !page.events.isEmpty, let local = self.commandStore, let account = self.draftAccount {
                            let snapshot = self.messages
                            do {
                                _ = try await local.cacheHistory(account: account,
                                    conversationKey: Self.draftKey(for: conversation), hostId: record.intent.hostId,
                                    sessionId: sessionID, messages: snapshot, observedThroughSeq: tracker.nextSeq)
                            } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
                                if self.epoch == accountEpoch { self.cacheError = "当前记录已读取，但本机历史缓存尚未更新。" }
                            }
                        }
                    }
                    if [.completed, .aborted, .failed, .blocked].contains(progress) { return }
                    if !page.hasMore {
                        try await Task.sleep(nanoseconds: policy.delayNanoseconds(madeProgress: !page.events.isEmpty))
                    }
                }
            } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
                guard self.epoch == accountEpoch, !Task.isCancelled else { return }
                let prior = self.commandPresentations[id]
                self.commandPresentations[id] = .init(record: prior?.record ?? record, receipt: prior?.receipt ?? receipt,
                    progress: prior?.progress, note: "连接中断，自动核对已暂停。回合结束尚未确认，请重新核对。" + self.friendly(error),
                    lookupNotFound: false, observationPaused: true)
            }
        }
    }
    private func retireHistoryObservers() {
        for (id, worker) in historyWorkers {
            worker.cancel()
            retiringHistoryWorkers[id] = worker
        }
        historyWorkers = [:]
        historyWorkerTokens = [:]
    }

    private func observationVisible(_ conversation: ConversationSummary, accountEpoch: UUID) -> Bool {
        ConversationPollingPolicy.remainsVisible(ownerMatches: epoch == accountEpoch,
            selectedMatches: selectedConversation?.id == conversation.id, foreground: foreground, cancelled: Task.isCancelled)
    }

    func setForeground(_ active: Bool) {
        foreground = active
        if active {
            guard let conversation = selectedConversation else { return }
            for row in commandRows(for: conversation) where !row.ended {
                if let receipt = row.receipt, historyWorkers[row.id] == nil {
                    observeTurn(row.record, receipt: receipt, conversation: conversation, accountEpoch: epoch)
                }
            }
            for row in adoptionRows(for: conversation) {
                if let receipt = row.record.receipt, receipt.command.state != .rejected,
                   receipt.projection.status != .active, historyWorkers[row.id] == nil {
                    observeAdoption(row.record, conversation: conversation, accountEpoch: epoch)
                }
            }
        } else {
            retireHistoryObservers()
            for (id, row) in commandPresentations where !row.ended {
                commandPresentations[id] = .init(record: row.record, receipt: row.receipt, progress: row.progress,
                    note: "窗口已切到后台；再次打开原会话时会重新核对。", lookupNotFound: row.lookupNotFound,
                    observationPaused: true)
            }
            for (id, row) in adoptionPresentations {
                adoptionPresentations[id] = .init(record: row.record, note: "窗口已转到后台，原采用请求保留；返回后重新核对。",
                    lookupNotFound: row.lookupNotFound, freshlyVerified: false)
            }
        }
    }

}

private struct LocalAppleDraftPersistence: AppleDraftPersisting {
    let store: LocalConversationStore
    func loadDrafts(account: LocalAccountScope) async throws -> [String: String] {
        try await store.loadDrafts(account: account)
    }
    func saveDraft(account: LocalAccountScope, conversationId: String, text: String) async throws {
        _ = try await store.saveDraft(account: account, conversationId: conversationId, text: text)
    }
}

/// Keeps every visible record and draft within one authenticated account epoch.
@MainActor
final class AppleAppModel: ObservableObject {
    #if DEBUG
    func scanOfflineTestStorage(needles: [String]) throws -> Data {
        guard A14TestSupport.driver != nil, let directory = timelineStateDirectory else { throw OfflineFailure.invalid }
        var files = 0, bytes = 0, hits = 0
        for case let file as URL in FileManager.default.enumerator(at: directory, includingPropertiesForKeys: [.isRegularFileKey])! {
            guard (try file.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true else { continue }
            let data = try Data(contentsOf: file); files += 1; bytes += data.count
            for needle in needles {
                for encoding in [String.Encoding.utf8, .utf16LittleEndian, .utf16BigEndian] {
                    if let marker = needle.data(using: encoding), data.range(of: marker) != nil { hits += 1 }
                }
            }
        }
        return try JSONSerialization.data(withJSONObject: ["files": files, "bytes": bytes, "plaintextOrKeyHits": hits])
    }
    #endif
    let offline = OfflineChatModel()
    func offlineAuthorization(_ hostID: String) async throws -> OfflineAuthorization {
        #if DEBUG
        if A14TestSupport.driver != nil { return try JSONDecoder().decode(OfflineAuthorization.self, from: await A14TestSupport.get("control")) }
        #endif
        return try await cloudLogin.offlineAuthorization(hostID: hostID)
    }
    func pollOffline() async {
        guard let session, let directory = timelineStateDirectory else { return }
        await offline.poll(session: session, client: client, directory: directory.appendingPathComponent("Offline"),
            store: KeychainCredentialStore(service: cloudNamespace + ".offline"),
            allowLoopback: permitsSyntheticLoopback, control: offlineAuthorization)
        #if os(iOS)
        if offline.hostOffline { _ = await watchSnapshotBytes() }
        #endif
    }
    private var cloudNamespace = "com.weftmate.apple.cloud"
    lazy var mainChat = MainChatModel(app: self)
    lazy var cloudLogin = CloudLoginModel(app: self, namespace: cloudNamespace)
    @Published var timelineRootCommands: [TaskRootCommandMetadata] = []
    @Published var stoppingActiveTask = false
    func stopActiveTask() async {
        guard !stoppingActiveTask, historyCachedAt == nil, let conversation = selectedConversation, tasksAvailable(conversation),
              let id = conversation.sessionId,
              let started = timeline.events.last(where: { $0.type == "task.started" }) ?? timeline.events.last(where: { $0.type == "user.message" }),
              let receipt = started.data["receiptId"]?.string,
              let command = timelineRootCommands.first(where: { $0.receiptId == receipt }) else { return }
        let actionEpoch = epoch
        stoppingActiveTask = true
        defer { if actionEpoch == epoch { stoppingActiveTask = false } }
        let control = TaskWorkspaceModel(client: client, taskId: command.commandId, expectedHostId: command.targetDeviceId,
            expectedSessionId: id, expectedRequestId: command.requestId, accountEpoch: epoch, stateDirectory: assistantStateDirectory,
            currentEpoch: { [weak self] in self?.accountEpoch ?? UUID() }, currentSession: { [weak self] in self?.session })
        await control.refresh()
        if control.snapshot?.control.canStop == true { await control.requestStop() }
        guard actionEpoch == epoch else { return }
        queueNotice = control.stopError ?? control.error
    }
    @Published var projects: [Project] = []
    @Published var projectCanManage = false
    @Published var projectsError: String?
    @Published var expandedProjectRows = Set<String>()
    @Published var hoveredSession: ConversationSummary?
    @Published var archiveUndo: ConversationSummary?
    private var archiveUndoToken = UUID()
    @Published var projectThinking = false
    @Published private(set) var projectCreatedSessionID: String?
    @Published var sourceMessageTarget: Int?
    @Published var subtaskStepTarget: Int?
    @Published var thinking = ThinkingState()
    @Published var thinkingError: String?
    private var thinkingConversation: String?
    var uxScope: AppleUXScope { .init(epoch: epoch, host: session?.hostId ?? "", device: session?.device.id ?? "", conversation: selectedConversation?.id) }
    var projectPreferenceAccount: String { (session?.account.ownerId ?? "") }
    func projectExpanded(_ id: String) -> Bool {
        expandedProjectRows.contains(id) || defaults.map { ProjectRecentRows.expanded(account: projectPreferenceAccount, project: id, defaults: $0) } == true
    }
    func toggleProjectRows(_ id: String, query: String) {
        guard query.isEmpty else { return }
        let value = !projectExpanded(id)
        if value { expandedProjectRows.insert(id) } else { expandedProjectRows.remove(id) }
        if let defaults { ProjectRecentRows.save(value, account: projectPreferenceAccount, project: id, defaults: defaults) }
    }
    func allProjectRows(_ project: Project, query: String = "") -> [ConversationSummary] {
        ProjectRecentRows.sorted(conversations.filter { !$0.archived && $0.projectId == project.id && (query.isEmpty || project.name.localizedCaseInsensitiveContains(query) || $0.title.localizedCaseInsensitiveContains(query)) })
    }
    func refreshThinking(_ row: ConversationSummary, enabled: Bool? = nil) async {
        guard selectedConversation?.id == row.id, let id = sendTargets[Self.draftKey(for: row)]?.sessionID ?? row.sessionId, !row.archived else { return }
        let scope = uxScope
        if thinkingConversation != row.id { thinking = .init(); thinkingConversation = row.id }
        let token = thinking.begin(scope: scope); thinkingError = nil
        do {
            let catalogue = try await client.hostModels()
            guard scope == uxScope else { return }
            let profile = sendTargets[Self.draftKey(for: row)]?.modelProfileID
            guard catalogue.first(where: { $0.id == profile })?.deepThinking?.supported == true else {
                _ = thinking.accept(.init(supported: false, enabled: false), token: token, scope: scope, current: uxScope); return
            }
            let value = try await client.sessionThinking(sessionID: id, enabled: enabled)
            _ = thinking.accept(value, token: token, scope: scope, current: uxScope)
        } catch { if scope == uxScope { thinking.fail(token: token); thinkingError = "深入思考状态未确认，请重试。" } }
    }
    @Published var collapsedProjects = Set<String>()
    @Published var projectEditor: AppleProjectEditor?
    @Published var projectConversation: Project?
    @Published var projectModelID = ""
    @Published var projectModels: [SharedHostModel] = []
    @Published var projectBusy = false
    @Published var projectError: String?
    @Published var executionAccount: Bool?
    @Published var sessionProjectNotices: [String: String] = [:]
    // Populated by an embedded local host, never by an arbitrary server URL.
    private(set) var localHostID: String?
    var canChooseProjectFolder: Bool {
        ProjectPresentation.canChooseLocalFolder(canManage: projectCanManage, hostID: session?.hostId, localHostID: localHostID, platform: .current)
    }
    func tasksAvailable(_ row: ConversationSummary) -> Bool {
        ProjectPresentation.taskEnabled(taskAvailable: liveConversations[row.id]?.taskAvailable ?? row.taskAvailable, executionAccount: executionAccount)
    }
    func projectRows(_ project: Project, query: String = "") -> [ConversationSummary] {
        let rows = allProjectRows(project, query: query)
        return !query.isEmpty || projectExpanded(project.id) ? rows : Array(rows.prefix(5))
    }
    func beginProject(_ project: Project? = nil) {
        guard canChooseProjectFolder else { return }
        projectError = nil; projectEditor = .init(project: project)
    }
    func saveProject() async {
        guard !projectBusy, canChooseProjectFolder, let editor = projectEditor, editor.draft.valid,
              editor.project != nil || !editor.draft.rootPath.isEmpty else { return }
        let token = epoch; projectBusy = true; projectError = nil
        defer { if token == epoch { projectBusy = false } }
        do {
            if let project = editor.project { _ = try await client.updateProject(project, draft: editor.draft) }
            else { _ = try await client.createProject(editor.draft) }
            guard token == epoch else { return }
            projectEditor = nil; await refresh()
        } catch { if token == epoch { projectError = ProjectPresentation.error(error); await refresh() } }
    }
    func removeProject() async {
        guard !projectBusy, canChooseProjectFolder, let project = projectEditor?.project else { return }
        let token = epoch; projectBusy = true; projectError = nil
        defer { if token == epoch { projectBusy = false } }
        do {
            let reply = try await client.removeProject(project)
            guard token == epoch else { return }
            guard reply.deleted, reply.projectId == project.id else { throw APIFailure.identityMismatch }
            projectEditor = nil; await refresh()
        } catch { if token == epoch { projectError = ProjectPresentation.error(error); await refresh() } }
    }
    func beginProjectConversation(_ project: Project) async {
        guard !projectBusy else { return }
        let token = epoch; projectError = nil; projectModels = []; projectModelID = ""; projectThinking = false; projectCreatedSessionID = nil; projectConversation = project
        do {
            let models = try await client.hostModels().filter(\.configured)
            guard token == epoch, projectConversation?.id == project.id else { return }
            projectModels = models; projectModelID = models.first?.id ?? ""
        } catch { if token == epoch { projectError = ProjectPresentation.error(error) } }
    }
    func createProjectConversation() async {
        guard !projectBusy, let project = projectConversation, let accountSession = session, let local = commandStore,
              projectModels.contains(where: { $0.id == projectModelID }) else { return }
        let token = epoch; projectBusy = true; projectError = nil
        defer { if token == epoch { projectBusy = false } }
        do {
            if let id = projectCreatedSessionID { try await finishProjectConversation(id: id, project: project, token: token); return }
            let records = try await local.commands(account: LocalAccountScope(server: accountSession.server, ownerId: accountSession.account.ownerId))
            let existing = records.last { record in
                record.intent.hostId == accountSession.hostId && record.intent.parsedPayload.projectId == project.id &&
                ([.queued, .uncertain].contains(record.state) || (record.state == .accepted && !conversations.contains(where: { $0.sessionId == record.receipt?.sessionId })))
            }
            let intent = try existing?.intent ?? SharedCommandIntent(session: accountSession, command: SharedCommandPayload(requestId: "apple-project-session-" + UUID().uuidString.lowercased(), kind: .create, targetDeviceId: accountSession.hostId, modelProfileId: projectModelID, projectId: project.id))
            var record = try await local.persist(intent)
            let deadline = Date().addingTimeInterval(45)
            var submit = true
            while token == epoch, !Task.isCancelled, Date() < deadline {
                let result = try await client.reconcileCommand(intent, allowSubmission: submit)
                submit = false
                guard token == epoch else { return }
                if case .found(let receipt) = result {
                    record = try await local.recordReceipt(receipt, for: intent, expectedRevision: record.revision)
                    publish(record, accountEpoch: token)
                    if receipt.state.isAccepted, let id = receipt.sessionId {
                        projectCreatedSessionID = id
                        try await finishProjectConversation(id: id, project: project, token: token); return
                    }
                    if receipt.state == .rejected { throw APIFailure.server(status: 409, code: receipt.errorCode ?? "REQUEST_FAILED") }
                    if receipt.state == .uncertain { break }
                }
                try await Task.sleep(for: .milliseconds(250))
            }
            throw APIFailure.transport(.timeout)
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            if token == epoch { projectError = (projectCreatedSessionID == nil ? "新建结果尚未确认。再次点新建会先核对原请求。" : "对话已创建，深入思考尚未确认。请重试保存后开始聊天。") + ProjectPresentation.error(error) }
        }
    }

    @Published var sessionGroups: [SessionGroup] = []
    @Published var collapsedSessionGroups = Set<String>()
    @Published var openedSessionID: String?
    @Published var renamingSessionID: String?
    @Published var sessionTitleDraft = ""
    @Published var groupCandidate: ConversationSummary?
    @Published var newGroupName = ""
    @Published var conversationForget = ForgetConfirmationState()
    @Published var conversationPreviewLoading = false
    private var conversationPreviewToken = UUID()
    func sections(query: String) -> [SessionSidebarSection] { SessionSidebar.sections(rows: conversations.filter { !$0.isMainChat }, groups: sessionGroups, query: query) }
    private func finishProjectConversation(id: String, project: Project, token: UUID) async throws {
        guard token == epoch, projectConversation?.id == project.id else { return }
        if projectModels.first(where: { $0.id == projectModelID })?.deepThinking?.supported == true {
            let choice = projectThinking
            let saved = try await client.sessionThinking(sessionID: id, enabled: choice)
            guard token == epoch, projectConversation?.id == project.id else { return }
            guard (!choice || saved.supported), saved.enabled == choice else { throw APIFailure.invalidResponse }
        }
        await refresh()
        guard token == epoch, projectConversation?.id == project.id else { return }
        guard let row = conversations.first(where: { $0.sessionId == id }) else { throw APIFailure.invalidResponse }
        projectCreatedSessionID = nil; projectConversation = nil; openedSessionID = row.id
    }
    func beginRename(_ row: ConversationSummary) { renamingSessionID = row.id; sessionTitleDraft = row.title }
    func saveSessionTitle(_ row: ConversationSummary) async {
        let title = sessionTitleDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.count <= 256 else { lifecycleError = "标题不能为空，且最多 256 个字符。"; return }
        await updateMetadata(row, title: title)
        if lifecycleError == nil { renamingSessionID = nil }
    }
    func updateMetadata(_ row: ConversationSummary, pinned: Bool? = nil, unread: Bool? = nil, title: String? = nil, groupID: String? = nil, changeGroup: Bool = false, projectID: String? = nil, changeProject: Bool = false) async {
        guard !lifecycleBusy, let id = row.sessionId else { return }
        let token = epoch; lifecycleBusy = true; lifecycleError = nil
        defer { if token == epoch { lifecycleBusy = false } }
        do {
            let reply = try await client.updateSessionMetadata(sessionID: id, pinned: pinned, unread: unread, title: title, groupID: groupID, changeGroup: changeGroup, projectID: projectID, changeProject: changeProject)
            guard token == epoch else { return }
            guard reply.sessionId == id else { throw APIFailure.identityMismatch }
            if let notice = reply.projectNotice { sessionProjectNotices[row.id] = notice }
            await refresh()
        } catch { if token == epoch { lifecycleError = friendly(error) } }
    }
    func createGroupAndMove() async {
        guard !lifecycleBusy, let row = groupCandidate else { return }
        let name = newGroupName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 256 else { lifecycleError = "分组名称不能为空，且最多 256 个字符。"; return }
        let token = epoch; lifecycleBusy = true; lifecycleError = nil
        defer { if token == epoch { lifecycleBusy = false } }
        do {
            let group = try await client.createSessionGroup(name: name)
            guard token == epoch else { return }
            lifecycleBusy = false
            await updateMetadata(row, groupID: group.id, changeGroup: true)
            if lifecycleError == nil { groupCandidate = nil; newGroupName = "" }
        } catch { if token == epoch { lifecycleError = friendly(error) } }
    }
    func fork(_ row: ConversationSummary) async {
        guard !lifecycleBusy, let id = row.sessionId else { return }
        let token = epoch; lifecycleBusy = true; lifecycleError = nil
        defer { if token == epoch { lifecycleBusy = false } }
        do {
            let reply = try await client.forkSession(sessionID: id)
            guard token == epoch else { return }
            await refresh()
            guard token == epoch else { return }
            guard let child = conversations.first(where: { $0.sessionId == reply.sessionId }) else { throw APIFailure.invalidResponse }
            openedSessionID = child.id
        } catch { if token == epoch { lifecycleError = friendly(error) } }
    }
    func setConversationForget(_ value: Bool) async {
        forgetConversationMemories = value; conversationForget = .init(); lifecycleError = nil
        conversationPreviewToken = UUID(); conversationPreviewLoading = false
        guard value, let row = deletionCandidate, let id = row.sessionId else { return }
        let token = conversationPreviewToken, account = epoch
        conversationPreviewLoading = true
        defer { if token == conversationPreviewToken && account == epoch { conversationPreviewLoading = false } }
        do {
            let preview = try await client.sessionForgetPreview(sessionID: id)
            guard token == conversationPreviewToken, account == epoch, deletionCandidate?.id == row.id else { return }
            conversationForget.preview = preview
        } catch { if token == conversationPreviewToken && account == epoch { lifecycleError = "无法读取遗忘范围，请重新读取后确认。" } }
    }
    var canDeleteConversation: Bool { !lifecycleBusy && (!forgetConversationMemories || conversationForget.canConfirm) }

    @Published var deletionInSettings = false
    @Published var sessionMenuCandidate: ConversationSummary?
    #if os(iOS)
    @Published var temporaryExpiryCandidate: ConversationSummary?
    #endif
    @Published var deletionCandidate: ConversationSummary?
    @Published var forgetConversationMemories = false
    @Published var lifecycleBusy = false
    @Published var lifecycleError: String?
    @Published var queueNotice: String?
    @Published var queueBusy = Set<String>()
    private var queueCancelRequests: [String: String] = [:]
    private var canceledQueuedTasks = Set<String>()
    var visibleConversations: [ConversationSummary] { conversations.filter { !$0.archived } }
    func askToDelete(_ conversation: ConversationSummary, inSettings: Bool = false) {
        deletionInSettings = inSettings
        forgetConversationMemories = false; conversationForget = .init(); conversationPreviewToken = UUID(); conversationPreviewLoading = false; lifecycleError = nil; deletionCandidate = conversation
    }
    func archive(_ conversation: ConversationSummary, archived: Bool) async {
        guard !lifecycleBusy, let id = conversation.sessionId else { return }
        let actionEpoch = epoch; lifecycleBusy = true; lifecycleError = nil
        defer { if actionEpoch == epoch { lifecycleBusy = false } }
        do {
            let result = try await client.setSessionArchived(archived, sessionID: id)
            guard actionEpoch == epoch else { return }
            guard result.sessionId == id, result.archived == archived else { throw APIFailure.identityMismatch }
            if let index = conversations.firstIndex(where: { $0.id == conversation.id }) {
                let old = conversations[index]
                conversations[index] = .init(id: old.id, title: old.title, conversationId: old.conversationId, sessionId: old.sessionId,
                    running: old.running, sendAvailable: !archived && old.sendAvailable, originalModelLabel: old.originalModelLabel, archived: archived, pinned: old.pinned, unread: old.unread, groupId: old.groupId, projectId: old.projectId, projectName: old.projectName, projectNotice: old.projectNotice, taskAvailable: old.taskAvailable, hostId: old.hostId, updatedAt: old.updatedAt, chatId: old.chatId, chatKind: old.chatKind, chatContentRevision: old.chatContentRevision, temporaryState: old.temporaryState)
            }
            if selectedConversation?.id == conversation.id { selectedConversation = conversations.first { $0.id == conversation.id } }
            if archived { archiveUndo = conversation }
            else if archiveUndo?.id == conversation.id { archiveUndo = nil }
            await refresh()
            // Give the user the full undo interval after controls become enabled.
            if archived, actionEpoch == epoch, archiveUndo?.id == conversation.id {
                let undoToken = UUID(); archiveUndoToken = undoToken
                DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
                    guard let self, actionEpoch == self.epoch, self.archiveUndoToken == undoToken else { return }
                    self.archiveUndo = nil
                }
            }
        } catch { if actionEpoch == epoch { lifecycleError = "归档状态未更新，请重试。" } }
    }
    func deleteConversation() async {
        guard canDeleteConversation, let conversation = deletionCandidate, let id = conversation.sessionId else { return }
        let actionEpoch = epoch, forget = forgetConversationMemories
        lifecycleBusy = true; lifecycleError = nil
        defer { if actionEpoch == epoch { lifecycleBusy = false } }
        do {
            let result = try await client.deleteSession(sessionID: id, forgetMemories: forget, deleteConversationSnippets: conversationForget.deleteConversationSnippets, memoryWorldRevision: forget ? conversationForget.preview?.worldRevision : nil)
            guard actionEpoch == epoch else { return }
            guard result.deleted, result.sessionId == id, result.forgetMemories == forget else { throw APIFailure.identityMismatch }
            conversations.removeAll { $0.id == conversation.id }
            if selectedConversation?.id == conversation.id { closeConversation() }
            deletionCandidate = nil
            await refresh()
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            guard actionEpoch == epoch else { return }
            if case APIFailure.server(409, "SESSION_BUSY") = error { lifecycleError = "任务停止尚未确认，请稍后重试删除。" }
            else if forget { conversationForget.preview = nil; lifecycleError = "遗忘范围已变化或删除未完成，请重新读取后确认。" }
            else { lifecycleError = "对话尚未删除，请稍后重试。" }
        }
    }
    func queuedTasks(for conversation: ConversationSummary) -> [QueuedTask] {
        guard selectedConversation?.id == conversation.id else { return [] }
        let observed = timelineRootCommands.map {
            SharedCommandReceipt(commandId: $0.commandId, requestId: $0.requestId, kind: .message,
                targetDeviceId: $0.targetDeviceId, state: $0.state, sessionId: $0.sessionId, conversationId: nil,
                sourceSyncEventId: nil, receiptId: $0.receiptId, errorCode: nil)
        }
        return TaskQueueProjection.queued(events: timeline.events, commands: commandRows(for: conversation).compactMap(\.receipt) + observed)
            .filter { !canceledQueuedTasks.contains($0.id) }
    }
    func cancelQueued(_ task: QueuedTask, conversation: ConversationSummary, edit: Bool = false) async {
        guard !queueBusy.contains(task.id), historyCachedAt == nil else { return }
        let actionEpoch = epoch
        queueBusy.insert(task.id); queueNotice = nil
        defer { if actionEpoch == epoch { queueBusy.remove(task.id) } }
        let request = queueCancelRequests[task.id] ?? "apple-cancel-" + UUID().uuidString.lowercased()
        queueCancelRequests[task.id] = request
        do {
            var result = try await client.cancelQueuedTask(taskID: task.id, requestID: request)
            while [.requested, .cancelRequested].contains(result.control.stopStatus), actionEpoch == epoch, !Task.isCancelled {
                try await Task.sleep(for: .seconds(1))
                result = try await client.taskDetail(taskID: task.id)
            }
            guard actionEpoch == epoch, !Task.isCancelled else { return }
            if result.control.stopStatus == .stopped {
                canceledQueuedTasks.insert(task.id)
                if edit { setDraft(task.text, for: conversation, accountEpoch: actionEpoch) }
            } else { queueNotice = "取消尚未确认，请检查状态后重试。" }
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            guard actionEpoch == epoch else { return }
            if case APIFailure.server(409, _) = error { queueNotice = "已经开始，可以用停止" }
            else { queueNotice = "取消未确认，请重试。" }
        }
    }

    @Published var serverInput: String
    @Published private(set) var session: AccountSession?
    @Published private(set) var restoring = true
    @Published private(set) var authBusy = false
    @Published var authError: String?
    @Published private(set) var conversations: [ConversationSummary] = []
    @Published private(set) var devices: [DeviceRecord] = []
    @Published private(set) var refreshing = false
    @Published private(set) var conversationsError: String?
    @Published private(set) var devicesError: String?
    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var timelineMessageIDs: [Int: String] = [:]
    @Published private(set) var timeline = TimelineWindow()
    @Published private(set) var olderBusy = false
    private var offlineTimeline = false
    private var timelinePolling: UUID?
    private var timelineCache: LocalTimelineCache? {
        timelineStateDirectory.map { LocalTimelineCache(directory: $0.appendingPathComponent("Timeline")) }
    }
    private var historyCacheAllowed = true
    @Published private(set) var historyBusy = false
    @Published private(set) var historyError: String?
    @Published private(set) var selectedConversation: ConversationSummary?
    @Published private(set) var drafts: [String: String] = [:]
    @Published private(set) var draftsReady = false
    @Published private(set) var draftError: String?
    @Published private(set) var draftSaveStates: [String: DraftSaveState] = [:]
    @Published private(set) var draftFlushBusy = false
    @Published private(set) var needsUnsavedDraftDecision = false
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var verificationPending = false
    @Published private(set) var conversationsCachedAt: Date?
    @Published private(set) var historyCachedAt: Date?
    @Published private(set) var cacheError: String?
    @Published private(set) var continuationNotices: [String: String] = [:]
    @Published private(set) var sendTargets: [String: BoundConversationTarget] = [:]
    @Published private(set) var modelsToConfirm: [String: SharedHostModel] = [:]
    @Published private(set) var commandPresentations: [String: ConversationCommandPresentation] = [:]
    @Published private(set) var observedUserReceipts = Set<String>()
    @Published private(set) var preparingMessages: [String: ChatMessage] = [:]
    @Published private(set) var preparingConversations = Set<String>()
    @Published private(set) var reconcilingRequests = Set<String>()
    @Published private(set) var clearingDraftKeys = Set<String>()
    @Published private(set) var adoptionChoices: [String: [SharedHostModel]] = [:]
    @Published private(set) var adoptionPresentations: [String: ConversationAdoptionPresentation] = [:]
    @Published private(set) var adoptingRequests = Set<String>()
    @Published private(set) var adoptionError: String?
    @Published private(set) var attachmentDrafts: [String: [ConversationAttachmentDraft]] = [:]
    @Published private(set) var loadingAttachments = Set<String>()
    @Published private(set) var taskControlSessions = Set<String>()
    private var attachmentAttempts: [String: ConversationAttachmentAttempt] = [:]
    private var attachmentMessageIDs: [String: String] = [:]
    private var attachmentSessionIDs: [String: String] = [:]

    var healthStateDirectory: URL {
        (localStateDirectory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0])
            .appendingPathComponent("Health", isDirectory: true)
    }
    func uploadHealthSummary(_ summary: HealthDailySummary, account: LocalAccountScope) async throws -> HealthUploadResult {
        try await client.uploadHealthSummary(summary, account: account)
    }
    func deleteHealthSummaries(account: LocalAccountScope) async throws -> HealthUploadResult {
        try await client.deleteHealthSummaries(account: account)
    }

    let developmentRouteEnabled: Bool

    private let client: PersonalClient
    @Published var settingsRoute = AppleSettingsRoute(categoryID: "general")
    @Published var appearanceMode = "system" {
        didSet { defaults?.set(appearanceMode, forKey: "appearanceMode") }
    }
    var runningMessageMode: RunningMessageMode {
        get {
            guard let defaults, let session, let account = try? LocalAccountScope(server: session.server, ownerId: session.account.ownerId) else { return .queue }
            return RunningMessagePreferences(defaults: defaults).read(account: account)
        }
        set {
            guard let defaults, let session, let account = try? LocalAccountScope(server: session.server, ownerId: session.account.ownerId) else { return }
            objectWillChange.send()
            RunningMessagePreferences(defaults: defaults).write(newValue, account: account)
        }
    }
    func regenerateReply(_ message: ChatMessage) async {
        guard let conversation = selectedConversation, !conversation.isMainChat, let native = conversation.sessionId,
              let sequence = Int(message.id.split(separator: "|").last ?? ""), message.role == .assistant,
              let accountSession = session, let local = commandStore,
              let scope = try? LocalAccountScope(server: accountSession.server, ownerId: accountSession.account.ownerId) else { return }
        let token = epoch, key = "messageBranch." + scope.cacheKey + "." + message.id
        let request = defaults?.string(forKey: key) ?? "apple-branch-" + UUID().uuidString.lowercased()
        defaults?.set(request, forKey: key)
        do {
            let result = try await client.regenerateMessageBranch(sessionID: native, sequence: sequence, requestID: request)
            guard token == epoch, let target = result["sessionId"]?.string, let send = result["sendRequestId"]?.string, let text = result["text"]?.string else { return }
            await refresh()
            guard token == epoch, let row = conversations.first(where: { $0.sessionId == target }) else { return }
            func attachments(_ key: String) throws -> [OriginalAttachment]? {
                guard let value = result[key], value != .null else { return nil }
                return try JSONDecoder().decode([OriginalAttachment].self, from: JSONEncoder().encode(value))
            }
            let payload = try SharedCommandPayload(requestId: send, kind: .message, targetDeviceId: accountSession.hostId,
                sessionId: target, text: text, attachments: attachments("attachments"),
                originalAttachments: attachments("originalAttachments"), attachmentMessageId: result["attachmentMessageId"]?.string, intent: .queue)
            let record = try await local.persist(SharedCommandIntent(session: accountSession, command: payload))
            guard token == epoch else { return }
            defaults?.removeObject(forKey: key)
            openedSessionID = row.id; await open(row)
            publish(record, note: "已保存原请求，正在核对服务端。", accountEpoch: token)
            await runCommand(record, allowSubmission: true, conversation: row, accountEpoch: token)
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            if token == epoch { continuationNotices[Self.draftKey(for: conversation)] = "重新生成尚未完成，原请求已保留，请重试。" }
        }
    }
    func messageRating(_ id: String) -> String {
        guard let session, let scope = try? LocalAccountScope(server: session.server, ownerId: session.account.ownerId) else { return "" }
        return (defaults?.dictionary(forKey: "messageRatings." + scope.cacheKey)?[id] as? [String: String])?["rating"] ?? ""
    }
    func rateMessage(_ id: String, rating: String) {
        guard let defaults, let session, let scope = try? LocalAccountScope(server: session.server, ownerId: session.account.ownerId) else { return }
        let key = "messageRatings." + scope.cacheKey
        var records = defaults.dictionary(forKey: key) ?? [:]
        records[id] = rating.isEmpty ? nil : ["rating": rating, "at": ISO8601DateFormatter().string(from: Date())]
        defaults.set(records, forKey: key)
    }
    private let defaults: UserDefaults?
    private let launchConfigurationError: String?
    private let draftPersistence: (any AppleDraftPersisting)?
    private let commandStore: LocalConversationStore?
    private let endpointStore: LocalEndpointOperationStore?
    private let localStateDirectory: URL?
    private let timelineStateDirectory: URL?
    private var adoptionProjections: [String: SharedConversationProjection] = [:]
    private var adoptionWorkers: [String: Task<Void, Never>] = [:]
    private var preparingAdoptions = Set<String>()
    private var confirmedModels: [String: String] = [:]
    private var commandWorkers: [String: Task<Void, Never>] = [:]
    private var historyWorkers: [String: Task<Void, Never>] = [:]
    private var retiringHistoryWorkers: [String: Task<Void, Never>] = [:]
    private var historyWorkerTokens: [String: UUID] = [:]
    private var liveConversations: [String: ConversationSummary] = [:]
    private var cachedConversationHosts: [String: String] = [:]
    @Published private var knownBoundSessions: [String: String] = [:]
    private var foreground = true
    private var draftAccount: LocalAccountScope?
    private var pendingDrafts: [String: PendingDraft] = [:]
    private var draftWorkers: [String: Task<Void, Never>] = [:]
    private var draftRevisions: [String: UUID] = [:]
    private var draftLoadInFlight = false
    private var draftLoadRequest = UUID()
    private var epoch = UUID()
    private var historyRequest = UUID()
    private var started = false

    enum DraftSaveState: Equatable { case saving, saved, failed }
    private struct PendingDraft {
        let account: LocalAccountScope
        let text: String
        let revision: UUID
    }

    init(localHostID: String? = nil) {
        self.localHostID = localHostID
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        let uiTesting = args.contains("--ui-testing")
        #else
        let args: [String] = []
        let uiTesting = false
        #endif
        var configurationError: String?
        var testNamespace = "default"
        if uiTesting, let index = args.firstIndex(of: "--ui-testing-namespace") {
            if args.indices.contains(index + 1),
               args[index + 1].range(of: "^[A-Za-z0-9._-]{1,64}$", options: .regularExpression) != nil {
                testNamespace = args[index + 1]
            } else {
                configurationError = "测试存储命名空间无效，请检查启动参数。"
            }
        }
        let testService = "com.weftmate.apple.ui-tests.\(testNamespace)"
        let preferences = uiTesting
            ? UserDefaults(suiteName: testService) : UserDefaults.standard
        if preferences == nil { configurationError = "无法打开测试存储，请检查启动参数。" }
        defaults = preferences
        appearanceMode = preferences?.string(forKey: "appearanceMode") ?? "system"
        #if DEBUG
        if uiTesting, let index = args.firstIndex(of: "--a5-theme"), args.indices.contains(index + 1), ["light", "dark"].contains(args[index + 1]) { appearanceMode = args[index + 1] }
        #endif
        var store: any CredentialStore = KeychainCredentialStore(service: uiTesting
            ? "\(testService).credentials" : "com.weftmate.apple.credentials")
        #if DEBUG && os(macOS)
        if uiTesting, args.contains("--lg2-capture"), let i = args.firstIndex(of: "--a11-local-host-id"), args.indices.contains(i + 1) { self.localHostID = args[i + 1] }
        if uiTesting, args.contains("--lg2-capture"), args.contains("--a5-local-server"),
           args.contains("--a10-ephemeral-credentials"), let index = args.firstIndex(of: "--server-url"),
           args.indices.contains(index + 1), let url = URL(string: args[index + 1]), url.host == "127.0.0.1", url.scheme == "http" {
            store = CaptureCredentials()
        }
        #endif
        cloudNamespace = uiTesting ? testService + ".cloud" : "com.weftmate.apple.cloud"
        var transport: any HTTPTransport = URLSessionTransport(hostPins: HostPinStore(store: KeychainCredentialStore(service: cloudNamespace + ".pins")))
        var routeEnabled = false
        #if DEBUG
        if let index = args.firstIndex(of: "--development-proxy-port") {
            if args.indices.contains(index + 1), let port = Int(args[index + 1]), (1024...65535).contains(port) {
                do {
                    transport = try URLSessionTransport(developmentProxyPort: port)
                    routeEnabled = true
                } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
                    configurationError = "局域网开发联调参数无效，请检查启动参数。"
                }
            } else {
                configurationError = "局域网开发联调端口无效，请检查启动参数。"
            }
        }
        #endif
        #if DEBUG
        if A14TestSupport.driver != nil { transport = A14ApprovedSessionTransport(base: transport) }
        #endif
        developmentRouteEnabled = routeEnabled
        launchConfigurationError = configurationError
        #if DEBUG
        if uiTesting && args.contains("--apple-contract-fixture") {
            client = AppleContractUIFixture.makeClient()
        } else if uiTesting && args.contains("--task-progress-fixture") {
            client = TaskProgressUIFixture.makeClient()
        } else {
            client = PersonalClient(credentialStore: store, transport: transport)
        }
        #else
        client = PersonalClient(credentialStore: store, transport: transport)
        #endif
        var initialDraftError: String?
        var localDirectory: URL?
        do {
            if uiTesting {
                guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
                    throw CocoaError(.fileNoSuchFile)
                }
                if let i = args.firstIndex(of: "--ui-testing-data-dir"), args.indices.contains(i + 1) {
                    localDirectory = URL(fileURLWithPath: args[i + 1], isDirectory: true)
                        .appendingPathComponent("LocalState", isDirectory: true)
                } else {
                    localDirectory = base.appendingPathComponent("WeftMate/UITests", isDirectory: true)
                        .appendingPathComponent(testNamespace, isDirectory: true)
                        .appendingPathComponent("LocalState", isDirectory: true)
                }
            }
            let local = try LocalConversationStore(directory: localDirectory)
            commandStore = local
            draftPersistence = LocalAppleDraftPersistence(store: local)
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            commandStore = nil
            draftPersistence = nil
            initialDraftError = "无法打开本机草稿存储。原有文件保留，暂时不能编辑或发送。"
        }
        var initialAdoptionError: String?
        do {
            if uiTesting && localDirectory == nil { throw LocalEndpointOperationFailure.storageUnavailable }
            endpointStore = try LocalEndpointOperationStore(directory: localDirectory)
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            endpointStore = nil
            initialAdoptionError = "本机采用记录未能打开，原文件保留，暂时不能接通新会话。"
        }
        serverInput = preferences?.string(forKey: "weftmate.server")
            ?? (uiTesting ? "https://127.0.0.1:1" : "https://home.weftmate.com:8443")
        if let index = args.firstIndex(of: "--server-url"), args.indices.contains(index + 1) {
            serverInput = args[index + 1]
        }
        draftError = initialDraftError
        adoptionError = initialAdoptionError
        localStateDirectory = localDirectory
        timelineStateDirectory = localDirectory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("WeftMate/LocalState", isDirectory: true)
    }

    /// Dependency injection for deterministic account/late-callback checks; no alternate auth path.
    init(client: PersonalClient, draftPersistence: any AppleDraftPersisting, server: ServerConfiguration,
         commandStore: LocalConversationStore? = nil, endpointStore: LocalEndpointOperationStore? = nil, stateDirectory: URL? = nil, preferences: UserDefaults? = nil) {
        self.client = client
        cloudNamespace = "com.weftmate.apple.unit-tests." + UUID().uuidString
        self.draftPersistence = draftPersistence
        self.commandStore = commandStore
        self.endpointStore = endpointStore
        localStateDirectory = stateDirectory; timelineStateDirectory = stateDirectory
        defaults = preferences
        launchConfigurationError = nil
        developmentRouteEnabled = false
        serverInput = server.originString
    }

    private var permitsSyntheticLoopback: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--ui-testing") && (ProcessInfo.processInfo.arguments.contains("--a3-local-server") || ProcessInfo.processInfo.arguments.contains("--a4a-local-server") || ProcessInfo.processInfo.arguments.contains("--a4b-local-server") || ProcessInfo.processInfo.arguments.contains("--s1c-browser-driver") || ProcessInfo.processInfo.arguments.contains("--lg2-cloud") || ProcessInfo.processInfo.arguments.contains("--a5-local-server"))
        #else
        false
        #endif
    }
    var serverDisplayName: String {
        guard let components = URLComponents(string: serverInput), let host = components.host else {
            return "设置服务器地址"
        }
        return components.port.map { "\(host):\($0)" } ?? host
    }

    var accountName: String {
        guard let account = session?.account else { return "账户" }
        return account.displayName.isEmpty ? account.username : account.displayName
    }

    var deviceName: String {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--a5-theme") {
            return ApplePlatform.current == .macOS ? "合成 Mac" : "合成 iPhone"
        }
        #endif
        #if os(macOS)
        return Host.current().localizedName ?? "我的 Mac"
        #else
        return UIDevice.current.name
        #endif
    }

    func start() async {
        guard !started else { return }
        started = true
        #if os(iOS)
        _ = watchBridge
        #endif
        defer { restoring = false }
        if let launchConfigurationError {
            authError = launchConfigurationError
            return
        }
        #if DEBUG
        let fixtureArguments = ProcessInfo.processInfo.arguments
        if fixtureArguments.contains("--ui-testing") && fixtureArguments.contains("--apple-contract-fixture") {
            await authenticate(username: "tester", password: "synthetic-only", displayName: nil, register: false)
            return
        }
        if permitsSyntheticLoopback && (fixtureArguments.contains("--a3-local-server") || fixtureArguments.contains("--a4a-local-server") || fixtureArguments.contains("--a4b-local-server")) {
            await authenticate(username: "a3-tester", password: "synthetic-test-only", displayName: nil, register: false)
            return
        }
        if A14TestSupport.driver != nil {
            let server = try? ServerConfiguration(input: serverInput, allowLoopbackHTTP: true)
            if let server {
                do { session = try await client.restoreSession(server: server) }
                catch { session = await client.currentSession(); verificationPending = session != nil }
                if let session { await loadScopedDrafts(session); return }
            }
        }
        if permitsSyntheticLoopback && fixtureArguments.contains("--a5-local-server") {
            await authenticate(username: "a5-tester", password: "synthetic-test-only", displayName: nil, register: false)
            if let index = fixtureArguments.firstIndex(of: "--a12-live-session"), index + 1 < fixtureArguments.count,
               let conversation = conversations.first(where: { $0.sessionId == fixtureArguments[index + 1] }) {
                await open(conversation)
                openedSessionID = conversation.id
            }
            return
        }
        #endif
        do {
            let server = try ServerConfiguration(input: serverInput, allowLoopbackHTTP: permitsSyntheticLoopback)
            session = try await client.restoreSession(server: server)
            await cloudLogin.restore()
            if let session {
                await loadScopedDrafts(session)
                await refresh()
            }
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            // A valid stored account can survive a temporary network outage.
            session = await client.currentSession()
            if session != nil {
                verificationPending = true
                conversationsError = friendly(error)
                devicesError = friendly(error)
                if let session { await loadScopedDrafts(session) }
            } else {
                authError = friendly(error)
            }
        }
    }

    func authenticate(username: String, password: String, displayName: String?, register: Bool) async {
        guard !authBusy, session == nil else { return }
        if let launchConfigurationError {
            authError = launchConfigurationError
            return
        }
        authBusy = true
        authError = nil
        let actionEpoch = epoch
        defer { if actionEpoch == epoch { authBusy = false } }
        do {
            let server = try ServerConfiguration(input: serverInput, allowLoopbackHTTP: permitsSyntheticLoopback)
            let name = username.trimmingCharacters(in: .whitespacesAndNewlines)
            let result: AccountSession
            if register {
                let nickname = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
                result = try await client.register(server: server, username: name, password: password,
                                                    deviceName: deviceName,
                                                    displayName: nickname?.isEmpty == false ? nickname : nil)
            } else {
                result = try await client.login(server: server, username: name, password: password,
                                                 deviceName: deviceName)
            }
            guard actionEpoch == epoch else { return }
            session = result
            verificationPending = false
            defaults?.set(server.originString, forKey: "weftmate.server")
            serverInput = server.originString
            await loadScopedDrafts(result)
            await refresh()
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            guard actionEpoch == epoch else { return }
            authError = friendly(error)
        }
    }

    func acceptCloudSession(_ result: AccountSession) async {
        if session?.account.ownerId != result.account.ownerId || session?.hostId != result.hostId { offline.erase() }
        session = result; verificationPending = false
        defaults?.set(result.server.originString, forKey: "weftmate.server")
        serverInput = result.server.originString
        await loadScopedDrafts(result); await refresh()
    }

    func refresh() async {
        guard session != nil, !refreshing else { return }
        refreshing = true
        conversationsError = nil
        devicesError = nil
        let actionEpoch = epoch
        defer { if actionEpoch == epoch { refreshing = false } }
        if verificationPending, let server = session?.server {
            do {
                let verified = try await client.restoreSession(server: server)
                guard actionEpoch == epoch else { return }
                guard let verified else {
                    clearVisibleAccount()
                    authError = "请重新登录。"
                    return
                }
                session = verified
                verificationPending = false
            } catch {
            RunLogRuntime.shared.failure(.syncFailure, error: error, phase: "sync")
                guard actionEpoch == epoch else { return }
                if await expireSessionIfNeeded(error) { return }
                conversationsError = friendly(error)
                devicesError = friendly(error)
                return
            }
        }
        if let session, !draftsReady { await loadScopedDrafts(session) }
        guard actionEpoch == epoch else { return }
        do {
            let result = try await client.conversations(includeArchived: true)
            guard actionEpoch == epoch else { return }
            taskControlSessions = try await client.taskControlSessionIDs(includeArchived: true)
            guard actionEpoch == epoch else { return }
            conversations = result
            if let candidate = sessionMenuCandidate { sessionMenuCandidate = result.first { $0.id == candidate.id } }
            for row in result where !row.temporaryState.cacheAllowed { await clearLocalHistory(row) }
            if let selectedConversation {
                if let updated = result.first(where: { $0.id == selectedConversation.id }) {
                    if !updated.isMainChat, let revision = selectedConversation.chatContentRevision, revision != updated.chatContentRevision {
                        historyRequest = UUID(); retireHistoryObservers()
                        messages = []; timeline = .init(); timelineMessageIDs = [:]; mainChat.sideSource = nil
                        await clearLocalHistory(selectedConversation, clearDraft: false)
                        if let id = selectedConversation.sessionId { await client.discardSessionCache(id, conversationID: selectedConversation.id) }
                    }
                    self.selectedConversation = updated
                }
                else if !selectedConversation.temporaryState.cacheAllowed {
                    historyRequest = UUID(); retireHistoryObservers()
                    await clearLocalHistory(selectedConversation)
                    if let id = selectedConversation.sessionId { await client.discardSessionCache(id, conversationID: selectedConversation.id) }
                    messages = []; timeline = .init(); timelineMessageIDs = [:]; mainChat.sideSource = nil
                    drafts[Self.draftKey(for: selectedConversation)] = nil; self.selectedConversation = nil
                }
            }
            if let main = result.first(where: \.isMainChat), let id = main.sessionId { taskControlSessions.insert(id) }
            await mainChat.configure()
            mainChat.restoreRequest()
            sessionGroups = try await client.sessionGroups()
            guard actionEpoch == epoch else { return }
            executionAccount = try await client.nativeUpdateStatus().executionAccount
            guard actionEpoch == epoch else { return }
            liveConversations = Dictionary(uniqueKeysWithValues: result.map { ($0.id, $0) })
            conversationsCachedAt = nil
            lastRefresh = Date()
            if let local = commandStore, let account = draftAccount, let session {
                do { _ = try await local.cacheConversationList(account: account, hostId: session.hostId, conversations: result.filter { !$0.isMainChat && $0.temporaryState.cacheAllowed }) }
                catch { if actionEpoch == epoch { cacheError = "列表已读取，但本机缓存尚未更新。" } }
            }
        } catch {
            RunLogRuntime.shared.failure(.syncFailure, error: error, phase: "sync")
            guard actionEpoch == epoch else { return }
            if await expireSessionIfNeeded(error) { return }
            conversationsError = friendly(error)
        }
        do {
            let reply = try await client.projects()
            guard actionEpoch == epoch else { return }
            projects = reply.projects.filter { !$0.revoked }; projectCanManage = reply.canManage; projectsError = nil
        } catch { if actionEpoch == epoch { projectsError = "项目暂时无法读取，重新连接后再试。"; projectCanManage = false } }
        do {
            let result = try await client.devices()
            guard actionEpoch == epoch else { return }
            devices = result
        } catch {
            RunLogRuntime.shared.failure(.syncFailure, error: error, phase: "sync")
            guard actionEpoch == epoch else { return }
            if await expireSessionIfNeeded(error) { return }
            devicesError = friendly(error)
        }
    }

    func open(_ conversation: ConversationSummary) async {
        if conversation.isMainChat { selectedConversation = conversation; return }
        historyCacheAllowed = conversation.temporaryState.cacheAllowed
        if !conversation.temporaryState.cacheAllowed { await clearLocalHistory(conversation) }

        timelineRootCommands = []
        retireHistoryObservers()
        if selectedConversation?.id != conversation.id { thinking = .init(); thinkingConversation = nil; thinkingError = nil; subtaskStepTarget = nil }
        selectedConversation = conversation
        messages = []; timeline = TimelineWindow(); timelineMessageIDs = [:]; offlineTimeline = false
        historyError = nil
        historyCachedAt = nil
        historyBusy = true
        #if os(iOS)
        _ = watchBridge
        #endif
        let actionEpoch = epoch
        let request = UUID()
        historyRequest = request
        let key = Self.draftKey(for: conversation)
        await mainChat.readSideSource(conversation)
        let cacheHost = cachedConversationHosts[conversation.id] ?? session?.hostId
        if conversation.temporaryState.cacheAllowed, let local = commandStore, let account = draftAccount, let cacheHost {
            do {
                if let cached = try await local.cachedHistory(account: account, conversationKey: key,
                                                              hostId: cacheHost, sessionId: conversation.sessionId) {
                    guard actionEpoch == epoch, historyRequest == request else { return }
                    messages = Array(cached.messages.suffix(100))
                    historyCachedAt = cached.cachedAt
                }
            } catch {
            RunLogRuntime.shared.failure(.syncFailure, error: error, phase: "sync")
                guard actionEpoch == epoch, historyRequest == request else { return }
                cacheError = "本机历史缓存未能读取，原文件保留。"
            }
        }
        if conversation.temporaryState.cacheAllowed, let account = draftAccount, let cacheHost, let sessionID = conversation.sessionId,
           let cached = try? await timelineCache?.readPage(account: account, hostID: cacheHost, sessionID: sessionID) {
            guard actionEpoch == epoch, historyRequest == request else { return }
            offlineTimeline = true; timeline.apply(cached.page, replace: true)
            messages = (try? await client.timelineMessages(timeline.events, sessionID: sessionID)) ?? messages
            historyCachedAt = cached.cachedAt
        }
        do {
            guard let live = liveConversations[conversation.id] else { throw APIFailure.transport(.unavailable) }
            let result = try await client.history(conversation: live)
            guard actionEpoch == epoch, historyRequest == request else { return }
            messages = result
            if let sessionID = live.sessionId ?? knownBoundSessions[key], let page = await client.cachedTimelinePage(sessionID: sessionID) {
                timeline.apply(page, replace: true); offlineTimeline = false
                if page.cacheAllowed == false { historyCacheAllowed = false; await clearLocalHistory(conversation) }
                timelineMessageIDs = await client.cachedTimelineMessageIDs(sessionID: sessionID)
            }
            historyCachedAt = nil
            historyBusy = false
        } catch {
            RunLogRuntime.shared.failure(.syncFailure, error: error, phase: "sync")
            guard actionEpoch == epoch, historyRequest == request else { return }
            historyBusy = false
            if await expireSessionIfNeeded(error) { return }
            if case APIFailure.server(404, _) = error, !conversation.temporaryState.cacheAllowed {
                await clearLocalHistory(conversation)
                if let id = conversation.sessionId { await client.discardSessionCache(id, conversationID: conversation.id) }
                messages = []; timeline = .init(); timelineMessageIDs = [:]
                drafts[Self.draftKey(for: conversation)] = nil; conversations.removeAll { $0.id == conversation.id }
                liveConversations[conversation.id] = nil; mainChat.sideSource = nil
                historyError = "临时对话已到期或被删除。"
            } else { historyError = friendly(error) }
        }
        guard actionEpoch == epoch, historyRequest == request else { return }
        await prepareContinuation(conversation, accountEpoch: actionEpoch)
        guard actionEpoch == epoch, historyRequest == request else { return }
        if historyCacheAllowed, conversation.temporaryState.cacheAllowed, historyCachedAt == nil, historyError == nil, let local = commandStore,
           let account = draftAccount, let session {
            do {
                _ = try await local.cacheHistory(account: account, conversationKey: key, hostId: session.hostId,
                    sessionId: conversation.sessionId ?? knownBoundSessions[key], messages: messages)
            } catch { if actionEpoch == epoch { cacheError = "原记录已读取，但本机历史缓存尚未更新。" } }
        }
        await persistTimeline(conversation)
        #if os(iOS)
        _ = await watchSnapshotBytes()
        #endif
        for row in commandRows(for: conversation) where row.record.state != .rejected {
            await reconcileSavedRequest(row.id, accountEpoch: actionEpoch)
        }
        for row in adoptionRows(for: conversation) where row.record.state != .rejected {
            await reconcileAdoptionRequest(row.id, accountEpoch: actionEpoch)
        }
    }

    func loadOlder(_ conversation: ConversationSummary) async {
        guard selectedConversation?.id == conversation.id, !olderBusy, timeline.hasOlder, let before = timeline.beforeSeq,
              let sessionID = conversation.sessionId ?? knownBoundSessions[Self.draftKey(for: conversation)] else { return }
        olderBusy = true; let actionEpoch = epoch, request = historyRequest
        defer { if actionEpoch == epoch, request == historyRequest { olderBusy = false } }
        do {
            let page: TimelinePage
            if offlineTimeline {
                guard let account = draftAccount, let host = session?.hostId,
                      let cached = try await timelineCache?.readPage(account: account, hostID: host, sessionID: sessionID, beforeSeq: before) else {
                    throw APIFailure.invalidResponse
                }
                page = cached.page
            }
            else { page = try await client.timelinePage(sessionID: sessionID, beforeSeq: before) }
            guard actionEpoch == epoch, request == historyRequest else { return }
            timeline.apply(page, older: true)
            let old = try await client.timelineMessages(page.events, sessionID: sessionID)
            let mapped = await client.cachedTimelineMessageIDs(sessionID: sessionID)
            guard actionEpoch == epoch, request == historyRequest else { return }
            timelineMessageIDs = mapped
            let known = Set(messages.map(\.id)); messages.insert(contentsOf: old.filter { !known.contains($0.id) }, at: 0)
            await persistTimeline(conversation)
        } catch { if actionEpoch == epoch, request == historyRequest { historyError = friendly(error) } }
    }
    func pollTimeline(_ conversation: ConversationSummary) async {
        let actionEpoch = epoch, request = historyRequest
        guard timelinePolling != request, historyCachedAt == nil,
              let sessionID = conversation.sessionId ?? knownBoundSessions[Self.draftKey(for: conversation)] else { return }
        timelinePolling = request
        defer { if timelinePolling == request { timelinePolling = nil } }
        var policy = ConversationPollingPolicy()
        while !Task.isCancelled, actionEpoch == epoch, request == historyRequest, foreground, selectedConversation?.id == conversation.id {
            do {
                let page = try await client.timelinePage(sessionID: sessionID, afterSeq: timeline.nextSeq)
                guard actionEpoch == epoch, request == historyRequest, !Task.isCancelled else { return }
                if page.cacheAllowed == false { historyCacheAllowed = false; await clearLocalHistory(conversation) }
                timeline.apply(page)
                let summaries = try await client.conversations(includeArchived: true)
                guard actionEpoch == epoch, request == historyRequest, !Task.isCancelled else { return }
                conversations = summaries
                liveConversations = Dictionary(uniqueKeysWithValues: summaries.map { ($0.id, $0) })
                updateTimelineActivity(conversation)
                let new = try await client.timelineMessages(page.events, sessionID: sessionID)
                let mapped = await client.cachedTimelineMessageIDs(sessionID: sessionID)
                guard actionEpoch == epoch, request == historyRequest, !Task.isCancelled else { return }
                timelineMessageIDs = mapped
                let newIDs = Set(new.map(\.id))
                messages.removeAll { $0.pendingContext && newIDs.contains($0.id) }
                for message in new {
                    if let index = messages.firstIndex(where: { $0.id == message.id }) { messages[index] = message }
                    else { messages.append(message) }
                }
                if !page.events.isEmpty {
                    await persistTimeline(conversation)
                    #if os(iOS)
                    _ = await watchSnapshotBytes()
                    #endif
                }
                if !page.hasMore { try await Task.sleep(nanoseconds: policy.delayNanoseconds(madeProgress: !page.events.isEmpty || self.conversations.first(where: { $0.id == conversation.id })?.running == true)) }
            } catch {
            RunLogRuntime.shared.failure(.syncFailure, error: error, phase: "sync")
                if error is CancellationError { return }
                guard actionEpoch == epoch, request == historyRequest else { return }
                if await expireSessionIfNeeded(error) { return }
                if case APIFailure.server(404, _) = error, !conversation.temporaryState.cacheAllowed {
                    await clearLocalHistory(conversation); messages = []; timeline = .init(); timelineMessageIDs = [:]
                    mainChat.sideSource = nil; drafts[Self.draftKey(for: conversation)] = nil
                    conversations.removeAll { $0.id == conversation.id }; liveConversations[conversation.id] = nil
                    historyError = "临时对话已到期或被删除。"
                } else { historyError = friendly(error) }; return
            }
        }
    }
    private func updateTimelineActivity(_ conversation: ConversationSummary) {
        guard let last = timeline.events.last(where: { ["turn.started", "task.started", "turn.ended", "task.ended"].contains($0.type) && !($0.type == "task.ended" && $0.data["reason"]?.string == "canceled") }),
              let index = conversations.firstIndex(where: { $0.id == conversation.id }) else { return }
        let old = conversations[index], running = last.type.hasSuffix("started")
        guard old.running != running else { return }
        conversations[index] = .init(id: old.id, title: old.title, conversationId: old.conversationId, sessionId: old.sessionId,
            running: running, sendAvailable: old.sendAvailable, originalModelLabel: old.originalModelLabel, archived: old.archived, pinned: old.pinned, unread: old.unread, groupId: old.groupId, contextUsage: old.contextUsage, processing: running ? old.processing : nil, projectId: old.projectId, projectName: old.projectName, projectNotice: old.projectNotice, taskAvailable: old.taskAvailable, hostId: old.hostId, updatedAt: old.updatedAt, chatId: old.chatId, chatKind: old.chatKind, temporaryState: old.temporaryState)
    }
    private func persistTimeline(_ conversation: ConversationSummary) async {
        guard historyCacheAllowed, conversation.temporaryState.cacheAllowed, historyCachedAt == nil, !timeline.events.isEmpty, let timelineCache, let account = draftAccount, let session,
              let sessionID = conversation.sessionId ?? knownBoundSessions[Self.draftKey(for: conversation)] else { return }
        let window = timeline, actionEpoch = epoch
        do {
            try await timelineCache.save(account: account, hostID: session.hostId, sessionID: sessionID, window: window)
        } catch { if epoch == actionEpoch { cacheError = "当前记录已读取，但本机时间线缓存尚未更新。" } }
    }
    #if os(iOS)
    private lazy var watchBridge = PhoneWatchTimelineBridge(model: self)
    private var watchDecisionsInFlight = Set<String>()
    func watchSnapshotBytes() async -> Data? {
        let actionEpoch = epoch
        guard let session else { return nil }
        if offline.hostOffline || session.verification == .unverifiedOffline {
            let snapshot = WatchTimelineProjection.computerOffline(accountKey: session.account.ownerId)
            watchBridge.publish(snapshot); return try? JSONEncoder().encode(snapshot)
        }
        guard session.verification == .verified else {
            watchBridge.publish(nil); return nil
        }
        do {
            guard mainChat.capabilities.timeline, let main = try? await client.logicalChat(),
                  let sessionID = main.activeSessionId else { watchBridge.publish(nil); return nil }
            let page = try await client.timelinePage(sessionID: sessionID)
            let approvals = try await client.approvals(sessionID: sessionID)
            guard actionEpoch == epoch else { return nil }
            let logical = try await client.chatPage(id: main.id)
            let results = logical.items.filter { $0.type == "side.result" && $0.data["state"]?.string == "completed" && $0.data["deleted"]?.bool != true }
            let completed = WatchTimelineProjection.successfulTaskIDs(in: page.events) + results.compactMap { row in
                row.data["resultId"]?.string.map { $0 + "@" + String(row.data["resultRevision"]?.int ?? 1) }
            }
            let ending = page.events.last(where: { $0.type == "task.ended" || $0.type == "turn.ended" })?.data["reason"]?.string
            let endLabel = ending == "completed" ? "已完成" : ending == "aborted" ? "已停止" : ending == "error" || ending == "blocked" ? "需要处理" : "结果待核对"
            let account = try LocalAccountScope(server: session.server, ownerId: session.account.ownerId)
            var watchApprovals: [WatchApproval] = []
            for approval in approvals.approvals.filter(\.canDecide) {
                var summary = approval.actionHeadline
                if let event = page.events.first(where: { $0.data["callId"]?.string == approval.callId && $0.data["detailRef"]?["seq"]?.int != nil }),
                   let seq = event.data["detailRef"]?["seq"]?.int,
                   let detail = try? await client.timelineDetail(sessionID: sessionID, seq: seq) {
                    summary = "要" + ToolProgressSummary.readable(tool: approval.toolName, raw: detail.text)
                }
                watchApprovals.append(WatchApproval(id: approval.id, summary: summary))
            }
            guard actionEpoch == epoch else { return nil }
            let snapshot = WatchTimelineSnapshot(accountKey: account.cacheKey, sessionID: sessionID,
                taskID: nil, progress: !watchApprovals.isEmpty ? "等待批准" : ending != nil ? endLabel : !results.isEmpty ? "已完成" : "等待新任务",
                running: !watchApprovals.isEmpty,
                assistantSummary: "",
                approvals: watchApprovals, completedTaskIDs: completed)
            watchBridge.publish(snapshot); return try JSONEncoder().encode(snapshot)
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            guard actionEpoch == epoch else { return nil }
            let snapshot = WatchTimelineProjection.connectionFailure(error, accountKey: session.account.ownerId)
            watchBridge.publish(snapshot)
            return snapshot.flatMap { try? JSONEncoder().encode($0) }
        }
    }
    func respondFromWatch(sessionID: String, approvalID: String, outcome: String) async -> Bool {
        let actionEpoch = epoch
        guard !offline.hostOffline, session?.verification == .verified, let value = ApprovalDecisionOutcome(rawValue: outcome),
              !watchDecisionsInFlight.contains(approvalID) else { return false }
        guard let main = try? await client.logicalChat(), main.activeSessionId == sessionID else { return false }
        watchDecisionsInFlight.insert(approvalID)
        defer { watchDecisionsInFlight.remove(approvalID) }
        let responder = TaskInteractionModel(client: client, account: session, epoch: epoch, stateDirectory: assistantStateDirectory,
            currentEpoch: { [weak self] in self?.accountEpoch ?? UUID() }, currentSession: { [weak self] in self?.session })
        await responder.refreshTimeline(sessionID: sessionID)
        guard let approval = responder.approvals.first(where: { $0.id == approvalID && $0.canDecide }) else { return false }
        let key = "approval:" + approvalID
        if responder.hasSaved(key) {
            guard responder.savedApprovalOutcome(approval) == value, responder.savedApprovalScope(approval) != .conversationCategory else { return false }
            await responder.continueOriginal(key)
        }
        else { await responder.decide(approval, outcome: value, decisionScope: value == .allowedOnce ? .once : nil) }
        guard actionEpoch == epoch else { return false }
        _ = await watchSnapshotBytes()
        let success = responder.errors[key] == nil && responder.isRegistered(key)
        if !success { RunLogRuntime.shared.record(.approvalFailure, ["phase": "approval", "code": "UNCONFIRMED"]) }
        return success
    }
    #endif

    func closeConversation() {
        retireHistoryObservers()
        historyRequest = UUID()
        timelineRootCommands = []
        selectedConversation = nil
        messages = []; timeline = TimelineWindow(); timelineMessageIDs = [:]; offlineTimeline = false; olderBusy = false
        historyBusy = false
        historyError = nil
        historyCachedAt = nil
    }

    func confirmCreatedChat(_ row: ConversationSummary, profileID: String) { confirmedModels[Self.draftKey(for: row)] = profileID }
    func transferComposer(from source: ConversationSummary?, to target: ConversationSummary, text: String, files: [ConversationAttachmentDraft], epoch token: UUID) -> Bool {
        guard token == epoch, selectedConversation?.id == target.id else { return false }
        let existing = draftText(for: target, accountEpoch: token)
        guard existing.isEmpty || existing == text else { return false }
        setDraft(text, for: target, accountEpoch: token)
        let key = Self.draftKey(for: target)
        var destination = attachmentDrafts[key] ?? []
        let known = Set(destination.map(\.id)); destination += files.filter { !known.contains($0.id) }; attachmentDrafts[key] = destination
        if let source {
            if draftText(for: source, accountEpoch: token) == text { setDraft("", for: source, accountEpoch: token) }
            let ids = Set(files.map(\.id)); attachmentDrafts[Self.draftKey(for: source)]?.removeAll { ids.contains($0.id) }
        }
        return draftText(for: target, accountEpoch: token) == text
    }
    func resolveOpenedConversation(_ id: String) async -> String? {
        if let row = conversations.first(where: { $0.id == id || $0.sessionId == id || $0.conversationId == id }) { return row.id }
        if mainChat.chat?.activeSessionId == id { return mainChat.chat?.id }
        guard mainChat.capabilities.supports("chats") else { return nil }
        let token = epoch
        let chat = try? await client.chatIDForNativeSession(id)
        guard token == epoch, let chat, conversations.contains(where: { $0.chatId == chat }) else { return nil }
        return chat
    }
    func locateNativeSource(_ conversation: ConversationSummary, sequence: Int) async {
        await open(conversation)
        while timeline.events.first?.seq ?? sequence > sequence, timeline.hasOlder { await loadOlder(conversation) }
        sourceMessageTarget = sequence
    }
    func clearTransferredAttachments(_ row: ConversationSummary) {
        let key = Self.draftKey(for: row)
        attachmentDrafts[key]?.forEach { $0.removeTemporaryFiles() }; attachmentDrafts[key] = []
    }
    func clearLocalHistory(_ conversation: ConversationSummary, clearDraft: Bool = true) async {
        guard let account = draftAccount, let session else { return }
        try? await commandStore?.removeCachedHistory(account: account, conversationKey: Self.draftKey(for: conversation))
        if clearDraft { _ = try? await commandStore?.clearDraft(account: account, conversationId: Self.draftKey(for: conversation)) }
        if let id = conversation.sessionId {
            try? await timelineCache?.remove(account: account, hostID: session.hostId, sessionID: id)
        }
    }
    static func draftKey(for conversation: ConversationSummary) -> String {
        if conversation.isMainChat, let id = conversation.chatId { return "chat:" + id }
        if let id = conversation.conversationId { return "conversation:\(id)" }
        if let id = conversation.sessionId { return "session:\(id)" }
        return conversation.id
    }

    var accountEpoch: UUID { epoch }
    var assistantClient: PersonalClient { client }
    var assistantStateDirectory: URL? { localStateDirectory }

    func draftText(for conversation: ConversationSummary, accountEpoch: UUID) -> String {
        guard accountEpoch == epoch else { return "" }
        return drafts[Self.draftKey(for: conversation)] ?? ""
    }

    func draftStatus(for conversation: ConversationSummary) -> String {
        if !conversation.temporaryState.cacheAllowed { return "临时草稿 · 仅当前显示" }
        guard draftsReady else { return draftError == nil ? "正在读取本机草稿…" : "草稿尚未读取" }
        switch draftSaveStates[Self.draftKey(for: conversation)] {
        case .saving: return "正在保存…"
        case .saved: return "已保存到本机"
        case .failed: return "尚未保存"
        case nil: return "本账户的本机草稿"
        }
    }

    func setDraft(_ text: String, for conversation: ConversationSummary, accountEpoch: UUID) {
        if accountEpoch == epoch, !conversation.temporaryState.cacheAllowed {
            drafts[Self.draftKey(for: conversation)] = text; return
        }
        guard accountEpoch == epoch, canEditDraft(for: conversation), let account = draftAccount,
              let session, let persistence = draftPersistence,
              (try? LocalAccountScope(server: session.server, ownerId: session.account.ownerId)) == account else { return }
        let key = Self.draftKey(for: conversation)
        guard text.utf8.count <= LocalConversationStoreLimits.default.draftUTF8Bytes else {
            draftError = "草稿最多保存 64 KB，这次输入没有写入草稿。"
            return
        }
        guard drafts[key] != nil || drafts.count < LocalConversationStoreLimits.default.draftCount else {
            draftError = "本机草稿达到数量上限，新草稿尚未写入。已有草稿保留。"
            return
        }
        guard drafts[key] != text else { return }
        drafts[key] = text
        let revision = UUID()
        draftRevisions[key] = revision
        pendingDrafts[key] = PendingDraft(account: account, text: text, revision: revision)
        draftSaveStates[key] = .saving
        draftError = nil
        needsUnsavedDraftDecision = false
        guard draftWorkers[key] == nil else { return }
        let actionEpoch = epoch
        // One worker per key coalesces rapid edits while preserving write order.
        draftWorkers[key] = Task { [weak self] in
            guard let self else { return }
            defer { if self.epoch == actionEpoch { self.draftWorkers[key] = nil } }
            while !Task.isCancelled, self.epoch == actionEpoch, let pending = self.pendingDrafts[key] {
                do {
                    try await persistence.saveDraft(account: pending.account, conversationId: key, text: pending.text)
                    guard self.epoch == actionEpoch, !Task.isCancelled else { return }
                    if self.draftRevisions[key] == pending.revision {
                        self.pendingDrafts[key] = nil
                        self.draftSaveStates[key] = .saved
                    }
                } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
                    guard self.epoch == actionEpoch, !Task.isCancelled else { return }
                    self.draftSaveStates[key] = .failed
                    self.draftError = "草稿尚未保存，当前文字仍在这里。请恢复本机存储后重试。"
                    return
                }
            }
        }
    }

    @discardableResult
    func flushDrafts() async -> Bool {
        guard !draftFlushBusy else { return false }
        let actionEpoch = epoch
        draftFlushBusy = true
        defer { if actionEpoch == epoch { draftFlushBusy = false } }
        let workers = Array(draftWorkers.values)
        workers.forEach { $0.cancel() }
        for worker in workers { await worker.value }
        guard actionEpoch == epoch else { return false }
        draftWorkers = [:]
        guard let persistence = draftPersistence else { return pendingDrafts.isEmpty }
        let writes = pendingDrafts
        for (key, pending) in writes {
            do {
                try await persistence.saveDraft(account: pending.account, conversationId: key, text: pending.text)
                guard actionEpoch == epoch else { return false }
                if draftRevisions[key] == pending.revision {
                    pendingDrafts[key] = nil
                    draftSaveStates[key] = .saved
                }
            } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
                guard actionEpoch == epoch else { return false }
                draftSaveStates[key] = .failed
                draftError = "草稿未能保存，本次操作尚未完成。当前文字和原有保存版本都保留。"
                return false
            }
        }
        return pendingDrafts.isEmpty
    }

    private func loadScopedDrafts(_ scopedSession: AccountSession) async {
        guard let persistence = draftPersistence else { return }
        let actionEpoch = epoch
        do {
            // A Keychain-restored identity permits its local drafts while cloud verification is pending.
            let account = try LocalAccountScope(server: scopedSession.server, ownerId: scopedSession.account.ownerId)
            guard draftAccount != account || !draftsReady else { return }
            guard !draftLoadInFlight || draftAccount != account else { return }
            draftAccount = account
            draftLoadInFlight = true
            let request = UUID()
            draftLoadRequest = request
            defer {
                if actionEpoch == epoch, draftLoadRequest == request { draftLoadInFlight = false }
            }
            draftsReady = false
            draftError = nil
            let saved = try await persistence.loadDrafts(account: account)
            guard actionEpoch == epoch, draftLoadRequest == request, draftAccount == account,
                  session?.account.ownerId == scopedSession.account.ownerId,
                  session?.server == scopedSession.server else { return }
            drafts = saved
            draftSaveStates = saved.mapValues { _ in .saved }
            draftsReady = true
            if let commandStore {
                let records = try await commandStore.commands(account: account)
                guard actionEpoch == epoch, draftAccount == account else { return }
                commandPresentations = Dictionary(uniqueKeysWithValues: records.map {
                    ($0.intent.requestId, ConversationCommandPresentation(record: $0, receipt: $0.receipt,
                        progress: nil, note: "本机保存的请求，尚未核对当前服务状态。", lookupNotFound: false))
                })
                if let cached = try await commandStore.cachedConversationList(account: account) {
                    guard actionEpoch == epoch, draftAccount == account else { return }
                    conversations = cached.conversations.map(\.conversation)
                    conversationsCachedAt = cached.cachedAt
                    cachedConversationHosts = Dictionary(uniqueKeysWithValues: cached.conversations.map { ($0.id, $0.hostId) })
                }
            }
            if let endpointStore {
                let operations = try await endpointStore.operations(account: account)
                guard actionEpoch == epoch, draftAccount == account else { return }
                adoptionPresentations = Dictionary(uniqueKeysWithValues: operations.map {
                    ($0.intent.requestId, .init(record: $0, note: "重开后只核对原请求，不自动重发。",
                                              lookupNotFound: false, freshlyVerified: false))
                })
            }
        } catch {
            RunLogRuntime.shared.failure(.failure, error: error, phase: "task")
            guard actionEpoch == epoch else { return }
            draftError = "本机草稿未能读取。原有文件保留，暂时不能编辑或发送。"
        }
    }

    var unsavedDraftTextForCopy: String {
        guard needsUnsavedDraftDecision, let account = draftAccount else { return "" }
        return pendingDrafts.sorted { $0.key < $1.key }.filter { $0.value.account == account }
            .map { $0.key + "\n" + $0.value.text }.joined(separator: "\n\n")
    }

    func signOut(discardUnsavedChanges: Bool = false) async {
        guard !authBusy else { return }
        guard !discardUnsavedChanges || needsUnsavedDraftDecision else { return }
        authBusy = true
        if discardUnsavedChanges {
            let workers = Array(draftWorkers.values)
            workers.forEach { $0.cancel() }
            for worker in workers { await worker.value }
        } else if !(await flushDrafts()) {
            draftError = "草稿未能保存，本次尚未退出。请保留当前文字并重试。"
            needsUnsavedDraftDecision = true
            authBusy = false
            return
        }
        clearVisibleAccount()
        var cloudCleanupFailure = false
        do { try await cloudLogin.signOut() } catch { cloudCleanupFailure = true }
        do { try await client.logout() }
        catch let failure as APIFailure {
            switch failure {
            case .logoutIncomplete:
                authError = failure.errorDescription
            case .credentialStorage:
                authError = "当前页面已退出，但钥匙串中的登录凭据未能清除。重新打开可能恢复原账户，请检查钥匙串访问后再试。"
            default:
                authError = "退出结果尚未确认，请重新检查连接后再试。"
            }
        }
        catch { authError = "已在这台设备退出。服务器暂不可达，远端退出结果尚未确认。" }
        if cloudCleanupFailure { authError = "当前页面已退出，但云刷新凭据未能从钥匙串清除，请检查钥匙串访问。" }
        authBusy = false
    }

    private func clearVisibleAccount() {
        mainChat.clear(); sourceMessageTarget = nil
        offline.erase()
        if let directory = timelineStateDirectory {
            do { try OfflineVault.clearActive(directory: directory.appendingPathComponent("Offline"),
                store: KeychainCredentialStore(service: cloudNamespace + ".offline")) }
            catch { authError = "离线副本清理失败，请检查设备存储后重试。" }
        }
        settingsRoute = .init(categoryID: "general")
        timelineRootCommands = []; stoppingActiveTask = false
        subtaskStepTarget = nil; thinking = .init(); thinkingConversation = nil; thinkingError = nil; archiveUndo = nil; hoveredSession = nil; expandedProjectRows = []; projectThinking = false; projectCreatedSessionID = nil
        projects = []; projectCanManage = false; projectsError = nil; projectEditor = nil; projectConversation = nil; projectModels = []; projectBusy = false; projectError = nil; executionAccount = nil; sessionProjectNotices = [:]; collapsedProjects = []
        sessionGroups = []; collapsedSessionGroups = []; openedSessionID = nil; renamingSessionID = nil; groupCandidate = nil; sessionMenuCandidate = nil; deletionInSettings = false; conversationForget = .init(); conversationPreviewToken = UUID(); conversationPreviewLoading = false; deletionCandidate = nil; forgetConversationMemories = false; lifecycleBusy = false; lifecycleError = nil
        #if os(iOS)
        temporaryExpiryCandidate = nil
        #endif
        queueNotice = nil; queueBusy = []; queueCancelRequests = [:]; canceledQueuedTasks = []
        attachmentDrafts.values.flatMap { $0 }.forEach { $0.removeTemporaryFiles() }
        attachmentDrafts = [:]; attachmentAttempts = [:]; attachmentMessageIDs = [:]; attachmentSessionIDs = [:]
        loadingAttachments = []; taskControlSessions = []
        retiringHistoryWorkers.values.forEach { $0.cancel() }
        retiringHistoryWorkers = [:]
        commandWorkers.values.forEach { $0.cancel() }
        adoptionWorkers.values.forEach { $0.cancel() }
        adoptionWorkers = [:]
        adoptionChoices = [:]
        adoptionProjections = [:]
        adoptionPresentations = [:]
        adoptingRequests = []
        preparingAdoptions = []
        adoptionError = nil
        historyWorkers.values.forEach { $0.cancel() }
        commandWorkers = [:]
        historyWorkers = [:]
        historyWorkerTokens = [:]
        continuationNotices = [:]
        sendTargets = [:]
        modelsToConfirm = [:]
        confirmedModels = [:]
        commandPresentations = [:]; observedUserReceipts = []
        preparingConversations = []; preparingMessages = [:]
        reconcilingRequests = []
        clearingDraftKeys = []
        liveConversations = [:]
        cachedConversationHosts = [:]
        knownBoundSessions = [:]
        conversationsCachedAt = nil
        historyCachedAt = nil
        cacheError = nil
        epoch = UUID()
        historyRequest = UUID()
        session = nil
        conversations = []
        devices = []
        messages = []; timeline = TimelineWindow(); timelineMessageIDs = [:]; offlineTimeline = false; olderBusy = false
        #if os(iOS)
        watchBridge.publish(nil)
        #endif
        selectedConversation = nil
        drafts = [:]
        draftWorkers.values.forEach { $0.cancel() }
        draftWorkers = [:]
        pendingDrafts = [:]
        draftRevisions = [:]
        draftSaveStates = [:]
        draftAccount = nil
        draftLoadInFlight = false
        draftLoadRequest = UUID()
        draftsReady = false
        draftError = nil
        draftFlushBusy = false
        needsUnsavedDraftDecision = false
        refreshing = false
        historyBusy = false
        historyError = nil
        conversationsError = nil
        devicesError = nil
        lastRefresh = nil
        verificationPending = false
        authError = nil
    }

    func handleLogicalChatFailure(_ error: Error) async -> Bool { await expireSessionIfNeeded(error) }

    private func expireSessionIfNeeded(_ error: Error) async -> Bool {
        guard let failure = error as? APIFailure else { return false }
        switch failure {
        case .notAuthenticated, .server(401, _), .identityMismatch:
            let savedDrafts = await flushDrafts()
            clearVisibleAccount()
            // The client forgets local credentials even if the server is offline.
            try? await client.logout()
            authError = failure == .identityMismatch
                ? "服务器返回的账户或设备身份不一致，请重新登录。"
                : "登录已过期或设备已撤权，请重新登录。"
            if !savedDrafts { authError = (authError ?? "请重新登录。") + " 有草稿未能保存，本机原有保存版本保留。" }
            return true
        default: return false
        }
    }

    private func friendly(_ error: Error) -> String {
        if let input = error as? ClientInputFailure { return input.errorDescription ?? "请检查输入。" }
        guard let failure = error as? APIFailure else { return "操作未完成，请稍后重试。" }
        switch failure {
        case .server(_, "INVALID_REQUEST"):
            return "请检查账户名、密码和昵称。注册密码需要 15–128 个字符。"
        case .server(let status, _) where status >= 500:
            return "服务器暂时无法完成操作，请稍后重试。"
        default: return failure.errorDescription ?? "操作未完成，请稍后重试。"
        }
    }
}

#if DEBUG && os(macOS)
/// Explicit capture-only alternative for noninteractive sessions without Keychain
/// access. Authentication still uses the real isolated HTTP host; nothing persists.
private final class CaptureCredentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ data: Data, key: String) { lock.withLock { values[key] = data } }
    func delete(key: String) { lock.withLock { values[key] = nil } }
}
#endif
