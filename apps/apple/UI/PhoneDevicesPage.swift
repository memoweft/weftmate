#if os(iOS)
import SwiftUI
import WeftMateCore

struct PhoneDevicesPage: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var cloud: CloudLoginModel
    @State private var renaming: CloudDirectoryDevice?
    @State private var removing: CloudDirectoryDevice?
    @State private var name = ""
    var body: some View {
        Form {
            Section {
                ForEach(cloud.hosts) { host in computer(host) }
                if cloud.hosts.isEmpty { Text("还没有电脑。可扫描电脑上的配对码，或在电脑上用同一账号登录。").foregroundStyle(Weave.muted) }
            } header: { Text("电脑") } footer: { Text("聊天在手机，电脑负责把事情做下去。切换电脑时保留对话归属。") }
            Section {
                NavigationLink { PhonePairingPage(app: app, cloud: cloud) } label: { WeftLabel("添加电脑", icon: "plus") }.accessibilityIdentifier("devices.addComputer")
            }
            Section("已登录的设备") {
                ForEach(cloud.devices) { device in
                    HStack {
                        PhoneSettingsLabel(title: device.name, subtitle: device.isCurrent ? "当前设备" : device.lastUsedAt.map { "最近使用：" + DeviceDateText.timestamp($0) } ?? "最近使用时间未知", icon: device.icon, disclosure: false)
                        PhoneActionMenu {
                            Button("改名") { name = device.name; renaming = device }.accessibilityIdentifier("renameDevice." + device.id)
                            Button("下线", role: .destructive) { removing = device }.accessibilityIdentifier("removeDevice." + device.id)
                        } label: { WeftIcon("more").phoneMenuLabel(circle: true, quiet: true) }
                            .disabled(cloud.busy).accessibilityLabel("设备操作").accessibilityIdentifier("device.actions." + device.id)
                            .phonePopover(isPresented: removingBinding(device)) { removalConfirmation(device) }
                    }
                }
            }
            if let error = cloud.error { Section { InlineNotice(message: error, isError: true); Button("重试") { Task { await cloud.refreshDirectory() } } } }
            if let notice = cloud.notice { InlineNotice(message: notice) }
        }.scrollContentBackground(.hidden).background(Weave.grouped).navigationTitle("设备").accessibilityIdentifier("cloudDevices")
            .toolbar { ToolbarItem(placement: .primaryAction) { Button { Task { await cloud.refreshDirectory() } } label: { WeftIcon("sync") }.phoneIcon(quiet: true).accessibilityLabel("刷新设备").accessibilityIdentifier("devices.refresh") } }
            .task { while !Task.isCancelled { await cloud.poll(); do { try await Task.sleep(for: .seconds(3)) } catch { return } } }
            .sheet(item: $renaming) { device in
                VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                    TextField(device.type == "computer" ? "电脑名称" : "设备名称", text: $name).weaveField().accessibilityIdentifier("devices.renameField")
                    Button("保存") {
                        Task {
                            if device.type == "computer" { await cloud.renameComputer(device, name: name) } else { await cloud.renameDevice(device, name: name) }
                            if cloud.error == nil { renaming = nil }
                        }
                    }.buttonStyle(PrimaryActionStyle()).disabled(cloud.busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("devices.saveName")
                    if let error = cloud.error { InlineNotice(message: error, isError: true) }
                    Spacer()
                }.padding(AppleTokens.Space.p20).phoneSheet("修改名称", close: { renaming = nil })
            }
    }
    private func removingBinding(_ device: CloudDirectoryDevice) -> Binding<Bool> {
        Binding(get: { removing?.id == device.id }, set: { if !$0 { removing = nil } })
    }
    private func removalConfirmation(_ device: CloudDirectoryDevice) -> some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
            Text(device.type == "computer" ? "移除这台电脑？电脑上的对话和文件保留；未开始的事项会取消，已经开始的操作在原电脑上收尾。" : "将设备下线？该设备会退出登录，下次使用需重新登录。")
            Button("确认移除", role: .destructive) {
                Task { if device.type == "computer" { await cloud.removeComputer(device) } else { await cloud.removeDevice(device) } }
                removing = nil
            }.disabled(cloud.busy).accessibilityIdentifier("devices.confirmRemove")
            Button("取消") { removing = nil }
        }.padding(AppleTokens.Space.p20).frame(idealWidth: AppleTokens.Phone.menuWidth)
    }
    private func computer(_ host: CloudDirectoryDevice) -> some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            HStack {
                PhoneSettingsLabel(title: host.computerName, subtitle: app.session?.hostId == (host.hostId ?? host.id) ? app.phoneConnectionStatus : host.online ? "在线，可连接" : "离线，打开电脑后重试", icon: "desktop", disclosure: false)
                PhoneActionMenu {
                    Button("切换到这台电脑") { Task { await cloud.connectHost(id: host.hostId ?? host.id) } }.accessibilityIdentifier("computer.switch." + host.id)
                    if cloud.multiHost {
                        Button("电脑改名") { name = host.computerName; renaming = host }.accessibilityIdentifier("computer.rename." + host.id)
                        Button("移除电脑", role: .destructive) { removing = host }.accessibilityIdentifier("computer.remove." + host.id)
                    }
                } label: { WeftIcon("more").phoneMenuLabel(circle: true, quiet: true) }
                    .disabled(cloud.busy).accessibilityLabel("电脑操作").accessibilityIdentifier("computer.actions." + host.id)
                    .phonePopover(isPresented: removingBinding(host)) { removalConfirmation(host) }
            }
            Button(app.session?.hostId == (host.hostId ?? host.id) ? "重新连接" : "连接这台电脑") { Task { await cloud.connectHost(id: host.hostId ?? host.id) } }
                .buttonStyle(PrimaryActionStyle()).disabled(cloud.busy).accessibilityIdentifier("connectHost." + host.id)
        }.padding(.vertical, AppleTokens.Space.p8)
    }
}

struct PhonePairingPage: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var cloud: CloudLoginModel
    @Environment(\.dismiss) private var dismiss
    @State private var scanner = false
    @State private var manual = false
    @State private var address = ""
    @State private var code = ""
    @State private var pending: HostPairing?
    @State private var subject: String?
    @State private var error: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p24) {
                Text("添加你的电脑").font(AppleTokens.Fonts.largeTitle.weight(.semibold))
                Text("打开电脑上的 WeftMate，扫描刚生成的配对码。").foregroundStyle(Weave.muted)
                VStack(spacing: AppleTokens.Space.p20) {
                    WeftIcon("camera", size: AppleTokens.Space.p44).padding(AppleTokens.Space.p24)
                    Button("扫描二维码") { scanner = true }.buttonStyle(PrimaryActionStyle()).disabled(!cloud.authenticated).accessibilityIdentifier("pairing.scan")
                }.frame(maxWidth: .infinity).padding(AppleTokens.Space.p24).background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Phone.groupRadius))
                Button("手动输入地址与配对码") { manual = true }.buttonStyle(OutlineActionStyle()).disabled(!cloud.authenticated).accessibilityIdentifier("pairing.manual")
                Button("稍后添加，先聊天") { dismiss() }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("pairing.later")
                if !cloud.authenticated { Text("添加电脑前，请先登录账号。").foregroundStyle(Weave.muted); Button("登录") { cloud.requireLogin() } }
                if let error {
                    InlineNotice(message: error, isError: true)
                    Button("重新扫码") { self.error = nil; scanner = true }
                        .buttonStyle(OutlineActionStyle()).accessibilityIdentifier("pairing.scanAgain")
                }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("添加电脑").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $scanner) { PairingScannerView(receive: { receive($0) }) }
            .sheet(isPresented: $manual) {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                    TextField("电脑地址（可选）", text: $address).accountInput().keyboardType(.URL).weaveField().accessibilityIdentifier("pairing.address")
                    TextField("完整配对码或链接", text: $code, axis: .vertical).accountInput().weaveField().accessibilityIdentifier("cloudPairingText")
                    Button("核对电脑") { receive(Data(code.utf8)) }.buttonStyle(PrimaryActionStyle()).disabled(code.isEmpty).accessibilityIdentifier("pairing.preview")
                    if let error { InlineNotice(message: error, isError: true) }
                    Spacer()
                }.padding(AppleTokens.Space.p20).phoneSheet("手动配对", close: { manual = false })
            }
            .navigationDestination(isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } })) {
                if let pending {
                    PhonePairConfirmation(cloud: cloud, pairing: pending, subject: subject,
                        cancel: { self.pending = nil }, rescan: { self.pending = nil; scanner = true },
                        finish: { self.pending = nil; dismiss() })
                }
            }
    }
    private func receive(_ bytes: Data) {
        do {
            let pair = try cloud.previewPairing(bytes)
            if !address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let server = try ServerConfiguration(input: address, allowLoopbackHTTP: true)
                guard server.originString == pair.origin || server.originString == pair.relay?.baseUrl else { throw CloudLoginFailure.pairing }
            }
            error = nil; scanner = false; manual = false; subject = cloud.subject; pending = pair
        } catch { scanner = false; self.error = (error as? PairingFailure)?.localizedDescription ?? "配对码无效或不属于这个账号的电脑。请在电脑上重新生成后重试。" }
    }
}

private struct PhonePairConfirmation: View {
    @ObservedObject var cloud: CloudLoginModel
    let pairing: HostPairing
    let subject: String?
    let cancel: () -> Void
    let rescan: () -> Void
    let finish: () -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p24) {
                Text("确认是你的电脑").font(AppleTokens.Fonts.largeTitle.weight(.semibold))
                Text("请在电脑上核对这六位数字并确认").foregroundStyle(Weave.muted)
                PhoneSettingsLabel(title: cloud.hosts.first { ($0.hostId ?? $0.id) == pairing.hostId }?.computerName ?? "你的电脑", subtitle: pairing.origin, icon: "desktop", disclosure: false).phoneCard()
                if let code = cloud.pairingCode {
                    Text(String(code.prefix(3)) + " " + String(code.suffix(3)))
                        .font(AppleTokens.Fonts.largeTitle.weight(.semibold)).monospacedDigit()
                        .tracking(AppleTokens.Space.p4).lineLimit(1).minimumScaleFactor(0.6)
                        .frame(maxWidth: .infinity).padding(.vertical, AppleTokens.Space.p24)
                        .accessibilityLabel("六位核对数字").accessibilityValue(code.map(String.init).joined(separator: " "))
                        .accessibilityIdentifier("pairing.confirmCode")
                }
                Text("两边数字一致，再在电脑上确认。不一致或不认识这台电脑，请取消。").foregroundStyle(Weave.muted)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let expired = context.date.timeIntervalSince1970 * 1000 >= Double(pairing.expiresAt)
                    if expired {
                        if cloud.error == nil { InlineNotice(message: "配对码已过期，请在电脑上重新生成，然后重新扫码。", isError: true) }
                    }
                    else if cloud.busy && cloud.error == nil {
                        HStack { ProgressView(); Text(cloud.pairingCode == nil ? "正在核对电脑…" : "等待电脑确认…") }
                            .accessibilityIdentifier("pairing.waiting")
                    }
                }
                Button("重新扫码", action: rescan).buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("pairing.rescan")
                Button("不是这台电脑", action: cancel).buttonStyle(OutlineActionStyle()).accessibilityIdentifier("pairing.cancel")
                if let error = cloud.error { InlineNotice(message: error, isError: true) }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("确认配对").navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("pairing.confirmPage")
            .task { if await cloud.completePairing(pairing, subject: subject) && !Task.isCancelled { finish() } }
            .onDisappear { cloud.cancelPairing() }
    }
}
#endif
