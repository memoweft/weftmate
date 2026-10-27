#if os(iOS)
import SwiftUI
import WeftMateCore

struct PhoneServiceModelProfile: View {
    let item: ServiceModel
    let profile: WeftMateCore.UsageModel?
    private func capability(_ value: Bool?) -> String { value.map { $0 ? "支持" : "不支持" } ?? "尚未声明" }
    var body: some View {
        Form {
            Section("模型") { Text(item.name); Text(item.modelId).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).textSelection(.enabled) }
            Section("能力") {
                LabeledContent("图片", value: capability(item.capabilities?.vision))
                LabeledContent("深入思考", value: capability(item.deepThinking?.supported))
                LabeledContent("上下文容量", value: item.capabilities?.contextWindow.map { "\($0)" } ?? "尚未声明")
            }
            Section {
                if let price = profile?.price {
                    LabeledContent("输入", value: "\(price.input)")
                    LabeledContent("缓存输入", value: "\(price.cachedInput)")
                    LabeledContent("输出", value: "\(price.output)")
                } else { Text("费用未知，尚未配置单价。").foregroundStyle(Weave.muted) }
            } header: { Text("单价 · 元 / 百万字") } footer: { Text("沿用电脑配置的单价估算。未知价格单独列出，不当作零；可在电脑端调整模型档案。") }
        }.scrollContentBackground(.hidden).background(Weave.grouped).navigationTitle("单价与能力").navigationBarTitleDisplayMode(.inline)
    }
}
#endif
