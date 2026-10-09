import SwiftUI
import WeftMateCore

/// Host-persisted mode. Each control is tied to the account epoch and the conversation it edits.
struct ApprovalModeControl: View {
    @ObservedObject var model: AppleAppModel
    let sessionID: String?
    var compact = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var settings: ApprovalModeSettings?
    @State private var busy = false
    @State private var error: String?
    @State private var showingMenu = false
    @State private var confirmingAllowAll = false
    private var identity: String { "\(model.accountEpoch)|\(sessionID ?? "default")" }
    private var isVerified: Bool { model.session?.verification == .verified }

    var body: some View {
        VStack(alignment: .leading, spacing: AppleTokens.Space.p5) {
            Button {
                showingMenu = true
            } label: {
                HStack(spacing: AppleTokens.Space.p3) {
                    WeftIcon("approval", size: compact ? AppleTokens.Space.p16 : AppleTokens.Space.p20)
                    Text(settings?.mode.shortTitle ?? "审批模式")
                        .lineLimit(compact ? 1 : 2).fixedSize(horizontal: compact, vertical: true)
                    WeftIcon("chevron", size: compact ? AppleTokens.Space.p12 : AppleTokens.Space.p16).font(AppleTokens.Fonts.caption)
                    if busy { ProgressView().controlSize(.mini) }
                }.font(AppleTokens.Fonts.caption).foregroundStyle(settings?.mode == .allowAll ? Weave.danger : Weave.ink)
            }
            .buttonStyle(ApprovalModeButtonStyle(compact: compact))
            .disabled(busy || !isVerified)
            .accessibilityLabel(sessionID == nil ? "默认审批模式" : "审批模式")
            .accessibilityValue(settings?.mode.rawValue ?? "尚未读取")
            .accessibilityIdentifier(sessionID == nil ? "defaultApprovalMode" : "approvalMode")
            .popover(isPresented: $showingMenu, arrowEdge: .bottom) {
                ScrollView {
                    VStack(alignment: .leading, spacing: AppleTokens.Space.p5) {
                        Text(sessionID == nil ? "新对话的默认模式" : "本对话的审批模式")
                            .font(AppleTokens.Fonts.headline).padding(.bottom, AppleTokens.Space.p6)
                        ForEach(Array(ApprovalMode.allCases.enumerated()), id: \.element.id) { index, mode in
                            modeButton(mode, number: index + 1)
                        }
                        if sessionID != nil, let categories = settings?.allowedCategories, !categories.isEmpty {
                            Divider()
                            Text("本对话已允许：" + categories.map(SessionApproval.riskLabel).joined(separator: "、"))
                                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        }
                    }
                    .padding(AppleTokens.Space.p18)
                }
                .frame(idealWidth: 330, maxWidth: 330, maxHeight: 520)
                .presentationCompactAdaptation(.popover)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("approvalModeMenu")
            }
            if let error {
                Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger)
                Button("重新读取审批模式") { Task { await load() } }
                    .font(AppleTokens.Fonts.caption).disabled(busy || !isVerified)
            }
        }
        .task(id: identity) { settings = nil; error = nil; await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
        .alert("全部允许？", isPresented: $confirmingAllowAll) {
            Button("取消", role: .cancel) {}
            Button("仍然全部允许", role: .destructive) { Task { await save(.allowAll) } }
                .accessibilityIdentifier("confirmAllowAll")
        } message: {
            Text(ApprovalMode.allowAllWarning + (sessionID == nil ? " 此设置将用于新对话。" : " 此设置只用于本对话。"))
        }
    }
    private func modeButton(_ mode: ApprovalMode, number: Int) -> some View {
        Button {
            showingMenu = false
            if mode == .allowAll { confirmingAllowAll = true }
            else { Task { await save(mode) } }
        } label: {
            HStack(alignment: .center, spacing: AppleTokens.Space.p10) {
                WeftIcon("allow", size: 16)
                    .opacity(settings?.mode == mode ? 1 : 0).frame(width: 16)
                VStack(alignment: .leading, spacing: AppleTokens.Space.p3) {
                    Text(mode.title).font(AppleTokens.Fonts.callout.weight(.medium)).foregroundStyle(Weave.ink)
                    Text(mode.explanation).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: AppleTokens.Space.p0)
                Text("\(number)").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            }.padding(.vertical, AppleTokens.Space.p7).contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(busy || !isVerified)
        .accessibilityLabel(mode.title + "，" + mode.explanation)
        .accessibilityValue(settings?.mode == mode ? "已选择" : "未选择")
        .accessibilityIdentifier("approvalModeOption.\(mode.rawValue)")
        #if os(macOS)
        .keyboardShortcut(KeyEquivalent(Character(String(number))), modifiers: [])
        #endif
    }
    private func load() async {
        guard !busy, isVerified else { return }
        let start = identity
        busy = true
        defer { if start == identity { busy = false } }
        do {
            let value = try await model.assistantClient.approvalMode(sessionID: sessionID)
            guard start == identity else { return }
            settings = value; error = nil
        } catch { if start == identity { self.error = failureMessage(error) } }
    }
    private func save(_ mode: ApprovalMode) async {
        guard !busy, isVerified else { return }
        let start = identity
        busy = true
        defer { if start == identity { busy = false } }
        do {
            let value = try await model.assistantClient.setApprovalMode(mode, sessionID: sessionID)
            guard start == identity else { return }
            settings = value; error = nil
        } catch { if start == identity { self.error = failureMessage(error) } }
    }
    private func failureMessage(_ error: Error) -> String {
        if case APIFailure.server(404, _) = error { return "当前宿主尚未提供审批模式，请更新宿主后重试。" }
        return "审批模式未能核对，请重新连接后读取。"
    }
}

private struct ApprovalModeButtonStyle: ButtonStyle {
    let compact: Bool
    func makeBody(configuration: Configuration) -> some View {
        if compact {
            configuration.label.frame(minHeight: AppleTokens.Space.p44).opacity(configuration.isPressed ? AppleTokens.Opacity.pressed : 1)
        } else { OutlineActionStyle().makeBody(configuration: configuration) }
    }
}
