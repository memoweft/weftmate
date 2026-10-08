import SwiftUI

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
                SecureField("新密码（至少 8 位）", text: $password).accessibilityLabel("新密码").focused($field, equals: .password)
                SecureField("再次输入新密码", text: $repeatedPassword).accessibilityLabel("再次输入新密码").focused($field, equals: .repeated)
                Button("修改密码") {
                    Task {
                        await cloud.changePassword(current: currentPassword, password: password, repeatPassword: repeatedPassword)
                        currentPassword = ""; password = ""; repeatedPassword = ""
                    }
                }.disabled(cloud.busy || currentPassword.isEmpty || password.count < 8 || password != repeatedPassword)
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

/// Cloud-only shell: the account stays usable before a trusted content host exists.
struct CloudAccountHome: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var cloud: CloudLoginModel
    var body: some View {
        NavigationStack {
            VStack(spacing: AppleTokens.Space.p24) {
                BrandMark(size: 48)
                if cloud.waiting {
                    Text("在你已登录的设备上允许这台设备").font(AppleTokens.Fonts.title3).multilineTextAlignment(.center).accessibilityIdentifier("cloudWaiting")
                    ForEach(cloud.devices.filter { !$0.isCurrent }) { device in WeftLabel(device.name, icon: device.icon) }
                    Button("取消连接") { cloud.cancel() }.buttonStyle(OutlineActionStyle())
                    Button("换账号") { Task { await cloud.signOutAccount() } }
                } else {
                    Text("已登录 WeftMate").font(AppleTokens.Fonts.title2)
                    Text("在设置中连接你的电脑，接上对话与记忆。")
                        .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted).multilineTextAlignment(.center)
                }
                NavigationLink { CloudDevicesView(app: app, cloud: cloud) } label: { WeftLabel("设置 → 设备", icon: "desktop") }.buttonStyle(PrimaryActionStyle())
                NavigationLink { AccountSettingsView(cloud: cloud) } label: { WeftLabel("设置 → 账户", icon: "account") }.buttonStyle(OutlineActionStyle())
                if let error = cloud.error { InlineNotice(message: error, isError: true) }
            }.padding(AppleTokens.Space.p24).frame(maxWidth: 468).frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Weave.canvas).navigationTitle("WeftMate")
        }
    }
}
