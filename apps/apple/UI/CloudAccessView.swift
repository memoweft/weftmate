import SwiftUI

/// This page is reachable only after account login, from Settings → Devices.
struct CloudAccessView: View {
    @ObservedObject var model: CloudLoginModel
    var body: some View {
        NavigationStack {
            Form {
                if model.waiting {
                    Section {
                        Text("在你已登录的设备上允许这台设备").font(AppleTokens.Fonts.headline).accessibilityIdentifier("cloudWaiting")
                        ForEach(model.devices.filter { !$0.isCurrent }) { device in WeftLabel(device.name, icon: device.icon) }
                        Text("批准后会自动进入。")
                        Button("换账号") { Task { await model.signOutAccount() } }
                    }
                }
                Section("连接你的电脑") {
                    Text("在电脑上打开「设置 → 设备 → 添加设备」，取得二维码或配对码。")
                    #if os(iOS)
                    Button("扫描电脑配对二维码") { model.showScanner = true }.disabled(model.busy).accessibilityIdentifier("cloudScan")
                    #endif
                    if model.hasPairing {
                        WeftLabel("已取得电脑配对信息", icon: "approval").accessibilityIdentifier("cloudPairingReady")
                        Button("更换配对码") { model.editPairing() }
                    } else {
                        TextField("输入配对码", text: $model.pairingText, axis: .vertical).lineLimit(2...4)
                            .accessibilityIdentifier("cloudPairingText")
                    }
                    Button("请求设备批准") { model.scan(Data(model.pairingText.utf8)) }.disabled(model.busy || model.pairingText.isEmpty)
                        .accessibilityIdentifier("cloudRequestApproval")
                    if model.hasPairing {
                        Button("使用配对码授权") { model.retry(redeem: true) }.disabled(model.busy).accessibilityIdentifier("cloudRedeem")
                    }
                }
                if let error = model.error { Section { InlineNotice(message: error, isError: true).accessibilityIdentifier("cloudError") } }
                if model.busy { ProgressView("正在连接…") }
            }.navigationTitle("连接设备")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { model.cancel() }.accessibilityIdentifier("cloudCancel") } }
                .task {
                    #if DEBUG && os(iOS)
                    await model.loadSyntheticQR()
                    #endif
                    while !Task.isCancelled {
                        await model.poll()
                        do { try await Task.sleep(for: .seconds(3)) } catch { return }
                    }
                }
                #if os(iOS)
                .sheet(isPresented: $model.showScanner) { PairingScannerView { model.scan($0) } }
                #endif
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 560)
        #endif
    }
}

struct CloudAccessPresenter: View {
    @ObservedObject var cloud: CloudLoginModel
    var body: some View {
        VStack {
            if let device = cloud.pending.first { PendingDeviceRow(cloud: cloud, device: device) }
            Spacer()
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .allowsHitTesting(!cloud.pending.isEmpty)
            .sheet(isPresented: $cloud.showLogin) { CloudAccessView(model: cloud) }
            .sheet(isPresented: $cloud.showTrustDelivery) { PairingDisplayView(cloud: cloud, initialValue: cloud.pairingCode ?? "") }
    }
}
