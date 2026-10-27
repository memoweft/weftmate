import SwiftUI

#if os(macOS)
struct AccountSettingsView: View {
    @ObservedObject var cloud: CloudLoginModel
    private enum Field: Hashable { case current, password, repeated, email, code, deletion }
    @FocusState private var field: Field?
    @State private var currentPassword = ""
    @State private var password = ""
    @State private var repeatedPassword = ""
    @State private var confirmLogout = false
    @State private var confirmOthers = false
    @State private var confirmDelete = false
    @State private var deletePassword = ""
    @State private var newEmail = ""
    @State private var code = ""
    var body: some View {
        Form {
            Section("账户") { LabeledContent("邮箱", value: cloud.email).accessibilityIdentifier("signedInEmail") }
            Section("修改密码") {
                SecureField("当前密码", text: $currentPassword).accessibilityLabel("当前密码").focused($field, equals: .current)
                SecureField("新密码（至少 15 位）", text: $password).accessibilityLabel("新密码").focused($field, equals: .password)
                SecureField("再次输入新密码", text: $repeatedPassword).accessibilityLabel("再次输入新密码").focused($field, equals: .repeated)
                Button("修改密码") {
                    Task {
                        await cloud.changePassword(current: currentPassword, password: password, repeatPassword: repeatedPassword)
                        currentPassword = ""; password = ""; repeatedPassword = ""
                    }
                }.disabled(cloud.busy || currentPassword.isEmpty || password.count < 15 || password != repeatedPassword)
            }
            Section("换绑邮箱") {
                TextField("新邮箱", text: $newEmail).accountInput().accessibilityLabel("新邮箱").focused($field, equals: .email)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let seconds = max(0, Int(ceil(cloud.emailResendAt.timeIntervalSince(context.date))))
                    Button(seconds > 0 ? "\(seconds) 秒后可重发" : "发送新邮箱验证码") { Task { await cloud.requestEmailChange(newEmail) } }
                        .disabled(cloud.busy || newEmail.isEmpty || seconds > 0)
                }
                if cloud.emailChangeChallenge != nil {
                    TextField("新邮箱验证码", text: $code).accountInput().accessibilityLabel("新邮箱验证码").focused($field, equals: .code)
                    Button("确认换绑邮箱") { Task { await cloud.confirmEmailChange(newEmail, code: code); code = "" } }
                        .disabled(cloud.busy || code.count != 6)
                }
            }
            Section {
                Button("退出所有其他设备") { confirmOthers = true }.disabled(cloud.busy)
            }
            Section("注销账号") {
                Text("云端账号数据全部删除且不可恢复；本机的对话与记忆仍留在设备上。")
                    .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
                SecureField("输入密码确认注销", text: $deletePassword).accessibilityLabel("输入密码确认注销").focused($field, equals: .deletion)
                Button("注销账号", role: .destructive) { confirmDelete = true }.disabled(cloud.busy || deletePassword.isEmpty)
            }
            Section { Button("退出登录", role: .destructive) { confirmLogout = true }.accessibilityIdentifier("accountLogout") }
        }.navigationTitle("账户")
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") { field = nil }.accessibilityIdentifier("dismissAccountKeyboard")
                }
            }
            #endif
            .safeAreaInset(edge: .top) {
                if cloud.notice != nil || cloud.error != nil {
                    VStack(spacing: AppleTokens.Space.p8) {
                        if let error = cloud.error { InlineNotice(message: error, isError: true) }
                        if let notice = cloud.notice { InlineNotice(message: notice) }
                    }.padding(AppleTokens.Space.p12).background(Weave.canvas)
                }
            }
            .confirmationDialog("退出所有其他设备？这些设备需要重新登录。", isPresented: $confirmOthers, titleVisibility: .visible) {
                Button("退出其他设备", role: .destructive) { Task { await cloud.logoutOthers() } }
                Button("取消", role: .cancel) {}
            }
            .confirmationDialog("云端账号数据全部删除且不可恢复；本机的对话与记忆仍留在设备上。", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("永久注销账号", role: .destructive) { Task { await cloud.deleteAccount(password: deletePassword); deletePassword = "" } }
                Button("取消", role: .cancel) { deletePassword = "" }
            }
            .confirmationDialog("退出登录？本机草稿会保留。", isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("退出登录", role: .destructive) { Task { await cloud.signOutAccount() } }
                Button("取消", role: .cancel) {}
            }
    }
}

#else
struct AccountSettingsView: View {
    @ObservedObject var cloud: CloudLoginModel
    var body: some View { PhoneAccountSettingsPage(cloud: cloud) }
}
#endif

/// Cloud-only shell: the account stays usable before a trusted content host exists.
struct CloudAccountHome: View {
    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    #endif
    @ObservedObject var app: AppleAppModel
    @ObservedObject var cloud: CloudLoginModel
    var body: some View {
        NavigationStack {
            VStack(spacing: AppleTokens.Space.p24) {
                BrandMark(size: 48)
                Text("电脑没开或没联网").font(AppleTokens.Fonts.title2)
                Text("你已登录。打开电脑上的 WeftMate 后再试一次；本机内容可以继续使用。")
                    .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted).multilineTextAlignment(.center)
                Button("再试一次") { Task { await cloud.retryConnection() } }.buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("retryComputer")
                Button("继续使用本机") { cloud.useLocalWorkspace = true }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("continueLocal")
                #if os(macOS)
                Button { app.settingsRoute = .init(categoryID: "devices"); openWindow(id: "settings") } label: { WeftLabel("设置 → 设备", icon: "desktop") }.buttonStyle(PrimaryActionStyle())
                Button { app.settingsRoute = .init(categoryID: "account"); openWindow(id: "settings") } label: { WeftLabel("设置 → 账户", icon: "account") }.buttonStyle(OutlineActionStyle())
                #else
                NavigationLink { SettingsView(model: app, route: .init(categoryID: "devices")) } label: { WeftLabel("设置 → 设备", icon: "desktop") }.buttonStyle(PrimaryActionStyle())
                NavigationLink { SettingsView(model: app, route: .init(categoryID: "account")) } label: { WeftLabel("设置 → 账户", icon: "account") }.buttonStyle(OutlineActionStyle())
                #endif
                if let error = cloud.error { InlineNotice(message: error, isError: true) }
            }.padding(AppleTokens.Space.p24).frame(maxWidth: 468).frame(maxWidth: .infinity, maxHeight: .infinity)
                .safeAreaInset(edge: .top) { PreviousRunNotice().padding(.horizontal, AppleTokens.Space.p16) }
                .background(Weave.canvas).navigationTitle("WeftMate")
        }
    }
}

/// Local notes are available before any server login. No account or network is needed.
struct LocalAccountWorkspace: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var cloud: CloudLoginModel
    var onHelp: ((String) -> Void)?
    @AppStorage private var draft: String
    @AppStorage private var notes: String
    init(app: AppleAppModel, cloud: CloudLoginModel, onHelp: ((String) -> Void)? = nil) {
        self.app = app; self.cloud = cloud; self.onHelp = onHelp
        let args = ProcessInfo.processInfo.arguments
        let index = args.firstIndex(of: "--ui-testing-namespace")
        let suffix = index.flatMap { args.indices.contains($0 + 1) ? args[$0 + 1] : nil } ?? "local"
        let preferences = args.contains("--ui-testing") ? UserDefaults(suiteName: "com.weftmate.apple.test." + suffix)! : .standard
        _draft = AppStorage(wrappedValue: "", "localWorkspaceDraft", store: preferences)
        _notes = AppStorage(wrappedValue: "", "localWorkspaceNotes", store: preferences)
    }
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                Text("本机笔记").font(AppleTokens.Fonts.title2)
                Text("先记下想法，内容只保存在这台设备。也可以把想法带到聊天里。")
                    .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                ScrollView { Text(notes).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled) }
                    .accessibilityIdentifier("localSavedNotes")
                WeaveCard {
                    VStack(spacing: AppleTokens.Space.p12) {
                        TextField("写点什么…", text: $draft, axis: .vertical).lineLimit(3...6).weaveField().accessibilityIdentifier("localDraft")
                        HStack {
                            Button("保存到本机") { if !draft.isEmpty { notes += (notes.isEmpty ? "" : "\n\n") + draft; draft = "" } }
                                .buttonStyle(OutlineActionStyle()).accessibilityIdentifier("saveLocalNote")
                            Button("让 WeftMate 帮忙") { if let onHelp { onHelp(draft) } else { cloud.requireLogin() } }.buttonStyle(PrimaryActionStyle(fillsWidth: false))
                                .accessibilityIdentifier("requestServer")
                        }
                    }
                }
            }.padding(AppleTokens.Space.p20).frame(maxWidth: 620).frame(maxWidth: .infinity)
                .background(Weave.canvas).navigationTitle("WeftMate").accessibilityElement(children: .contain).accessibilityIdentifier("localWorkspace")
                .toolbar { ToolbarItem(placement: .primaryAction) { Button("登录") { cloud.requireLogin() }.accessibilityIdentifier("openAccountLogin") } }
        }
    }
}
