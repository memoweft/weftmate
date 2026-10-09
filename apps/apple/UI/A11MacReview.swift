#if DEBUG && os(macOS)
import AppKit
import Foundation
import WeftMateCore

@MainActor private final class A11NativeMenuObserver: NSObject {
    var menu: NSMenu?
    override init() {
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(track(_:)), name: NSMenu.didBeginTrackingNotification, object: nil)
    }
    @objc private func track(_ notification: Notification) { menu = notification.object as? NSMenu }
    func stop() { NotificationCenter.default.removeObserver(self); menu = nil }
}

@MainActor enum A11MacReview {
    private static func step(_ text: String) { FileHandle.standardOutput.write(Data(("A11_STEP:" + text + "\n").utf8)) }
    private static func press(_ id: String) async throws { try await A10MacReview.press(id); try await Task.sleep(for: .milliseconds(350)) }
    private struct Failure: Error { let step: String }
    private static func until(_ message: String, _ condition: () -> Bool) async throws {
        for _ in 0..<150 { if condition() { return }; try await Task.sleep(for: .milliseconds(200)) }
        throw Failure(step: message)
    }
    static func run(_ app: AppleAppModel, local: Bool) async throws {
        guard app.session?.verification == .verified, let project = app.projects.first,
              let ordinary = app.conversations.first(where: { $0.title == "待移动的合成对话" }),
              let restricted = app.conversations.first(where: { $0.title == "受限聊天" }) else { throw Failure(step: "Login/project list failed") }
        let menuObserver = A11NativeMenuObserver()
        defer { menuObserver.stop() }
        NSApplication.shared.setActivationPolicy(.regular); NSApplication.shared.activate(ignoringOtherApps: true)
        _ = try await A10MacReview.wait("projectToggle." + project.id)
        try await A10MacReview.capture("projects-list", identifier: "conversationList")
        step("collapse project")
        try await press("projectToggle." + project.id)
        guard app.collapsedProjects.contains(project.id) else { throw Failure(step: "Project did not collapse") }
        try await press("projectToggle." + project.id)
        step("expand project")
        var createdID: String?
        if local {
            guard app.canChooseProjectFolder else { throw Failure(step: "Trusted local identity not enabled") }
            step("open project editor")
            try await press("newProject")
            _ = try await A10MacReview.wait("projectEditor")
            step("open native folder panel")
            try await press("projectChooseFolder")
            try await until("NSOpenPanel missing") { ProjectFolderPicker.panel?.isVisible == true }
            guard let picker = ProjectFolderPicker.panel, picker.canChooseDirectories, !picker.canChooseFiles else { throw Failure(step: "Not a native directory picker") }
            try await Task.sleep(for: .seconds(2))
            // The system view service does not expose its choose button through
            // this app's own control tree. Open/cancel the real panel, then supply
            // the synthetic OS-selection callback without adding system permissions.
            step("cancel native folder panel; use explicit synthetic selection callback")
            picker.cancel(nil)
            try await until("NSOpenPanel did not cancel") { ProjectFolderPicker.panel == nil }
            let args = ProcessInfo.processInfo.arguments
            guard let index = args.firstIndex(of: "--a11-folder"), args.indices.contains(index + 1) else { throw Failure(step: "Synthetic folder not supplied") }
            ProjectFolderPicker.acceptSelection(URL(fileURLWithPath: args[index + 1]), app: app)
            try await until("NSOpenPanel folder selection not applied") { app.projectEditor?.draft.name == "A11Folder" }
            app.projectEditor?.draft.instructions = "只使用合成资料，输出简洁中文。"
            try await A10MacReview.capture("project-create", identifier: "projectEditor")
            try await press("projectSave")
            try await until("Project registration did not arrive") { app.projects.contains { $0.name == "A11Folder" } && app.projectEditor == nil }
            try await until("Project editor did not dismiss") { A10MacReview.control("projectEditor") == nil }
            createdID = app.projects.first { $0.name == "A11Folder" }?.id
            try await A10MacReview.capture("projects-created", identifier: "conversationList")
        } else {
            guard !app.canChooseProjectFolder, A10MacReview.control("newProject") == nil,
                  A10MacReview.control("projectSettings." + project.id) == nil else { throw Failure(step: "Remote Mac exposed local folder management") }
            _ = try await A10MacReview.wait("projectsCreateOnHost")
        }
        let target = createdID.flatMap { id in app.projects.first { $0.id == id } } ?? project
        step("new project conversation")
        try await press("projectNewConversation." + target.id)
        _ = try await A10MacReview.wait("projectConversationSheet")
        try await until("Project models missing") { !app.projectModelID.isEmpty }
        try await A10MacReview.capture("project-new-conversation", identifier: "projectConversationSheet")
        try await press("projectStartConversation")
        try await until("Project conversation did not open") { app.selectedConversation?.projectId == target.id && app.projectConversation == nil && !app.historyBusy }
        guard let conversation = app.selectedConversation else { throw Failure(step: "Created conversation missing") }
        try await until("Project send target missing") { app.sendTargets[AppleAppModel.draftKey(for: conversation)] != nil }
        app.setDraft("A11 合成项目消息", for: conversation, accountEpoch: app.accountEpoch)
        try await until("Project send not ready") { app.canSend(conversation) }
        try await A10MacReview.capture("project-send-ready")
        try await press("sendButton")
        try await until("Project send not acknowledged") { app.draftText(for: conversation, accountEpoch: app.accountEpoch).isEmpty }
        try await until("Project synthetic turn still running") { app.conversations.first { $0.id == conversation.id }?.running == false }
        try await A10MacReview.capture("project-sent")
        // Open the same native session menu used by the row and toolbar.
        step("move conversation")
        app.sessionMenuCandidate = ordinary
        _ = try await A10MacReview.wait("sessionAction.project")
        try await A10MacReview.capture("move-project", identifier: "conversationDetail")
        menuObserver.menu = nil
        try await press("sessionAction.project")
        try await until("Native project submenu missing") { menuObserver.menu?.items.contains(where: { $0.title == target.name }) == true }
        guard let menu = menuObserver.menu, let index = menu.items.firstIndex(where: { $0.title == target.name }) else { throw Failure(step: "Native project submenu item missing") }
        menu.performActionForItem(at: index); menu.cancelTrackingWithoutAnimation()
        try await Task.sleep(for: .milliseconds(350))
        try await until("Move did not change project binding") { app.conversations.first { $0.id == ordinary.id }?.projectId == target.id }
        app.openedSessionID = ordinary.id
        _ = try await A10MacReview.wait("projectNotice")
        try await A10MacReview.capture("project-moved")
        if local {
            try await press("projectSettings." + target.id)
            _ = try await A10MacReview.wait("projectEditor")
            app.projectEditor?.draft.name = "合成资料已改名"
            app.projectEditor?.draft.instructions = "仅阅读合成资料。"
            app.projectEditor?.draft.permission = .readOnly
            try await A10MacReview.capture("project-settings", identifier: "projectEditor")
            try await press("projectSave")
            try await until("Project settings not saved") { app.projects.first { $0.id == target.id }?.permission == .readOnly && app.projectEditor == nil }
            try await press("projectSettings." + target.id)
            try await press("projectRemove")
            _ = try await A10MacReview.wait("projectConfirmRemove")
            try await A10MacReview.capture("project-remove", identifier: "projectEditor")
            try await press("projectConfirmRemove")
            try await until("Project registration not removed") { !app.projects.contains { $0.id == target.id } && app.projectEditor == nil }
            let args = ProcessInfo.processInfo.arguments
            guard let i = args.firstIndex(of: "--a11-folder"), args.indices.contains(i + 1), FileManager.default.fileExists(atPath: URL(fileURLWithPath: args[i + 1]).appendingPathComponent("brief.md").path) else { throw Failure(step: "Synthetic project file was removed") }
            guard app.conversations.contains(where: { $0.id == conversation.id && $0.projectId == nil }), app.conversations.contains(where: { $0.id == ordinary.id && $0.projectId == nil }) else { throw Failure(step: "Project removal lost conversations") }
            try await A10MacReview.capture("project-removed")
        }
        app.openedSessionID = restricted.id
        _ = try await A10MacReview.wait("restrictedSessionNotice")
        guard A10MacReview.control("approvalBar") == nil, A10MacReview.control("approvalMode") == nil else { throw Failure(step: "Restricted session exposed approvals") }
        try await A10MacReview.capture("restricted-session")
        FileHandle.standardOutput.write(Data(("A10_REPORT:" + String(data: try JSONSerialization.data(withJSONObject: ["authenticated":true,"localIdentity":local,"projectCreated":createdID != nil,"nativeFolderPanelOpened":local,"nativeFolderSelectionConfirmed":false,"syntheticFolderSelection":local,"projectConversation":true,"projectSent":true,"moved":true,"settingsAndRemoval":local,"syntheticFilePreserved":local,"restrictedNotice":true,"ownWindowCapture":true,"globalPermissionsRequested":false]), encoding:.utf8)! + "\n").utf8))
    }
}
#endif
