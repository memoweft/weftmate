#if os(iOS)
import SwiftUI
import WeftMateCore

struct PhoneAccountSettingsPage: View {
    @ObservedObject var cloud: CloudLoginModel
    @State private var others = false
    @State private var logout = false
    @State private var deletion = false
    var body: some View {
        Form {
            Section {
                PhoneSettingsLabel(title: "你的账号", subtitle: cloud.email, icon: "account", disclosure: false).accessibilityIdentifier("signedInEmail")
                NavigationLink("换绑邮箱") { PhoneAccountEmailPage(cloud: cloud) }.accessibilityIdentifier("account.changeEmail")
                NavigationLink("修改密码") { PhoneAccountPasswordPage(cloud: cloud) }.accessibilityIdentifier("account.changePassword")
                NavigationLink("登录设备", value: AppleSettingsRoute(categoryID: "devices"))
            }
            Section("会话与账号") {
                Button("退出所有其他设备") { others = true }.disabled(cloud.busy).accessibilityIdentifier("account.logoutOthers")
                    .phonePopover(isPresented: $others) {
                        confirmation("其他设备会退出登录，当前手机继续使用。", title: "退出其他设备") { Task { await cloud.logoutOthers() }; others = false }
                    }
                Button("注销账号", role: .destructive) { deletion = true }.accessibilityIdentifier("account.delete")
            }
            Section {
                Button("退出当前账号", role: .destructive) { logout = true }.disabled(cloud.busy).accessibilityIdentifier("accountLogout")
                    .phonePopover(isPresented: $logout) {
                        confirmation("退出当前账号？未发送草稿保留在这台手机。", title: "退出登录") { Task { await cloud.signOutAccount() }; logout = false }
                    }
            }
            PhoneAccountFeedback(cloud: cloud)
        }.scrollContentBackground(.hidden).background(Weave.grouped).navigationTitle("账号与安全")
            .sheet(isPresented: $deletion) { PhoneAccountDeletion(cloud: cloud, close: { deletion = false }).phoneSheet("注销账号", close: { deletion = false }) }
    }
    private func confirmation(_ text: String, title: String, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
            Text(text).fixedSize(horizontal: false, vertical: true)
            Button(title, role: .destructive, action: action).disabled(cloud.busy)
            Button("取消") { others = false; logout = false }
        }.padding(AppleTokens.Space.p20).frame(idealWidth: AppleTokens.Phone.menuWidth)
    }
}

private struct PhoneAccountFeedback: View {
    @ObservedObject var cloud: CloudLoginModel
    var body: some View {
        if let error = cloud.error { InlineNotice(message: error, isError: true).accessibilityIdentifier("account.error") }
        if let notice = cloud.notice { InlineNotice(message: notice).accessibilityIdentifier("account.notice") }
        if cloud.busy { ProgressView("正在处理…") }
    }
}

private struct PhoneAccountEmailPage: View {
    @ObservedObject var cloud: CloudLoginModel
    @State private var email = ""
    @State private var code = ""
    var body: some View {
        Form {
            Section {
                TextField("新邮箱", text: $email).accountInput().keyboardType(.emailAddress).textContentType(.emailAddress)
                    .disabled(cloud.emailChangeChallenge != nil).accessibilityIdentifier("account.newEmail")
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let seconds = max(0, Int(ceil(cloud.emailResendAt.timeIntervalSince(context.date))))
                    Button(seconds > 0 ? "\(seconds) 秒后可重发" : "发送新邮箱验证码") { Task { await cloud.requestEmailChange(email) } }
                        .disabled(cloud.busy || email.isEmpty || seconds > 0).accessibilityIdentifier("account.sendEmailCode")
                }
                if cloud.emailChangeChallenge != nil {
                    TextField("新邮箱验证码", text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode)
                        .accessibilityIdentifier("account.newEmailCode")
                    Button("换一个邮箱") { cloud.cancelEmailChange(); code = "" }.disabled(cloud.busy)
                }
            } footer: { Text("验证新邮箱后，账号内容继续保留。换绑成功后需要重新登录。") }
            Section {
                Button("确认换绑邮箱") { Task { await cloud.confirmEmailChange(email, code: code); code = "" } }
                    .disabled(cloud.busy || cloud.emailChangeChallenge == nil || code.count != 6 || !code.allSatisfy(\.isNumber)).accessibilityIdentifier("account.confirmEmail")
            }
            PhoneAccountFeedback(cloud: cloud)
        }.scrollContentBackground(.hidden).background(Weave.grouped).navigationTitle("换绑邮箱").scrollDismissesKeyboard(.interactively)
            .onDisappear { code = ""; cloud.cancelEmailChange() }
    }
}

private struct PhoneAccountPasswordPage: View {
    @ObservedObject var cloud: CloudLoginModel
    @State private var current = ""
    @State private var password = ""
    @State private var repeated = ""
    @State private var visible = false
    var body: some View {
        Form {
            Section {
                SecureField("当前密码", text: $current).textContentType(.password).accessibilityIdentifier("account.currentPassword")
                HStack {
                    Group { if visible { TextField("新密码", text: $password) } else { SecureField("新密码", text: $password) } }
                        .textContentType(.newPassword).accessibilityIdentifier("account.newPassword")
                    Button(visible ? "隐藏" : "显示") { visible.toggle() }.frame(minWidth: AppleTokens.Space.p44, minHeight: AppleTokens.Space.p44).buttonStyle(.borderless)
                }
                SecureField("再次输入新密码", text: $repeated).textContentType(.newPassword).accessibilityIdentifier("account.repeatPassword")
            } footer: { Text("密码至少 15 位，两次输入需一致。修改成功后需要重新登录。") }
            Section {
                Button("保存新密码") {
                    Task { await cloud.changePassword(current: current, password: password, repeatPassword: repeated); current = ""; password = ""; repeated = "" }
                }.disabled(cloud.busy || current.isEmpty || password.count < 15 || password != repeated).accessibilityIdentifier("account.savePassword")
            }
            PhoneAccountFeedback(cloud: cloud)
        }.scrollContentBackground(.hidden).background(Weave.grouped).navigationTitle("修改密码").scrollDismissesKeyboard(.interactively)
            .onDisappear { current = ""; password = ""; repeated = "" }
    }
}

private struct PhoneAccountDeletion: View {
    @ObservedObject var cloud: CloudLoginModel
    let close: () -> Void
    @State private var password = ""
    @State private var confirm = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                Text("云端账号数据全部删除且不可恢复。手机上的原话与电脑上的内容需要分别管理。")
                SecureField("输入密码重新验证", text: $password).textContentType(.password).weaveField().accessibilityIdentifier("account.deletePassword")
                Button("注销账号", role: .destructive) { confirm = true }.disabled(password.isEmpty || cloud.busy).accessibilityIdentifier("account.confirmDelete")
                PhoneAccountFeedback(cloud: cloud)
            }.padding(AppleTokens.Space.p20)
        }.confirmationDialog("永久注销账号？此操作无法恢复。", isPresented: $confirm, titleVisibility: .visible) {
            Button("永久注销账号", role: .destructive) { Task { await cloud.deleteAccount(password: password); password = ""; if !cloud.authenticated { close() } } }
            Button("取消", role: .cancel) {}
        }.onDisappear { password = "" }
    }
}
#endif
