import SwiftUI

struct SpiritProfileView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p24) {
                VStack(spacing: AppleTokens.Space.p12) {
                    SpiritView(size: 144)
                    Text("小纬").font(AppleTokens.Fonts.title2.weight(.semibold)).foregroundStyle(Weave.ink)
                    Text("陪你接上话题，也陪你把事情慢慢做好。")
                        .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                DisclosureGroup("查看表情设定") {
                    Image("WeftMateSpiritStates")
                        .resizable().aspectRatio(1, contentMode: .fit)
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel("小纬的待机、倾听、思考和完成四种表情设定")
                        .accessibilityIdentifier("spiritStateReference")
                        .padding(.top, AppleTokens.Space.p12)
                }
                .foregroundStyle(Weave.ink)
                .accessibilityIdentifier("spiritStatesDisclosure")
                Text("当前展示的是静态形象和表情设定。")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }
            .padding(AppleTokens.Space.p24).frame(maxWidth: 520).frame(maxWidth: .infinity)
        }
        .background(Weave.canvas)
        .navigationTitle("小纬")
        .accessibilityIdentifier("spiritProfile")
    }
}
