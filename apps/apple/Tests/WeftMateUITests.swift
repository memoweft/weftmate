import XCTest
import CryptoKit
#if os(macOS)
import AppKit
import ApplicationServices
#endif

final class WeftMateUITests: XCTestCase {
    @MainActor func testCandidateTextArtifactPreviewSaveAndReturnDraft() throws {
        #if os(iOS)
        let env = ProcessInfo.processInfo.environment
        guard let username = env["WEFTMATE_E2E_USERNAME"], !username.isEmpty,
              let password = env["WEFTMATE_E2E_PASSWORD"], !password.isEmpty,
              let sessionID = env["WEFTMATE_E2E_CONVERSATION_ID"],
              let taskID = env["WEFTMATE_E2E_TASK_ID"],
              let artifactID = env["WEFTMATE_E2E_ARTIFACT_ID"],
              let commandID = env["WEFTMATE_E2E_ARTIFACT_COMMAND_ID"],
              let fileName = env["WEFTMATE_E2E_ARTIFACT_FILE_NAME"],
              let sizeText = env["WEFTMATE_E2E_ARTIFACT_EXPECTED_BYTES"], let expectedSize = Int(sizeText),
              let expectedHash = env["WEFTMATE_E2E_ARTIFACT_EXPECTED_SHA256"],
              let marker = env["WEFTMATE_E2E_MARKER"] else {
            throw XCTSkip("Private text-artifact scenario inputs are required.")
        }
        let identityMatches = env["WEFTMATE_E2E_SERVER"] == "https://home.weftmate.com:58450"
            && env["WEFTMATE_E2E_NAMESPACE"] == "cross-artifact-ios-2c8d"
            && env["WEFTMATE_E2E_DEVELOPMENT_PROXY_PORT"] == nil
            && sessionID == "session-747f2417-d9f3-4812-b797-6bedfcf2d88c"
            && taskID == "cmd-3f583862-7ac3-49a8-9bf1-1390710062f8"
            && artifactID == "artifact-475b99e8-1033-4ca9-9b79-8f919ad946c5"
            && commandID == "cmd-53d6b16c-21c2-49c8-b8e0-d970def8b196"
            && marker == "TEXT_ARTIFACT_DELIVERY" && fileName == "information.txt" && expectedSize == 206
            && expectedHash == "ac61c4ece8a9a5a906d6fc73e46a3a76d4b8ff60b3bcd47d199d20143d0c1953"
        XCTAssertTrue(identityMatches, "Use only the assigned independent text-artifact scenario.")
        guard identityMatches else { return }
        let app = launchApp(realServer: true)
        let saveReturnOnly = env["WEFTMATE_E2E_ARTIFACT_SAVE_RETURN_ONLY"] == "true"
        if app.textFields["username"].waitForExistence(timeout: 4) {
            login(app, username: username, password: password, privateReadiness: true)
        } else { XCTAssertTrue(element(app, "conversationList").waitForExistence(timeout: 30)) }
        let original = element(app, "conversationRow." + sessionID)
        XCTAssertTrue(original.waitForExistence(timeout: 15)); original.tap()
        let markerNode = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch
        XCTAssertTrue(markerNode.waitForExistence(timeout: 30))
        let progress = element(app, "conversationTaskProgress." + taskID)
        XCTAssertTrue(progress.waitForExistence(timeout: 30))
        let draft = element(app, "conversationDraft")
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        let retainedDraft = "Text artifact navigation draft 2c8d"
        let restoredOriginalDraft = (draft.value as? String) == retainedDraft
        if !restoredOriginalDraft {
            let emptyDraft = ((draft.value as? String) ?? "").isEmpty
            XCTAssertTrue(emptyDraft, "Preserve any different existing draft rather than appending or overwriting it.")
            guard emptyDraft else { return }
            draft.tap(); draft.typeText(retainedDraft)
        }
        let details = progress.buttons.matching(identifier: "inlineTaskDetailsButton").firstMatch
        scrollConversationControl(details, draft: draft, app: app)
        XCTAssertTrue(details.exists && details.isHittable); details.tap()
        let workspace = app.scrollViews["taskWorkspace"]
        XCTAssertTrue(workspace.waitForExistence(timeout: 15))
        let parentID = "taskArtifact." + artifactID
        let preview = workspace.buttons.matching(NSPredicate(format: "label == %@ AND (identifier == %@ OR identifier == %@)",
            "预览成果", "previewTaskArtifact." + artifactID, parentID)).firstMatch
        for _ in 0..<4 { if preview.exists && preview.isHittable { break }; workspace.swipeUp() }
        let namedArtifact = workspace.staticTexts.matching(NSPredicate(format: "label == %@", fileName)).firstMatch.exists
        XCTAssertTrue(namedArtifact)
        if !saveReturnOnly {
            XCTAssertTrue(preview.exists && preview.isEnabled && preview.isHittable)
            preview.tap()
            let labels = workspace.staticTexts.matching(NSPredicate(format: "identifier == %@ OR identifier == %@", "taskArtifactPreview." + artifactID, parentID))
            var previewBytesMatch = false, previewHashMatch = false
            let previewDeadline = Date().addingTimeInterval(20)
            while Date() < previewDeadline && !previewHashMatch {
                for node in labels.allElementsBoundByIndex {
                    let bytes = Data(node.label.utf8)
                    let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
                    if hash == expectedHash { previewHashMatch = true; previewBytesMatch = bytes.count == expectedSize; break }
                }
                if !previewHashMatch { RunLoop.current.run(until: Date().addingTimeInterval(0.5)) }
            }
            retainScreenshot(app, name: "private-new-text-artifact-preview")
            print("CANDIDATE_TEXT_ARTIFACT identityMatched=\(identityMatches) markerObserved=\(markerNode.exists) namedArtifact=\(namedArtifact) previewRepeated=true previewBytesMatch=\(previewBytesMatch) previewHashMatch=\(previewHashMatch) newTaskSent=false answerTouched=false approvalTouched=false")
            XCTAssertTrue(previewBytesMatch && previewHashMatch, "Native preview must match the original UTF8 bytes and SHA without trimming or invented content.")
            guard previewBytesMatch && previewHashMatch else { return }
        } else {
            print("CANDIDATE_TEXT_SAVE_RETURN_ONLY identityMatched=\(identityMatches) namedArtifact=\(namedArtifact) previewRepeated=false restoredOriginalDraft=\(restoredOriginalDraft) newTaskSent=false")
        }
        let save = workspace.buttons.matching(NSPredicate(format: "label == %@ AND (identifier == %@ OR identifier == %@)",
            "保存文件", "saveTaskArtifact." + artifactID, parentID)).firstMatch
        for _ in 0..<3 { if save.exists && save.isHittable { break }; workspace.swipeUp() }
        var saveAttempted = false, saveConfirmed = false, cancelled = false, isolatedFolderSelected = false
        var exporterObserved = false, downloadValidatedNotice = false
        var localProviderObserved = false, inlineRenameObserved = false, nativeFilenamePrepared = false, saveTapped = false
        let nativeSaveBaseName = "weftmate-live2c8d-information-" + UUID().uuidString.lowercased()
        let expectedNativeSavedFileName = nativeSaveBaseName + ".txt"
        let nativeBar = app.navigationBars["FullDocumentManagerViewControllerNavigationBar"]
        let filename = app.textFields["DOCPicker.filenameTextField"]
        if save.exists && save.isEnabled && save.isHittable {
            saveAttempted = true; save.tap()
            exporterObserved = nativeBar.waitForExistence(timeout: 15)
            if exporterObserved {
                retainScreenshot(app, name: "private-new-text-artifact-native-exporter")
                let localRoot = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@",
                    "DOC.browsingRoot Source: com.apple.FileProvider.LocalStorage, ")).firstMatch
                if !localRoot.exists {
                    let local = app.cells.matching(NSPredicate(format: "label IN %@", ["我的 iPhone", "我的iPhone", "On My iPhone", "在我的 iPhone 上"])).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
                    if let local { local.tap(); _ = localRoot.waitForExistence(timeout: 3) }
                }
                localProviderObserved = localRoot.exists
                if localProviderObserved {
                    // The observed new-folder editor is inline, with a native Done keyboard key.
                    let rename = app.textViews["DOC.inlineRenameField"]
                    inlineRenameObserved = rename.exists
                    if rename.exists && rename.isHittable {
                        let done = app.keyboards.buttons.matching(identifier: "Done").allElementsBoundByIndex.first { $0.exists && $0.isHittable }
                        if let done { done.tap() }
                    }
                    if let folderName = env["WEFTMATE_E2E_NATIVE_SAVE_FOLDER"], !folderName.isEmpty {
                        let folder = localRoot.cells.matching(NSPredicate(format: "label == %@", folderName)).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
                        if let folder { folder.tap(); isolatedFolderSelected = true }
                    }
                    // A fresh filename avoids overwriting; a new directory is not required.
                    if localRoot.exists && !rename.exists && filename.exists && filename.isHittable {
                        filename.tap()
                        let oldName = filename.value as? String ?? ""
                        filename.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: oldName.count) + nativeSaveBaseName)
                        nativeFilenamePrepared = (filename.value as? String) == nativeSaveBaseName
                        let done = app.keyboards.buttons.matching(identifier: "Done").allElementsBoundByIndex.first { $0.exists && $0.isHittable }
                        if let done { done.tap() }
                        let confirm = nativeBar.buttons.matching(NSPredicate(format: "label IN %@", ["存储", "保存", "Save"])).allElementsBoundByIndex.first { $0.exists && $0.isEnabled && $0.isHittable }
                        if nativeFilenamePrepared && localRoot.exists, let confirm {
                            saveTapped = true; confirm.tap()
                        }
                    }
                }
                let savedNotice = workspace.staticTexts.matching(NSPredicate(format: "label == %@", "已保存到你选择的位置。")).firstMatch
                if saveTapped { saveConfirmed = savedNotice.waitForExistence(timeout: 10) && !nativeBar.exists }
                if !saveConfirmed && nativeBar.exists {
                    let done = app.keyboards.buttons.matching(identifier: "Done").allElementsBoundByIndex.first { $0.exists && $0.isHittable }
                    if let done { done.tap() }
                    let cancel = app.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", ["取消", "Cancel"])).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
                    if let cancel {
                        cancel.tap()
                        cancelled = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: nativeBar)], timeout: 10) == .completed
                    }
                }
            }
            downloadValidatedNotice = exporterObserved || workspace.staticTexts.matching(NSPredicate(format: "label == %@", "完整文件已校验，等待选择保存位置。")).firstMatch.exists
        }
        retainScreenshot(app, name: "private-new-text-artifact-save-attempt-result")
        print("CANDIDATE_TEXT_SAVE attempted=\(saveAttempted) exporterObserved=\(exporterObserved) sdkDownloadValidated=\(downloadValidatedNotice) localProviderObserved=\(localProviderObserved) inlineRenameObserved=\(inlineRenameObserved) newFolderActionObserved=false isolatedFolderCreated=false isolatedFolderSelected=\(isolatedFolderSelected) nativeFilenamePrepared=\(nativeFilenamePrepared) saveTapped=\(saveTapped) saveConfirmed=\(saveConfirmed) expectedNativeSavedFileName=\(expectedNativeSavedFileName) cancelled=\(cancelled) savedFileBytesVerified=false")
        let exporterClosed = !nativeBar.exists && !filename.exists
        XCTAssertTrue(exporterClosed, "Do not use the covered task view as proof that the exporter has closed.")
        guard exporterClosed else { return }
        XCTAssertTrue(element(app, "taskWorkspace").exists, "Finish or cancel the ordinary exporter before returning to the original conversation.")
        let taskBar = app.navigationBars.matching(NSPredicate(format: "identifier == %@ OR label == %@", "任务", "任务")).firstMatch
        let taskBack = taskBar.buttons.matching(identifier: "BackButton").firstMatch
        XCTAssertTrue(taskBack.exists && taskBack.isHittable); taskBack.tap()
        XCTAssertTrue(draft.waitForExistence(timeout: 15))
        let draftRetained = (draft.value as? String) == retainedDraft
        let sameTask = element(app, "conversationTaskProgress." + taskID).waitForExistence(timeout: 15)
        let visible = draft.isHittable && app.windows.firstMatch.frame.contains(draft.frame)
        XCTAssertTrue(draftRetained && sameTask && visible)
        draft.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let refocusPreserved = (draft.value as? String) == retainedDraft
        draft.typeText(" continued")
        let editable = (draft.value as? String) == retainedDraft + " continued"
        retainScreenshot(app, name: "private-new-text-artifact-return-draft")
        print("CANDIDATE_TEXT_RETURN draftRetained=\(draftRetained) sameTask=\(sameTask) visible=\(visible) refocusPreserved=\(refocusPreserved) editable=\(editable) newTaskSent=false")
        XCTAssertTrue(refocusPreserved && editable)
        #else
        throw XCTSkip("The new text-artifact native entry is the assigned isolated iOS device.")
        #endif
    }

    @MainActor func testCandidateQuestionAnswerApprovalOnce() throws {
        #if os(iOS)
        let env = ProcessInfo.processInfo.environment
        guard let username = env["WEFTMATE_E2E_USERNAME"], !username.isEmpty,
              let password = env["WEFTMATE_E2E_PASSWORD"], !password.isEmpty,
              let sessionID = env["WEFTMATE_E2E_CONVERSATION_ID"],
              let taskID = env["WEFTMATE_E2E_TASK_ID"],
              let questionID = env["WEFTMATE_E2E_QUESTION_RPC_ID"],
              let marker = env["WEFTMATE_E2E_MARKER"],
              let expectedApprovalID = env["WEFTMATE_E2E_EXPECTED_APPROVAL_ID"],
              let expectedTool = env["WEFTMATE_E2E_APPROVAL_TOOL_NAME"], !expectedTool.isEmpty else {
            throw XCTSkip("Private candidate execution inputs are required.")
        }
        let identityMatches = env["WEFTMATE_E2E_SERVER"] == "https://home.weftmate.com:58450"
            && env["WEFTMATE_E2E_NAMESPACE"] == "real-ui-b8d7b9f416494c0fade756cc72ad93dd"
            && env["WEFTMATE_E2E_DEVELOPMENT_PROXY_PORT"] == nil
            && sessionID == "session-36a4a8e7-a361-43bd-a668-95c43cb74761"
            && taskID == "cmd-93d90ace-ce9c-4acd-a373-cc6910d58dad"
            && questionID == "e77abfc5-37ee-4712-8216-e16d323ce9d4"
            && marker == "QUESTION_CLIENT_INFORMATION" && UUID(uuidString: expectedApprovalID) != nil
        XCTAssertTrue(identityMatches, "Execution must use the assigned candidate and existing isolated namespace.")
        guard identityMatches else { return }
        let app = launchApp(realServer: true)
        if app.textFields["username"].waitForExistence(timeout: 4) {
            login(app, username: username, password: password, privateReadiness: true)
        } else { XCTAssertTrue(element(app, "conversationList").waitForExistence(timeout: 30)) }
        let original = element(app, "conversationRow." + sessionID)
        XCTAssertTrue(original.waitForExistence(timeout: 15)); original.tap()
        XCTAssertTrue(element(app, "conversationDetail").waitForExistence(timeout: 15))
        let markerNode = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch
        XCTAssertTrue(markerNode.waitForExistence(timeout: 30))
        let interactions = element(app, "taskInteractions." + taskID)
        XCTAssertTrue(interactions.waitForExistence(timeout: 30))
        let question = interactions.descendants(matching: .any).matching(identifier: "questionCard." + questionID).firstMatch
        let readAnswers = question.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "submittedQuestionAnswer." + questionID + "."))
        let submit = question.buttons.matching(identifier: "submitQuestion." + questionID).firstMatch
        let custom = question.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "questionCustom." + questionID + "."))
        let answerDeadline = Date().addingTimeInterval(120)
        while Date() < answerDeadline && !(question.exists && readAnswers.count > 0 && !submit.exists && custom.count == 0) {
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        let answerReadonly = question.exists && readAnswers.count > 0 && !submit.exists && custom.count == 0
        XCTAssertTrue(answerReadonly, "Observe the original information answer as read-only; never submit it from iOS.")
        guard answerReadonly else { return }
        let approvals = interactions.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "approveOnce."))
        let approvalDeadline = Date().addingTimeInterval(120)
        while Date() < approvalDeadline && approvals.count == 0 {
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTAssertTrue(approvals.count == 1, "Only one live approval may exist in this task subtree.")
        guard approvals.count == 1 else { return }
        let allow = approvals.element(boundBy: 0)
        let prefix = "approveOnce."
        let approvalID = String(allow.identifier.dropFirst(prefix.count))
        let approvalMatches = allow.identifier == prefix + expectedApprovalID && approvalID == expectedApprovalID
        let card = interactions.descendants(matching: .any).matching(identifier: "approvalCard." + approvalID).firstMatch
        let toolMatches = card.staticTexts.matching(NSPredicate(format: "label == %@", expectedTool)).firstMatch.exists
        XCTAssertTrue(approvalMatches && card.exists && toolMatches, "Match the actual task-bound approval and its authorized tool before deciding.")
        guard approvalMatches && card.exists && toolMatches else { return }
        let window = app.windows.firstMatch, draft = element(app, "conversationDraft")
        for _ in 0..<4 {
            let top = app.navigationBars.firstMatch.frame.maxY, bottom = draft.frame.minY - 48
            if allow.frame.minY > top && allow.frame.maxY < bottom { break }
            guard bottom - 16 > top + 16 else { break }
            let origin = window.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: 8, dy: bottom - 16)).press(forDuration: 0.05,
                thenDragTo: origin.withOffset(CGVector(dx: 8, dy: top + 16)))
        }
        let ready = allow.exists && allow.isEnabled && allow.isHittable && window.frame.contains(allow.frame)
            && allow.frame.minY > app.navigationBars.firstMatch.frame.maxY && allow.frame.maxY < draft.frame.minY - 48
        XCTAssertTrue(ready && approvals.count == 1 && allow.identifier == prefix + expectedApprovalID)
        guard ready && approvals.count == 1 && allow.identifier == prefix + expectedApprovalID else { return }
        retainScreenshot(app, name: "private-candidate-readonly-answer-single-approval-before-tap")
        print("CANDIDATE_APPROVAL identityMatched=true answerReadonly=true approvalUnique=true approvalMatched=true toolMatched=true visible=true answerTouched=false")
        // One coordinate event only. Never retry this decision or use a continue/recovery submission.
        allow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        print("CANDIDATE_APPROVAL singleTap=true")
        let notice = interactions.descendants(matching: .any).matching(identifier: "interactionNotice.approval:" + approvalID).firstMatch
        var registeredObserved = false, nativeConfirmed = false
        let confirmationDeadline = Date().addingTimeInterval(120)
        while Date() < confirmationDeadline && !nativeConfirmed {
            if notice.exists {
                registeredObserved = registeredObserved || notice.label.contains("已登记")
                nativeConfirmed = notice.label == "执行端已确认本次允许决定；任务进度另行显示。"
            }
            if !nativeConfirmed { RunLoop.current.run(until: Date().addingTimeInterval(0.5)) }
        }
        retainScreenshot(app, name: "private-candidate-single-approval-receipt")
        print("CANDIDATE_APPROVAL registeredNoticeObserved=\(registeredObserved) nativeConfirmed=\(nativeConfirmed) repeatDecision=false")
        XCTAssertTrue(nativeConfirmed, "A registered decision is not native execution confirmation; do not retry an unknown decision.")
        guard nativeConfirmed else { return }
        let progress = element(app, "conversationTaskProgress." + taskID)
        let reply = progress.descendants(matching: .any).matching(identifier: "inlineTaskReplyStatus").firstMatch
        let endDeadline = Date().addingTimeInterval(120)
        while Date() < endDeadline && reply.exists && !["回复已结束", "回复失败", "回复已中止"].contains(reply.label) {
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        let states = ["回复已结束": "completed", "回复失败": "failed", "回复已中止": "aborted", "回复需要处理": "blocked", "回复结果待核对": "unconfirmed", "正在回复": "streaming", "等待回复": "waiting"]
        let replyState = reply.exists ? states[reply.label] ?? "unknown" : "unavailable"
        let details = progress.buttons.matching(identifier: "inlineTaskDetailsButton").firstMatch
        var artifactObserved = false, expectedArtifactObserved = false
        if details.exists && details.isHittable {
            details.tap()
            let workspace = app.scrollViews["taskWorkspace"]
            if workspace.waitForExistence(timeout: 15) {
                for _ in 0..<4 {
                    let rows = workspace.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "taskArtifact."))
                    if rows.count > 0 { artifactObserved = true; break }
                    workspace.swipeUp()
                }
                if let file = env["WEFTMATE_E2E_ARTIFACT_FILE_NAME"], !file.isEmpty {
                    expectedArtifactObserved = workspace.staticTexts.matching(NSPredicate(format: "label == %@", file)).firstMatch.exists
                }
            }
        }
        retainScreenshot(app, name: "private-candidate-original-task-final-observation")
        print("CANDIDATE_TASK replyState=\(replyState) artifactObserved=\(artifactObserved) expectedArtifactObserved=\(expectedArtifactObserved) answerTouched=false repeatDecision=false")
        #else
        throw XCTSkip("The assigned live approval executor is the isolated iOS entry.")
        #endif
    }

    @MainActor func testCandidatePendingQuestionReadiness() throws {
        #if os(iOS)
        let environment = ProcessInfo.processInfo.environment
        guard let username = environment["WEFTMATE_E2E_USERNAME"], !username.isEmpty,
              let password = environment["WEFTMATE_E2E_PASSWORD"], !password.isEmpty,
              let sessionID = environment["WEFTMATE_E2E_CONVERSATION_ID"],
              let taskID = environment["WEFTMATE_E2E_TASK_ID"],
              let questionID = environment["WEFTMATE_E2E_QUESTION_RPC_ID"],
              let marker = environment["WEFTMATE_E2E_MARKER"], !marker.isEmpty,
              let namespace = environment["WEFTMATE_E2E_NAMESPACE"], !namespace.isEmpty else {
            throw XCTSkip("Private candidate readiness inputs are required.")
        }
        let identityMatches = environment["WEFTMATE_E2E_SERVER"] == "https://home.weftmate.com:58450"
            && environment["WEFTMATE_E2E_DEVELOPMENT_PROXY_PORT"] == nil
            && sessionID == "session-36a4a8e7-a361-43bd-a668-95c43cb74761"
            && taskID == "cmd-93d90ace-ce9c-4acd-a373-cc6910d58dad"
            && questionID == "e77abfc5-37ee-4712-8216-e16d323ce9d4"
            && marker == "QUESTION_CLIENT_INFORMATION"
        XCTAssertTrue(identityMatches, "Candidate identity inputs must match the assigned read-only scene.")
        guard identityMatches else { return }
        let app = launchApp(realServer: true)
        if app.textFields["username"].waitForExistence(timeout: 4) {
            login(app, username: username, password: password, privateReadiness: true)
        } else {
            XCTAssertTrue(element(app, "conversationList").waitForExistence(timeout: 30), "Same isolated namespace must restore the issued account.")
        }
        let original = element(app, "conversationRow." + sessionID)
        XCTAssertTrue(original.waitForExistence(timeout: 15)); original.tap()
        XCTAssertTrue(element(app, "conversationDetail").waitForExistence(timeout: 15))
        let actualMarker = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch
        XCTAssertTrue(actualMarker.waitForExistence(timeout: 30), "Read the actual candidate marker from its original goal or message.")
        let interactions = element(app, "taskInteractions." + taskID)
        XCTAssertTrue(interactions.waitForExistence(timeout: 30))
        let question = interactions.descendants(matching: .any).matching(identifier: "questionCard." + questionID).firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 30))
        let submit = question.buttons.matching(identifier: "submitQuestion." + questionID).firstMatch
        let window = app.windows.firstMatch
        let draft = element(app, "conversationDraft")
        // Only drag in the empty left gutter; never press an option, custom field or response control.
        for _ in 0..<4 {
            let top = app.navigationBars.firstMatch.frame.maxY
            let bottom = draft.frame.minY - 48
            if submit.exists && submit.frame.minY > top && submit.frame.maxY < bottom { break }
            guard bottom - 16 > top + 16 else { break }
            let origin = window.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: 8, dy: bottom - 16)).press(forDuration: 0.05,
                thenDragTo: origin.withOffset(CGVector(dx: 8, dy: top + 16)))
        }
        let submitExists = submit.exists
        let disabled = submitExists && !submit.isEnabled
        let visible = submitExists && submit.frame.height > 0 && window.frame.contains(submit.frame)
            && submit.frame.minY > app.navigationBars.firstMatch.frame.maxY
            && submit.frame.maxY < draft.frame.minY - 48
        XCTAssertTrue(submitExists && disabled && visible, "The assigned unanswered question must remain visible with submission disabled.")
        retainScreenshot(app, name: "private-candidate-pending-question-readiness")
        print("CANDIDATE_PENDING identityMatched=\(identityMatches) markerObserved=\(actualMarker.exists) taskMatched=\(interactions.exists) questionMatched=\(question.exists) submitExists=\(submitExists) disabled=\(disabled) visible=\(visible) answerTouched=false approvalTouched=false")
        if let releasePath = environment["WEFTMATE_E2E_HOLD_RELEASE_FILE"] {
            print("CANDIDATE_PENDING_UI_HOLD active=true responsesAuthorized=false")
            let deadline = Date().addingTimeInterval(900)
            while !FileManager.default.fileExists(atPath: releasePath) && Date() < deadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.25))
            }
        }
        #else
        throw XCTSkip("Read-only candidate readiness targets the assigned isolated iOS entry.")
        #endif
    }

    @MainActor func testA2AttachmentHistoryComposerAndPreview() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a2-" + UUID().uuidString,
            "--apple-contract-fixture", "--server-url", "https://a2-ui.unit.example"]
        app.launch()
        XCTAssertTrue(element(app, "conversationList").waitForExistence(timeout: 15))
        let row = element(app, "conversationRow.session-11111111-1111-4111-8111-111111111111")
        XCTAssertTrue(row.waitForExistence(timeout: 15)); row.tap()
        let detail = element(app, "conversationDraft")
        XCTAssertTrue(detail.waitForExistence(timeout: 10))
        XCTAssertFalse(element(app, "conversationTasksButton").exists)
        let history = app.buttons.matching(NSPredicate(format: "label == %@", "预览 历史图片.png")).firstMatch
        XCTAssertTrue(history.waitForExistence(timeout: 10)); history.tap()
        let panel = element(app, "attachmentPreviewPanel")
        XCTAssertTrue(panel.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["保存文件"].waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "attachmentImageContent").waitForExistence(timeout: 10))
        retainScreenshot(app, name: "a2-history-image-preview")
        app.buttons["关闭预览"].tap()
        XCTAssertTrue(element(app, "conversationDraft").waitForExistence(timeout: 5))
        element(app, "addAttachmentButton").tap()
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "添加测试文件")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["A2-测试文件.txt"].waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "sendButton").isEnabled)
        retainScreenshot(app, name: "a2-attachment-only-composer")
        element(app, "sendButton").tap()
        XCTAssertTrue(app.staticTexts["已收到测试文件。"].waitForExistence(timeout: 10))
        retainScreenshot(app, name: "a2-sent-file-in-history")
        let file = app.buttons.matching(NSPredicate(format: "label == %@", "预览 A2-测试文件.txt")).firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 5)); file.tap()
        XCTAssertTrue(app.buttons["保存文件"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "A2 controlled attachment file 中文")).firstMatch.waitForExistence(timeout: 10))
        retainScreenshot(app, name: "a2-history-file-preview")
        app.buttons["关闭预览"].tap()
    }

    @MainActor func testControlledArtifactPreviewAndReturnDraft() throws {
        try controlledArtifactFlow(interactions: false)
    }
    @MainActor func testControlledApprovalQuestionArtifactAndReturnDraft() throws {
        try controlledArtifactFlow(interactions: true)
    }
    @MainActor private func controlledArtifactFlow(interactions: Bool) throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "artifact-return-" + UUID().uuidString,
            "--task-progress-fixture", "--server-url", "https://task-ui.unit.example:8443"]
        if interactions { app.launchArguments.append("--interaction-flow-fixture") }
        app.launch()
        #if os(macOS)
        app.activate()
        if let process = NSRunningApplication.runningApplications(withBundleIdentifier: "com.weftmate.apple.weftmatemac").first,
           process.bundleURL?.path.contains("MacDerived/Build/Products/Debug/") == true {
            let activated = process.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
            let root = AXUIElementCreateApplication(process.processIdentifier)
            var rawWindows: CFTypeRef?
            let read = AXUIElementCopyAttributeValue(root, kAXWindowsAttribute as CFString, &rawWindows)
            if read == .success, let windows = rawWindows as? [AXUIElement], let window = windows.first {
                let raised = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
                print("MAC_TEST_WINDOW activated=\(activated) raiseResult=\(raised.rawValue) pid=\(process.processIdentifier)")
            } else { print("MAC_TEST_WINDOW activated=\(activated) windowRead=\(read.rawValue)") }
        }
        let username = app.textFields["username"]
        XCTAssertTrue(username.waitForExistence(timeout: 15)); username.click(); username.typeText("task_fixture")
        let password = app.secureTextFields["password"]
        password.click(); password.typeText("synthetic-only"); app.buttons["loginButton"].click()
        XCTAssertTrue(element(app, "conversationList").waitForExistence(timeout: 15))
        #else
        login(app, username: "task_fixture", password: "synthetic-only")
        #endif
        let original = element(app, "conversationRow.session-fixture")
        XCTAssertTrue(original.waitForExistence(timeout: 10)); artifactPress(original)
        let draft = element(app, "conversationDraft")
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        artifactPress(draft); draft.typeText("Artifact preview original request")
        XCTAssertTrue(app.buttons["sendButton"].isEnabled); artifactPress(app.buttons["sendButton"])
        XCTAssertTrue(element(app, "inlineTaskOriginalGoal").waitForExistence(timeout: 15))
        let retainedDraft = "Draft kept while reading the original artifact"
        artifactPress(draft); draft.typeText(retainedDraft)
        #if os(iOS)
        if interactions {
            let approvalID = "e853ec16-12a9-4590-9dbb-c4b9a2ff84de"
            let questionID = "fbfe3e79-8276-4900-bc75-1f78cb7bb844"
            let allow = app.buttons["approveOnce." + approvalID]
            XCTAssertTrue(allow.waitForExistence(timeout: 10))
            scrollConversationControl(allow, draft: draft, app: app)
            XCTAssertTrue(allow.isEnabled && allow.isHittable); allow.tap()
            let approvalNotice = element(app, "interactionNotice.approval:" + approvalID)
            let confirmed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "已确认本次允许"), object: approvalNotice)
            XCTAssertEqual(XCTWaiter.wait(for: [confirmed], timeout: 10), .completed)
            let option = app.buttons["questionOption.\(questionID).format.完整"]
            scrollConversationControl(option, draft: draft, app: app)
            XCTAssertTrue(option.isHittable); option.tap()
            let custom = element(app, "questionCustom.\(questionID).notes")
            scrollConversationControl(custom, draft: draft, app: app)
            XCTAssertTrue(custom.isHittable); custom.tap(); custom.typeText("同意")
            let submit = app.buttons["submitQuestion." + questionID]
            scrollConversationControl(submit, draft: draft, app: app)
            XCTAssertTrue(submit.isEnabled && submit.isHittable); submit.tap()
            let questionNotice = element(app, "interactionNotice.question:" + questionID)
            let adopted = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "执行端已接收这次回答。"), object: questionNotice)
            XCTAssertEqual(XCTWaiter.wait(for: [adopted], timeout: 10), .completed)
            XCTAssertEqual(element(app, "submittedQuestionAnswer.\(questionID).notes").label, "同意")
            XCTAssertEqual(approvalNotice.label, "执行端已确认本次允许决定；任务进度另行显示。")
            let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "回复已结束"), object: element(app, "inlineTaskReplyStatus"))
            XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 15), .completed)
            XCTAssertEqual(draft.value as? String, retainedDraft)
            retainScreenshot(app, name: "controlled-same-task-approval-question-acknowledged")
            print("INTERACTION_FLOW sameTask=cmd-fixture approvalNativeResolved=true answerOwnEntryAccepted=true answerTextIsInformationOnly=true draftRetained=true externalHTTP=0 paidProvider=0")
        }
        #endif
        let details = app.buttons["inlineTaskDetailsButton"]
        XCTAssertTrue(details.waitForExistence(timeout: 10))
        #if os(iOS)
        let window = app.windows.firstMatch
        for _ in 0..<3 {
            let barBottom = app.navigationBars.firstMatch.frame.maxY
            let composerTop = draft.frame.minY - 48
            if details.frame.maxY < composerTop && details.frame.minY > barBottom { break }
            let start = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.frame.midX, dy: composerTop - 16))
            let end = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.frame.midX, dy: barBottom + 16))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertLessThan(details.frame.maxY, draft.frame.minY - 48)
        #endif
        XCTAssertTrue(details.isHittable); artifactPress(details)
        let workspace = app.scrollViews["taskWorkspace"]
        XCTAssertTrue(workspace.waitForExistence(timeout: 10))
        let namedPreview = app.buttons.matching(NSPredicate(format: "label == %@", "预览成果")).firstMatch
        for _ in 0..<4 {
            if namedPreview.exists && namedPreview.isHittable { break }
            workspace.swipeUp()
        }
        let ax = XCTAttachment(string: app.debugDescription)
        ax.name = "controlled-artifact-visible-AX-before-click"; ax.lifetime = .keepAlways; add(ax)
        for button in app.buttons.allElementsBoundByIndex where ["预览成果", "保存文件"].contains(button.label) {
            print("ARTIFACT_AX label=\(button.label) identifier=\(button.identifier) enabled=\(button.isEnabled) hittable=\(button.isHittable) frame=\(button.frame)")
        }
        retainScreenshot(app, name: "controlled-artifact-visible-before-click")
        XCTAssertTrue(app.staticTexts["受控成果.md"].exists, "The preview must belong to the original task's named artifact.")
        XCTAssertTrue(namedPreview.exists && namedPreview.isEnabled && namedPreview.isHittable)
        artifactPress(namedPreview)
        let expected = "# 受控界面成果\n这是测试文件，未调用真实模型。"
        let body = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "这是测试文件，未调用真实模型。")).firstMatch
        XCTAssertTrue(body.waitForExistence(timeout: 10))
        XCTAssertEqual(body.label.trimmingCharacters(in: .whitespacesAndNewlines), expected)
        retainScreenshot(app, name: "controlled-original-artifact-body-visible")
        print("ARTIFACT_BODY_MATCH original=artifact-fixture filename=受控成果.md fullRenderedBody=true")
        #if os(iOS)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        #else
        app.typeKey("[", modifierFlags: .command)
        #endif
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        XCTAssertEqual(draft.value as? String, retainedDraft)
        XCTAssertTrue(element(app, "inlineTaskOriginalGoal").waitForExistence(timeout: 10))
        XCTAssertEqual(element(app, "inlineTaskOriginalGoal").label, "Artifact preview original request")
        let returnedAX = XCTAttachment(string: app.debugDescription)
        returnedAX.name = "controlled-return-draft-AX-before-edit"; returnedAX.lifetime = .keepAlways; add(returnedAX)
        retainScreenshot(app, name: "controlled-original-draft-visible-before-edit")
        print("RETURN_DRAFT_AX frame=\(draft.frame) hittable=\(draft.isHittable) keyboard=\(app.keyboards.count)")
        XCTAssertTrue(draft.isHittable)
        XCTAssertTrue(app.windows.firstMatch.frame.contains(draft.frame), "Returned composer must remain in the visible window.")
        #if os(macOS)
        draft.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
        #else
        draft.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        #endif
        XCTAssertEqual(draft.value as? String, retainedDraft, "Refocusing must not change the saved draft.")
        draft.typeText(" continued")
        XCTAssertEqual(draft.value as? String, retainedDraft + " continued")
        retainScreenshot(app, name: "controlled-original-conversation-draft-focus-return")
        print("ARTIFACT_RETURN_MATCH sameConversation=session-fixture draftRetained=true editableFocus=true")
    }

    @MainActor private func artifactPress(_ control: XCUIElement) {
        #if os(macOS)
        control.click()
        #else
        control.tap()
        #endif
    }

    #if os(iOS)
    @MainActor private func scrollConversationControl(_ control: XCUIElement, draft: XCUIElement, app: XCUIApplication) {
        let window = app.windows.firstMatch
        for _ in 0..<8 {
            let barBottom = app.navigationBars.firstMatch.frame.maxY
            let composerTop = draft.frame.minY - 48
            let frame = control.frame
            print("INTERACTION_SCROLL id=\(control.identifier) frame=\(frame) visibleTop=\(barBottom) visibleBottom=\(composerTop) hittable=\(control.isHittable)")
            if control.exists, control.isHittable, control.frame.minY > barBottom,
               control.frame.maxY < composerTop { return }
            let middle = (barBottom + composerTop) / 2
            let direction: CGFloat = control.exists && frame.minY < barBottom ? -1 : 1
            let distance = min(max(80, abs(frame.midY - middle)), (composerTop - barBottom) * 0.55)
            let start = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.frame.midX, dy: middle + direction * distance / 2))
            let end = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.frame.midX, dy: middle - direction * distance / 2))
            start.press(forDuration: 0.1, thenDragTo: end)
        }
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "controlled-interaction-control-not-visible"; hierarchy.lifetime = .keepAlways; add(hierarchy)
        retainScreenshot(app, name: "controlled-interaction-control-not-visible")
    }
    #endif

    func testControlledTaskProgressStopArtifactAndReturnDraft() throws {
        #if os(iOS)
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "task-flow-" + UUID().uuidString,
            "--task-progress-fixture", "--server-url", "https://task-ui.unit.example:8443"]
        app.launch()
        login(app, username: "task_fixture", password: "synthetic-only")
        let conversation = element(app, "conversationRow.session-fixture")
        XCTAssertTrue(conversation.waitForExistence(timeout: 10))
        conversation.tap()
        let draft = element(app, "conversationDraft")
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        draft.tap(); draft.typeText("Controlled original request")
        let send = app.buttons["sendButton"]
        XCTAssertTrue(send.isEnabled)
        send.tap()
        XCTAssertTrue(element(app, "inlineTaskReplyStatus").waitForExistence(timeout: 15))
        XCTAssertEqual(element(app, "inlineTaskReplyStatus").label, "回复需要处理")
        XCTAssertTrue(element(app, "inlineTaskLatestStep").label.contains("状态待核对"))
        retainScreenshot(app, name: "controlled-inline-task-unknown-step")

        draft.tap(); draft.typeText("Draft retained across task details")
        let details = app.buttons["inlineTaskDetailsButton"]
        XCTAssertTrue(details.waitForExistence(timeout: 10))
        // isHittable can be true for a lazy ScrollView row covered by the safe-area composer.
        // Scroll within its observed visible region; a gesture starting below it hits the keyboard.
        let window = app.windows.firstMatch
        for _ in 0..<3 {
            let barBottom = app.navigationBars.firstMatch.frame.maxY
            let composerTop = draft.frame.minY - 48
            if details.frame.maxY < composerTop && details.frame.minY > barBottom { break }
            let start = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.frame.midX, dy: composerTop - 16))
            let end = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: window.frame.midX, dy: barBottom + 16))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertLessThan(details.frame.maxY, draft.frame.minY - 48, "Task link must be fully above the composer before tapping.")
        XCTAssertGreaterThan(details.frame.minY, app.navigationBars.firstMatch.frame.maxY)
        details.tap()
        XCTAssertTrue(element(app, "taskWorkspace").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["状态待核对"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["打开应用"].exists)
        let stop = app.buttons["stopTaskButton"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10)); stop.tap()
        let control = element(app, "taskControlStatus")
        XCTAssertTrue(control.waitForExistence(timeout: 10))
        let requested = NSPredicate(format: "label == %@", "已请求停止，等待执行回执。")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: requested, object: control)], timeout: 10), .completed)
        retainScreenshot(app, name: "controlled-stop-requested-not-stopped")
        app.buttons["refreshTaskButton"].tap()
        let stopped = NSPredicate(format: "label == %@", "服务已确认停止。")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: stopped, object: control)], timeout: 10), .completed)
        let preview = app.buttons["previewTaskArtifact.artifact-fixture"]
        for _ in 0..<4 where !preview.isHittable { app.scrollViews.firstMatch.swipeUp() }
        XCTAssertTrue(preview.isHittable); preview.tap()
        let text = element(app, "taskArtifactPreview.artifact-fixture")
        XCTAssertTrue(text.waitForExistence(timeout: 10))
        XCTAssertTrue(text.label.contains("这是测试文件，未调用真实模型。"))
        retainScreenshot(app, name: "controlled-task-stopped-verified-artifact")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        XCTAssertEqual(draft.value as? String, "Draft retained across task details")
        retainScreenshot(app, name: "controlled-task-return-same-draft")
        #else
        throw XCTSkip("This controlled keyboard/back gesture workflow targets the isolated iOS simulator.")
        #endif
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launchApp(realServer: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        let environment = ProcessInfo.processInfo.environment
        let namespace = realServer
            ? (environment["WEFTMATE_E2E_NAMESPACE"] ?? "real-ui-" + UUID().uuidString)
            : "smoke-ui-" + UUID().uuidString
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", namespace]
        if realServer {
            app.launchArguments += ["--server-url", environment["WEFTMATE_E2E_SERVER"] ?? "https://home.weftmate.com:8443"]
            if let port = environment["WEFTMATE_E2E_DEVELOPMENT_PROXY_PORT"] {
                app.launchArguments += ["--development-proxy-port", port]
            }
        }
        app.launch()
        return app
    }

    private func retainScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func login(_ app: XCUIApplication, username: String, password: String, privateReadiness: Bool = false) {
        let usernameField = app.textFields["username"]
        XCTAssertTrue(usernameField.waitForExistence(timeout: 15))
        usernameField.tap()
        usernameField.typeText(username)
        let passwordField = app.secureTextFields["password"]
        passwordField.tap()
        passwordField.typeText(password)
        app.buttons["loginButton"].tap()
        XCTAssertTrue(element(app, "conversationList").waitForExistence(timeout: 45),
                      "Login must reach the real conversation screen.")
        #if os(iOS)
        // The system offers to save the synthetic password after a real login.
        // Keep that credential out of Passwords and expose the underlying app.
        let offer = app.sheets.matching(NSPredicate(format: "label == %@", "保存密码？")).firstMatch
        if offer.waitForExistence(timeout: 5) {
            retainScreenshot(app, name: "synthetic-password-offer-before-decline")
            let later = offer.buttons.matching(NSPredicate(format: "label == %@", "以后")).firstMatch
            XCTAssertTrue(later.exists && later.isEnabled && later.isHittable)
            if privateReadiness { print("PASSWORD_OFFER observed=true") }
            else { print("PASSWORD_OFFER observed=保存密码？ button=以后 frame=\(later.frame)") }
            // Target the actual system-sheet button, not a same-named node elsewhere in the app.
            later.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            var closed = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: offer)], timeout: 4) == .completed
            if !closed && later.exists && later.isHittable {
                later.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                closed = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: offer)], timeout: 4) == .completed
            }
            XCTAssertTrue(closed, "The normal password offer must actually disappear before continuing.")
            print("PASSWORD_OFFER declineTapped=true sheetDisappeared=\(closed)")
            retainScreenshot(app, name: "synthetic-password-offer-declined-list-visible")
        }
        #endif
    }

    private func openDevices(_ app: XCUIApplication) -> String {
        #if os(macOS)
        element(app, "devicesNavigation").tap()
        #else
        openPhoneAuxiliary(app, item: "phoneMenu.devices")
        #endif
        XCTAssertTrue(element(app, "devicesList").waitForExistence(timeout: 15))
        let current = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "currentDevice.")).firstMatch
        XCTAssertTrue(current.waitForExistence(timeout: 30),
                      "The server must identify this app's current device.")
        return current.identifier
    }

    private func verifyAccount(_ app: XCUIApplication, username: String) {
        #if os(macOS)
        element(app, "settingsNavigation").tap()
        #else
        openPhoneAuxiliary(app, item: "phoneMenu.settings")
        #endif
        let account = element(app, "accountUsername")
        XCTAssertTrue(account.waitForExistence(timeout: 15))
        XCTAssertEqual(account.label, username)
    }

    private func signOut(_ app: XCUIApplication) {
        #if os(macOS)
        element(app, "settingsNavigation").tap()
        #else
        openPhoneAuxiliary(app, item: "phoneMenu.settings")
        #endif
        let button = app.buttons["signOutButton"]
        XCTAssertTrue(button.waitForExistence(timeout: 15))
        button.tap()
        let confirmation = app.buttons["退出登录"].firstMatch
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        confirmation.tap()
        XCTAssertTrue(app.textFields["username"].waitForExistence(timeout: 30))
    }

    private func readFixture(_ app: XCUIApplication, conversationID: String, title: String?, marker: String) {
        #if !os(macOS)
        closePhoneAuxiliary(app)
        if element(app, "conversationDetail").exists {
            let back = app.navigationBars.buttons["对话"].firstMatch
            XCTAssertTrue(back.exists)
            back.tap()
        }
        #endif
        let row = element(app, "conversationRow." + conversationID)
        XCTAssertTrue(row.waitForExistence(timeout: 30),
                      "The original conversation identity must come from the server.")
        if let title, !title.isEmpty {
            XCTAssertTrue(row.label.contains(title), "The original server conversation title must be retained.")
        }
        row.tap()
        XCTAssertTrue(element(app, "conversationDetail").waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts[marker].waitForExistence(timeout: 30),
                      "Read the original synthetic message; a conversation row alone is insufficient.")
    }

    #if os(iOS)
    private func closePhoneAuxiliary(_ app: XCUIApplication) {
        let done = app.buttons["closeAuxiliarySheetButton"]
        if done.exists { done.tap() }
    }

    private func openPhoneAuxiliary(_ app: XCUIApplication, item: String) {
        closePhoneAuxiliary(app)
        let menu = app.buttons["phoneAccountMenu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.tap()
        let choice = app.buttons[item]
        XCTAssertTrue(choice.waitForExistence(timeout: 5))
        choice.tap()
    }

    @MainActor func testPhoneAccountMenuReturnsToSameDraft() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let username = environment["WEFTMATE_E2E_USERNAME"],
              let password = environment["WEFTMATE_E2E_PASSWORD"],
              let conversationID = environment["WEFTMATE_E2E_CONVERSATION_ID"],
              let marker = environment["WEFTMATE_E2E_MARKER"] else {
            throw XCTSkip("An isolated original-message fixture is required.")
        }
        let app = launchApp(realServer: true)
        login(app, username: username, password: password)
        XCTAssertEqual(app.tabBars.count, 0, "Conversation is the primary page, auxiliary pages use the account menu.")
        readFixture(app, conversationID: conversationID,
                    title: environment["WEFTMATE_E2E_CONVERSATION_TITLE"], marker: marker)
        retainScreenshot(app, name: "account-menu-original-conversation-before-draft")
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "account-menu-conversation-accessibility"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let draft = element(app, "conversationDraft")
        XCTAssertTrue(draft.waitForExistence(timeout: 15))
        let text = "Apple account-menu draft " + UUID().uuidString
        draft.tap(); draft.typeText(text)
        let saved = app.descendants(matching: .any).matching(identifier: "draftSaveStatus").firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 10))
        let savedPredicate = NSPredicate(format: "label CONTAINS %@", "已保存到本机")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: savedPredicate, object: saved)], timeout: 10), .completed)
        retainScreenshot(app, name: "account-menu-saved-draft")

        openPhoneAuxiliary(app, item: "phoneMenu.spirit")
        XCTAssertTrue(element(app, "spiritProfile").waitForExistence(timeout: 10))
        app.buttons["spiritStatesDisclosure"].tap()
        retainScreenshot(app, name: "selected-spirit-details")
        closePhoneAuxiliary(app)
        XCTAssertTrue(app.staticTexts[marker].exists)
        XCTAssertEqual(draft.value as? String, text)

        openPhoneAuxiliary(app, item: "phoneMenu.memory")
        XCTAssertTrue(app.staticTexts["我的记忆"].waitForExistence(timeout: 15))
        closePhoneAuxiliary(app)
        XCTAssertEqual(draft.value as? String, text)
        XCTAssertTrue(app.staticTexts[marker].exists)
        retainScreenshot(app, name: "account-menu-returned-to-draft")
        signOut(app)
    }

    @MainActor func testPhoneSpiritReferenceShowsWholeImage() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let username = environment["WEFTMATE_E2E_USERNAME"],
              let password = environment["WEFTMATE_E2E_PASSWORD"] else {
            throw XCTSkip("An isolated backend fixture is required.")
        }
        let app = launchApp(realServer: true)
        login(app, username: username, password: password)
        openPhoneAuxiliary(app, item: "phoneMenu.spirit")
        XCTAssertTrue(element(app, "spiritProfile").waitForExistence(timeout: 10))
        app.buttons["spiritStatesDisclosure"].tap()
        let image = app.images.matching(NSPredicate(format: "label == %@",
            "小纬的待机、倾听、思考和完成四种表情设定")).firstMatch
        XCTAssertTrue(image.waitForExistence(timeout: 10))
        app.scrollViews.firstMatch.swipeUp()
        XCTAssertGreaterThan(image.frame.width, 200)
        XCTAssertEqual(image.frame.width, image.frame.height, accuracy: 2,
                       "The square state artwork must retain its full aspect ratio.")
        retainScreenshot(app, name: "selected-spirit-full-state-reference")
        closePhoneAuxiliary(app)
        signOut(app)
    }
    #endif

    func testSignedOutEntryCanBeUsed() throws {
        let app = launchApp()
        XCTAssertTrue(app.textFields["username"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.secureTextFields["password"].exists)
        XCTAssertTrue(app.buttons["loginButton"].exists)
        XCTAssertTrue(app.buttons["注册"].exists)
        app.buttons["注册"].tap()
        XCTAssertTrue(app.buttons["registerButton"].exists)
        retainScreenshot(app, name: "isolated-registration-form")
    }

    func testConnectionFailurePreservesInputs() throws {
        let app = launchApp()
        let username = app.textFields["username"]
        XCTAssertTrue(username.waitForExistence(timeout: 15))
        username.tap()
        username.typeText("apple_failure_probe")
        let password = app.secureTextFields["password"]
        password.tap()
        password.typeText("LocalFailureProbe123!")
        app.buttons["loginButton"].tap()
        XCTAssertTrue(app.otherElements["authError"].waitForExistence(timeout: 30)
            || app.staticTexts["authError"].exists,
            "An unreachable server must show a failure instead of a logged-in state.")
        XCTAssertEqual(username.value as? String, "apple_failure_probe")
        XCTAssertTrue(app.buttons["loginButton"].isEnabled)
        XCTAssertFalse(app.tables["conversationList"].exists)
        retainScreenshot(app, name: "isolated-connection-failure")
    }

    func testRealLoginAndConversationRead() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let username = environment["WEFTMATE_E2E_USERNAME"],
              let password = environment["WEFTMATE_E2E_PASSWORD"],
              let conversationID = environment["WEFTMATE_E2E_CONVERSATION_ID"],
              let marker = environment["WEFTMATE_E2E_MARKER"],
              !username.isEmpty, !password.isEmpty, !conversationID.isEmpty, !marker.isEmpty else {
            throw XCTSkip("An isolated backend account and original message fixture are required for the real login test.")
        }
        let app = launchApp(realServer: true)
        login(app, username: username, password: password)
        let title = environment["WEFTMATE_E2E_CONVERSATION_TITLE"]
        readFixture(app, conversationID: conversationID, title: title, marker: marker)
        retainScreenshot(app, name: "real-original-message")
        let firstDevice = openDevices(app)
        retainScreenshot(app, name: "real-server-devices")
        verifyAccount(app, username: username)

        // Same test namespace and launch arguments restore the issued credential.
        app.terminate()
        app.launch()
        XCTAssertTrue(element(app, "conversationList").waitForExistence(timeout: 45),
                      "Restart must verify the saved credential without a new login.")
        XCTAssertFalse(app.textFields["username"].exists)
        XCTAssertEqual(openDevices(app), firstDevice, "Restart must preserve the issued device identity.")
        readFixture(app, conversationID: conversationID, title: title, marker: marker)
        retainScreenshot(app, name: "real-restored-original-message")

        if let secondUsername = environment["WEFTMATE_E2E_SECOND_USERNAME"],
           let secondPassword = environment["WEFTMATE_E2E_SECOND_PASSWORD"],
           !secondUsername.isEmpty, !secondPassword.isEmpty {
            signOut(app)
            login(app, username: secondUsername, password: secondPassword)
            XCTAssertTrue(app.staticTexts["这个账户还没有已同步的对话。"].waitForExistence(timeout: 30),
                          "The isolated second account must finish loading its own empty history.")
            XCTAssertFalse(element(app, "conversationRow." + conversationID).exists)
            XCTAssertFalse(app.staticTexts[marker].exists)
            XCTAssertNotEqual(openDevices(app), firstDevice)
            verifyAccount(app, username: secondUsername)
            retainScreenshot(app, name: "real-second-account-isolation")
            signOut(app)
            login(app, username: username, password: password)
            readFixture(app, conversationID: conversationID, title: title, marker: marker)
            retainScreenshot(app, name: "real-primary-account-return")
        } else {
            XCTContext.runActivity(named: "Second-account UI isolation not run: private fixture missing") { _ in }
        }
        signOut(app)
    }

    func testRealConversationNavigationLayout() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let username = environment["WEFTMATE_E2E_USERNAME"],
              let password = environment["WEFTMATE_E2E_PASSWORD"],
              let conversationID = environment["WEFTMATE_E2E_CONVERSATION_ID"],
              let marker = environment["WEFTMATE_E2E_MARKER"],
              !username.isEmpty, !password.isEmpty, !conversationID.isEmpty, !marker.isEmpty else {
            throw XCTSkip("A private original-message fixture is required for the layout regression.")
        }
        let app = launchApp(realServer: true)
        login(app, username: username, password: password)
        let title = environment["WEFTMATE_E2E_CONVERSATION_TITLE"]
        readFixture(app, conversationID: conversationID, title: title, marker: marker)
        let refresh = app.buttons["refreshHistoryButton"]
        XCTAssertTrue(refresh.exists && refresh.isHittable,
                      "The navigation refresh control must remain usable below the development notice.")
        #if os(iOS)
        let navigation = app.navigationBars.firstMatch
        XCTAssertTrue(navigation.exists)
        let back = navigation.buttons.firstMatch
        XCTAssertTrue(back.exists && back.isHittable)
        let notice = element(app, "developmentRouteNotice")
        if notice.exists {
            XCTAssertFalse(notice.frame.intersects(refresh.frame))
            XCTAssertFalse(notice.frame.intersects(back.frame))
            if let title, !title.isEmpty {
                let heading = navigation.staticTexts[title].firstMatch
                XCTAssertTrue(heading.exists)
                XCTAssertFalse(notice.frame.intersects(heading.frame))
            }
        }
        #endif
        retainScreenshot(app, name: "real-original-message-navigation-visible")
        signOut(app)
    }
}

#if os(iOS)
extension WeftMateUITests {
    @MainActor func testHealthSettingsDefaultsAndReturnToConversation() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "h1-settings-" + UUID().uuidString,
            "--apple-contract-fixture", "--server-url", "https://a2-ui.unit.example"]
        app.launch()
        XCTAssertTrue(app.buttons["phoneAccountMenu"].waitForExistence(timeout: 20))
        app.buttons["phoneAccountMenu"].tap()
        app.buttons["phoneMenu.health"].tap()
        XCTAssertTrue(app.buttons["healthAuthorize"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label == %@", "尚未请求读取权限")).firstMatch.exists)
        let cloud = app.descendants(matching: .any).matching(identifier: "healthCloudAllowed").firstMatch
        for _ in 0..<4 {
            if cloud.exists && cloud.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(cloud.exists)
        XCTAssertEqual(cloud.value as? String, "0")
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "h1-health-settings-defaults"
        screenshot.lifetime = .keepAlways; add(screenshot)
        app.buttons["closeAuxiliarySheetButton"].tap()
        XCTAssertTrue(app.buttons["phoneAccountMenu"].waitForExistence(timeout: 10))
        app.buttons["phoneAccountMenu"].tap(); app.buttons["phoneMenu.health"].tap()
        app.buttons["healthAuthorize"].tap()
        XCTAssertTrue(app.buttons["仅供本地模型使用（默认）"].waitForExistence(timeout: 5))
        app.terminate() // Dismiss the consent prompt without requesting any system authorization.
    }

    @MainActor func testHealthKitSyntheticDailySummary() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "h1-isolated", "--h1-healthkit-fixture"]
        app.launch()
        XCTAssertTrue(app.buttons["healthFixtureStart"].waitForExistence(timeout: 20))
        app.buttons["healthFixtureStart"].tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline {
            let result = app.staticTexts["healthFixtureResult"]
            if result.exists && (result.label.hasPrefix("PASS:") || result.label.hasPrefix("FAIL:") || result.label == "UNAVAILABLE") { break }
            let allCategories = app.cells["UIA.Health.AuthSheet.AllCategoryButton"]
            if allCategories.exists && allCategories.isHittable { allCategories.tap() }
            for surface in [app, springboard] {
                for label in ["Turn On All", "全部打开", "Allow", "允许", "Done", "完成"] {
                    let control = surface.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
                    if control.exists && control.isHittable && control.isEnabled { control.tap() }
                }
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        let result = app.staticTexts["healthFixtureResult"]
        if result.label == "UNAVAILABLE" { throw XCTSkip("HealthKit is unavailable on this simulator") }
        XCTAssertTrue(result.label.hasPrefix("PASS:"), result.label + "\n" + app.debugDescription)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.lifetime = .keepAlways; add(attachment)
    }
}
#endif
