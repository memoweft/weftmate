#if os(macOS)
import AppKit
import SwiftUI
import WeftMateCore

/// Native AppKit menu items keep destructive color, checkmarks, keyboard selection,
/// and submenus. Actions still belong to AppleAppModel / MainChatModel.
@MainActor enum MacSessionMenu {
    @MainActor private final class Action: NSObject {
        let run: @MainActor () -> Void
        init(_ run: @escaping @MainActor () -> Void) { self.run = run }
        @objc func invoke(_ sender: NSMenuItem) { run() }
    }
    static func entry(_ title: String, icon: String? = nil, enabled: Bool = true, checked: Bool = false, destructive: Bool = false, appearanceMode: String, shortcut: String = "", action: @escaping @MainActor () -> Void) -> NSMenuItem {
            let target = Action(action), item = NSMenuItem(title: title, action: #selector(Action.invoke(_:)), keyEquivalent: shortcut)
            item.keyEquivalentModifierMask = []
            item.target = target; item.representedObject = target; item.isEnabled = enabled
            item.state = checked ? .on : .off
            if let icon, let image = NSImage(named: "wm-" + icon + "-small")?.copy() as? NSImage {
                image.size = NSSize(width: AppleTokens.Space.p16, height: AppleTokens.Space.p16); image.isTemplate = true; item.image = image
            }
            if destructive {
                let scheme = AppleAppearance(rawValue: appearanceMode)?.colorScheme
                let appearance = scheme.map { NSAppearance(named: $0 == .dark ? .darkAqua : .aqua)! } ?? NSAppearance.currentDrawing()
                appearance.performAsCurrentDrawingAppearance {
                    let color = NSColor(Weave.danger).usingColorSpace(.deviceRGB) ?? NSColor(Weave.danger)
                    item.attributedTitle = NSAttributedString(string: title, attributes: [.foregroundColor: color, .font: NSFont.menuFont(ofSize: 0)])
                }
            }
            return item
        }

    static func make(app: AppleAppModel, conversation: ConversationSummary, usage: (@MainActor () -> Void)? = nil) -> NSMenu {
        let row = app.conversations.first { $0.id == conversation.id } ?? conversation
        let menu = NSMenu(title: "对话菜单"); menu.autoenablesItems = false
        func item(_ title: String, icon: String? = nil, enabled: Bool = true, checked: Bool = false, destructive: Bool = false, shortcut: String = "", action: @escaping @MainActor () -> Void) -> NSMenuItem {
            entry(title, icon: icon, enabled: enabled, checked: checked, destructive: destructive, appearanceMode: app.appearanceMode, shortcut: shortcut, action: action)
        }
        func submenu(_ title: String, icon: String, entries: [NSMenuItem], enabled: Bool = true) {
            let parent = item(title, icon: icon, enabled: enabled, action: {})
            let child = NSMenu(title: title); child.autoenablesItems = false
            entries.forEach { child.addItem($0) }; parent.submenu = child; menu.addItem(parent)
        }
        let enabled = !app.lifecycleBusy
        if app.mainChat.capabilities.supports("temporaryChats") {
            menu.addItem(item("此对话不形成记忆", icon: "memory", enabled: enabled, checked: row.temporaryState.memoryMode == "off") {
                Task { await app.mainChat.temporarySetting(row, fields: ["memoryMode": .string(row.temporaryState.memoryMode == "off" ? "on" : "off")]) }
            })
            menu.addItem(item("使用已有记忆", icon: "book", enabled: enabled, checked: row.temporaryState.recallEnabled) {
                Task { await app.mainChat.temporarySetting(row, fields: ["recallEnabled": .bool(!row.temporaryState.recallEnabled)]) }
            })
            submenu("自动删除 · " + (row.temporaryState.autoDeleteDays.map { "\($0) 天" } ?? "不自动删除"), icon: "clock", entries: [1, 7, 30, 0].map { days in
                item(days == 0 ? "不自动删除" : "\(days) 天", checked: (row.temporaryState.autoDeleteDays ?? 0) == days) {
                    Task { await app.mainChat.temporarySetting(row, fields: ["autoDeleteDays": days == 0 ? .null : .number(Double(days))]) }
                }
            }, enabled: enabled)
            menu.addItem(.separator())
        }
        menu.addItem(item(row.pinned ? "取消置顶" : "置顶", icon: "pin", enabled: enabled, shortcut: "p") { Task { await app.updateMetadata(row, pinned: !row.pinned) } })
        menu.addItem(item(row.unread ? "标记为已读" : "标记为未读", icon: "mail", enabled: enabled, shortcut: "u") { Task { await app.updateMetadata(row, unread: !row.unread) } })
        menu.addItem(item("重命名", icon: "edit", enabled: enabled, shortcut: "r") { app.beginRename(row) })
        menu.addItem(item("分叉", icon: "chat", enabled: enabled && !row.running, shortcut: "f") { Task { await app.fork(row) } })
        var projects = app.projects.map { project in
            item(project.name, icon: "folder", checked: row.projectId == project.id) { Task { await app.updateMetadata(row, projectID: project.id, changeProject: true) } }
        }
        projects.append(item("移出项目", enabled: row.projectId != nil) { Task { await app.updateMetadata(row, changeProject: true) } })
        submenu("移至项目", icon: "folder", entries: projects, enabled: enabled && !row.running)
        var groups = app.sessionGroups.map { group in
            item(group.name, checked: row.groupId == group.id) { Task { await app.updateMetadata(row, groupID: group.id, changeGroup: true) } }
        }
        groups.append(item("新建分组…", icon: "plus") { app.newGroupName = ""; app.groupCandidate = row })
        groups.append(item("移出分组", enabled: row.groupId != nil) { Task { await app.updateMetadata(row, changeGroup: true) } })
        submenu("移至分组", icon: "list", entries: groups, enabled: enabled)
        menu.addItem(item(row.archived ? "恢复" : "归档", icon: "archive", enabled: enabled, shortcut: "a") { Task { await app.archive(row, archived: !row.archived) } })
        menu.addItem(item("删除", icon: "trash", enabled: enabled, destructive: true, shortcut: "d") { app.askToDelete(row) })
        if let usage { menu.addItem(.separator()); menu.addItem(item("本对话用量", icon: "chart", action: usage)) }
        return menu
    }
}

struct MacSessionMenuButton: View {
    @ObservedObject var app: AppleAppModel
    let conversation: ConversationSummary
    let usage: @MainActor () -> Void
    var body: some View {
        MacNativeMenuButton(label: "对话菜单", identifier: "conversationMenu") { MacSessionMenu.make(app: app, conversation: conversation, usage: usage) }
    }
}

struct MacNativeMenuButton: NSViewRepresentable {
    @Environment(\.colorScheme) private var scheme
    let label: String
    let identifier: String
    let makeMenu: @MainActor () -> NSMenu
    func makeCoordinator() -> Coordinator { Coordinator(label: label, makeMenu: makeMenu) }
    func makeNSView(context: Context) -> NSPopUpButton {
        let button = NSPopUpButton(frame: .zero, pullsDown: true)
        button.isBordered = false; button.imagePosition = .imageOnly
        (button.cell as? NSPopUpButtonCell)?.arrowPosition = .noArrow
        let menu = NSMenu(); menu.delegate = context.coordinator; button.menu = menu
        button.setAccessibilityIdentifier(identifier); button.setAccessibilityLabel(label)
        context.coordinator.menuNeedsUpdate(menu)
        return button
    }
    func updateNSView(_ view: NSPopUpButton, context: Context) { context.coordinator.makeMenu = makeMenu; view.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua) }
    @MainActor final class Coordinator: NSObject, NSMenuDelegate {
        let label: String
        var makeMenu: @MainActor () -> NSMenu
        init(label: String, makeMenu: @escaping @MainActor () -> NSMenu) { self.label = label; self.makeMenu = makeMenu }
        func menuNeedsUpdate(_ menu: NSMenu) {
            menu.removeAllItems(); menu.autoenablesItems = false
            let heading = NSMenuItem(title: label, action: nil, keyEquivalent: "")
            heading.image = NSImage(named: "wm-more"); menu.addItem(heading)
            let content = makeMenu()
            for item in content.items { content.removeItem(item); menu.addItem(item) }
        }
    }
}
#endif
