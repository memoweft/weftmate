import SwiftUI
import WeftMateCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct SettingsView: View {
    @ObservedObject var model: AppleAppModel
    @StateObject private var settings: AppleSettingsModel
    @State private var search = ""
    @State private var phonePath: [AppleSettingsRoute]
    #if os(macOS)
    @Environment(\.dismissWindow) private var dismissWindow
    #endif
    @Environment(\.dismiss) private var dismiss
    let onClose: (() -> Void)?
    init(model: AppleAppModel, route: AppleSettingsRoute? = nil, onClose: (() -> Void)? = nil) {
        self.model = model
        self.onClose = onClose
        _settings = StateObject(wrappedValue: AppleSettingsModel(app: model))
        _phonePath = State(initialValue: route.map { [$0] } ?? [])
    }
    private var categories: [AppleSettingsCategory] {
        #if os(macOS)
        AppleSettingsRegistry.list(desktop: true, query: search)
        #else
        AppleSettingsRegistry.list(desktop: false, query: search)
        #endif
    }
    var body: some View {
        #if os(macOS)
        GeometryReader { geometry in
            if geometry.size.width < 720 {
                VStack(spacing: AppleTokens.Space.p0) {
                    TextField("搜索设置", text: $search).textFieldStyle(.roundedBorder).padding(AppleTokens.Space.p12)
                    Picker("分类", selection: selection) {
                        ForEach(categories) { Text($0.name).tag($0.id) }
                    }.padding(.horizontal, AppleTokens.Space.p20)
                    detail(model.settingsRoute)
                }
            } else {
                NavigationSplitView {
                    VStack(spacing: AppleTokens.Space.p12) {
                        TextField("搜索设置", text: $search).textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("settingsSearch").padding(.horizontal, AppleTokens.Space.p12).padding(.top, AppleTokens.Space.p12)
                        List(selection: Binding<String?>(get: { model.settingsRoute.categoryID }, set: { if let id = $0 { model.settingsRoute = .init(categoryID: id) } })) {
                            ForEach(["设置", "助手", "此电脑", "关于"], id: \.self) { group in
                                let rows = categories.filter { $0.group == group }
                                if !rows.isEmpty {
                                    Section(group) {
                                        ForEach(rows) { category in
                                            WeftLabel(category.name, icon: category.icon).tag(category.id)
                                                .accessibilityIdentifier("settingsCategory." + category.id)
                                        }
                                    }
                                }
                            }
                        }.listStyle(.sidebar)
                    }.navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 260)
                } detail: { detail(model.settingsRoute) }
            }
        }
        .onExitCommand { dismissWindow(id: "settings") }
        .toolbar { Button { dismissWindow(id: "settings") } label: { WeftLabel("关闭设置", icon: "deny") }.keyboardShortcut(.cancelAction).accessibilityIdentifier("closeSettings") }
        .background(Weave.canvas).accessibilityIdentifier("settingsRoot")
        .preferredColorScheme(AppleAppearance(rawValue: model.appearanceMode)?.colorScheme).tint(Weave.accent)
        #else
        NavigationStack(path: $phonePath) {
            List {
                ForEach(["设置", "助手", "关于"], id: \.self) { group in
                    let rows = categories.filter { $0.group == group }
                    if !rows.isEmpty {
                        Section(group) {
                            ForEach(rows) { category in
                                NavigationLink(value: AppleSettingsRoute(categoryID: category.id)) {
                                    HStack(spacing: AppleTokens.Space.p12) {
                                        WeftIcon(category.icon).foregroundStyle(Weave.accent)
                                        Text(category.name)
                                        Spacer()
                                        Text(settings.summary(category.id)).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).lineLimit(1)
                                    }
                                }.accessibilityIdentifier("settingsCategory." + category.id)
                            }
                        }
                    }
                }
                if categories.isEmpty { Text("没有匹配的设置") }
            }.listStyle(.insetGrouped).navigationTitle("设置")
                .searchable(text: $search, prompt: "搜索设置")
                .navigationDestination(for: AppleSettingsRoute.self) { detail($0).toolbar { closeButton } }
                .toolbar { closeButton }
                .accessibilityIdentifier("settingsRoot")
        }
        #endif
    }
    @ToolbarContentBuilder private var closeButton: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) {
            Button("完成") { if let onClose { onClose() } else { dismiss() } }
                .accessibilityIdentifier("closeAuxiliarySheetButton")
        }
    }
    #if os(macOS)
    private var selection: Binding<String> {
        Binding(get: { model.settingsRoute.categoryID }, set: { model.settingsRoute = .init(categoryID: $0) })
    }
    #endif
    private func detail(_ route: AppleSettingsRoute) -> some View {
        SettingsCategoryView(app: model, settings: settings, route: route)
            .id(route).id(model.accountEpoch)
    }
}

private struct SettingsCategoryView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var settings: AppleSettingsModel
    let route: AppleSettingsRoute
    @State private var legal: LegalDocument?
    @State private var deletingSchedule: ManagedSchedule?
    @State private var restoringBackup: HostBackup?
    @State private var restartingService: HostService?
    #if os(macOS)
    @EnvironmentObject private var updates: MacUpdateModel
    @Environment(\.openWindow) private var openWindow
    #endif
    private var title: String { AppleSettingsRegistry.category(route.categoryID)?.name ?? "设置" }
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p0) {
            #if os(macOS)
            Text(title).font(AppleTokens.Fonts.largeTitle.weight(.semibold)).foregroundStyle(Weave.ink)
                .padding(.horizontal, AppleTokens.Space.p24).padding(.top, AppleTokens.Space.p24).padding(.bottom, AppleTokens.Space.p16)
            #endif
            content
        }.background(Weave.canvas).navigationTitle(title)
            .accessibilityIdentifier("settingsPage." + route.categoryID)
            .task(id: route.categoryID) {
                await settings.refresh(route.categoryID)
                #if DEBUG && os(macOS)
                let args = ProcessInfo.processInfo.arguments
                if route.categoryID == "about", args.contains("--ui-testing"), args.contains("--upd2-auto-check") {
                    updates.check()
                    while updates.checking && !Task.isCancelled { try? await Task.sleep(for: .milliseconds(100)) }
                    // Sanitized acceptance result; temporary feed URLs/keys never appear here.
                    FileHandle.standardOutput.write(Data(("UPD2_STATUS:" + updates.statusText + "\n").utf8))
                }
                #endif
            }
            .sheet(item: $legal) { LegalDocumentView(document: $0) }
            .confirmationDialog("删除这条提醒或定时任务？已启动的任务和历史记录保留。", isPresented: Binding(get: { deletingSchedule != nil }, set: { if !$0 { deletingSchedule = nil } }), titleVisibility: .visible) {
                Button("删除", role: .destructive) { if let item = deletingSchedule { Task { await settings.schedule(item, action: .delete) } }; deletingSchedule = nil }
                Button("取消", role: .cancel) { deletingSchedule = nil }
            }
            .confirmationDialog("重启服务？运行中的任务可能中断，请等待电脑完成维护（最多 6 分钟）。", isPresented: Binding(get: { restartingService != nil }, set: { if !$0 { restartingService = nil } }), titleVisibility: .visible) {
                Button("确认重启") { if let service = restartingService { Task { await settings.restart(service) } }; restartingService = nil }
                Button("取消", role: .cancel) { restartingService = nil }
            }
            .confirmationDialog("恢复此备份？电脑将备份当前状态后替换本地数据并重启，完成后需要重新登录。", isPresented: Binding(get: { restoringBackup != nil }, set: { if !$0 { restoringBackup = nil } }), titleVisibility: .visible) {
                Button("恢复并重启", role: .destructive) { if let item = restoringBackup { Task { await settings.restore(item) } }; restoringBackup = nil }
                Button("取消", role: .cancel) { restoringBackup = nil }
            }
    }
    @ViewBuilder private var content: some View {
        switch route.categoryID {
        case "account":
            if app.cloudLogin.authenticated { AccountSettingsView(cloud: app.cloudLogin) }
            else { LocalAccountSettingsView(app: app) }
        case "devices":
            if app.cloudLogin.authenticated { CloudDevicesView(app: app, cloud: app.cloudLogin) }
            else { DevicesView(model: app) }
        case "usage":
            VStack(spacing: AppleTokens.Space.p0) {
                if let id = route.sessionID {
                    HStack {
                        Text("本对话：" + (app.conversations.first { $0.sessionId == id }?.title ?? "当前对话"))
                            .font(AppleTokens.Fonts.callout).accessibilityIdentifier("usageSessionFocus")
                        Spacer()
                        #if os(macOS)
                        Button("全部用量") { app.settingsRoute = .usage(sessionID: nil) }
                        #endif
                    }.padding(AppleTokens.Space.p16)
                }
                UsageView(app: app, sessionID: route.sessionID).id(route.sessionID)
            }
        default:
            Form {
                fields
                if settings.busy { ProgressView("正在读取…") }
                if let error = settings.error { InlineNotice(message: error, isError: true) }
                if let notice = settings.notice { InlineNotice(message: notice) }
            }
            .formStyle(.grouped)
        }
    }
    @ViewBuilder private var fields: some View {
        switch route.categoryID {
        case "general":
            SettingsRow("语言", "当前界面使用简体中文。") { Text("简体中文").foregroundStyle(Weave.muted) }
            SettingsRow("通知", "审批与任务提醒沿用系统通知权限。") { Text("由系统管理").foregroundStyle(Weave.muted) }
            #if os(macOS)
            SettingsRow("开机自启", "Apple 原生启动项尚未接入。") { Text("即将支持").foregroundStyle(Weave.muted) }
            SettingsRow("关闭窗口", "关闭主窗口后程序仍保留在 Dock，可再次打开。") { Text("保留程序").foregroundStyle(Weave.muted) }
            #endif
            SettingsRow("电脑连接", "更换电脑需退出当前连接，在设备分类重新连接。") { Text(app.verificationPending ? "等待验证" : "已连接").foregroundStyle(Weave.muted) }
        case "appearance":
            SettingsRow("颜色模式", "选择适合当前环境的颜色模式，保存到这台设备。") {
                Picker("颜色模式", selection: $app.appearanceMode) {
                    Text("浅色").tag("light"); Text("深色").tag("dark"); Text("跟随系统").tag("system")
                }.pickerStyle(.segmented).labelsHidden().accessibilityIdentifier("appearancePicker")
            }
            SettingsRow("主题色", "按钮、选中状态与交互提示使用统一主题色。") { Text("石墨").foregroundStyle(Weave.muted) }
            SettingsRow("字号", "随系统文字大小与辅助功能设置调整。") { Text("系统默认").foregroundStyle(Weave.muted) }
            SettingsRow("界面密度", "当前布局使用标准间距。") { Text("标准").foregroundStyle(Weave.muted) }
            NavigationLink("小纬形象") { SpiritProfileView() }
        case "approvals":
            SettingsRow("默认审批模式", "按账户保存，只影响新建对话；已有对话在输入区切换。") {
                ApprovalModeControl(model: app, sessionID: nil).id(app.accountEpoch)
            }
        case "memory":
            SettingsRow("记忆管理", "查看它记得什么、从哪里来，并进行纠正。") {
                NavigationLink("管理记忆") { MemoryWorkspaceView(appModel: app).id(app.accountEpoch) }
            }
        case "models":
            SettingsRow("主模型", "新对话创建时选择，已有对话保留原模型。") { Text("按对话选择").foregroundStyle(Weave.muted) }
            SettingsRow("后台模型", "标题与记忆整理等后续后台请求使用此模型。") {
                #if os(macOS)
                Picker("后台模型", selection: Binding(get: { settings.backgroundModelID }, set: { id in Task { await settings.saveBackgroundModel(id) } })) {
                    Text("跟随主模型").tag("")
                    ForEach(settings.models.filter(\.configured)) { Text($0.name).tag($0.id) }
                    if !settings.backgroundModelID.isEmpty && !settings.models.contains(where: { $0.id == settings.backgroundModelID }) { Text("原后台模型不可用").tag(settings.backgroundModelID) }
                }.labelsHidden().disabled(settings.busy)
                #else
                Text(settings.models.first { $0.id == settings.backgroundModelID }?.name ?? (settings.backgroundModelID.isEmpty ? "跟随主模型" : "原后台模型不可用")).foregroundStyle(Weave.muted)
                #endif
            }
            Section("模型档案与单价 · 元 / 百万令牌") {
                ForEach(settings.models) { model in
                    SettingsRow(model.name, model.configured ? "已配置 · " + model.model : "未配置") {
                        if let price = settings.prices.first(where: { $0.id == model.id })?.price {
                            Text("缓存 \(price.cachedInput) · 输入 \(price.input) · 输出 \(price.output)").font(AppleTokens.Fonts.caption)
                        } else { Text("费用未知").foregroundStyle(Weave.muted) }
                    }
                }
            }
        case "schedules":
            if settings.schedules.isEmpty && !settings.busy { Text("暂无提醒或定时任务").foregroundStyle(Weave.muted) }
            ForEach(settings.schedules, id: \.identity) { item in
                Section {
                    SettingsRow(item.text, (item.kind == "reminder" ? "提醒" : "任务") + " · " + item.timeZone) { Text(item.state == "paused" ? "已暂停" : item.state == "completed" ? "已完成" : "已安排") }
                    if let next = item.nextRunAt { LabeledContent("下次运行", value: next) }
                    HStack {
                        Button(item.state == "paused" ? "恢复" : "暂停") { Task { await settings.schedule(item, action: item.state == "paused" ? .resume : .pause) } }.disabled(item.state == "completed")
                        Button("立即运行") { Task { await settings.schedule(item, action: .run) } }
                        Button("删除", role: .destructive) { deletingSchedule = item }
                    }.buttonStyle(.borderless).disabled(settings.busy)
                }
            }
            Button("刷新提醒") { Task { await settings.refresh("schedules") } }.disabled(settings.busy)
        case "system":
            ForEach(HostService.allCases) { service in
                SettingsRow(service.title, "电脑宿主报告的实际状态；重启可能中断当前任务。") {
                    VStack(alignment: .trailing, spacing: AppleTokens.Space.p5) {
                        Text(settings.status?.service(service).title ?? "尚未读取")
                        if let version = settings.status?.service(service).version { Text(version).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                        Button("重启修复") { restartingService = service }.disabled(settings.busy || settings.status?.service(service).canRestart != true)
                    }
                }
            }
            Button("刷新系统状态") { Task { await settings.refresh("system") } }.disabled(settings.busy)
        case "backups":
            if let preferences = settings.backupPreferences {
                SettingsRow("自动备份", "电脑空闲时每日备份，运行中的任务不会被中断。") {
                    Toggle("自动备份", isOn: Binding(get: { settings.backupPreferences?.enabled ?? false }, set: { settings.backupPreferences?.enabled = $0; Task { await settings.saveBackups() } })).labelsHidden().disabled(settings.busy)
                }
                SettingsRow("保留每日备份", "最近的每日备份保留天数。") {
                    Picker("天数", selection: Binding(get: { settings.backupPreferences?.dailyDays ?? 7 }, set: { settings.backupPreferences?.dailyDays = $0; Task { await settings.saveBackups() } })) { ForEach(Array(Set([7, 14, 30, preferences.dailyDays])).sorted(), id: \.self) { Text("\($0) 天").tag($0) } }.labelsHidden().disabled(settings.busy)
                }
                SettingsRow("保留每周备份", "额外保留的每周副本数量。") {
                    Picker("份数", selection: Binding(get: { settings.backupPreferences?.weeklyCopies ?? 4 }, set: { settings.backupPreferences?.weeklyCopies = $0; Task { await settings.saveBackups() } })) { ForEach(Array(Set([4, 8, 12, preferences.weeklyCopies])).sorted(), id: \.self) { Text("\($0) 份").tag($0) } }.labelsHidden().disabled(settings.busy)
                }
            }
            SettingsRow("立即备份", "本地备份不含凭据；目前未加密，请妥善保存。") { Button("立即备份") { Task { await settings.backup() } }.disabled(settings.busy || settings.backups == nil) }
            Section("恢复备份") {
                ForEach(settings.backups?.backups ?? []) { item in
                    SettingsRow(item.createdAt, "\(item.size) 字节 · " + (item.verification == "valid" ? "校验通过" : "校验失败")) {
                        Button("恢复") { restoringBackup = item }.disabled(settings.busy || item.verification != "valid")
                    }
                }
                if settings.backups?.backups.isEmpty == true { Text("暂无备份") }
            }
            Button("刷新备份") { Task { await settings.refresh("backups") } }.disabled(settings.busy)
        case "about":
            SettingsRow("App 版本", "当前安装的 WeftMate 版本与 build。") {
                Text("\(settings.installedVersion) / \(settings.installedBuild)").accessibilityIdentifier("aboutNativeVersion")
            }
            ForEach(["ui", "app", "mobile-ui"], id: \.self) { layer in
                let value = settings.hostUpdates?.updates?.layers.first { $0.layer == layer }
                SettingsRow("所连电脑 · " + (value?.title ?? (layer == "ui" ? "界面与功能包" : layer == "app" ? "程序本体" : "手机界面包")), "宿主版本与更新状态（" + layer + "）。") {
                    VStack(alignment: .trailing, spacing: AppleTokens.Space.p4) {
                        Text(value?.currentVersion ?? "宿主未提供版本")
                        Text(value?.statusText ?? "等待连接").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    }.accessibilityIdentifier("aboutHostLayer." + layer)
                }
            }
            if let notice = settings.compatibilityNotice {
                InlineNotice(message: notice, isError: true).accessibilityIdentifier("aboutCompatibilityNotice")
            }
            #if os(macOS)
            SettingsRow("更新状态", "独立分发版可检查更新并打开下载页。") { Text(updates.statusText).accessibilityIdentifier("aboutUpdateStatus") }
            Button("检查更新") { updates.check() }.disabled(updates.checking).accessibilityIdentifier("openUpdatesButton")
            if let release = updates.release { Link("打开下载页", destination: release.downloadPage).accessibilityIdentifier("aboutDownloadPage") }
            #else
            SettingsRow("更新状态", "App 由 TestFlight / App Store 自动更新。") { Text(settings.compatibilityNotice == nil ? "在手机上检查" : "有新版本可在 TestFlight 更新") }
            #endif
            Button("刷新宿主版本") { Task { await settings.refresh("about") } }.disabled(settings.busy)
            Button("服务条款") { legal = .terms }
            Button("隐私政策") { legal = .privacy }
            Link("反馈", destination: URL(string: "https://github.com/memoweft/weftmate/issues")!)
        default: EmptyView()
        }
    }
}

/// Native Form row: copy stays on the left and the control follows platform sizing.
private struct SettingsRow<Control: View>: View {
    let name: String; let explanation: String; @ViewBuilder let control: () -> Control
    init(_ name: String, _ explanation: String, @ViewBuilder control: @escaping () -> Control) {
        self.name = name; self.explanation = explanation; self.control = control
    }
    var body: some View {
        #if os(macOS)
        HStack(alignment: .center, spacing: AppleTokens.Space.p24) {
            labels.frame(maxWidth: .infinity, alignment: .leading)
            control().frame(maxWidth: 300, alignment: .trailing)
        }.padding(.vertical, AppleTokens.Space.p12)
        #else
        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) { labels; control() }.padding(.vertical, AppleTokens.Space.p8)
        #endif
    }
    private var labels: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p5) {
            Text(name).font(AppleTokens.Fonts.body).foregroundStyle(Weave.ink)
            Text(explanation).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct LocalAccountSettingsView: View {
    @ObservedObject var app: AppleAppModel
    @State private var signOut = false
    @State private var server = false
    @State private var copied: String?
    var body: some View {
        Form {
            if app.verificationPending { InlineNotice(message: "服务器暂不可达，正在显示上次保存的账户身份。") }
            if let error = app.draftError { InlineNotice(message: error, isError: true) }
            LabeledContent("账户", value: app.accountName)
            LabeledContent("登录名", value: app.session?.account.username ?? "").accessibilityIdentifier("accountUsername")
            LabeledContent("登录设备", value: app.session?.device.name ?? app.deviceName)
                .accessibilityIdentifier("accountDevice.\(app.session?.device.id ?? "unknown")")
            Text("当前使用电脑本地账户。云端邮箱、密码与注销操作在云账号登录后提供。")
                .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
            if app.needsUnsavedDraftDecision {
                Section("有改动尚未保存") {
                    Button("复制未保存草稿") {
                        #if os(macOS)
                        NSPasteboard.general.clearContents(); copied = NSPasteboard.general.setString(app.unsavedDraftTextForCopy, forType: .string) ? "已复制未保存草稿。" : "复制未完成。"
                        #else
                        UIPasteboard.general.string = app.unsavedDraftTextForCopy; copied = "已复制未保存草稿。"
                        #endif
                    }
                    Button("重试保存并退出") { Task { await app.signOut() } }.disabled(app.authBusy)
                    Button("仍然退出（未保存的改动会丢失）", role: .destructive) { Task { await app.signOut(discardUnsavedChanges: true) } }.disabled(app.authBusy)
                    if let copied { Text(copied) }
                }
            }
            Button("退出登录 / 切换账户", role: .destructive) { signOut = true }.disabled(app.authBusy).accessibilityIdentifier("signOutButton")
            Button("更换服务器") { server = true }.disabled(app.authBusy).accessibilityIdentifier("changeServerButton")
        }.formStyle(.grouped)
            .confirmationDialog("退出当前账户？", isPresented: $signOut, titleVisibility: .visible) {
                Button("退出登录", role: .destructive) { Task { await app.signOut() } }; Button("取消", role: .cancel) {}
            } message: { Text("未发送草稿保留在本机对应账户，服务器原记录保留。") }
            .confirmationDialog("更换服务器？", isPresented: $server, titleVisibility: .visible) {
                Button("退出并更换", role: .destructive) { Task { await app.signOut() } }; Button("取消", role: .cancel) {}
            } message: { Text("退出后在登录页更改服务器地址，草稿仍归原账户保留。") }
    }
}
