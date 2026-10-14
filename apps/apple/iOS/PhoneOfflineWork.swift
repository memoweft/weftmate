import SwiftUI
import WeftMateCore

struct PhoneOfflineWork: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject private var offline: OfflineChatModel
    @ObservedObject private var cloud: CloudLoginModel
    @State private var referenceID = ""
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    init(app: AppleAppModel) { self.app=app;offline=app.offline;cloud=app.cloudLogin }
    private var references: [OfflineTaskReference] { offline.workSnapshot?.taskReferences?.filter { $0.projectId != nil } ?? [] }
    private var pending: OfflineWorkTask? { offline.workTasks.first { $0.state == "sending" } }
    var body: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
            Text("电脑暂时不在线").font(AppleTokens.Fonts.headline)
            Text("可以交代已保存的工作，电脑上线后接着做。文件权限和审批照常。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
            if references.isEmpty { Text("先连接电脑，保存一段绑定项目的工作，再离线交代。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            else {
                Menu {
                    ForEach(references) { reference in Button(reference.title) { referenceID=reference.id } }
                } label: { Text(references.first { $0.id == referenceID }?.title ?? "选择工作对话").frame(minHeight:AppleTokens.Space.p44) }
                TextField("交代电脑做什么…",text:$text,axis:.vertical).lineLimit(1...5).weaveField()
                if let pending { Button("重试原交代") { Task { await submit(pending) } }.buttonStyle(OutlineActionStyle()).disabled(busy) }
                else { Button("交给电脑，上线后做") { Task { await prepare() } }.buttonStyle(OutlineActionStyle()).disabled(busy || text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || !references.contains { $0.id == referenceID }) }
            }
            if !offline.workTasks.isEmpty { Button("刷新进展") { Task { await refresh() } }.buttonStyle(OutlineActionStyle()).disabled(busy) }
            ForEach(offline.workTasks) { task in
                HStack {
                    Text(status(task.state)).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                    Spacer()
                    if task.state == "waiting" || task.state == "sending" {
                        Button("撤回交代") { Task { await cancel(task) } }.buttonStyle(OutlineActionStyle()).disabled(busy)
                    }
                }
            }
            if let error { Text(error).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.danger) }
        }.padding(AppleTokens.Space.p12).tint(Weave.accent).accessibilityIdentifier("phone.work.offline")
            .task(id:offline.workSnapshot?.generation) { await refresh() }
    }
    private func refresh() async {
        let epoch=app.accountEpoch
        guard let snapshot=offline.workSnapshot else { return }
        do {
            let receipts=try await cloud.listOfflineWork(hostID:snapshot.control.hostId)
            guard app.accountEpoch == epoch else { return }
            for receipt in receipts where offline.workTasks.contains(where: { $0.id == receipt.id }) { try offline.acknowledgeWorkTask(receipt) }
        } catch { self.error="进展暂时读不了，已保存的交代仍然保留。" }
    }
    private func prepare() async {
        guard !busy else { return };busy=true;defer { busy=false }
        let epoch=app.accountEpoch
        guard let snapshot=offline.workSnapshot,let reference=references.first(where: { $0.id == referenceID }) else { return }
        do {
            let auth=try await cloud.offlineAuthorization(hostID:snapshot.control.hostId)
            let deviceID=try await cloud.offlineWorkDeviceID()
            guard app.accountEpoch == epoch else { return }
            let task=try OfflineWorkTask.prepare(text:text,reference:reference,snapshot:snapshot,authorization:auth,deviceID:deviceID)
            try offline.retainWorkTask(task)
            await submit(task)
        } catch { self.error="还没能交给电脑，原交代保留。" }
    }
    private func submit(_ task: OfflineWorkTask) async {
        busy=true;error=nil;let epoch=app.accountEpoch
        defer { busy=false }
        do {
            let receipt=try await cloud.submitOfflineWork(task)
            guard app.accountEpoch == epoch else { return }
            try offline.acknowledgeWorkTask(receipt);text=""
        } catch { self.error="结果还没能确认。重试会核对原交代，不会另建一项。" }
    }
    private func cancel(_ task: OfflineWorkTask) async {
        busy=true;error=nil;let epoch=app.accountEpoch
        defer { busy=false }
        do {
            let receipt=try await cloud.cancelOfflineWork(task)
            guard app.accountEpoch == epoch else { return }
            try offline.acknowledgeWorkTask(receipt)
        } catch { self.error="还没能撤回。电脑已接收时，请连上电脑后在原工作里停止。" }
    }
    private func status(_ value: String) -> String {
        switch value {
        case "waiting": "等待电脑上线"
        case "claimed", "received": "电脑已接收"
        case "started": "电脑已开始"
        case "completed": "电脑已完成"
        case "failed": "电脑没能完成"
        case "expired": "交代已过期"
        case "canceled": "交代已撤回"
        default: "提交结果待核对"
        }
    }
}
