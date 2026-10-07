import SwiftUI

struct AuthView: View {
    @ObservedObject var model: AppleAppModel
    @State private var register = false
    @State private var username = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var showServer = false
    @FocusState private var field: Field?
    private enum Field: Hashable { case server, username, password, displayName }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                HStack(spacing: 12) {
                    BrandMark()
                    VStack(alignment: .leading, spacing: 3) {
                        Text("WeftMate").font(.title2.weight(.semibold)).tracking(-0.6)
                        Text("在这里，接上你的话题").font(.callout).foregroundStyle(Weave.muted)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: 420)

                WeaveCard {
                    VStack(alignment: .leading, spacing: 20) {
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 9) {
                                Text(register ? "创建你的账户" : "欢迎回来")
                                    .font(.system(size: 28, weight: .semibold)).tracking(-0.7)
                                Text("用同一个账户，接上原来的对话。")
                                    .font(.callout).foregroundStyle(Weave.muted).lineSpacing(4)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            SpiritView(size: 76)
                        }
                        Picker("账户操作", selection: $register) {
                            Text("登录").tag(false)
                            Text("注册").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .disabled(model.authBusy)

                        VStack(alignment: .leading, spacing: 8) {
                            fieldLabel("账户")
                            TextField("账户名", text: $username)
                                .textContentType(.username)
                                .accountInput().weaveField()
                                .focused($field, equals: .username)
                                .submitLabel(.next)
                                .onSubmit { field = .password }
                                .accessibilityIdentifier("username")
                            if register {
                                Text("账户名为 3–64 个字符，可使用字母、数字、点、横线和下划线。")
                                    .font(.caption).foregroundStyle(Weave.muted)
                            }
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            fieldLabel("密码")
                            SecureField(register ? "15–128 个字符" : "输入密码", text: $password)
                                .textContentType(register ? .newPassword : .password)
                                .weaveField().focused($field, equals: .password)
                                .submitLabel(register ? .next : .go)
                                .onSubmit { if register { field = .displayName } else { authenticate() } }
                                .accessibilityIdentifier("password")
                        }

                        if register {
                            VStack(alignment: .leading, spacing: 8) {
                                fieldLabel("昵称（可选）")
                                TextField("希望怎么称呼你", text: $displayName)
                                    .textContentType(.nickname).weaveField()
                                    .focused($field, equals: .displayName).submitLabel(.go)
                                    .onSubmit(authenticate)
                                    .accessibilityIdentifier("displayName")
                            }
                        }

                        VStack(alignment: .leading, spacing: 10) {
                            Button {
                                withAnimation(.easeInOut(duration: 0.18)) { showServer.toggle() }
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "network")
                                    Text(model.serverDisplayName).lineLimit(1)
                                    Spacer()
                                    Text(showServer ? "收起" : "更改").font(.caption.weight(.medium))
                                    Image(systemName: "chevron.down").font(.caption2).rotationEffect(.degrees(showServer ? 180 : 0))
                                }
                                .font(.callout).foregroundStyle(Weave.secondary)
                                .padding(.vertical, 6).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain).accessibilityIdentifier("serverSettingsButton")
                            if showServer {
                                TextField("https://服务器地址", text: $model.serverInput)
                                    .serverInput().weaveField().focused($field, equals: .server)
                                    .submitLabel(.next).onSubmit { field = .username }
                                    .accessibilityIdentifier("serverURL")
                                Text("连接你自己的 WeftMate 服务器。更改地址后，登录到该服务器上的账户。")
                                    .font(.caption).foregroundStyle(Weave.muted).lineSpacing(3)
                            }
                        }

                        if let error = model.authError {
                            InlineNotice(message: error, isError: true)
                                .accessibilityIdentifier("authError")
                        }

                        Button(action: authenticate) {
                            HStack(spacing: 9) {
                                if model.authBusy { ProgressView().controlSize(.small).tint(.white) }
                                Text(model.authBusy ? "正在连接…" : register ? "注册并登录" : "登录")
                            }
                        }
                        .buttonStyle(PrimaryActionStyle())
                        .disabled(model.authBusy || username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                        .accessibilityIdentifier(register ? "registerButton" : "loginButton")
                    }
                    .foregroundStyle(Weave.ink)
                }
                .frame(maxWidth: 468)

                Text("账户数据按账户独立保存。登录失败时，输入会保留在当前页面。")
                    .font(.caption).foregroundStyle(Weave.muted)
                    .multilineTextAlignment(.center).frame(maxWidth: 410)
            }
            .padding(.horizontal, 24).padding(.vertical, 36)
            .frame(maxWidth: .infinity)
        }
        .background(Weave.canvas)
        .disabled(model.authBusy)
        .onChange(of: register) { _, _ in model.authError = nil }
        #if os(iOS)
        .scrollDismissesKeyboard(.interactively)
        #endif
        .accessibilityIdentifier("authRoot")
    }

    private func fieldLabel(_ label: String) -> some View {
        Text(label).font(.callout.weight(.medium)).foregroundStyle(Weave.secondary)
    }

    private func authenticate() {
        guard !model.authBusy else { return }
        field = nil
        Task { await model.authenticate(username: username, password: password,
                                       displayName: register ? displayName : nil, register: register) }
    }
}
