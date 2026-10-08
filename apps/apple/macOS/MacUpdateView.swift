import SwiftUI
import WeftMateCore

struct MacUpdateView: View {
    @EnvironmentObject private var updates: MacUpdateModel
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
            Text("WeftMate · Mac 更新").font(AppleTokens.Fonts.title2)
            LabeledContent("App 版本", value: updates.installedVersionDisplay).accessibilityIdentifier("installedVersion")
            Text(updates.statusText).accessibilityIdentifier("updateStatus")
            Button("检查更新") { updates.check() }.disabled(updates.checking).accessibilityIdentifier("checkUpdatesButton")
            if let release = updates.release { Link("打开下载页", destination: release.downloadPage).accessibilityIdentifier("downloadUpdateButton") }
            Text("下载完成后，请在任务空闲时手动安装新版应用。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            Link("查看 Mac 下载页", destination: PublicUpdateClient.macLandingURL)
        }.padding(AppleTokens.Space.p24).frame(minWidth: 400, minHeight: 300)
            .background(Weave.canvas).tint(Weave.accent).accessibilityIdentifier("updateWindow")
    }
}
