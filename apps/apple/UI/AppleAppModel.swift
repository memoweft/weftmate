import Combine
import Foundation
import WeftMateCore

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

    /// Read-only task navigation uses an observed session identity, independently of send/model readiness.
    func taskSessionID(for conversation: ConversationSummary, accountEpoch: UUID) -> String? {
        guard accountEpoch == epoch, let session, let selected = selectedConversation,
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
        guard canEditDraft(for: conversation), commandStore != nil, session?.verification == .verified,
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
            let sessions = try await client.sharedSessions()
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
            taskControlSessions = try await client.taskControlSessionIDs()
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
            let prepared = try await Task.detached { () throws -> [ConversationAttachmentDraft] in
                var drafts: [ConversationAttachmentDraft] = []
                do { for file in files { drafts.append(try .prepare(file: file)) }; return drafts }
                catch { drafts.forEach { $0.removeTemporaryFiles() }; throw error }
            }.value
            guard accountEpoch == epoch else { prepared.forEach { $0.removeTemporaryFiles() }; return }
            attachmentDrafts[key, default: []].append(contentsOf: prepared)
            attachmentAttempts[key] = nil; continuationNotices[key] = nil
        } catch {
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

    func send(_ conversation: ConversationSummary, accountEpoch: UUID) async {
        guard accountEpoch == epoch, canSend(conversation), let accountSession = session,
              let local = commandStore, let target = sendTargets[Self.draftKey(for: conversation)] else { return }
        let key = Self.draftKey(for: conversation)
        let text = drafts[key] ?? ""
        guard text.utf16.count <= 8_192 else {
            continuationNotices[key] = "消息太长，请缩短后发送。"
            return
        }
        preparingConversations.insert(key)
        defer { if accountEpoch == epoch { preparingConversations.remove(key) } }
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
                    targetDeviceId: accountSession.hostId, sessionId: target.sessionID, text: text)
            } else {
                let attempt: ConversationAttachmentAttempt
                if let prior = attachmentAttempts[key], prior.drafts == selectedFiles, prior.payload.text == text,
                   prior.payload.sessionId == target.sessionID { attempt = prior }
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
                        originalAttachments: selectedFiles.map(\.original), attachmentMessageId: messageID)
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
            await runCommand(record, allowSubmission: true, conversation: conversation, accountEpoch: accountEpoch)
        } catch {
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
                while self.observationVisible(conversation, accountEpoch: accountEpoch) {
                    try Task.checkCancellation()
                    let page = try await self.client.sharedHistory(sessionID: sessionID, afterSeq: tracker.nextSeq)

                    try tracker.apply(page)
                    guard self.epoch == accountEpoch, !Task.isCancelled else { return }
                    let progress = tracker.progress(for: currentReceipt)
                    self.commandPresentations[id] = .init(record: currentRecord, receipt: currentReceipt, progress: progress,
                        note: nil, lookupNotFound: false)
                    // Bound sync transcripts are merged by the paged timeline, not a second host-only alias.
                    if self.selectedConversation?.id == conversation.id, conversation.conversationId == nil {
                        let known = Set(self.messages.map(\.id))
                        self.messages.append(contentsOf: tracker.messages.filter { !known.contains($0.id) })
                        self.historyCachedAt = nil
                        if !page.events.isEmpty, let local = self.commandStore, let account = self.draftAccount {
                            let snapshot = self.messages
                            do {
                                _ = try await local.cacheHistory(account: account,
                                    conversationKey: Self.draftKey(for: conversation), hostId: record.intent.hostId,
                                    sessionId: sessionID, messages: snapshot, observedThroughSeq: tracker.nextSeq)
                            } catch {
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
    private var cloudNamespace = "com.weftmate.apple.cloud"
    lazy var cloudLogin = CloudLoginModel(app: self, namespace: cloudNamespace)
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
    @Published var appearanceMode = "system" {
        didSet { defaults?.set(appearanceMode, forKey: "appearanceMode") }
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

    init() {
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
        let store = KeychainCredentialStore(service: uiTesting
            ? "\(testService).credentials" : "com.weftmate.apple.credentials")
        cloudNamespace = uiTesting ? testService + ".cloud" : "com.weftmate.apple.cloud"
        var transport = URLSessionTransport(hostPins: HostPinStore(store: KeychainCredentialStore(service: cloudNamespace + ".pins")))
        var routeEnabled = false
        #if DEBUG
        if let index = args.firstIndex(of: "--development-proxy-port") {
            if args.indices.contains(index + 1), let port = Int(args[index + 1]), (1024...65535).contains(port) {
                do {
                    transport = try URLSessionTransport(developmentProxyPort: port)
                    routeEnabled = true
                } catch {
                    configurationError = "局域网开发联调参数无效，请检查启动参数。"
                }
            } else {
                configurationError = "局域网开发联调端口无效，请检查启动参数。"
            }
        }
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
                localDirectory = base.appendingPathComponent("WeftMate/UITests", isDirectory: true)
                    .appendingPathComponent(testNamespace, isDirectory: true)
                    .appendingPathComponent("LocalState", isDirectory: true)
            }
            let local = try LocalConversationStore(directory: localDirectory)
            commandStore = local
            draftPersistence = LocalAppleDraftPersistence(store: local)
        } catch {
            commandStore = nil
            draftPersistence = nil
            initialDraftError = "无法打开本机草稿存储。原有文件保留，暂时不能编辑或发送。"
        }
        var initialAdoptionError: String?
        do {
            if uiTesting && localDirectory == nil { throw LocalEndpointOperationFailure.storageUnavailable }
            endpointStore = try LocalEndpointOperationStore(directory: localDirectory)
        } catch {
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
         commandStore: LocalConversationStore? = nil, endpointStore: LocalEndpointOperationStore? = nil, stateDirectory: URL? = nil) {
        self.client = client
        cloudNamespace = "com.weftmate.apple.unit-tests." + UUID().uuidString
        self.draftPersistence = draftPersistence
        self.commandStore = commandStore
        self.endpointStore = endpointStore
        localStateDirectory = stateDirectory; timelineStateDirectory = stateDirectory
        defaults = nil
        launchConfigurationError = nil
        developmentRouteEnabled = false
        serverInput = server.originString
    }

    private var permitsSyntheticLoopback: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--ui-testing") && (ProcessInfo.processInfo.arguments.contains("--a3-local-server") || ProcessInfo.processInfo.arguments.contains("--a4a-local-server") || ProcessInfo.processInfo.arguments.contains("--a4b-local-server") || ProcessInfo.processInfo.arguments.contains("--s1c-browser-driver"))
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
        #if os(macOS)
        return Host.current().localizedName ?? "我的 Mac"
        #else
        return "我的 iPhone"
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
        #endif
        do {
            let server = try ServerConfiguration(input: serverInput, allowLoopbackHTTP: permitsSyntheticLoopback)
            session = try await client.restoreSession(server: server)
            if session == nil { await cloudLogin.restore() }
            if let session {
                await loadScopedDrafts(session)
                await refresh()
            }
        } catch {
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
            guard actionEpoch == epoch else { return }
            authError = friendly(error)
        }
    }

    func acceptCloudSession(_ result: AccountSession) async {
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
            let result = try await client.conversations()
            guard actionEpoch == epoch else { return }
            taskControlSessions = try await client.taskControlSessionIDs()
            guard actionEpoch == epoch else { return }
            conversations = result
            liveConversations = Dictionary(uniqueKeysWithValues: result.map { ($0.id, $0) })
            conversationsCachedAt = nil
            lastRefresh = Date()
            if let local = commandStore, let account = draftAccount, let session {
                do { _ = try await local.cacheConversationList(account: account, hostId: session.hostId, conversations: result) }
                catch { if actionEpoch == epoch { cacheError = "列表已读取，但本机缓存尚未更新。" } }
            }
        } catch {
            guard actionEpoch == epoch else { return }
            if await expireSessionIfNeeded(error) { return }
            conversationsError = friendly(error)
        }
        do {
            let result = try await client.devices()
            guard actionEpoch == epoch else { return }
            devices = result
        } catch {
            guard actionEpoch == epoch else { return }
            if await expireSessionIfNeeded(error) { return }
            devicesError = friendly(error)
        }
    }

    func open(_ conversation: ConversationSummary) async {
        retireHistoryObservers()
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
        let cacheHost = cachedConversationHosts[conversation.id] ?? session?.hostId
        if let local = commandStore, let account = draftAccount, let cacheHost {
            do {
                if let cached = try await local.cachedHistory(account: account, conversationKey: key,
                                                              hostId: cacheHost, sessionId: conversation.sessionId) {
                    guard actionEpoch == epoch, historyRequest == request else { return }
                    messages = Array(cached.messages.suffix(100))
                    historyCachedAt = cached.cachedAt
                }
            } catch {
                guard actionEpoch == epoch, historyRequest == request else { return }
                cacheError = "本机历史缓存未能读取，原文件保留。"
            }
        }
        if let account = draftAccount, let cacheHost, let sessionID = conversation.sessionId,
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
                timelineMessageIDs = await client.cachedTimelineMessageIDs(sessionID: sessionID)
            }
            historyCachedAt = nil
            historyBusy = false
        } catch {
            guard actionEpoch == epoch, historyRequest == request else { return }
            historyBusy = false
            if await expireSessionIfNeeded(error) { return }
            historyError = friendly(error)
        }
        guard actionEpoch == epoch, historyRequest == request else { return }
        await prepareContinuation(conversation, accountEpoch: actionEpoch)
        guard actionEpoch == epoch, historyRequest == request else { return }
        if historyCachedAt == nil, historyError == nil, let local = commandStore,
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
                timeline.apply(page)
                updateTimelineActivity(conversation)
                let new = try await client.timelineMessages(page.events, sessionID: sessionID)
                let mapped = await client.cachedTimelineMessageIDs(sessionID: sessionID)
                guard actionEpoch == epoch, request == historyRequest, !Task.isCancelled else { return }
                timelineMessageIDs = mapped
                let newIDs = Set(new.map(\.id))
                messages.removeAll { $0.pendingContext && newIDs.contains($0.id) }
                let known = Set(messages.map(\.id)); messages.append(contentsOf: new.filter { !known.contains($0.id) })
                if !page.events.isEmpty {
                    await persistTimeline(conversation)
                    #if os(iOS)
                    _ = await watchSnapshotBytes()
                    #endif
                }
                if !page.hasMore { try await Task.sleep(nanoseconds: policy.delayNanoseconds(madeProgress: !page.events.isEmpty)) }
            } catch {
                if error is CancellationError { return }
                guard actionEpoch == epoch, request == historyRequest else { return }
                if await expireSessionIfNeeded(error) { return }
                historyError = friendly(error); return
            }
        }
    }
    private func updateTimelineActivity(_ conversation: ConversationSummary) {
        guard let last = timeline.events.last(where: { ["turn.started", "task.started", "turn.ended", "task.ended"].contains($0.type) }),
              let index = conversations.firstIndex(where: { $0.id == conversation.id }) else { return }
        let old = conversations[index], running = last.type.hasSuffix("started")
        guard old.running != running else { return }
        conversations[index] = .init(id: old.id, title: old.title, conversationId: old.conversationId, sessionId: old.sessionId,
            running: running, sendAvailable: old.sendAvailable, originalModelLabel: old.originalModelLabel)
    }
    private func persistTimeline(_ conversation: ConversationSummary) async {
        guard historyCachedAt == nil, !timeline.events.isEmpty, let timelineCache, let account = draftAccount, let session,
              let sessionID = conversation.sessionId ?? knownBoundSessions[Self.draftKey(for: conversation)] else { return }
        let window = timeline, actionEpoch = epoch
        do {
            try await timelineCache.save(account: account, hostID: session.hostId, sessionID: sessionID, window: window)
        } catch { if epoch == actionEpoch { cacheError = "当前记录已读取，但本机时间线缓存尚未更新。" } }
    }
    #if os(iOS)
    private lazy var watchBridge = PhoneWatchTimelineBridge(model: self)
    func watchSnapshotBytes() async -> Data? {
        let actionEpoch = epoch
        guard let session, session.verification == .verified else { return nil }
        do {
            let live = try await client.sharedSessions()
            guard actionEpoch == epoch,
                  let currentSession = live.first(where: { $0.running && $0.sessionId == selectedConversation?.sessionId })
                    ?? live.first(where: \.running)
                    ?? live.first(where: { $0.sessionId == selectedConversation?.sessionId })
                    ?? live.first else { return nil }
            let sessionID = currentSession.sessionId
            let page = try await client.timelinePage(sessionID: sessionID)
            let approvals = try await client.approvals(sessionID: sessionID)
            guard actionEpoch == epoch else { return nil }
            let entries = TimelineProjection.entries(page.events)
            let current = entries.last(where: { !$0.steps.isEmpty })
            let completed = page.events.filter { $0.type == "task.ended" }.compactMap { $0.data["taskId"]?.string }
            let running = TimelineProjection.taskRunning(page.events, fallback: currentSession.running)
            let ending = page.events.last(where: { $0.type == "task.ended" || $0.type == "turn.ended" })?.data["reason"]?.string
            let endLabel = ending == "completed" ? "已完成" : ending == "aborted" ? "已停止" : ending == "error" || ending == "blocked" ? "需要处理" : "结果待核对"
            let account = try LocalAccountScope(server: session.server, ownerId: session.account.ownerId)
            let snapshot = WatchTimelineSnapshot(accountKey: account.cacheKey, sessionID: sessionID,
                taskID: current?.steps.last?.taskID, progress: running ? current?.steps.last?.summary ?? "正在处理" : ending == nil && current == nil ? "等待新任务" : endLabel,
                running: running,
                assistantSummary: String((page.events.last(where: { $0.type == "assistant.message" })?.data["text"]?.string ?? "").prefix(240)),
                approvals: approvals.approvals.filter(\.canDecide).map { WatchApproval(id: $0.id, summary: $0.reason) }, completedTaskIDs: completed)
            watchBridge.publish(snapshot); return try JSONEncoder().encode(snapshot)
        } catch { return nil }
    }
    func respondFromWatch(sessionID: String, approvalID: String, outcome: String) async -> Bool {
        let actionEpoch = epoch
        guard let value = ApprovalDecisionOutcome(rawValue: outcome) else { return false }
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
        return responder.errors[key] == nil && responder.hasSaved(key)
    }
    #endif

    func closeConversation() {
        retireHistoryObservers()
        historyRequest = UUID()
        selectedConversation = nil
        messages = []; timeline = TimelineWindow(); timelineMessageIDs = [:]; offlineTimeline = false; olderBusy = false
        historyBusy = false
        historyError = nil
        historyCachedAt = nil
    }

    static func draftKey(for conversation: ConversationSummary) -> String {
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
        guard draftsReady else { return draftError == nil ? "正在读取本机草稿…" : "草稿尚未读取" }
        switch draftSaveStates[Self.draftKey(for: conversation)] {
        case .saving: return "正在保存…"
        case .saved: return "已保存到本机"
        case .failed: return "尚未保存"
        case nil: return "本账户的本机草稿"
        }
    }

    func setDraft(_ text: String, for conversation: ConversationSummary, accountEpoch: UUID) {
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
        commandPresentations = [:]
        preparingConversations = []
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
