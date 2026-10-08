import SwiftUI

struct MacUpdateView: View {
    @EnvironmentObject private var updates: MacUpdateModel
    @Environment(\.openURL) private var openURL
    @FocusState private var checkFocused: Bool
    @State private var browserFailed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                HStack(spacing: AppleTokens.Space.p13) {
                    BrandMark(size: 42)
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p4) {
                        Text("WeftMate").font(AppleTokens.Fonts.title2.weight(.semibold)).foregroundStyle(Weave.ink)
                        Text("Mac 更新").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                    }
                }

                WeaveCard {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                        LabeledContent("本机版本", value: updates.installedVersionDisplay)
                            .accessibilityIdentifier("installedVersion")
                        LabeledContent("进程架构", value: updates.architecture)
                    }
                    .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
                }

                WeaveCard {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                        HStack(spacing: AppleTokens.Space.p10) {
                            if updates.checking {
                                ProgressView().controlSize(.small)
                            } else {
                                WeftIcon( statusSymbol).foregroundStyle(statusColor)
                            }
                            Text(statusTitle).font(AppleTokens.Fonts.title3.weight(.semibold)).foregroundStyle(Weave.ink)
                        }
                        Text(statusMessage).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
                            .fixedSize(horizontal: false, vertical: true).lineSpacing(AppleTokens.Space.p4)
                        if let release = updates.release, !release.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Divider()
                            Text(release.notes).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                                .fixedSize(horizontal: false, vertical: true).lineSpacing(AppleTokens.Space.p4)
                                .textSelection(.enabled)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("updateStatus")
                }

                VStack(spacing: AppleTokens.Space.p12) {
                    Button(updates.checking ? "正在检查…" : "检查更新") {
                        browserFailed = false
                        updates.check()
                    }
                    .buttonStyle(PrimaryActionStyle())
                    .disabled(updates.checking)
                    .keyboardShortcut(.defaultAction)
                    .focused($checkFocused)
                    .accessibilityIdentifier("checkUpdatesButton")

                    Button(updates.downloadLabel) {
                        browserFailed = false
                        openURL(updates.downloadURL) { accepted in browserFailed = !accepted }
                    }
                    .buttonStyle(.bordered).controlSize(.large)
                    .disabled(updates.checking)
                    .accessibilityIdentifier("downloadUpdateButton")

                    Link("其他设备下载", destination: updates.otherDevicesURL)
                        .font(AppleTokens.Fonts.callout)
                        .accessibilityIdentifier("otherDevicesDownloadLink")
                }
                .frame(maxWidth: .infinity)

                if browserFailed {
                    InlineNotice(message: "无法打开浏览器，请重试。", isError: true)
                }
                Text("更新信息来自官网，无需登录。下载完成后，请手动安装新版应用。")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).lineSpacing(AppleTokens.Space.p4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(AppleTokens.Space.p24)
            .frame(maxWidth: 620, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Weave.canvas)
        .tint(Weave.accent)
        .frame(minWidth: 400, minHeight: 420)
        .accessibilityIdentifier("updateWindow")
        .onAppear { checkFocused = true }
        .onDisappear { updates.cancelCheck() }
    }

    private var statusTitle: String {
        switch updates.phase {
        case .idle: "检查官网发布的版本"
        case .checking: "正在检查更新…"
        case .updateAvailable: "有新版本"
        case .upToDate: "已是最新版本"
        case .localIsNewer: "本机版本较新"
        case .noCompatibleRelease: "暂无匹配的 Mac 版本"
        case .failure: "暂时无法检查更新"
        }
    }

    private var statusMessage: String {
        switch updates.phase {
        case .idle: "检查后即可查看适合这台 Mac 的下载。"
        case .checking: "正在读取官网更新信息。"
        case .updateAvailable(let release): "官网版本 \(release.version) / \(release.build) 已可下载。"
        case .upToDate(let release): "官网版本 \(release.version) / \(release.build) 与本机相同。"
        case .localIsNewer(let release): "官网当前版本为 \(release.version) / \(release.build)。"
        case .noCompatibleRelease: "官网尚未提供匹配 \(updates.architecture) 的安装包。"
        case .failure(let message): message
        }
    }

    private var statusSymbol: String {
        switch updates.phase {
        case .idle, .checking: "sync"
        case .updateAvailable: "download"
        case .upToDate: "allow"
        case .localIsNewer: "send"
        case .noCompatibleRelease: "desktop"
        case .failure: "warn"
        }
    }

    private var statusColor: Color {
        if case .failure = updates.phase { return Weave.danger }
        return Weave.accent
    }
}
