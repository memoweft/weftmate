import SwiftUI
import WeftMateCore

struct DevicesView: View {
    @ObservedObject var model: AppleAppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("你的设备").font(.title2.weight(.semibold)).foregroundStyle(Weave.ink)
                    Text("同一个账户的设备会出现在这里。最近联系时间来自服务器记录。")
                        .font(.callout).foregroundStyle(Weave.muted).lineSpacing(4)
                }
                if let error = model.devicesError {
                    InlineNotice(message: error, isError: true)
                }
                if model.refreshing && model.devices.isEmpty {
                    HStack { ProgressView(); Text("正在读取设备…").foregroundStyle(Weave.muted) }
                        .frame(maxWidth: .infinity).padding(24)
                } else if model.devices.isEmpty && model.devicesError == nil {
                    EmptyState(symbol: "laptopcomputer.and.iphone", title: "没有设备记录",
                               message: "刷新以取得服务器登记的设备。")
                } else {
                    WeaveCard {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(model.devices.enumerated()), id: \.element.id) { index, device in
                                if index > 0 { Divider().padding(.vertical, 18) }
                                DeviceRow(device: device)
                            }
                        }
                    }
                }
                Text("本版本提供设备查看。设备重命名和撤权管理将在后续接通。")
                    .font(.caption).foregroundStyle(Weave.muted)
            }
            .padding(24).frame(maxWidth: 760).frame(maxWidth: .infinity)
        }
        .background(Weave.canvas)
        .navigationTitle("设备")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await model.refresh() } } label: {
                    Label("刷新设备", systemImage: "arrow.clockwise")
                }.disabled(model.refreshing)
            }
        }
        .accessibilityIdentifier("devicesList")
    }
}

private struct DeviceRow: View {
    let device: DeviceRecord
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol).font(.title3).foregroundStyle(Weave.accent)
                .frame(width: 40, height: 40).background(Weave.accentSoft, in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 8) {
                    Text(device.name).font(.body.weight(.semibold)).foregroundStyle(Weave.ink)
                    if device.current {
                        Text("本机").font(.caption.weight(.medium)).foregroundStyle(Weave.accent)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(Weave.accentSoft, in: Capsule())
                    }
                }
                if device.revoked {
                    Text("已撤权").font(.callout).foregroundStyle(Weave.danger)
                } else {
                    Text(device.lastSeenAt.flatMap(relativeDate) ?? "最近联系时间未知")
                        .font(.caption).foregroundStyle(Weave.muted)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        let name = device.name.lowercased()
        if name.contains("watch") || name.contains("手表") { return "applewatch" }
        if name.contains("phone") || name.contains("手机") || name.contains("android") { return "iphone" }
        if name.contains("mac") { return "laptopcomputer" }
        return "desktopcomputer"
    }

    private func relativeDate(_ source: String) -> String? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: source) ?? ISO8601DateFormatter().date(from: source) else { return nil }
        let relative = RelativeDateTimeFormatter()
        relative.locale = Locale(identifier: "zh_CN")
        return "最近联系：\(relative.localizedString(for: date, relativeTo: Date()))"
    }
}
