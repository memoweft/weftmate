import SwiftUI
import WeftMateCore

struct CloudAccessView: View {
    @ObservedObject var model: CloudLoginModel
    var body: some View {
        NavigationStack {
            Form {
                if model.waiting {
                    Section {
                        WeftLabel("等待设备批准", icon: "clock").font(.headline)
                            .accessibilityIdentifier("cloudWaiting")
                        Text("请在已登录的设备上点允许，或扫电脑上的二维码")
                        Button("已允许，重试连接") { model.retry() }.disabled(model.busy)
                            .accessibilityIdentifier("cloudRetry")
                        #if os(iOS)
                        Button("扫描电脑配对二维码") { model.showScanner = true }.disabled(model.busy)
                        #else
                        Text("请在另一台设备上批准。也可从电脑粘贴配对信息固定安全密钥。")
                        #endif
                    }
                } else {
                    Section {
                        Text("用 WeftMate 账号登录").font(.headline)
                        Text("注册、邮箱验证和找回密码在云端认证页面完成。访问电脑上的对话还需要设备批准。")
                        Button(model.busy ? "正在登录…" : "打开系统登录浏览器") { model.begin() }
                            .disabled(model.busy).accessibilityIdentifier("cloudBrowserLogin")
                    }
                }
                Section("连接你的电脑") {
                    Text("首次连接请从电脑取得配对信息。电脑的安全密钥会保存在这台设备上。")
                    #if os(iOS)
                    Button("扫描电脑配对二维码") { model.showScanner = true }.disabled(model.busy)
                        .accessibilityIdentifier("cloudScan")
                    #endif
                    if model.hasPairing {
                        WeftLabel("已取得电脑配对信息", icon: "approval")
                            .accessibilityIdentifier("cloudPairingReady")
                        Button("更换配对信息") { model.editPairing() }.disabled(model.busy)
                    } else {
                        TextField("粘贴电脑配对信息", text: $model.pairingText, axis: .vertical)
                            .lineLimit(2...4).disabled(model.busy).accessibilityIdentifier("cloudPairingText")
                    }
                    if model.waiting {
                        Button("使用此配对信息授权") {
                            do { try model.receivePairing(Data(model.pairingText.utf8)); model.retry(redeem: true) }
                            catch { model.scan(Data(model.pairingText.utf8)) }
                        }.disabled(model.busy).accessibilityIdentifier("cloudRedeem")
                    }
                }
                Section("云服务") {
                    TextField("https://api.weftmate.com", text: $model.cloudAddress)
                        .serverInput().disabled(model.busy || model.cloudSignedIn).accessibilityIdentifier("cloudAddress")
                }
                if let error = model.error {
                    Section { Text(error).foregroundStyle(.red).accessibilityIdentifier("cloudError") }
                }
                if model.busy { ProgressView("正在连接…") }
            }
            .navigationTitle("WeftMate 账号")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { model.cancel() }.accessibilityIdentifier("cloudCancel") } }
            #if os(iOS)
            #if DEBUG
            .task { await model.loadSyntheticQR() }
            #endif
            .sheet(isPresented: $model.showScanner) { PairingScannerView { model.scan($0) } }
            #endif
        }
        .interactiveDismissDisabled(model.busy || model.waiting)
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 560)
        #endif
    }
}

struct CloudAccessPresenter: View {
    @ObservedObject var cloud: CloudLoginModel
    var body: some View {
        Color.clear.frame(width: 0, height: 0)
            .sheet(isPresented: $cloud.showLogin, onDismiss: { cloud.cancel() }) { CloudAccessView(model: cloud) }
            .sheet(isPresented: $cloud.showPending) {
                NavigationStack {
                    List {
                        Section {
                            Text("有新设备请求访问你的对话").font(.headline)
                            Text("仅在确认是你自己的设备时允许。")
                        }
                        ForEach(cloud.pending) { device in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(device.name).font(.headline)
                                Text("\(device.platformLabel) · \(device.requestedAtLabel)").font(.caption)
                                HStack {
                                    Button("允许") { Task { await cloud.decide(device, allow: true) } }
                                        .buttonStyle(.borderedProminent).accessibilityIdentifier("cloudAllow.\(device.id)")
                                    Button("拒绝", role: .destructive) { Task { await cloud.decide(device, allow: false) } }.buttonStyle(.bordered)
                                }
                            }
                        }
                        if let error = cloud.error { Text(error).foregroundStyle(.red) }
                    }
                    .navigationTitle("新设备授权")
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("稍后") { cloud.showPending = false } } }
                }
                #if os(macOS)
                .frame(minWidth: 480, minHeight: 380)
                #endif
            }
    }
}
