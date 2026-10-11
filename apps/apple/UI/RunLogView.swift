import SwiftUI
import WeftMateCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct RunLogView: View {
    private let onClose: (@MainActor () -> Void)?
    init(onClose: (@MainActor () -> Void)? = nil) { self.onClose = onClose }
    @ObservedObject private var runtime = RunLogRuntime.shared
    @State private var summary = ""
    @State private var peer = false
    @State private var expanded = false
    @State private var exportURL: URL?
    @State private var preparedURL: URL?
    @State private var logPreview = ""
    @State private var notice: String?
    @Environment(\.dismiss) private var dismiss
    private var snapshot: RunLogSnapshot? { peer ? runtime.watchSnapshot : runtime.snapshot }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                    #if os(iOS)
                    Picker("记录来自", selection: $peer) { Text("iPhone").tag(false); Text("手表").tag(true) }
                        .pickerStyle(.segmented).accessibilityIdentifier("runLogSource")
                    #endif
                    if let value = snapshot {
                        if !value.readable {
                            InlineNotice(message: "运行记录暂时无法读取。请检查设备存储后重试。", isError: true).accessibilityIdentifier("runLogReadFailure")
                        } else {
                            WeaveCard {
                                VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                                    if !peer {
                                        row("本次启动", time(value.current?.startedAt))
                                        row(value.previous?.clean == false ? "上次最后记录" : "上次结束", time(value.previous?.lastAt))
                                        row("结束状态", previousText(value.previous))
                                    }
                                    row(peer ? "最近 7 天收到的异常" : "最近 7 天异常", "\(value.summary.abnormalCountsLast7Days.values.reduce(0, +)) 次")
                                    Text(peer ? "通过配对手机接收，仅保存在这两台设备。" : "只在本机保存，复制或分享由你选择。")
                                        .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                                }
                            }
                            if value.summary.recentAbnormalRecords.isEmpty {
                                InlineNotice(message: peer ? "还没有收到手表异常记录。手表连接手机后会自动补送。" : "最近没有异常记录。程序没有正常结束时，会在这里留下线索。")
                                    .accessibilityIdentifier("runLogEmpty")
                            } else {
                                VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                                    Text("最近的异常").font(AppleTokens.Fonts.headline)
                                    ForEach(Array(value.summary.recentAbnormalRecords.suffix(5).reversed().enumerated()), id: \.offset) { _, record in
                                        HStack(alignment: .top, spacing: AppleTokens.Space.p12) {
                                            WeftIcon("warn").foregroundStyle(Weave.danger)
                                            VStack(alignment: .leading, spacing: AppleTokens.Space.p4) {
                                                Text(eventText(record)).font(AppleTokens.Fonts.body)
                                                Text(time(record.at)).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                                            }
                                        }
                                    }
                                }.accessibilityIdentifier("runLogRecords")
                            }
                        }
                        Text("保留 \(value.summary.retentionPolicy.retentionDays) 天 · 最多 \(value.summary.retentionPolicy.maxBytes / 1024) KB")
                            .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    } else { ProgressView("正在读取运行记录…") }
                    Button { expanded.toggle() } label: { WeftLabel(expanded ? "收起诊断摘要" : "预览诊断摘要", icon: "info") }
                        .buttonStyle(OutlineActionStyle()).accessibilityIdentifier("previewRunSummary")
                    if expanded {
                        Text(summary).font(AppleTokens.Fonts.caption.monospaced()).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(AppleTokens.Space.p12)
                            .background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r10))
                            .accessibilityIdentifier("runSummaryPreview")
                        Button {
                            #if os(macOS)
                            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(summary, forType: .string)
                            #else
                            UIPasteboard.general.string = summary
                            #endif
                            notice = "诊断摘要已复制。"
                        } label: { WeftLabel("复制诊断摘要", icon: "copy") }
                            .buttonStyle(PrimaryActionStyle()).disabled(snapshot?.readable != true).accessibilityIdentifier("copyRunSummary")
                    }
                    if !peer {
                        Button {
                            Task {
                                guard let url = await runtime.store.export() else { notice = "日志文件暂时无法读取。"; return }
                                let bytes = await Task.detached { try? Data(contentsOf: url) }.value
                                guard let bytes, let text = String(data: bytes, encoding: .utf8) else { notice = "日志文件暂时无法读取。"; return }
                                preparedURL = url; logPreview = text
                            }
                        } label: { WeftLabel("分享日志文件", icon: "share") }
                            .buttonStyle(OutlineActionStyle()).disabled(snapshot?.readable != true).accessibilityIdentifier("shareRunLog")
                    }
                    if let preparedURL {
                        Text("将要分享的日志文件").font(AppleTokens.Fonts.headline)
                        ScrollView { Text(logPreview).accessibilityIdentifier("runLogFilePreviewText").font(AppleTokens.Fonts.caption.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                            .frame(height: AppleTokens.Space.p20 * 10).padding(AppleTokens.Space.p12).background(Weave.soft, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r10)).accessibilityIdentifier("runLogFilePreview")
                        Button {
                            #if os(macOS)
                            NSWorkspace.shared.activateFileViewerSelecting([preparedURL])
                            #else
                            exportURL = preparedURL
                            #endif
                        } label: {
                            #if os(macOS)
                            WeftLabel("在访达中显示", icon: "folder")
                            #else
                            WeftLabel("打开分享面板", icon: "share")
                            #endif
                        }.buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("confirmShareRunLog")
                    }
                    Button { Task { await reload() } } label: { WeftLabel("重新读取", icon: "sync") }
                        .buttonStyle(OutlineActionStyle()).accessibilityIdentifier("reloadRunLog")
                    if let notice { InlineNotice(message: notice) }
                }.padding(AppleTokens.Space.p20)
            }.background(Weave.canvas).foregroundStyle(Weave.ink).navigationTitle("运行记录")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(Weave.canvas, for: .navigationBar).toolbarBackground(.visible, for: .navigationBar)
                #endif
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button { if let onClose { onClose() } else { dismiss() } } label: { WeftLabel("完成", icon: "allow") }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("closeRunLog") } }
                .accessibilityIdentifier("runLogPage")
                .task { await reload() }
                .onChange(of: peer) { _, _ in Task { await reload() } }
            #if os(iOS)
                .sheet(isPresented: Binding(get: { exportURL != nil }, set: { if !$0 { exportURL = nil } })) {
                    if let exportURL { RunLogShare(url: exportURL) }
                }
            #endif
        }
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 620)
        #endif
    }
    private func reload() async { await runtime.reload(); summary = await runtime.store.summaryJSON(peer: peer) }
    private func row(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) { Text(title).foregroundStyle(Weave.muted); Spacer(); Text(value).multilineTextAlignment(.trailing) }.font(AppleTokens.Fonts.callout)
    }
    private func time(_ value: String?) -> String {
        guard let value, let date = ISO8601DateFormatter().date(from: value) else { return "暂无记录" }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "zh_CN"); formatter.dateFormat = "HH:mm"
        if Calendar.current.isDateInToday(date) { return "今天 " + formatter.string(from: date) }
        if Calendar.current.isDateInYesterday(date) { return "昨天 " + formatter.string(from: date) }
        formatter.dateFormat = Calendar.current.isDate(date, equalTo: Date(), toGranularity: .year) ? "M 月 d 日 HH:mm" : "yyyy 年 M 月 d 日 HH:mm"
        return formatter.string(from: date)
    }
    private func previousText(_ marker: RunLogMarker?) -> String {
        guard let marker else { return "第一次运行" }
        if marker.clean { return marker.reason == "user_quit" ? "正常退出" : "已记录结束" }
        return marker.state == "background" ? "后台结束，可能由系统回收" : "没有正常结束，原因待诊断"
    }
    private func eventText(_ row: RunLogRecord) -> String {
        switch row.event {
        case .previousUncleanExit: row.fields["reason"] == "terminated_in_background" ? "后台结束，可能由系统回收" : "上次没有正常结束"
        case .crash: "系统补送了崩溃诊断"
        case .hang: "系统记录了卡顿"
        case .cpu: "CPU 使用异常"
        case .disk: "磁盘写入异常"
        case .approvalFailure: "批准操作未完成"
        case .syncFailure: "同步未完成"
        default: "运行中出现错误"
        }
    }
}
#if os(iOS)
private struct RunLogShare: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
#endif
