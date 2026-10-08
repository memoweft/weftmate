import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct SettingsView: View {
    @ObservedObject var model: AppleAppModel
    #if os(macOS)
    @EnvironmentObject private var updates: MacUpdateModel
    @Environment(\.openWindow) private var openWindow
    #endif
    @State private var confirmSignOut = false
    @State private var confirmServer = false
    @State private var draftCopyResult: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                Text("账户与设置").font(AppleTokens.Fonts.title2.weight(.semibold)).foregroundStyle(Weave.ink)
                if model.verificationPending {
                    InlineNotice(message: "服务器暂不可达，正在显示上次保存的账户身份。重新连接后会验证登录状态。")
                }
                if let error = model.draftError {
                    InlineNotice(message: error, isError: true)
                }
                if model.needsUnsavedDraftDecision {
                    WeaveCard {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                            Text("有改动尚未保存").font(AppleTokens.Fonts.headline).foregroundStyle(Weave.ink)
                            Button("复制未保存草稿") { copyUnsavedDrafts() }
                                .buttonStyle(OutlineActionStyle())
                            Button("重试保存并退出") { Task { await model.signOut() } }
                                .buttonStyle(OutlineActionStyle()).disabled(model.authBusy)
                            Button("仍然退出（未保存的改动会丢失）", role: .destructive) {
                                Task { await model.signOut(discardUnsavedChanges: true) }
                            }
                            .buttonStyle(OutlineActionStyle()).disabled(model.authBusy)
                            if let draftCopyResult {
                                Text(draftCopyResult).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                            }
                        }
                    }
                }
                WeaveCard {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                        HStack(spacing: AppleTokens.Space.p14) {
                            Text(String(model.accountName.prefix(1)).uppercased())
                                .font(AppleTokens.Fonts.title2.weight(.medium)).foregroundStyle(Weave.accent)
                                .frame(width: 52, height: 52).background(Weave.accentSoft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r16))
                            VStack(alignment: .leading, spacing: AppleTokens.Space.p5) {
                                Text(model.accountName).font(AppleTokens.Fonts.headline).foregroundStyle(Weave.ink)
                                Text(model.session?.account.username ?? "")
                                    .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                                    .accessibilityIdentifier("accountUsername")
                            }
                            Spacer(minLength: AppleTokens.Space.p0)
                        }
                        Divider()
                        LabeledContent("登录设备", value: model.session?.device.name ?? model.deviceName)
                            .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
                            .accessibilityIdentifier("accountDevice.\(model.session?.device.id ?? "unknown")")
                        Button("用 WeftMate 账号登录") {
                            Task { await model.signOut(); if model.session == nil { model.cloudLogin.showLogin = true } }
                        }.disabled(model.authBusy).accessibilityIdentifier("settingsCloudLogin")
                        Button(role: .destructive) { confirmSignOut = true } label: {
                            WeftLabel("退出登录 / 切换账户", icon: "back")
                        }
                        .buttonStyle(OutlineActionStyle())
                        .disabled(model.authBusy)
                        .accessibilityIdentifier("signOutButton")
                    }
                }

                WeaveCard {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                        WeftLabel("外观", icon: "sun").font(AppleTokens.Fonts.headline).foregroundStyle(Weave.ink)
                        Picker("颜色模式", selection: $model.appearanceMode) {
                            ForEach(AppleAppearance.allCases) { mode in Text(mode.title).tag(mode.rawValue) }
                        }.accessibilityIdentifier("appearancePicker")
                        Text("保存到这台设备").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    }
                }

                WeaveCard {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                        WeftLabel("审批", icon: "approval").font(AppleTokens.Fonts.headline).foregroundStyle(Weave.ink)
                        Text("新对话的默认模式").font(AppleTokens.Fonts.callout)
                        ApprovalModeControl(model: model, sessionID: nil).id(model.accountEpoch)
                        Text("按账户保存，只影响新建对话。已有对话在输入区切换审批模式。")
                            .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    }
                }

                WeaveCard {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p15) {
                        WeftLabel("服务器", icon: "cloud").font(AppleTokens.Fonts.headline).foregroundStyle(Weave.ink)
                        Text(model.session?.server.originString ?? model.serverInput)
                            .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text("更换服务器需要先退出当前账户，再登录到新的服务器。")
                            .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).lineSpacing(AppleTokens.Space.p3)
                        Button("更换服务器") { confirmServer = true }.buttonStyle(OutlineActionStyle())
                            .disabled(model.authBusy)
                            .accessibilityIdentifier("changeServerButton")
                    }
                }

                WeaveCard {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p13) {
                        WeftLabel("关于", icon: "brand-monochrome").font(AppleTokens.Fonts.headline).foregroundStyle(Weave.ink)

                        #if os(macOS)
                        LabeledContent("版本", value: updates.installedVersionDisplay)
                            .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
                        Button("检查更新…") {
                            openWindow(id: "updates")
                            updates.check()
                        }
                        .buttonStyle(OutlineActionStyle())
                        .accessibilityIdentifier("openUpdatesButton")
                        #else
                        LabeledContent("版本", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1")
                            .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
                        #endif
                    }
                }
            }
            .padding(AppleTokens.Space.p24).frame(maxWidth: 700).frame(maxWidth: .infinity)
        }
        .background(Weave.canvas)
        .navigationTitle("设置")
        .confirmationDialog("退出当前账户？", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) { Task { await model.signOut() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("当前会话列表会关闭。未发送草稿保留在本机对应账户，服务器原记录也会保留。")
        }
        .confirmationDialog("更换服务器？", isPresented: $confirmServer, titleVisibility: .visible) {
            Button("退出并更换", role: .destructive) { Task { await model.signOut() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("退出后，在登录页更改服务器地址。草稿仍归原服务器的原账户保留。")
        }
        .accessibilityIdentifier("settingsRoot")
    }

    private func copyUnsavedDrafts() {
        let text = model.unsavedDraftTextForCopy
        guard !text.isEmpty else { draftCopyResult = "没有尚未保存的文字。"; return }
        #if os(macOS)
        NSPasteboard.general.clearContents()
        draftCopyResult = NSPasteboard.general.setString(text, forType: .string) ? "已复制未保存草稿。" : "复制未完成，请重试。"
        #else
        UIPasteboard.general.string = text
        draftCopyResult = "已复制未保存草稿。"
        #endif
    }
}
