#if os(iOS)
import SwiftUI
import UIKit
import WeftMateCore

/// Phone-only settings content. SettingsView owns the one navigation stack.
struct PhoneSettingsIndex: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var settings: AppleSettingsModel
    @Binding var search: String
    @State private var logout = false
    @FocusState private var searchFocused: Bool
    private var categories: [AppleSettingsCategory] { AppleSettingsRegistry.list(desktop: false, query: search) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p24) {
                NavigationLink(value: AppleSettingsRoute(categoryID: "account")) {
                    PhoneSettingsLabel(title: app.accountName, subtitle: app.cloudLogin.authenticated ? app.cloudLogin.email : "账号与安全", icon: "account")
                }.buttonStyle(.plain).phoneCard().accessibilityIdentifier("settings.accountCard")
                HStack(spacing: AppleTokens.Space.p8) {
                    WeftIcon("search").foregroundStyle(Weave.muted)
                    TextField("搜索设置", text: $search).textFieldStyle(.plain).focused($searchFocused).submitLabel(.search).onSubmit { searchFocused = false }.accessibilityIdentifier("settingsSearch")
                    if !search.isEmpty { Button { search = "" } label: { WeftIcon("deny") }.phoneIcon(quiet: true).accessibilityLabel("清除搜索").accessibilityIdentifier("settings.clearSearch") }
                }.padding(.horizontal, AppleTokens.Space.p12).frame(minHeight: AppleTokens.Space.p44)
                    .background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
                ForEach(AppleSettingsRegistry.phoneGroups, id: \.self) { group in
                    let rows = categories.filter { $0.group == group }
                    if !rows.isEmpty {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                            Text(group).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).padding(.horizontal, AppleTokens.Space.p12)
                            VStack(spacing: AppleTokens.Space.p0) {
                                ForEach(Array(rows.enumerated()), id: \.element.id) { index, category in
                                    if index > 0 { Divider() }
                                    NavigationLink(value: AppleSettingsRoute(categoryID: category.id)) {
                                        PhoneSettingsLabel(title: category.name, subtitle: settings.summary(category.id), icon: category.icon)
                                    }.buttonStyle(.plain).accessibilityIdentifier("settingsCategory." + category.id)
                                }
                            }.phoneCard()
                        }
                    }
                }
                if categories.isEmpty { Text("没有找到这个设置。试试其他关键词。").foregroundStyle(Weave.muted).accessibilityIdentifier("settings.searchEmpty") }
                if app.cloudLogin.authenticated || app.session != nil {
                    Button("退出登录", role: .destructive) { logout = true }
                        .frame(maxWidth: .infinity).buttonStyle(OutlineActionStyle(destructive: true)).accessibilityIdentifier("settings.logout")
                        .phonePopover(isPresented: $logout) {
                            VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                                Text("退出当前账号？未发送草稿保留在这台手机。")
                                Button("退出登录", role: .destructive) { logout = false; Task { await app.signOut() } }
                                Button("取消") { logout = false }
                            }.padding(AppleTokens.Space.p20).frame(idealWidth: AppleTokens.Phone.menuWidth)
                        }
                }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.grouped).navigationTitle("设置").navigationBarTitleDisplayMode(.large)
    }
}

struct PhoneSettingsLabel: View {
    let title: String
    var subtitle = ""
    var icon = "settings"
    var disclosure = true
    var body: some View {
        HStack(spacing: AppleTokens.Space.p12) {
            WeftIcon(icon).foregroundStyle(Weave.secondary)
            VStack(alignment: .leading, spacing: AppleTokens.Space.p4) {
                Text(title).foregroundStyle(Weave.ink).font(AppleTokens.Fonts.body)
                if !subtitle.isEmpty { Text(subtitle).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).fixedSize(horizontal: false, vertical: true) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if disclosure { WeftIcon("right", size: AppleTokens.Space.p12).foregroundStyle(Weave.muted) }
        }.frame(minHeight: AppleTokens.Space.p56).padding(.vertical, AppleTokens.Space.p4).contentShape(Rectangle())
    }
}

struct PhonePreferencePage: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var settings: AppleSettingsModel
    let category: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @ObservedObject private var runLog = RunLogRuntime.shared
    var body: some View {
        Form {
            fields
            if settings.busy { ProgressView("正在读取…") }
            if let error = settings.error {
                Section { InlineNotice(message: error, isError: true); Button("重试") { Task { await settings.refresh(category) } } }
            }
            if let notice = settings.notice { InlineNotice(message: notice) }
        }.scrollContentBackground(.hidden).background(Weave.grouped)
    }
    @ViewBuilder private var fields: some View {
        switch category {
        case "general":
            Section("回复") {
                Picker("回复中发送的消息", selection: $app.runningMessageMode) {
                    ForEach(RunningMessageMode.allCases) { Text($0.title).tag($0) }
                }.pickerStyle(.menu).disabled(app.session == nil).accessibilityIdentifier("runningMessageMode")
                if app.session == nil { Text("连上电脑后，可以按账户设置回复中发送的消息如何处理。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            }
            DailyHealthSettingsRow(app: app, showsHealth: false)
            Section("连接") { NavigationLink(value: AppleSettingsRoute(categoryID: "devices")) { PhoneSettingsLabel(title: "电脑连接", subtitle: "配对、重新连接与切换", icon: "desktop") } }
        case "appearance":
            Section {
                Picker("颜色模式", selection: $app.appearanceMode) { ForEach(AppleAppearance.allCases) { Text($0.title).tag($0.rawValue) } }
                    .pickerStyle(.segmented).accessibilityIdentifier("appearancePicker")
                LabeledContent("主题色", value: "石墨")
                LabeledContent("字号", value: typeSize.isAccessibilitySize ? "系统辅助字号" : "跟随系统")
                LabeledContent("减少动态效果", value: reduceMotion ? "已开启" : "未开启").accessibilityIdentifier("settings.reduceMotion")
                Link("打开系统设置", destination: URL(string: UIApplication.openSettingsURLString)!)
            } footer: { Text("字号与动态效果跟随 iPhone 的辅助功能设置。换色时保留当前页面与草稿。") }
        case "approvals":
            Section {
                ApprovalModeControl(model: app, sessionID: nil)
            } header: { Text("新对话的默认审批模式") } footer: { Text("已有对话在输入框里调整。手机自己聊天不执行电脑操作，无需审批。") }
            Section("额外核对") {
                if let approvals = settings.approvals {
                    Toggle("动手前多看一眼", isOn: Binding(get: { settings.approvals?.effectiveSecondOpinionEnabled ?? approvals.effectiveSecondOpinionEnabled }, set: { value in Task { await settings.saveSecondOpinion(value) } }))
                        .disabled(settings.busy).accessibilityIdentifier("settings.secondOpinionEnabled")
                    Text("让另一个模型复核操作计划。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                } else if !settings.busy && settings.error == nil { Text("连上电脑后读取额外核对设置。").foregroundStyle(Weave.muted) }
            }
        case "system":
            Section("电脑连接") {
                LabeledContent(app.cloudLogin.selectedComputerName, value: app.session == nil ? "还没连接电脑" : app.phoneConnectionStatus)
                NavigationLink("管理电脑", value: AppleSettingsRoute(categoryID: "devices"))
            }
            Section("服务状态") {
                ForEach(HostService.allCases) { service in
                    LabeledContent(service.title, value: settings.status?.service(service).title ?? "尚未读取")
                }
                if settings.backgroundModelFallback != nil { Text("后台模型不可用，已改用聊天模型。").foregroundStyle(Weave.muted) }
                NavigationLink("查看模型服务", value: AppleSettingsRoute(categoryID: "models"))
            }
            Section {
                Button("刷新状态") { Task { await settings.refresh("system") } }.disabled(settings.busy || app.session == nil).accessibilityIdentifier("settings.system.refresh")
            } footer: { Text("手机只查看电脑报告的状态。重启修复与备份恢复在电脑端处理。") }
        case "about":
            Section {
                HStack { Spacer(); BrandMark(size: AppleTokens.Space.p44); Spacer() }.padding(.vertical, AppleTokens.Space.p16)
                LabeledContent("版本", value: settings.installedVersion + " / " + settings.installedBuild).accessibilityIdentifier("aboutNativeVersion")
                Text("通过 TestFlight / App Store 更新。").foregroundStyle(Weave.muted)
                NavigationLink("隐私与条款", value: AppleSettingsRoute(categoryID: "legal")).accessibilityIdentifier("settings.legal")
                NavigationLink(value: AppleSettingsRoute(categoryID: "run-log")) {
                    PhoneSettingsLabel(title: "运行记录", subtitle: RunLogText.entry(runLog.snapshot), icon: "list")
                }.accessibilityIdentifier("openRunLog")
                Link("反馈", destination: URL(string: "https://github.com/memoweft/weftmate/issues")!)
            }
            if let notice = settings.compatibilityNotice { InlineNotice(message: notice, isError: true) }
        case "legal":
            Section {
                NavigationLink("服务条款") { PhoneLegalReader(document: .terms) }
                NavigationLink("隐私政策") { PhoneLegalReader(document: .privacy) }
            }
        default: EmptyView()
        }
    }
}

struct PhoneLegalReader: View {
    let document: LegalDocument
    var body: some View {
        ScrollView { Text(document.content).font(AppleTokens.Fonts.body).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(AppleTokens.Space.p20) }
            .foregroundStyle(Weave.ink).background(Weave.canvas).navigationTitle(document.title).navigationBarTitleDisplayMode(.inline)
    }
}

struct PhoneArchivedSettingsPage: View {
    @ObservedObject var app: AppleAppModel
    let openConversation: @MainActor (String) -> Void
    @State private var search = ""
    private var rows: [ConversationSummary] { app.conversations.filter { $0.archived && (search.isEmpty || $0.title.localizedCaseInsensitiveContains(search)) } }
    var body: some View {
        Form {
            Section { TextField("搜索已归档对话", text: $search).accessibilityIdentifier("archivedSearch") }
            Section {
                ForEach(rows) { row in
                    HStack(spacing: AppleTokens.Space.p8) {
                        Button { openConversation(row.id) } label: {
                            Text(row.title).frame(maxWidth: .infinity, minHeight: AppleTokens.Space.p44, alignment: .leading)
                        }.buttonStyle(.plain).accessibilityIdentifier("openArchived." + row.id)
                        Button("恢复") { Task { await app.archive(row, archived: false) } }.buttonStyle(.borderless).accessibilityIdentifier("restoreArchived." + row.id)
                        PhoneActionMenu {
                            Button("删除", role: .destructive) { app.askToDelete(row, inSettings: true) }.accessibilityIdentifier("deleteArchived." + row.id)
                        } label: { WeftIcon("more").phoneMenuLabel(circle: true, quiet: true) }
                            .accessibilityLabel("已归档对话操作").accessibilityIdentifier("archivedActions." + row.id)
                    }.disabled(app.lifecycleBusy)
                }
                if rows.isEmpty { Text(search.isEmpty ? "没有已归档对话。" : "没有找到这段对话。换个关键词试试。").foregroundStyle(Weave.muted) }
            } footer: { Text("归档只从日常列表收起。删除与遗忘分别确认。") }
            if let error = app.lifecycleError { InlineNotice(message: error, isError: true) }
            if let error = app.conversationsError { InlineNotice(message: error, isError: true); Button("重试") { Task { await app.refresh() } } }
        }.scrollContentBackground(.hidden).background(Weave.grouped).task { await app.refresh() }.accessibilityIdentifier("archivedSessions")
            .sheet(item: Binding(get: { app.deletionInSettings ? app.deletionCandidate : nil }, set: { app.deletionCandidate = $0 })) { _ in
                SessionDeleteSheet(app: app).phoneSheet("删除对话", close: { app.deletionCandidate = nil })
            }
    }
}
#endif
