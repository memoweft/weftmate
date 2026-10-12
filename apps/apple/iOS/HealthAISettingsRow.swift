import SwiftUI
import WeftMateCore

struct HealthAISettingsRow: View {
    @ObservedObject var app: AppleAppModel
    @State private var settings: HealthPageSettings?
    @State private var message: String?
    @State private var updating=false
    var body: some View {
        if let settings {
            Toggle("今日解读使用 AI",isOn:Binding(get:{self.settings?.modelInsightsEnabled == true},set:{value in Task { await change(top:value) } })).disabled(updating)
            if settings.itemAnalysisEnabled != nil {
                Toggle("各项 AI 分析",isOn:Binding(get:{self.settings?.itemAnalysisEnabled == true},set:{value in Task { await change(item:value) } })).disabled(updating)
            }
            Text("会把每天的汇总数字发给你设置的模型，不发明细。各项分析只有展开时才生成。") .font(.footnote).foregroundStyle(.secondary)
        }
        if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
        Color.clear.frame(height:0).task(id:app.accountEpoch) {
            let token=app.accountEpoch; settings=nil; message=nil
            if let reply=try? await app.assistantClient.healthPageSettings(),token == app.accountEpoch { settings=reply.settings }
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
