import SwiftUI
import WeftMateCore

struct AccountUsageBar: View {
    @StateObject private var usage: AccountUsageModel
    @ObservedObject var app: AppleAppModel
    init(app: AppleAppModel) { self.app = app; _usage = StateObject(wrappedValue: AccountUsageModel(app: app)) }
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p4) {
            if let summary = usage.summary {
                Text(AccountUsagePresentation.text(summary)).accessibilityIdentifier("accountUsageTotal")
                if let notice = summary.total.uncertaintyNotice { Text(notice).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            } else { Text(usage.error ?? "正在读取本月用量…").foregroundStyle(Weave.muted) }
        }.font(AppleTokens.Fonts.callout).accessibilityElement(children: .contain).accessibilityIdentifier("accountUsageBar")
            .task(id: app.uxScope) { await usage.refresh() }
    }
}
struct ArchiveUndoBar: View {
    @ObservedObject var app: AppleAppModel
    var body: some View {
        if let row = app.archiveUndo {
            HStack {
                Text("已归档「\(row.title)」").lineLimit(1)
                Spacer()
                Button("撤销归档") { Task { await app.archive(row, archived: false) } }
                    .disabled(app.lifecycleBusy).accessibilityIdentifier("undoArchive")
            }.font(AppleTokens.Fonts.callout).padding(AppleTokens.Space.p12).background(Weave.accentSoft)
                .accessibilityElement(children: .contain).accessibilityIdentifier("archiveUndoBar")
        }
    }
}
struct ProjectMoreRows: View {
    @ObservedObject var app: AppleAppModel
    let project: Project
    let search: String
    var body: some View {
        let count = app.allProjectRows(project, query: search).count
        if search.isEmpty, count > 5 {
            Button { app.toggleProjectRows(project.id, query: search) } label: {
                Text(app.projectExpanded(project.id) ? "收起" : "更多（\(count - 5)）")
            }.buttonStyle(.plain).foregroundStyle(Weave.muted)
                .accessibilityValue(app.projectExpanded(project.id) ? "已展开" : "已收起")
                .accessibilityIdentifier("projectMore." + project.id)
        }
    }
}
#if os(macOS)
struct MacAccountMenu: View {
    @ObservedObject var app: AppleAppModel
    @Environment(\.openWindow) private var openWindow
    @State private var showing = false
    @State private var logout = false
    @FocusState private var menuFocused: Bool
    var body: some View {
        Button { showing.toggle() } label: {
            HStack(spacing: AppleTokens.Space.p11) {
                WeftIcon("account")
                Text(app.accountName).lineLimit(1)
                Spacer()
                WeftIcon("more", size: 16)
            }.padding(AppleTokens.Space.p16).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel("账户菜单").accessibilityIdentifier("macAccountMenu")
            .accessibilityValue(showing ? "已展开" : "已收起")
            .overlay(alignment: .bottom) {
                if showing { VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                    Text(app.accountName).font(AppleTokens.Fonts.headline)
                    Text(app.cloudLogin.authenticated ? app.cloudLogin.email : "本机账户：" + (app.session?.account.username ?? ""))
                        .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    AccountUsageBar(app: app)
                    Divider()
                    Button { settings("general") } label: { WeftLabel("设置", icon: "settings") }.keyboardShortcut(",", modifiers: .command)
                    Button { settings("usage") } label: { WeftLabel("用量详情", icon: "chart") }
                    Button { settings("about") } label: { WeftLabel("帮助 / 关于", icon: "info") }
                    Button { showing = false; logout = true } label: { WeftLabel("退出登录", icon: "logout") }
                }.padding(AppleTokens.Space.p16).frame(maxWidth: .infinity, alignment: .leading).buttonStyle(.plain)
                    .fixedSize(horizontal: false, vertical: true)
                    .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r16))
                    .overlay(RoundedRectangle(cornerRadius: AppleTokens.Radius.r16).strokeBorder(Weave.line))
                    .padding(.horizontal, AppleTokens.Space.p12).offset(y: -AppleTokens.Space.p64)
                    .focusable().focused($menuFocused).focusSection()
                    .onAppear { menuFocused = true }.onExitCommand { showing = false }
                    .accessibilityElement(children: .contain).accessibilityIdentifier("macAccountMenuPanel") }
            }.zIndex(showing ? 1 : 0)
            .confirmationDialog("退出登录？本机对话与记忆保留。", isPresented: $logout, titleVisibility: .visible) {
                Button("退出登录", role: .destructive) { Task { await app.signOut() } }
                Button("取消", role: .cancel) {}
            }
            .onChange(of: app.uxScope) { _, _ in showing = false }
            .onChange(of: app.accountEpoch) { _, _ in showing = false; logout = false }
    }
    private func settings(_ id: String) { showing = false; app.settingsRoute = .init(categoryID: id); openWindow(id: "settings") }
}
#endif
