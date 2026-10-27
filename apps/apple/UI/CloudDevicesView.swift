import SwiftUI
import WeftMateCore

struct CloudDevicesView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var cloud: CloudLoginModel
    @State private var renameTarget: CloudDirectoryDevice?
    @State private var removeTarget: CloudDirectoryDevice?
    @State private var newName = ""
    @State private var computerRename: CloudDirectoryDevice?
    @State private var computerRemove: CloudDirectoryDevice?
    @ViewBuilder var body: some View {
        #if os(iOS)
        PhoneDevicesPage(app: app, cloud: cloud)
        #else
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                if let notice = cloud.newDeviceNotice {
                    WeaveCard {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                            Text("有一台新设备登录").font(AppleTokens.Fonts.headline)
                            Text(notice)
                            Button("查看设备") { cloud.dismissNewDeviceNotice() }
                                .buttonStyle(AccountActionStyle()).accessibilityIdentifier("newDeviceOpen")
                        }
                    }.accessibilityElement(children: .contain).accessibilityIdentifier("newDeviceNotice")
                }
                Text("已登录的设备").font(AppleTokens.Fonts.title2.weight(.semibold))
                Text("不认识的设备可以下线，下次使用时需要重新登录。")
                    .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                ForEach(cloud.devices) { device in WeaveCard { row(device) } }
                Text("电脑").font(AppleTokens.Fonts.headline)
                ForEach(cloud.hosts) { host in
                    WeaveCard {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                            row(host)
                            if cloud.multipleComputers {
                                Button("电脑改名") { newName=host.name;computerRename=host }.buttonStyle(ServiceActionStyle()).accessibilityIdentifier("computer.rename."+host.id)
                                Button("移除电脑") { computerRemove=host }.buttonStyle(ServiceActionStyle()).accessibilityIdentifier("computer.remove."+host.id)
                            }
                            Button("重新连接") { Task { await cloud.connectHost(id: host.hostId ?? host.id) } }
                                .buttonStyle(AccountActionStyle()).disabled(cloud.busy)
                                .accessibilityIdentifier("connectHost." + host.id)
                        }
                    }
                }
                if cloud.hosts.isEmpty { Text("在电脑上安装 WeftMate 并用同一个账号登录，就会出现在这里。") }
                if let error = cloud.error { InlineNotice(message: error, isError: true) }
            }.padding(AppleTokens.Space.p20).frame(maxWidth: 620).frame(maxWidth: .infinity)
        }.background(Weave.canvas).navigationTitle("设备").font(AppleTokens.Fonts.body)
            .accessibilityElement(children: .contain).accessibilityIdentifier("cloudDevices")
            .toolbar { ToolbarItem(placement: .primaryAction) { Button("刷新设备") { Task { await cloud.refreshDirectory() } } } }
            .task {
                while !Task.isCancelled {
                    await cloud.poll()
                    do { try await Task.sleep(for: .seconds(3)) } catch { return }
                }
            }
            .sheet(item:$computerRename) { host in
                NavigationStack { VStack(spacing:AppleTokens.Space.p16) { TextField("电脑名称",text:$newName).weaveField();Button("保存") { Task { await cloud.renameComputer(host,name:newName);computerRename=nil } }.buttonStyle(ServiceActionStyle(primary:true)) }.padding(AppleTokens.Space.p20).navigationTitle("电脑名称") }
            }
            .confirmationDialog("移除这台电脑？不会删除这台电脑上的对话、文件和其他内容；未开始的事项会取消，已经开始的操作在那台电脑上收尾。",isPresented:Binding(get:{computerRemove != nil},set:{if !$0 {computerRemove=nil}}),titleVisibility:.visible) { Button("移除电脑",role:.destructive) { if let host=computerRemove { Task { await cloud.removeComputer(host) } };computerRemove=nil };Button("取消",role:.cancel) {} }
            .alert("设备名称", isPresented: Binding(get: { renameTarget != nil }, set: { if !$0 { renameTarget = nil } })) {
                TextField("名称", text: $newName)
                Button("保存") { if let device = renameTarget { Task { await cloud.renameDevice(device, name: newName) } }; renameTarget = nil }
                Button("取消", role: .cancel) { renameTarget = nil }
            }
            .confirmationDialog("将设备下线？该设备将立即退出，需要重新登录。", isPresented: Binding(get: { removeTarget != nil }, set: { if !$0 { removeTarget = nil } }), titleVisibility: .visible) {
                Button("将设备下线", role: .destructive) { if let device = removeTarget { Task { await cloud.removeDevice(device) } }; removeTarget = nil }
                Button("取消", role: .cancel) { removeTarget = nil }
            }
        #endif
    }
    private static func date(_ value: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: value) ?? ISO8601DateFormatter().date(from: value)
        return date?.formatted(date: .abbreviated, time: .shortened) ?? "暂无记录"
    }
    private func row(_ device: CloudDirectoryDevice) -> some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
            HStack(spacing: AppleTokens.Space.p12) {
                WeftIcon(device.icon).foregroundStyle(Weave.accent)
                Text(device.computerName).font(AppleTokens.Fonts.headline)
                if device.isCurrent { Text("这台设备").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            }
            Text(device.online ? "在线" : "离线").foregroundStyle(Weave.secondary)
            if device.type == "computer" { Text("可执行任务").font(AppleTokens.Fonts.caption) }
            if let first = device.firstUsedAt { Text("首次登录：\(Self.date(first))").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            if let last = device.lastUsedAt { Text("最近使用：\(Self.date(last))").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            if device.type != "computer" {
                HStack {
                    Button("改名") { newName = device.name; renameTarget = device }
                        .accessibilityIdentifier("renameDevice." + device.id)
                    Button("下线", role: .destructive) { removeTarget = device }
                        .accessibilityIdentifier("removeDevice." + device.id)
                }.font(AppleTokens.Fonts.caption).buttonStyle(AccountActionStyle()).disabled(cloud.busy)
            }
        }.padding(.vertical, AppleTokens.Space.p6)
    }
}
