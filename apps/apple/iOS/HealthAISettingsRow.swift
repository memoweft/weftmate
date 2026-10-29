import SwiftUI
import WeftMateCore

struct HealthAISettingsRow: View {
    @ObservedObject var app: AppleAppModel
    @State private var settings: HealthPageSettings?
    @State private var message: String?
    @State private var updating=false
    @State private var attempt=0
    @State private var loading=false
    var body: some View {
        if app.session == nil { Text("分数和 AI 解读，连上电脑后可用。").font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted) }
        else if let settings {
            Toggle("今日解读用模型写",isOn:Binding(get:{self.settings?.modelInsightsEnabled == true},set:{value in Task { await change(top:value) } })).disabled(updating).accessibilityIdentifier("health.modelInsightsEnabled")
            if settings.itemAnalysisEnabled != nil {
                Toggle("各项 AI 分析",isOn:Binding(get:{self.settings?.itemAnalysisEnabled == true},set:{value in Task { await change(item:value) } })).disabled(updating)
            }
            Text("汇总和模型解读用于了解趋势，不是医学结论；模型只接收汇总数字，各项分析展开时才生成。") .font(AppleTokens.Fonts.footnote).foregroundStyle(.secondary)
        }
        if loading { ProgressView("正在读取解读设置…") }
        if let message { Text(message).font(AppleTokens.Fonts.footnote).foregroundStyle(.secondary);Button("重试") { attempt += 1 }.disabled(updating) }
        Color.clear.frame(height:0).task(id:"\(app.accountEpoch)-\(attempt)") {
            let token=app.accountEpoch;settings=nil;message=nil;updating=false
            guard app.session != nil else { return }
            loading=true;defer { if token == app.accountEpoch { loading=false } }
            do { let reply=try await app.assistantClient.healthPageSettings();if token == app.accountEpoch,!Task.isCancelled { settings=reply.settings } }
            catch { if token == app.accountEpoch,!Task.isCancelled { message="解读设置暂时读不到，请连接电脑后重试。" } }
        }
    }

    private func change(top: Bool? = nil,item: Bool? = nil) async {
        let token=app.accountEpoch;updating=true;defer { if token == app.accountEpoch { updating=false } }
        do {
            let reply: HealthPageSettingsReply
            if let top { reply=try await app.assistantClient.healthTopInsightSetting(top) }
            else { reply=try await app.assistantClient.healthPageSettings(enabled:item) }
            if token == app.accountEpoch { settings=reply.settings;message=nil }
        } catch { if token == app.accountEpoch { message="设置还没改好，连接电脑后再试。" } }
    }
}
