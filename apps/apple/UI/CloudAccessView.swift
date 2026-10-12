import SwiftUI

/// Server features ask for login without replacing the current local workspace.
struct CloudAccessPresenter: View {
    @ObservedObject var cloud: CloudLoginModel
    var body: some View {
        VStack {
            if let notice = cloud.newDeviceNotice {
                WeaveCard {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                        Text("有一台新设备登录").font(AppleTokens.Fonts.headline)
                        Text(notice).font(AppleTokens.Fonts.callout)
                        HStack {
                            Button("查看设备") { cloud.showDevices = true; cloud.dismissNewDeviceNotice() }
                                .buttonStyle(PrimaryActionStyle(fillsWidth: false)).accessibilityIdentifier("newDeviceOpen")
                            Button("知道了") { cloud.dismissNewDeviceNotice() }.buttonStyle(OutlineActionStyle())
                        }
                    }
                }.padding(AppleTokens.Space.p16).accessibilityElement(children: .contain).accessibilityIdentifier("newDeviceNotice")
            }
            Spacer()
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .allowsHitTesting(cloud.newDeviceNotice != nil)
            .sheet(isPresented: $cloud.showLogin) {
                NavigationStack {
                    AuthView(model: cloud).navigationTitle("登录")
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("稍后再说") { cloud.cancel() } } }
                }
                #if os(macOS)
                .frame(minWidth: 480, minHeight: 560)
                #endif
            }
    }
}
