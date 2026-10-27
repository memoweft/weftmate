import SwiftUI
import WeftMateCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// A settings subpage. The parent owns navigation and the settings dismissal.
struct RunLogView: View {
    var onBack: (@MainActor () -> Void)?
    var onClose: (@MainActor () -> Void)?
    @ObservedObject private var runtime = RunLogRuntime.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var peer = false
    @State private var recording = true
    @State private var clearConfirmation = false
    @State private var summary = ""
    @State private var preview: Preview?
    @State private var detail: RunLogRecord?
    @State private var exportURL: URL?
    @State private var notice: String?
    private enum Preview: String, Identifiable {
        case summary, file
        var id: String { rawValue }
    }
    @State private var preparedURL: URL?
    @State private var logPreview = ""
    @State private var logSize = 0
    @State private var previewRawExpanded = false
    private var snapshot: RunLogSnapshot? { peer ? runtime.watchSnapshot : runtime.snapshot }
    private var previewSummary: RunLogSummary? {
        summary.data(using: .utf8).flatMap { try? JSONDecoder().decode(RunLogSummary.self, from: $0) }
    }
    private var retentionInk: Color {
        #if os(iOS)
        // The native grouped Form footer is light gray, rather than the canvas token.
        Weave.secondary
        #else
        Weave.muted
        #endif
    }
    private var canExport: Bool {
        guard let snapshot, snapshot.readable else { return false }
        return peer ? snapshot.summary.appVersion != "unknown" : snapshot.current != nil || !recording
    }
    var body: some View {
        #if os(macOS)
        if let detail {
            VStack(spacing: AppleTokens.Space.p0) {
                macHeader("记录详情") { self.detail = nil }
                RunLogDetail(record: detail, records: snapshot?.summary.recentAbnormalRecords ?? [])
            }
        } else {
            VStack(spacing: AppleTokens.Space.p0) {
                macHeader("运行记录") { onBack?() }
                page
            }
        }
        #else
        page.scrollContentBackground(.hidden).background(Weave.grouped).navigationTitle("运行记录").toolbar { phoneDone }
            .task { recording = await runtime.store.isRecordingEnabled() }
            .navigationDestination(isPresented: Binding(get: { detail != nil }, set: { if !$0 { detail = nil } })) {
                if let detail { RunLogDetail(record: detail, records: snapshot?.summary.recentAbnormalRecords ?? []).navigationTitle("记录详情").toolbar { phoneDone } }
            }
        #endif
    }
    #if os(iOS)
    @ToolbarContentBuilder private var phoneDone: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) { SettingsDoneButton { onClose?() } }
    }
    #endif
    private var page: some View {
        Form {
            #if os(iOS)
            Section {
                Toggle("记录运行信息", isOn: Binding(get: { recording }, set: { value in
                    Task { do { try await runtime.store.setRecordingEnabled(value); recording = value; await runtime.reload() } catch { notice = "记录设置未能保存，请重试。" } }
                })).accessibilityIdentifier("runLog.recording")
                Picker("记录来自", selection: $peer) { Text("iPhone").tag(false); Text("手表").tag(true) }
                    .pickerStyle(.segmented).accessibilityIdentifier("runLogSource")
            }
            #endif
            if let value = snapshot {
                if !value.readable {
                    Section {
                        HStack(alignment: .center, spacing: AppleTokens.Space.p12) {
                            InlineNotice(message: "运行记录暂时无法读取。请检查设备存储后重试。", isError: true)
                            Button("重试") { Task { await runtime.reload() } }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("retryRunLog")
                        }.accessibilityElement(children: .contain).accessibilityIdentifier("runLogReadFailure")
                    }
                } else {
                    Section {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                            if !peer {
                                row("本次启动", RunLogText.time(value.current?.startedAt))
                                row(value.previous?.clean == false ? "上次最后记录" : "上次结束", RunLogText.time(value.previous?.lastAt))
                                row("结束状态", RunLogText.previous(value.previous, platform: value.summary.platform))
                            }
                            row(peer ? "最近 7 天收到的异常" : "最近 7 天异常", "\(value.summary.abnormalCountsLast7Days.values.reduce(0, +)) 次")
                            Text(peer ? "通过 iPhone 接收，仅保存在这两台设备。" : "只在本机保存，复制或分享由你选择。")
                                .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                        }.padding(.vertical, AppleTokens.Space.p8)
                    }
                    Section("最近的异常") {
                        if value.summary.recentAbnormalRecords.isEmpty {
                            InlineNotice(message: peer ? "还没有收到手表异常记录。手表连接手机后会自动补送。" : "最近没有异常记录。程序没有正常结束时，会在这里留下线索。")
                                .accessibilityIdentifier("runLogEmpty")
                        } else {
                            ForEach(Array(value.summary.recentAbnormalRecords.suffix(5).reversed().enumerated()), id: \.offset) { index, record in
                                Button { detail = record } label: {
                                    RunLogNavigationRow(title: RunLogText.event(record), subtitle: RunLogText.time(record.at))
                                }.buttonStyle(RunLogRowStyle()).accessibilityIdentifier("runLogRecord.\(index)")
                                    .listRowSeparator(.hidden)
                            }
                        }
                    }.accessibilityElement(children: .contain).accessibilityIdentifier("runLogRecords")
                }
                Section {
                    HStack(spacing: AppleTokens.Space.p12) {
                        Button { Task { summary = await runtime.store.summaryJSON(peer: peer); previewRawExpanded = false; preview = .summary } } label: {
                            actionLabel("复制诊断摘要", icon: "copy")
                        }.accessibilityIdentifier("previewRunSummary").buttonStyle(PrimaryActionStyle()).disabled(!canExport).frame(maxWidth: .infinity)
                        Button { Task { await prepareFile() } } label: {
                            #if os(macOS)
                            actionLabel("在访达中显示", icon: "folder")
                            #else
                            actionLabel("分享日志文件", icon: "share")
                            #endif
                        }.accessibilityIdentifier("shareRunLog").buttonStyle(OutlineActionStyle()).disabled(!canExport || peer).frame(maxWidth: .infinity)
                    }.padding(.vertical, AppleTokens.Space.p8).accessibilityElement(children: .contain).accessibilityIdentifier("runLogActions")
                } footer: {
                    Text("保留 \(value.summary.retentionPolicy.retentionDays) 天 · 最多 \(RunLogText.capacity(value.summary.retentionPolicy.maxBytes))")
                        .font(AppleTokens.Fonts.caption).foregroundStyle(retentionInk).accessibilityIdentifier("runLogRetention")
                }
            } else {
                Section { ProgressView("正在读取运行记录…") }
            }
            #if os(iOS)
            Section {
                Button("清空这台手机的记录", role: .destructive) { clearConfirmation = true }.disabled(peer).accessibilityIdentifier("runLog.clear")
                    .phonePopover(isPresented: $clearConfirmation) {
                        VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                            Text("清空已有运行记录？之后按当前开关继续记录，已分享的文件需要另行删除。")
                            Button("清空记录", role: .destructive) {
                                Task {
                                    do {
                                        try await runtime.store.clearRecords()
                                        summary = ""; logPreview = ""; detail = nil; preview = nil; preparedURL = nil; exportURL = nil
                                        await runtime.reload(); notice = "旧记录已清空。"
                                    } catch { notice = "记录未能清空，请重试。" }
                                    clearConfirmation = false
                                }
                            }.accessibilityIdentifier("runLog.confirmClear")
                            Button("取消") { clearConfirmation = false }
                        }.padding(AppleTokens.Space.p20).frame(idealWidth: AppleTokens.Phone.menuWidth)
                    }
            }
            #endif
            if let notice { Section { InlineNotice(message: notice) } }
        }.formStyle(.grouped).foregroundStyle(Weave.ink).tint(Weave.accent)
            .accessibilityIdentifier("runLogPage")
            .task {
                runtime.notify = false; await runtime.reload()
                #if DEBUG && os(iOS)
                await prepareNativeScene()
                #endif
            }
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await runtime.reload() } } }
            .sheet(item: $preview) { kind in previewSheet(kind) }
            #if os(iOS)
            .sheet(isPresented: Binding(get: { exportURL != nil }, set: { if !$0 { exportURL = nil } })) {
                if let exportURL { RunLogShare(url: exportURL) }
            }
            #endif
    }
    #if DEBUG && os(iOS)
    /// Screenshot-only fixture uses the real settings views and the same preview/export actions.
    /// Interactions are independently verified by DIAG3UITests; no production data or OS settings.
    private func prepareNativeScene() async {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("--ui-testing"), let index = args.firstIndex(of: "--diag3-native-scene"), args.indices.contains(index + 1) else { return }
        let scene = args[index + 1]
        peer = scene.hasPrefix("watch")
        await runtime.reload()
        if scene.contains("summary") {
            summary = await runtime.store.summaryJSON(peer: peer); previewRawExpanded = scene.contains("raw"); preview = .summary
        } else if scene.contains("file") || scene == "system-share" {
            await prepareFile(); previewRawExpanded = scene.contains("raw")
            if scene == "system-share", let preparedURL {
                preview = nil
                try? await Task.sleep(for: .seconds(AppleTokens.Motion.slow))
                exportURL = preparedURL
            }
        } else if scene.contains("detail"), let record = snapshot?.summary.recentAbnormalRecords.last {
            detail = record
        }
    }
    #endif
    private func prepareFile() async {
        guard let url = await runtime.store.export() else { notice = "日志文件暂时无法读取。"; return }
        let bytes = await Task.detached { try? Data(contentsOf: url) }.value
        guard let bytes, let text = String(data: bytes, encoding: .utf8) else { notice = "日志文件暂时无法读取。"; return }
        preparedURL = url; logPreview = text; logSize = bytes.count; previewRawExpanded = false; preview = .file
    }
    private var filePreviewMessage: String {
        #if os(macOS)
        "先检查运行记录文件，再在访达中显示。"
        #else
        "先检查将要分享的日志文件。分享由你选择接收方。"
        #endif
    }
    private func previewSheet(_ kind: Preview) -> some View {
        NavigationStack {
            Form {
                Section {
                    Text(kind == .summary ? "先检查将要复制的诊断摘要。这里只包含脱敏后的运行线索。" : filePreviewMessage)
                        .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                        if kind == .summary, let value = previewSummary {
                            row("记录来自", peer ? "手表" : value.platform == .macos ? "Mac" : "iPhone")
                            row("程序版本", value.appVersion)
                            row("最近 7 天异常", "\(value.abnormalCountsLast7Days.values.reduce(0, +)) 次")
                            row("摘要时间", RunLogText.time(value.generatedAt))
                        } else {
                            row("文件内容", "脱敏后的运行记录")
                            row("文件大小", RunLogText.capacity(logSize))
                        }
                    }.padding(.vertical, AppleTokens.Space.p8)
                    Button { previewRawExpanded.toggle() } label: {
                        HStack(spacing: AppleTokens.Space.p12) {
                            Text("查看原始记录").font(AppleTokens.Fonts.body).foregroundStyle(Weave.ink)
                            Spacer()
                            WeftIcon(previewRawExpanded ? "chevron" : "right").foregroundStyle(Weave.muted)
                        }.padding(.vertical, AppleTokens.Space.p8).contentShape(Rectangle())
                    }.buttonStyle(RunLogRowStyle()).accessibilityIdentifier(kind == .summary ? "expandRunSummaryRaw" : "expandRunFileRaw")
                        .accessibilityValue(previewRawExpanded ? "已展开" : "已收起")
                    if previewRawExpanded {
                        ScrollView {
                            Text(kind == .summary ? summary : logPreview)
                                .font(AppleTokens.Fonts.caption.monospaced()).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .accessibilityIdentifier(kind == .summary ? "runSummaryPreview" : "runLogFilePreviewText")
                        }.frame(height: AppleTokens.Space.p20 * 10)
                    }
                }.accessibilityElement(children: .contain).accessibilityIdentifier(kind == .summary ? "runSummaryPreviewSection" : "runLogFilePreview")
                Section {
                    Button {
                        if kind == .summary {
                            #if os(macOS)
                            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(summary, forType: .string)
                            #else
                            UIPasteboard.general.string = summary
                            #endif
                            preview = nil; notice = "诊断摘要已复制。"
                        } else if let preparedURL {
                            preview = nil
                            #if os(macOS)
                            NSWorkspace.shared.activateFileViewerSelecting([preparedURL])
                            #else
                            // Present after the preview has dismissed, avoiding two competing sheets.
                            Task { @MainActor in
                                try? await Task.sleep(for: .seconds(AppleTokens.Motion.slow))
                                exportURL = preparedURL
                            }
                            #endif
                        }
                    } label: {
                        if kind == .summary { WeftLabel("复制", icon: "copy") }
                        else {
                            #if os(macOS)
                            WeftLabel("在访达中显示", icon: "folder")
                            #else
                            WeftLabel("打开分享面板", icon: "share")
                            #endif
                        }
                    }.buttonStyle(PrimaryActionStyle()).accessibilityIdentifier(kind == .summary ? "copyRunSummary" : "confirmShareRunLog")
                }
            }.formStyle(.grouped).navigationTitle(kind == .summary ? "诊断摘要" : "日志文件预览")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { preview = nil }
                            #if os(macOS)
                            .buttonStyle(OutlineActionStyle())
                            #endif
                            .accessibilityIdentifier("closeRunLogPreview")
                    }
                }
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
        }.foregroundStyle(Weave.ink).tint(Weave.accent)
        #if os(iOS)
        .persistentSystemOverlays(.visible)
        #endif
        #if os(macOS)
        .frame(minWidth: AppleTokens.Space.p56 * 10, minHeight: AppleTokens.Space.p56 * 10)
        #endif
    }
    private func actionLabel(_ title: String, icon: String) -> some View {
        HStack(spacing: AppleTokens.Space.p6) {
            WeftIcon(icon, size: AppleTokens.Space.p16)
            Text(title).lineLimit(1).layoutPriority(1)
        }.frame(maxWidth: .infinity)
    }
    private func row(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: AppleTokens.Space.p16) {
            Text(title).foregroundStyle(Weave.muted).fixedSize()
            Spacer(minLength: AppleTokens.Space.p8)
            Text(value).multilineTextAlignment(.trailing)
        }.font(AppleTokens.Fonts.callout)
    }
    #if os(macOS)
    private func macHeader(_ title: String, back: @escaping () -> Void) -> some View {
        HStack(spacing: AppleTokens.Space.p12) {
            Button(action: back) { WeftIcon("back") }.buttonStyle(OutlineActionStyle()).accessibilityLabel(title == "记录详情" ? "返回运行记录" : "返回关于").accessibilityIdentifier("backRunLog")
            Text(title).font(AppleTokens.Fonts.largeTitle.weight(.semibold)).foregroundStyle(Weave.ink)
            Spacer()
            Button("完成") { onClose?() }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("closeRunLog")
        }.padding(.horizontal, AppleTokens.Space.p24).padding(.top, AppleTokens.Space.p24).padding(.bottom, AppleTokens.Space.p16)
    }
    #endif
}

struct RunLogNavigationRow: View {
    let title: String
    let subtitle: String
    var body: some View {
        HStack(spacing: AppleTokens.Space.p12) {
            VStack(alignment: .leading, spacing: AppleTokens.Space.p5) {
                Text(title).font(AppleTokens.Fonts.body).foregroundStyle(Weave.ink)
                Text(subtitle).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
            }
            Spacer(minLength: AppleTokens.Space.p12)
            WeftIcon("right").foregroundStyle(Weave.muted)
        }.padding(.vertical, AppleTokens.Space.p8).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
    }
}
struct RunLogRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(configuration.isPressed ? Weave.soft : AppleTokens.Colors.clear)
            .opacity(configuration.isPressed ? AppleTokens.Opacity.pressed : 1)
    }
}

private struct RunLogDetail: View {
    let record: RunLogRecord
    let records: [RunLogRecord]
    @State private var rawExpanded = false
    private var diagnostics: [RunLogRecord] {
        records.filter { [.crash, .hang, .cpu, .disk].contains($0.event) && ($0.runId == record.runId || record.previousRunId != nil && $0.previousRunId == record.previousRunId) }
    }
    private var raw: String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? encoder.encode(record)).flatMap { String(data: $0, encoding: .utf8) } ?? "没有更多线索"
    }
    var body: some View {
        Form {
            Section {
                Text(RunLogText.event(record)).font(AppleTokens.Fonts.headline)
                clue("发现时间", RunLogText.time(record.at))
                if let at = record.lastAt { clue("结束前最后记录", RunLogText.time(at)) }
                if let event = record.lastEvent { clue("最后记录的动作", RunLogText.action(event)) }
                if let state = record.fields["state"] { clue("当时的状态", RunLogText.state(state)) }
                clue("系统崩溃诊断", record.event == .crash ? "已收到系统补送的诊断" : diagnostics.contains { $0.event == .crash } ? "已收到可能与这次结束有关的诊断" : "之后尚未收到相关诊断")
                if let type = record.fields["errorType"] { clue("错误类型", RunLogText.error(type)) }
                else if record.event == .crash { clue("错误类型", "系统崩溃诊断") }
                if let code = record.fields["errorCode"] ?? record.fields["signal"] { clue(record.fields["signal"] == nil ? "错误代码" : "系统信号", code) }
                if let module = record.fields["module"] {
                    clue("错误位置", [module, record.fields["file"], record.fields["line"].map { "第 " + $0 + " 行" }].compactMap { $0 }.joined(separator: " · "))
                } else if let frames = record.frames, !frames.isEmpty { clue("错误位置", frames.joined(separator: "\n")) }
                else if record.event == .crash { clue("错误位置", "系统未提供错误位置") }
                if record.lastAt == nil && record.fields["errorType"] == nil && record.fields["state"] == nil && record.frames?.isEmpty != false { Text("没有更多线索").foregroundStyle(Weave.muted) }
            }
            if !diagnostics.isEmpty && record.event != .crash {
                Section("系统补送的线索") {
                    ForEach(Array(diagnostics.enumerated()), id: \.offset) { _, item in
                        clue(RunLogText.event(item), RunLogText.time(item.at))
                        clue("错误类型", item.fields["errorType"].map(RunLogText.error) ?? RunLogText.event(item))
                        if let signal = item.fields["signal"] { clue("系统信号", signal) }
                        if let frames = item.frames, !frames.isEmpty { clue("错误位置", frames.joined(separator: "\n")) }
                        else { clue("错误位置", "系统未提供错误位置") }
                    }
                    Text("系统诊断可能覆盖多次启动，以上关联是线索。")
                        .font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                }
            }
            Section {
                Button { rawExpanded.toggle() } label: {
                    HStack(spacing: AppleTokens.Space.p12) {
                        Text("查看原始记录").font(AppleTokens.Fonts.body).foregroundStyle(Weave.ink)
                        Spacer()
                        WeftIcon(rawExpanded ? "chevron" : "right").foregroundStyle(Weave.muted)
                    }.padding(.vertical, AppleTokens.Space.p8).contentShape(Rectangle())
                }.buttonStyle(RunLogRowStyle()).accessibilityIdentifier("expandRunLogRaw")
                    .accessibilityValue(rawExpanded ? "已展开" : "已收起")
                if rawExpanded { Text(raw).font(AppleTokens.Fonts.caption.monospaced()).textSelection(.enabled).accessibilityIdentifier("runLogRawRecord") }
            }
        }.formStyle(.grouped).foregroundStyle(Weave.ink).tint(Weave.accent).accessibilityIdentifier("runLogDetail")
            .task {
                #if DEBUG && os(iOS)
                let args = ProcessInfo.processInfo.arguments
                if args.contains("--ui-testing"), let index = args.firstIndex(of: "--diag3-native-scene"), args.indices.contains(index + 1), args[index + 1] == "detail-raw" { rawExpanded = true }
                #endif
            }
    }
    private func clue(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p5) {
            Text(title).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
            Text(value).font(AppleTokens.Fonts.body)
        }.padding(.vertical, AppleTokens.Space.p8)
    }
}

enum RunLogText {
    static func time(_ value: String?) -> String {
        guard let value, let date = ISO8601DateFormatter().date(from: value) else { return "暂无记录" }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "zh_CN"); formatter.dateFormat = "HH:mm"
        if Calendar.current.isDateInToday(date) { return "今天 " + formatter.string(from: date) }
        if Calendar.current.isDateInYesterday(date) { return "昨天 " + formatter.string(from: date) }
        formatter.dateFormat = Calendar.current.isDate(date, equalTo: Date(), toGranularity: .year) ? "M 月 d 日 HH:mm" : "yyyy 年 M 月 d 日 HH:mm"
        return formatter.string(from: date)
    }
    static func capacity(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) 字节" }
        return bytes >= 1024 * 1024 ? "\(bytes / (1024 * 1024)) MB" : "\(bytes / 1024) KB"
    }
    static func entry(_ value: RunLogSnapshot?) -> String {
        guard let value else { return "暂无记录" }
        guard value.readable else { return "记录暂时无法读取" }
        guard let marker = value.previous else { return "暂无记录" }
        if marker.clean { return "上次正常结束" }
        return marker.state == "background" && value.summary.platform != .macos ? "在后台被系统回收（正常现象）" : "上次没有正常结束"
    }
    static func previous(_ marker: RunLogMarker?, platform: RunPlatform) -> String {
        guard let marker else { return "第一次运行" }
        if marker.clean { return "正常结束" }
        return marker.state == "background" && platform != .macos ? "在后台被系统回收（正常现象）" : "没有正常结束，原因待诊断"
    }
    static func event(_ row: RunLogRecord) -> String {
        switch row.event {
        case .previousUncleanExit: row.fields["reason"] == "terminated_in_background" ? "在后台被系统回收（正常现象）" : "上次没有正常结束"
        case .crash: "系统补送了崩溃诊断"
        case .hang: "系统记录了卡顿"
        case .cpu: "CPU 使用异常"
        case .disk: "磁盘写入异常"
        case .approvalFailure: "批准操作未完成"
        case .syncFailure: "同步未完成"
        default: "运行中出现错误"
        }
    }
    static func action(_ event: RunEvent) -> String {
        switch event {
        case .start: "程序启动或回到前台"
        case .state: "程序切换前后台状态"
        case .connection: "连接状态变化"
        case .exit: "程序结束"
        default: "运行中记录了错误线索"
        }
    }
    static func state(_ state: String) -> String { state == "background" ? "后台" : state == "foreground" ? "前台" : "暂时未处于活动状态" }
    static func error(_ type: String) -> String { type == "network" ? "网络连接错误" : type == "api" ? "服务请求错误" : type == "objc_exception" ? "程序异常" : "暂时无法确定" }
}

private struct OpenRunLogPageKey: EnvironmentKey {
    static let defaultValue: @MainActor () -> Void = {}
}
extension EnvironmentValues {
    var openRunLogPage: @MainActor () -> Void {
        get { self[OpenRunLogPageKey.self] }
        set { self[OpenRunLogPageKey.self] = newValue }
    }
}

/// An inline notice inside page content, never a safe-area or titlebar inset.
struct PreviousRunNotice: View {
    @ObservedObject private var log = RunLogRuntime.shared
    @Environment(\.openRunLogPage) private var openPage
    var viewRecords: (() -> Void)? = nil
    var body: some View {
        if log.notify {
            HStack(alignment: .center, spacing: AppleTokens.Space.p8) {
                InlineNotice(message: "上次没有正常结束，已留下运行记录。", isError: true)
                Button("查看") { log.notify = false; if let viewRecords { viewRecords() } else { openPage() } }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("previousRunNotice")
                Button { log.notify = false } label: { WeftIcon("deny") }
                    .buttonStyle(OutlineActionStyle()).accessibilityLabel("关闭运行提示").accessibilityIdentifier("dismissPreviousRunNotice")
            }.accessibilityElement(children: .contain).accessibilityIdentifier("previousRunNoticeRow")
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
