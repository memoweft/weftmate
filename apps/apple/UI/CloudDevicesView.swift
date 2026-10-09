import SwiftUI
import WeftMateCore

struct CloudDevicesView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var cloud: CloudLoginModel
    @State private var direct = false
    @State private var pairingDisplay: String?
    @State private var renameTarget: CloudDirectoryDevice?
    @State private var removeTarget: CloudDirectoryDevice?
    @State private var newName = ""
    var body: some View {
        List {
            Section("这台账户的设备") {
                ForEach(cloud.devices) { row($0) }
            }
            Section("电脑") {
                ForEach(cloud.hosts) { host in
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                        row(host)
                        Button("连接") { Task { await cloud.connectHost(id: host.hostId ?? host.id) } }
                            .disabled(cloud.busy).accessibilityIdentifier("connectHost." + host.id)
                    }
                }
                if cloud.hosts.isEmpty { Text("还没有电脑。请先在电脑程序登录同一账号。") }
            }
            if !cloud.pending.isEmpty {
                Section("待批准") { ForEach(cloud.pending) { device in PendingDeviceRow(cloud: cloud, device: device) } }
            }
            if app.session != nil {
                Section {
                    Button("添加设备") {
                        Task { await cloud.generatePairing(); pairingDisplay = cloud.pairingCode }
                    }
                }
            }
            Section("连接方式") {
                Button("扫码或输入配对码") { cloud.showLogin = true }
                DisclosureGroup("直连电脑", isExpanded: $direct) {
                    TextField("电脑地址", text: $app.serverInput).serverInput()
                    Text("使用已配对电脑的直接地址，仍会验证电脑证书与安全密钥。")
                        .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    Button("连接电脑") { Task { await cloud.connectDirect(address: app.serverInput) } }
                        .disabled(cloud.busy || app.serverInput.isEmpty)
                }
            }
            if let error = cloud.error { Section { InlineNotice(message: error, isError: true) } }
        }.navigationTitle("设备").font(AppleTokens.Fonts.body)
            .accessibilityIdentifier("cloudDevices")
            .toolbar { ToolbarItem(placement: .primaryAction) { Button("刷新设备") { Task { await cloud.refreshDirectory() } } } }
            .task {
                while !Task.isCancelled {
                    await cloud.poll()
                    do { try await Task.sleep(for: .seconds(cloud.waiting ? 3 : 30)) } catch { return }
                }
            }
            .alert("设备名称", isPresented: Binding(get: { renameTarget != nil }, set: { if !$0 { renameTarget = nil } })) {
                TextField("名称", text: $newName)
                Button("保存") { if let device = renameTarget { Task { await cloud.renameDevice(device, name: newName) } }; renameTarget = nil }
                Button("取消", role: .cancel) { renameTarget = nil }
            }
            .confirmationDialog("移除设备？该设备将立即退出，需要重新登录。", isPresented: Binding(get: { removeTarget != nil }, set: { if !$0 { removeTarget = nil } }), titleVisibility: .visible) {
                Button("移除设备", role: .destructive) { if let device = removeTarget { Task { await cloud.removeDevice(device) } }; removeTarget = nil }
                Button("取消", role: .cancel) { removeTarget = nil }
            }
            .sheet(item: Binding(get: { pairingDisplay.map(PairingDisplay.init) }, set: { pairingDisplay = $0?.value })) { display in
                PairingDisplayView(cloud: cloud, initialValue: display.value)
            }
    }
    private func row(_ device: CloudDirectoryDevice) -> some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            HStack(spacing: AppleTokens.Space.p12) {
                WeftIcon(device.icon).foregroundStyle(Weave.accent)
                Text(device.name).font(AppleTokens.Fonts.headline)
                if device.isCurrent { Text("这台设备").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            }
            Text(device.online ? "在线" : "离线").foregroundStyle(Weave.secondary)
            if device.type == "computer" { Text("可执行任务").font(AppleTokens.Fonts.caption) }
            if let last = device.lastUsedAt { Text("最近使用：\(last)").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            if device.hostId == nil {
                HStack {
                    Button("改名") { newName = device.name; renameTarget = device }
                        .accessibilityIdentifier("renameDevice." + device.id)
                    Button("移除", role: .destructive) { removeTarget = device }
                        .accessibilityIdentifier("removeDevice." + device.id)
                }.font(AppleTokens.Fonts.caption).buttonStyle(OutlineActionStyle()).disabled(cloud.busy)
            }
        }.padding(.vertical, AppleTokens.Space.p6)
    }
}

struct PendingDeviceRow: View {
    @ObservedObject var cloud: CloudLoginModel
    let device: PendingCloudDevice
    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p10) {
            Text("新设备 \(device.name) 请求访问").font(AppleTokens.Fonts.headline)
            HStack {
                Button("允许") { Task { await cloud.decide(device, allow: true) } }
                    .buttonStyle(PrimaryActionStyle(fillsWidth: false)).accessibilityIdentifier("cloudAllow." + device.id)
                Button("拒绝", role: .destructive) { Task { await cloud.decide(device, allow: false) } }.buttonStyle(OutlineActionStyle())
            }
        }.padding(AppleTokens.Space.p12).background(Weave.surface)
    }
}
private struct PairingDisplay: Identifiable { let value: String; var id: String { value } }
struct PairingDisplayView: View {
    @ObservedObject var cloud: CloudLoginModel
    let initialValue: String
    private var value: String { cloud.pairingCode ?? initialValue }
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            VStack(spacing: AppleTokens.Space.p20) {
                Text("在新设备的「设置 → 设备」扫描此码")
                #if canImport(CoreImage)
                if let bytes = PairingQRCode.image(value) { Image(decorative: bytes, scale: 1).interpolation(.none).resizable().scaledToFit().frame(width: 240, height: 240) }
                #endif
                Text(value).font(AppleTokens.Fonts.caption).textSelection(.enabled).lineLimit(4)
                Text("配对码每 2 分钟自动刷新。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }.padding(AppleTokens.Space.p24).navigationTitle("添加设备")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }.task {
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(120)) } catch { return }
                if value.hasPrefix("wm1.") { await cloud.generatePairing() }
                else { dismiss(); return }
            }
        }
    }
}
#if canImport(CoreImage)
import CoreImage
import CoreImage.CIFilterBuiltins
private enum PairingQRCode {
    static func image(_ value: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator(); filter.message = Data(value.utf8)
        guard let image = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else { return nil }
        return CIContext().createCGImage(image, from: image.extent)
    }
}
#endif
