import SwiftUI
import WeftMateCore

/// Account layout only. Network, countdown, validation and transitions belong to the model/core.
struct AuthView: View {
    @ObservedObject var model: CloudLoginModel
    @State private var showPassword = false
    @State private var legal: LegalDocument?
    private enum Field: Hashable { case email, password, repeated, code, name }
    @FocusState private var focus: Field?
    var body: some View {
        ScrollView { accountContent }.background(Weave.canvas).foregroundStyle(Weave.ink)
            .disabled(model.busy).sheet(item: $legal) { LegalDocumentView(document: $0) }
            .accessibilityIdentifier("authRoot")
        #if WEFTMATE_WINDOW_TEST
            .onAppear { PhoneWindowLaunch.recordLoginVisible() }
        #endif
        #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") { focus = nil }.accessibilityIdentifier("dismissAccountKeyboard")
                }
            }
        #endif
    }
    var accountContent: some View {
            VStack(spacing: AppleTokens.Space.p24) {
                BrandMark(size: 48)
                WeaveCard {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                        Text(title).font(AppleTokens.Fonts.title2.weight(.semibold))
                        if model.form.page == .login {
                            HStack(spacing: AppleTokens.Space.p8) {
                                Button("密码登录") { model.form.loginMethod = .password; model.form.password = "" }
                                    .buttonStyle(AccountActionStyle(primary: model.form.loginMethod == .password,selection:true))
                                    .frame(maxWidth: .infinity).accessibilityValue(model.form.loginMethod == .password ? "已选择" : "")
                                Button("验证码登录") { model.form.loginMethod = .emailCode; model.form.password = "" }
                                    .buttonStyle(AccountActionStyle(primary: model.form.loginMethod == .emailCode,selection:true))
                                    .frame(maxWidth: .infinity).accessibilityValue(model.form.loginMethod == .emailCode ? "已选择" : "")
                            }.accessibilityIdentifier("loginMethod")
                        }
                        fields
                        if let error = model.error { InlineNotice(message: error, isError: true).accessibilityIdentifier("authError") }
                        if let notice = model.notice { InlineNotice(message: notice) }
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let seconds = max(0, Int(ceil(model.retryAt.timeIntervalSince(context.date))))
                            Button { Task { await model.submit() } } label: {
                                HStack { if model.busy { ProgressView().controlSize(.small) }; Text(seconds > 0 ? "等待 \(seconds) 秒" : actionTitle) }
                            }.buttonStyle(AccountActionStyle(primary: true)).disabled(model.busy || !canSubmit || seconds > 0)
                                .accessibilityIdentifier("accountSubmit")
                        }
                        if model.form.page == .login {
                            Button("忘记密码？") { model.changePage(.recovery) }.buttonStyle(AccountActionStyle()).accessibilityIdentifier("accountRecovery")
                            Button("还没有账号？注册") { model.changePage(.registration) }.buttonStyle(AccountActionStyle()).accessibilityIdentifier("accountRegistration")
                        } else {
                            Button("回到登录") { model.changePage(.login) }
                        }
                    }
                }.frame(maxWidth: 468)
                if model.form.page == .registration {
                    VStack(spacing: AppleTokens.Space.p6) {
                        Text("注册即表示同意").font(AppleTokens.Fonts.caption)
                        HStack(spacing: AppleTokens.Space.p8) {
                            Button("《服务条款》") { legal = .terms }
                            Button("《隐私政策》") { legal = .privacy }
                        }.font(AppleTokens.Fonts.caption)
                    }.foregroundStyle(Weave.muted)
                }
            }.padding(AppleTokens.Space.p24).frame(maxWidth: .infinity)
    }
    private var title: String {
        switch model.form.page {
        case .login: "登录 WeftMate"
        case .registration: "注册 WeftMate"
        case .recovery: "找回密码"
        case .deviceConfirmation: "查看邮箱验证码"
        }
    }
    @ViewBuilder private var fields: some View {
        if model.form.page == .login || model.form.step == .email && model.form.page != .deviceConfirmation {
            TextField("邮箱", text: $model.form.email).accountInput().weaveField().focused($focus, equals: .email).accessibilityLabel("邮箱").accessibilityIdentifier("accountEmail")
            #if os(iOS)
                .keyboardType(.emailAddress)
            #endif
        }
        if model.form.page == .login && model.form.loginMethod == .password || [.registration, .recovery].contains(model.form.page) && model.form.step == .password {
            HStack {
                Group {
                    if showPassword { TextField("密码", text: $model.form.password) }
                    else { SecureField("密码", text: $model.form.password) }
                }.accountInput().focused($focus, equals: .password).accessibilityLabel("密码").accessibilityIdentifier("accountPassword")
                Button(showPassword ? "隐藏" : "显示") { showPassword.toggle() }
                    .font(AppleTokens.Fonts.caption).accessibilityLabel(showPassword ? "隐藏密码" : "显示密码")
            }.weaveField()
            if model.form.page != .login {
                SecureField("再次输入密码", text: $model.form.repeatedPassword).weaveField().focused($focus, equals: .repeated)
                    .accessibilityLabel("再次输入密码").accessibilityIdentifier("accountRepeatedPassword")
                Text(model.form.strength).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }
        }
        if model.form.page == .deviceConfirmation || model.form.step == .code {
            Text(model.form.loginMethod == .password ? "这是你第一次在这台设备登录。输入邮件里的验证码即可继续。" : "验证码已发送到你的邮箱。输入 6 位数字即可登录，无需密码。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
            TextField("6 位验证码", text: $model.form.code).accountInput().weaveField().focused($focus, equals: .code)
                .accessibilityLabel("6 位验证码").accessibilityIdentifier("accountCode")
            #if os(iOS)
                .keyboardType(.numberPad).textContentType(.oneTimeCode)
            #endif
            if model.form.page == .deviceConfirmation || model.form.step == .code {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let seconds = model.form.resendSeconds(now: context.date)
                    Button(seconds > 0 ? "\(seconds) 秒后可重发" : "重新发送验证码") { Task { await model.resend() } }
                        .disabled(seconds > 0 || model.busy)
                }
            }
        }
        if model.form.page == .registration && model.form.step == .deviceName {
            TextField("设备名称", text: $model.deviceName).weaveField().focused($focus, equals: .name).accessibilityLabel("设备名称").accessibilityIdentifier("accountDeviceName")
        }
    }
    private var actionTitle: String {
        if model.busy { return "正在处理…" }
        switch model.form.page {
        case .login: return model.form.loginMethod == .emailCode ? "发送验证码" : "登录"
        case .deviceConfirmation: return "确认并登录"
        case .registration, .recovery:
            switch model.form.step {
            case .email: return "发送验证码"
            case .code: return "验证"
            case .password: return model.form.page == .recovery ? "设置新密码" : "下一步"
            case .deviceName: return "完成并登录"
            }
        }
    }
    private var canSubmit: Bool {
        if model.form.page == .login { return !model.form.email.isEmpty && (model.form.loginMethod == .emailCode || !model.form.password.isEmpty) }
        if model.form.page == .deviceConfirmation || model.form.step == .code {
            return model.form.code.count == 6 && model.form.code.allSatisfy(\.isNumber)
        }
        if model.form.step == .password { return model.form.validPassword }
        if model.form.step == .deviceName { return !model.deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return !model.form.email.isEmpty
    }
}

enum LegalDocument: String, Identifiable {
    case terms, privacy
    var id: String { rawValue }
    var title: String { self == .terms ? "服务条款" : "隐私政策" }
    var content: String {
        guard let url = Bundle.main.url(forResource: self == .terms ? "terms-zh" : "privacy-zh", withExtension: "md"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "文档未能打开，请稍后重试。" }
        return text
    }
}
struct LegalDocumentView: View {
    let document: LegalDocument
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView { Text(document.content).font(AppleTokens.Fonts.body).textSelection(.enabled).padding(AppleTokens.Space.p24).frame(maxWidth: 760, alignment: .leading) }
                .background(Weave.canvas).foregroundStyle(Weave.ink).navigationTitle(document.title)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 580)
        #endif
    }
}

/// Capsule controls are shared only by the login and device pages.
struct AccountActionStyle: ButtonStyle {
    var primary = false
    var selection = false
    @Environment(\.isEnabled) private var enabled
    @ViewBuilder func makeBody(configuration: Configuration) -> some View {
        #if os(iOS)
        if selection {
            configuration.label.font(AppleTokens.Fonts.body.weight(.semibold))
                .padding(.horizontal,AppleTokens.Space.p20).frame(maxWidth:.infinity,minHeight:48)
                .foregroundStyle(primary ? Weave.ink : Weave.muted)
                .background(primary ? Weave.accentSoft : .clear,in:Capsule()).contentShape(Capsule())
                .opacity(enabled ? (configuration.isPressed ? AppleTokens.Opacity.pressed : 1) : AppleTokens.Opacity.disabled)
        } else { ordinary(configuration) }
        #else
        ordinary(configuration)
        #endif
    }
    private func ordinary(_ configuration: Configuration) -> some View {
        configuration.label.font(AppleTokens.Fonts.body.weight(.semibold))
            .padding(.horizontal, AppleTokens.Space.p20).frame(minHeight: 48)
            .frame(maxWidth: primary ? .infinity : nil)
            .foregroundStyle(primary ? Weave.onAccent : Weave.accent)
            .background(primary ? Weave.accent : Weave.accentSoft, in: Capsule())
            .opacity(enabled ? (configuration.isPressed ? AppleTokens.Opacity.pressed : 1) : AppleTokens.Opacity.disabled)
    }
}
