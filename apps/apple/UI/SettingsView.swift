import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: AppleAppModel
    @State private var confirmSignOut = false
    @State private var confirmServer = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("账户与设置").font(.title2.weight(.semibold)).foregroundStyle(Weave.ink)
                if model.verificationPending {
                    InlineNotice(message: "服务器暂不可达，正在显示上次保存的账户身份。重新连接后会验证登录状态。")
                }
                WeaveCard {
                    VStack(alignment: .leading, spacing: 20) {
                        HStack(spacing: 14) {
                            Text(String(model.accountName.prefix(1)).uppercased())
                                .font(.title2.weight(.medium)).foregroundStyle(Weave.accent)
                                .frame(width: 52, height: 52).background(Weave.accentSoft, in: RoundedRectangle(cornerRadius: 16))
                            VStack(alignment: .leading, spacing: 5) {
                                Text(model.accountName).font(.headline).foregroundStyle(Weave.ink)
                                Text(model.session?.account.username ?? "")
                                    .font(.callout).foregroundStyle(Weave.muted)
                                    .accessibilityIdentifier("accountUsername")
                            }
                            Spacer(minLength: 0)
                        }
                        Divider()
                        LabeledContent("登录设备", value: model.session?.device.name ?? model.deviceName)
                            .font(.callout).foregroundStyle(Weave.secondary)
                            .accessibilityIdentifier("accountDevice.\(model.session?.device.id ?? "unknown")")
                        Button(role: .destructive) { confirmSignOut = true } label: {
                            Label("退出登录 / 切换账户", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.authBusy)
                        .accessibilityIdentifier("signOutButton")
                    }
                }

                WeaveCard {
                    VStack(alignment: .leading, spacing: 15) {
                        Label("服务器", systemImage: "network").font(.headline).foregroundStyle(Weave.ink)
                        Text(model.session?.server.originString ?? model.serverInput)
                            .font(.callout).foregroundStyle(Weave.secondary).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text("更换服务器需要先退出当前账户，再登录到新的服务器。")
                            .font(.caption).foregroundStyle(Weave.muted).lineSpacing(3)
                        Button("更换服务器") { confirmServer = true }.buttonStyle(.bordered)
                            .disabled(model.authBusy)
                            .accessibilityIdentifier("changeServerButton")
                    }
                }

                WeaveCard {
                    VStack(alignment: .leading, spacing: 13) {
                        Label("Apple 客户端", systemImage: "app").font(.headline).foregroundStyle(Weave.ink)
                        LabeledContent("外观", value: "跟随系统").font(.callout).foregroundStyle(Weave.secondary)
                        LabeledContent("版本", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1")
                            .font(.callout).foregroundStyle(Weave.secondary)
                        Divider()
                        Text("当前可以登录、查看设备和读取原会话。续聊、附件和独立模型正在接通；Apple Watch 暂提供独立的起步界面。")
                            .font(.caption).foregroundStyle(Weave.muted).lineSpacing(4)
                    }
                }
            }
            .padding(24).frame(maxWidth: 700).frame(maxWidth: .infinity)
        }
        .background(Weave.canvas)
        .navigationTitle("设置")
        .confirmationDialog("退出当前账户？", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) { Task { await model.signOut() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("这台设备上的会话列表和草稿将清空。服务器上的原记录会保留。")
        }
        .confirmationDialog("更换服务器？", isPresented: $confirmServer, titleVisibility: .visible) {
            Button("退出并更换", role: .destructive) { Task { await model.signOut() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("退出后，在登录页更改服务器地址。这台设备上的当前草稿将清空。")
        }
        .accessibilityIdentifier("settingsRoot")
    }
}
