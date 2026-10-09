import SwiftUI
import WeftMateCore

struct DevicesView: View {
    @ObservedObject var model: AppleAppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p20) {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                    Text("你的设备").font(AppleTokens.Fonts.title2.weight(.semibold)).foregroundStyle(Weave.ink)
                    Text("同一个账户的设备会出现在这里。最近联系时间来自服务器记录。")
                        .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted).lineSpacing(AppleTokens.Space.p4)
                }
                if let error = model.devicesError {
                    InlineNotice(message: error, isError: true)
                }
                if model.refreshing && model.devices.isEmpty {
                    HStack { ProgressView(); Text("正在读取设备…").foregroundStyle(Weave.muted) }
                        .frame(maxWidth: .infinity).padding(AppleTokens.Space.p24)
                } else if model.devices.isEmpty && model.devicesError == nil {
                    EmptyState(symbol: "desktop", title: "没有设备记录",
                               message: "刷新以取得服务器登记的设备。")
                } else {
                    WeaveCard {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p0) {
                            ForEach(Array(model.devices.enumerated()), id: \.element.id) { index, device in
                                if index > 0 { Divider().padding(.vertical, AppleTokens.Space.p18) }
                                DeviceRow(device: device)
                            }
                        }
                    }
                }
            }
            .padding(AppleTokens.Space.p24).frame(maxWidth: 760).frame(maxWidth: .infinity)
        }
        .background(Weave.canvas)
        .navigationTitle("设备")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await model.refresh() } } label: {
                    WeftLabel("刷新设备", icon: "sync")
                }.disabled(model.refreshing)
            }
        }
        .accessibilityIdentifier("devicesList")
    }
}

private struct DeviceRow: View {
    let device: DeviceRecord
    var body: some View {
        HStack(alignment: .top, spacing: AppleTokens.Space.p14) {
            WeftIcon(symbol, size: 24).foregroundStyle(Weave.accent)
                .frame(width: 40, height: 40).background(Weave.accentSoft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r12))
            VStack(alignment: .leading, spacing: AppleTokens.Space.p7) {
                HStack(spacing: AppleTokens.Space.p8) {
                    Text(device.name).font(AppleTokens.Fonts.body.weight(.semibold)).foregroundStyle(Weave.ink)
                    if device.current {
                        Text("本机").font(AppleTokens.Fonts.caption.weight(.medium)).foregroundStyle(Weave.accent)
                            .padding(.horizontal, AppleTokens.Space.p7).padding(.vertical, AppleTokens.Space.p3)
                            .background(Weave.accentSoft, in: Capsule())
                    }
                }
                if device.revoked {
                    Text("已撤权").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.danger)
                } else {
                    Text(device.lastSeenAt.flatMap(relativeDate) ?? "最近联系时间未知")
                        .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                }
            }
            Spacer(minLength: AppleTokens.Space.p0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(device.current ? "currentDevice.\(device.id)" : "deviceRow.\(device.id)")
    }

    private var symbol: String {
        let name = device.name.lowercased()
        if name.contains("watch") || name.contains("手表") { return "watch" }
        if name.contains("phone") || name.contains("手机") || name.contains("android") { return "phone" }
        if name.contains("mac") { return "desktop" }
        return "desktop"
    }

    private func relativeDate(_ source: String) -> String? {
        "最近联系：" + DeviceDateText.timestamp(source)
    }
}
