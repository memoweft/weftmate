import SwiftUI
import WeftMateCore

struct PhoneLocalHealthView: View {
    @ObservedObject var app: AppleAppModel
    @EnvironmentObject private var health: DailyHealthModel
    @StateObject private var page=HealthPageModel()
    private var latest: DailyHealth? { health.state.pending.sorted { $0.key > $1.key }.first(where: { $0.value.status == "available" })?.value }
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text("iPhone 可以读取本机健康数据；分数和解读，连上电脑后可用。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                if !health.state.connected || !health.state.enabled {
                    Text("还没有授权读取健康数据。允许后可以在这里查看本机测量，缺少的数据会留空。")
                    Button("授权读取健康数据") { Task { await health.connect(app:app) } }.disabled(health.busy || !health.reader.available).buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("phoneHealth.authorize")
                } else {
                    Button("更新本机测量") { Task { await health.activate(app:app) } }.disabled(health.busy).buttonStyle(OutlineActionStyle())
                    if let value=latest {
                        VStack(spacing:0) {
                            metric("步数",value.steps.map(Double.init),"步")
                            metric("昨晚睡眠",value.sleepMinutes,"分钟")
                            metric("静息心率",value.restingHeartRateBpm,"次/分")
                            metric("心率变异性",value.hrvSdnnMs,"毫秒")
                            metric("活动能量",value.activeEnergyKcal,"千卡")
                            metric("运动",value.exerciseMinutes,"分钟")
                        }
                    } else { Text("暂时没有读到测量。健康数据也可能尚未获准读取，请到 iPhone 的健康 App 检查权限。") }
                }
                if health.busy { ProgressView("正在读取本机测量…") }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("健康").navigationBarTitleDisplayMode(.large).toolbar { ToolbarItem(placement:.primaryAction) { NavigationLink { HealthPageSettingsView(app:app,page:page) } label: { WeftIcon("settings") }.accessibilityLabel("健康设置") } }
            .task(id:app.phoneAccountIdentity) { await health.enteredHealthPage(app:app) }
    }
    private func metric(_ title: String,_ value: Double?,_ unit: String) -> some View {
        VStack(spacing:0) {
            PhoneFeatureRow(title:title,subtitle:value == nil ? "暂时没有测量，请检查健康读取权限。" : nil,value:PhoneHealthText.number(value)+" "+unit,chevron:false)
            Divider()
        }
    }
}
