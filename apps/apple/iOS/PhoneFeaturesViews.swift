import SwiftUI
import WeftMateCore

struct PhoneActivityView: View {
    @ObservedObject var app: AppleAppModel
    @StateObject private var model=PhoneFeaturesModel()
    @Environment(\.phoneOpenConversation) private var openConversation
    @State private var selected: PhoneActivity?
    @State private var settings: String?
    @State private var memory=false
    var body: some View {
        ScrollView {
            LazyVStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                Text("该你处理的，先放在前面。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                Picker("动态范围",selection:$model.filter) {
                    Text("全部").tag("all"); Text("未读").tag("unread"); Text("待处理").tag("actionable")
                }.pickerStyle(.segmented).accessibilityIdentifier("activity.filter")
                PhonePageState(loading:model.loading,error:model.errors["activity"],empty:model.activity.isEmpty,title:model.filter == "actionable" ? "没有待处理的事" : model.filter == "unread" ? "动态都看过了" : "还没有动态",message:"任务进展、完成回执、回顾和记忆变化会出现在这里。") { reload() }
                ForEach(model.orderedActivity) { item in
                    VStack(alignment:.leading,spacing:0) {
                        HStack(alignment:.top,spacing:AppleTokens.Space.p12) {
                            Button { Task { await open(item) } } label: {
                                HStack(alignment:.top,spacing:AppleTokens.Space.p12) {
                                    WeftIcon(item.state == "pending" ? "approval" : item.memoryDigest != nil ? "memory" : "bell")
                                        .foregroundStyle(item.state == "pending" ? Weave.danger : Weave.secondary)
                                        .padding(AppleTokens.Space.p8).background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r10))
                                    VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                                        HStack { Text(item.title).font(AppleTokens.Fonts.headline); if !item.read { Circle().fill(Weave.accent).frame(width:6,height:6).accessibilityLabel("未读") } }
                                        Text(item.summary).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.secondary)
                                        Text((item.state == "pending" ? "待处理 · " : "")+phoneFeatureTime(item.at)).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                                    }.frame(maxWidth:.infinity,alignment:.leading)
                                }.frame(minHeight:AppleTokens.Space.p44).contentShape(Rectangle())
                            }.buttonStyle(.plain).accessibilityIdentifier("activity.row."+item.id)
                            PhoneActionMenu {
                                if !item.read { Button("标为已读") { Task { await mark(item) } } }
                                Button("查看详情") { selected=item }
                            } label: { WeftIcon("more").phoneMenuLabel(circle:true) }.accessibilityLabel("动态操作").disabled(model.busy.contains(item.id))
                        }.padding(.vertical,AppleTokens.Space.p16)
                        Divider()
                    }
                }
                if model.nextActivity != nil { Button("查看更多动态") { Task { await model.read("activity",app:app,more:true) } }.disabled(model.loading) }
                if let health=model.weekly?.health, let text=health["text"]?.string {
                    PhoneSectionHeading(title:"这周的健康回顾"); Text(text).font(AppleTokens.Fonts.callout)
                }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("动态").navigationBarTitleDisplayMode(.large)
            .task(id:app.accountEpoch) { model.prepare(app); selected=nil; settings=nil; memory=false; await model.read("activity",app:app) }
            .refreshable { await model.read("activity",app:app) }
            .task(id:model.filter) { await model.read("activity",app:app) }
            .navigationDestination(isPresented:$memory) { PhoneMemoryWorkspaceView(app:app) }
            .sheet(item:$selected) { item in
                NavigationStack {
                    ScrollView {
                        VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                            Text(item.title).font(AppleTokens.Fonts.title2); Text(item.summary)
                            if let text=item.weeklyInsight?["text"]?.string { Text(text) }
                            if let text=item.weeklyInsight?["health"]?["text"]?.string { Text(text) }
                            if case .array(let sources)=item.weeklyInsight?["sources"] {
                                ForEach(Array(sources.enumerated()),id:\.offset) { _,source in
                                    Button(source["title"]?.string ?? "查看来源") {
                                        selected=nil
                                        if let artifact=source["artifactId"]?.string { app.phoneLibrarySelection=artifact }
                                        else if let session=source["sessionId"]?.string ?? source["source"]?["sessionId"]?.string { app.openedSessionID=session;openConversation?(session) }
                                    }.buttonStyle(OutlineActionStyle())
                                }
                            }
                            if let digest=item.memoryDigest { PhoneMemoryDigestContent(digest:digest) }
                            ForEach(Array(item.actions.enumerated()),id:\.offset) { _,action in
                                if PhoneFeaturePolicy.supportedAction(action.kind) {
                                    Button(action.label) { Task { await actionTap(action,item) } }.buttonStyle(OutlineActionStyle())
                                }
                            }
                            if !item.read { Button("标为已读") { Task { await mark(item); selected=nil } }.buttonStyle(PrimaryActionStyle()) }
                        }.padding(AppleTokens.Space.p20)
                    }.phoneSheet("动态详情",close:{ selected=nil })
                }
            }
            .sheet(isPresented:Binding(get:{settings != nil},set:{if !$0 { settings=nil }})) { SettingsView(model:app,route:.init(categoryID:settings ?? "devices"),onClose:{ settings=nil }) }
    }
    private func reload() { Task { await model.read("activity",app:app) } }
    private func mark(_ item: PhoneActivity) async {
        await model.write(item.id,page:"activity",app:app) { id in try await app.assistantClient.phoneMarkRead(item,requestID:id) }
    }
    private func open(_ item: PhoneActivity) async {
        if let action=item.actions.first(where:{ PhoneFeaturePolicy.supportedAction($0.kind) }) { await actionTap(action,item) }
        else if item.source.chatId != nil || item.source.sessionId != nil {
            await model.open(item.source,app:app,navigate:openConversation); if !item.read { await mark(item) }
        } else { selected=item }
    }
    private func actionTap(_ action: PhoneActivity.Action,_ item: PhoneActivity) async {
        switch action.kind {
        case "view_settings": selected=nil; settings=action.target.category ?? "devices"
        case "view_memory": selected=nil; memory=true
        case "view_library": app.phoneLibrarySelection=action.target.id ?? action.target.artifactId; selected=nil
        default: await model.open(action.target,app:app,navigate:openConversation); selected=nil
        }
        if !item.read { await mark(item) }
    }
}
private struct PhoneMemoryDigestContent: View {
    var digest: JSONValue
    var body: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
            if let text=digest["summary"]?.string { Text(text) }
            ForEach(["added","review","reviews"],id:\.self) { key in
                if case .array(let values)=digest[key] {
                    ForEach(Array(values.enumerated()),id:\.offset) { _,value in
                        if let text=value["text"]?.string { Text(text); if let reason=value["reviewReason"]?.string { Text(reason).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) } }
                    }
                }
            }
        }
    }
}
struct PhoneGoalsView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject private var phone: PhoneStandaloneModel
    @StateObject private var model=PhoneFeaturesModel()
    @Environment(\.phoneOpenConversation) private var openConversation
    @State private var selectedGoal: PhoneGoal?
    @State private var deleting: ManagedSchedule?
    @State private var archiving: PhoneGoal?
    @State private var schedules=false
    @State private var reminders=false
    init(app: AppleAppModel) { self.app=app; phone=app.phoneChat }
    var body: some View {
        ScrollView {
            LazyVStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                Text("把想做的事，慢慢做下去。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                Button { reminders=true } label: { PhoneFeatureRow(icon:"bell",title:"手机提醒",subtitle:phone.reminders.filter { !$0.completed }.sorted { $0.fireAt < $1.fireAt }.first.map { phoneReminderTime($0.fireAt)+" · "+$0.text } ?? "电脑不在线，也能准时提醒。",value:String(phone.reminders.filter { !$0.completed }.count)) }.buttonStyle(.plain).accessibilityIdentifier("goals.reminders")
                Divider()
                Button { schedules=true } label: { PhoneFeatureRow(icon:"clock",title:"定时任务",subtitle:"电脑上的安排，集中在这里。",value:app.session == nil ? "—" : String(model.schedules.count)) }.buttonStyle(.plain).accessibilityIdentifier("goals.schedules")
                Divider()
                PhoneSectionHeading(title:"进行中的目标")
                if app.session == nil { Text("连上电脑后，查看长期目标和任务进展。").foregroundStyle(Weave.muted) }
                else {
                    PhonePageState(loading:model.loading,error:model.errors["goals"],empty:model.goals.isEmpty,title:"还没有长期目标",message:"在对话中设立一个持续推进的目标。") { reload() }
                    ForEach(model.goals.filter { $0.phase != "complete" }) { row in goalRow(row) }
                    PhoneSectionHeading(title:"进行中的任务")
                    PhonePageState(loading:model.loading,error:model.errors["tasks"],empty:model.tasks.isEmpty,title:"现在没有进行中的任务",message:"在对话里交代一件事，这里会显示真实进展。") { reload() }
                    ForEach(model.tasks) { row in task(row) }
                    PhoneSectionHeading(title:"已经完成")
                    ForEach(model.goals.filter { $0.phase == "complete" }) { row in goalRow(row) }
                    ForEach(model.recent.prefix(10)) { row in task(row) }
                }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("目标与提醒").navigationBarTitleDisplayMode(.large)
            .task(id:app.accountEpoch) { phone.activate(app:app);model.prepare(app);selectedGoal=nil;deleting=nil;archiving=nil;await model.read("goals",app:app) }
            .refreshable { await model.read("goals",app:app) }
            .navigationDestination(isPresented:$reminders) { PhoneLocalRemindersView(app:app,phone:phone) }
            .navigationDestination(isPresented:$schedules) { schedulePage }
            .navigationDestination(isPresented:Binding(get:{selectedGoal != nil},set:{if !$0 { selectedGoal=nil }})) { if let row=selectedGoal { goalDetail(row) } }
            .alert("删除这项定时任务？",isPresented:Binding(get:{deleting != nil},set:{if !$0 { deleting=nil }})) {
                Button("取消",role:.cancel) { deleting=nil }
                Button("删除",role:.destructive) { if let row=deleting { manage(row,.delete) }; deleting=nil }
            } message: { Text("以后不会再执行这项安排，原对话保留。") }
            .alert("移出目标列表？",isPresented:Binding(get:{archiving != nil},set:{if !$0 { archiving=nil }})) {
                Button("取消",role:.cancel) { archiving=nil }; Button("移出",role:.destructive) { if let row=archiving { goal(row,.archive) }; archiving=nil }
            } message: { Text("停止继续推进这个目标，原对话和执行记录保留。") }
    }
    private var schedulePage: some View {
        ScrollView {
            LazyVStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                Text("电脑上的安排，集中在这里。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                PhonePageState(loading:model.loading,error:model.errors["schedules"],empty:model.schedules.isEmpty,title:"还没有定时任务",message:"新增或调整定时任务，在对话里告诉 WeftMate。") { reload() }
                if let error=model.errors["goals"] { InlineNotice(message:error,isError:true);Text("操作尚未确认，请重试刚才的操作。").font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted) }
                ForEach(model.schedules) { row in
                    PhoneRowGroup {
                        HStack {
                            PhoneFeatureRow(title:row.text,subtitle:(row.state == "paused" ? "已暂停" : row.nextRunAt.map { "下次 "+phoneFeatureTime($0) } ?? "已结束")+" · "+row.timeZone,chevron:false)
                            Button(row.state == "paused" ? "恢复" : "暂停") { manage(row,row.state == "paused" ? .resume : .pause) }.buttonStyle(OutlineActionStyle()).disabled(row.state == "completed")
                        }
                        Divider()
                        NavigationLink { scheduleDetail(row) } label: { PhoneFeatureRow(icon:"history",title:"查看最近执行",subtitle:row.lastResult.map { PhoneFeaturePolicy.taskStatus($0.state) } ?? "还没有执行记录") }.accessibilityIdentifier("goals.schedule."+row.id)
                        Divider()
                        Button { manage(row,.run) } label: { PhoneFeatureRow(icon:"play",title:"立即运行") }.disabled(row.state == "completed").accessibilityIdentifier("schedules.run."+row.id)
                        Divider()
                        Button(role:.destructive) { deleting=row } label: { PhoneFeatureRow(icon:"trash",title:"删除定时任务") }
                    }.disabled(model.busy.contains(row.identity))
                }
                Text("新增或调整定时任务，在来源对话里告诉 WeftMate。同一项安排只在这里管理。").font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.grouped).navigationTitle("定时任务").accessibilityIdentifier("schedules.page")
    }
    private func scheduleDetail(_ row: ManagedSchedule) -> some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text(row.text).font(AppleTokens.Fonts.title2)
                Text(row.state == "paused" ? "已暂停" : row.state == "completed" ? "已结束" : "已安排")
                if let next=row.nextRunAt { Text("下次 "+phoneFeatureTime(next)+" · "+row.timeZone) }
                PhoneSectionHeading(title:"最近执行")
                if let result=row.lastResult { Text(result.state == "delivered" ? "提醒已送达" : PhoneFeaturePolicy.taskStatus(result.state)) }
                else { Text("还没有执行记录。").foregroundStyle(Weave.muted) }
                ForEach(model.recent.filter { $0.source.sessionId == row.sessionId }.prefix(5)) { task($0) }
                Button("打开来源对话") { app.openedSessionID=row.sessionId;openConversation?(row.sessionId) }.buttonStyle(PrimaryActionStyle())
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("最近执行")
    }
    private func goalRow(_ row: PhoneGoal) -> some View {
        VStack(alignment:.leading,spacing:0) {
            Button { selectedGoal=row } label: { PhoneFeatureRow(title:row.title,subtitle:PhoneFeaturePolicy.goalStatus(row.phase)+" · "+row.progress) }.buttonStyle(.plain).accessibilityIdentifier("goals.goal."+row.id)
            Divider()
        }
    }
    private func goalDetail(_ row: PhoneGoal) -> some View {
        let current=model.goals.first { $0.id == row.id } ?? row
        return ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text(current.title).font(AppleTokens.Fonts.title.bold())
                Text("长期目标 · "+PhoneFeaturePolicy.goalStatus(current.phase)).foregroundStyle(Weave.muted)
                Text(current.progress).accessibilityIdentifier("goals.progress")
                if let description=current.description { PhoneSectionHeading(title:"目标说明");Text(description) }
                PhoneSectionHeading(title:"下一步")
                Text("打开来源对话，查看或调整下一步安排。").accessibilityIdentifier("goals.nextStep")
                PhoneSectionHeading(title:"相关安排与进展")
                ForEach(model.schedules.filter { current.scheduleIds?.contains($0.id) == true }) { schedule in
                    NavigationLink { scheduleDetail(schedule) } label: { PhoneFeatureRow(icon:"clock",title:schedule.text,subtitle:schedule.nextRunAt.map(phoneFeatureTime) ?? "暂无下次执行时间") }
                }
                ForEach(model.tasks.filter { $0.source.sessionId == current.source.sessionId }) { task($0) }
                Button("打开来源对话") { Task { await model.open(current.source,app:app,navigate:openConversation) } }.buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("goals.source")
                PhoneActionMenu {
                    if current.phase != "complete" { Button("标为完成") { goal(current,.complete) } }
                    Button("移出目标列表",role:.destructive) { archiving=current }
                } label: { Text("管理目标").frame(maxWidth:.infinity,minHeight:AppleTokens.Space.p44) }.buttonStyle(OutlineActionStyle()).disabled(model.busy.contains(row.id))
                if let error=model.errors["goals"] { InlineNotice(message:error,isError:true);Button("重试") { reload() } }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("目标详情").accessibilityIdentifier("goals.detail")
    }
    private func reload() { Task { await model.read("goals",app:app) } }
    private func manage(_ row: ManagedSchedule,_ action: ScheduleAction) {
        let epoch=app.accountEpoch,identity=app.phoneAccountIdentity,host=app.session?.hostId
        Task {
            await model.write(row.identity,page:"goals",app:app) { id in
                try await app.assistantClient.phoneManageSchedule(row,action:action,requestID:id)
                if epoch == app.accountEpoch,identity == app.phoneAccountIdentity,let host,host == app.session?.hostId { try app.phoneChat.withdrawComputerReminder(row,hostID:host,action:action) }
            }
        }
    }
    private func goal(_ row: PhoneGoal,_ action: PhoneGoalAction) { Task { await model.write(row.id,page:"goals",app:app) { id in try await app.assistantClient.phoneManageGoal(row,action:action,requestID:id) } } }
    private func task(_ row: PhoneTask) -> some View {
        VStack(spacing:0) {
            Button { Task { await model.open(row.source,app:app,navigate:openConversation) } } label: { PhoneFeatureRow(title:row.title,subtitle:PhoneFeaturePolicy.taskStatus(row.status)+" · "+row.step+" · "+row.conversationTitle) }.buttonStyle(.plain).accessibilityIdentifier("goals.task."+row.id)
            Divider()
        }
    }
}
struct PhonePageState: View {
    var loading: Bool; var error: String?; var empty: Bool; var title: String; var message: String; var retry: () -> Void
    var body: some View {
        if loading && empty { ProgressView("正在读取…").frame(maxWidth:.infinity).padding(AppleTokens.Space.p20) }
        else if let error { VStack { InlineNotice(message:error,isError:true); Button("重试",action:retry).buttonStyle(OutlineActionStyle()) }.phoneCard() }
        else if empty { EmptyState(symbol:"outputs",title:title,message:message).phoneCard() }
    }
}
func phoneFeatureTime(_ value: String) -> String {
    guard let date=HealthInputMath.parseISO(value) else { return "时间暂不可用" }
    let f=DateFormatter(); f.locale=Locale(identifier:"zh_CN"); f.dateFormat="M月d日 H:mm"
    if Calendar.current.isDateInToday(date) { f.dateFormat="今天 H:mm" }
    else if Calendar.current.isDateInYesterday(date) { f.dateFormat="昨天 H:mm" }
    return f.string(from:date)
}
