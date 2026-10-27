import SwiftUI
import WeftMateCore

/// Uses the host's authenticated root-command metadata and native queue projection.
/// Cancellation must finish before an unstarted message becomes a draft again.
struct PhoneMainChatQueue: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var chat: MainChatModel
    let sessionID: String
    @StateObject private var directory: TaskDirectoryModel
    @Environment(\.scenePhase) private var phase
    @State private var presented=false
    @State private var busy=Set<String>()
    @State private var canceled=Set<String>()
    @State private var requests: [String:String]=[:]
    @State private var notice: String?
    init(app:AppleAppModel,chat:MainChatModel,sessionID:String) {
        self.app=app; self.chat=chat; self.sessionID=sessionID
        _directory=StateObject(wrappedValue:TaskDirectoryModel(client:app.assistantClient,sessionId:sessionID,expectedHostId:app.session?.hostId ?? "",accountEpoch:app.accountEpoch,currentEpoch:{[weak app] in app?.accountEpoch ?? UUID()},currentSession:{[weak app] in app?.session}))
    }
    private var queued: [QueuedTask] {
        let commands=directory.rootCommands.map {
            SharedCommandReceipt(commandId:$0.commandId,requestId:$0.requestId,kind:.message,targetDeviceId:$0.targetDeviceId,state:$0.state,sessionId:$0.sessionId,conversationId:nil,sourceSyncEventId:nil,receiptId:$0.receiptId,errorCode:nil)
        }
        return TaskQueueProjection.queued(events:chat.nativeEvents,commands:commands).filter { !canceled.contains($0.id) }
    }
    var body: some View {
        Group {
            if !queued.isEmpty {
                Button("\(queued.count) 条消息排队中") { dismissPhonePreviewKeyboard(); presented=true }
                    .font(AppleTokens.Fonts.caption).buttonStyle(.plain).frame(minHeight:AppleTokens.Space.p44)
                    .accessibilityIdentifier("mainChat.queue")
            }
        }.sheet(isPresented:$presented) {
            ScrollView {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                    ForEach(queued) { row in
                        VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                            Text(row.text).fixedSize(horizontal:false,vertical:true)
                            HStack {
                                Button("修改") { Task { await withdraw(row,edit:true) } }
                                Spacer()
                                Button("撤回",role:.destructive) { Task { await withdraw(row,edit:false) } }
                            }.frame(minHeight:AppleTokens.Space.p44)
                        }.disabled(busy.contains(row.id) || !directory.scopeIsCurrent)
                            .accessibilityIdentifier("mainChat.queued."+row.id)
                        Divider()
                    }
                    if queued.isEmpty { Text("没有排队消息，已开始的回复可以在输入框停止。").foregroundStyle(Weave.muted) }
                    if let notice { Text(notice).foregroundStyle(Weave.danger) }
                    if let error=directory.error { Text(error).foregroundStyle(Weave.muted) }
                }.padding(AppleTokens.Phone.pageInset)
            }.phoneSheet("排队消息",close:{presented=false})
        }.task(id:phase) {
            guard phase == .active else { directory.suspend(); return }
            directory.activate()
            while !Task.isCancelled {
                await directory.refresh()
                do { try await Task.sleep(for:.seconds(1.5)) } catch { return }
            }
        }.onDisappear { directory.suspend() }
    }
    private func withdraw(_ row:QueuedTask,edit:Bool) async {
        guard directory.scopeIsCurrent,!busy.contains(row.id),queued.contains(where:{$0.id == row.id}) else { return }
        if edit && (!chat.draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || !chat.attachments.isEmpty) {
            notice="先发送或清空当前草稿，再修改排队消息。"; return
        }
        let epoch=app.accountEpoch
        let request=requests[row.id] ?? "apple-queue-cancel-"+UUID().uuidString.lowercased()
        requests[row.id]=request; busy.insert(row.id); notice=nil
        defer { busy.remove(row.id) }
        do {
            var result=try await app.assistantClient.cancelQueuedTask(taskID:row.id,requestID:request)
            while [.requested,.cancelRequested].contains(result.control.stopStatus),directory.scopeIsCurrent,!Task.isCancelled {
                try await Task.sleep(for:.seconds(1))
                result=try await app.assistantClient.taskDetail(taskID:row.id)
            }
            guard epoch == app.accountEpoch,directory.scopeIsCurrent,chat.chat?.activeSessionId == sessionID else { return }
            guard result.control.stopStatus == .stopped else { notice="撤回还没确认，请核对后重试。"; return }
            canceled.insert(row.id)
            if edit {
                // A draft typed while the network request was in flight also belongs to the user.
                if chat.draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && chat.attachments.isEmpty { chat.setDraft(row.text); presented=false }
                else { notice="已经撤回。当前草稿保留，原消息："+row.text }
            }
        } catch {
            guard epoch == app.accountEpoch,directory.scopeIsCurrent else { return }
            if case APIFailure.server(409,_) = error { notice="这条消息已经开始，可以回到输入框停止。" }
            else { notice="撤回结果待核对。重试会继续原提交。" }
        }
    }
}
