import SwiftUI
import WeftMateCore
import UniformTypeIdentifiers
import PDFKit

struct PhoneActivityView: View {
    @ObservedObject var app: AppleAppModel
    @StateObject private var model=PhoneFeaturesModel()
    @State private var selected: PhoneActivity?
    @State private var settings: String?
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                Picker("动态范围",selection:$model.filter) {
                    Text("全部").tag("all"); Text("未读").tag("unread"); Text("待处理").tag("actionable")
                }.pickerStyle(.segmented).accessibilityIdentifier("activity.filter")
                PhonePageState(loading:model.loading,error:model.errors["activity"],empty:model.activity.isEmpty,title:"还没有动态",message:"提醒、任务进展和每周回顾会出现在这里。") { Task { await model.read("activity",app:app) } }
                ForEach(model.activity) { item in
                    HStack(alignment:.top) {
                        Button { selected=item } label: {
                            VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                                HStack { if !item.read { Circle().fill(Weave.accent).frame(width:8,height:8) }; Text(item.title).font(AppleTokens.Fonts.headline); Spacer() }
                                Text(item.summary).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                                Text(phoneFeatureTime(item.at)+(item.state == "pending" ? " · 待处理" : "")).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                            }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("activity.row."+item.id)
                        Menu {
                            if !item.read { Button("标为已读") { Task { await mark(item) } } }
                            Button("查看详情") { selected=item }
                        } label: { WeftIcon("more").phoneMenuLabel(circle:true,onCard:true) }.accessibilityLabel("动态操作").disabled(model.busy.contains(item.id))
                    }.phoneCard()
                }
                if model.nextActivity != nil { Button("查看更多动态") { Task { await model.read("activity",app:app,more:true) } }.disabled(model.loading) }
                if let health=model.weekly?.health, let text=health["text"]?.string { VStack(alignment:.leading) { Text("这周的健康回顾").font(AppleTokens.Fonts.headline); Text(text) }.phoneCard() }
            }.padding(AppleTokens.Space.p16)
        }.background(Weave.canvas).navigationTitle("动态").toolbar { PhoneAccountMenu(model:app) }
            .task(id:app.accountEpoch) { model.prepare(app); selected=nil; await model.read("activity",app:app) }
            .refreshable { await model.read("activity",app:app) }
            .onChange(of:model.filter) { _,_ in Task { await model.read("activity",app:app) } }
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
                                        else if let session=source["sessionId"]?.string ?? source["source"]?["sessionId"]?.string { app.openedSessionID=session }
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
    private func mark(_ item: PhoneActivity) async {
        await model.write(item.id,page:"activity",app:app) { id in try await app.assistantClient.phoneMarkRead(item,requestID:id) }
    }
    private func actionTap(_ action: PhoneActivity.Action,_ item: PhoneActivity) async {
        switch action.kind {
        case "view_settings": selected=nil; settings=action.target.category ?? "devices"
        case "view_memory": selected=nil; settings="memory"
        case "view_library":
            app.phoneLibrarySelection=action.target.id ?? action.target.artifactId; selected=nil
        default: await model.open(action.target,app:app); selected=nil
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
    @StateObject private var model=PhoneFeaturesModel()
    @State private var deleting: ManagedSchedule?
    @State private var archiving: PhoneGoal?
    @State private var scheduleDetail: ManagedSchedule?
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                Text("进行中").font(AppleTokens.Fonts.title2)
                PhonePageState(loading:model.loading,error:model.errors["tasks"],empty:model.tasks.isEmpty,title:"现在没有进行中的任务",message:"在对话里交代一件事，这里会显示真实进展。") { reload() }
                ForEach(model.tasks) { row in task(row) }
                Text("定时任务与提醒").font(AppleTokens.Fonts.title2)
                PhonePageState(loading:model.loading,error:model.errors["schedules"],empty:model.schedules.isEmpty,title:"还没有定时任务",message:"在对话里告诉 WeftMate 想在什么时候做什么。") { reload() }
                ForEach(model.schedules) { row in
                    HStack(alignment:.top) {
                        Button { scheduleDetail=row } label: {
                            VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                                Text(row.text).font(AppleTokens.Fonts.headline)
                                Text(row.state == "paused" ? "已暂停" : row.nextRunAt.map { "下次 "+phoneFeatureTime($0) } ?? "已结束").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                            }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("goals.schedule."+row.id)
                        Button(row.state == "paused" ? "恢复" : "暂停") { manage(row,row.state == "paused" ? .resume : .pause) }.buttonStyle(OutlineActionStyle()).disabled(model.busy.contains(row.identity) || row.state == "completed")
                        Menu { Button("查看最近执行") { scheduleDetail=row }; Button("删除",role:.destructive) { deleting=row } } label: { WeftIcon("more").phoneMenuLabel(circle:true,onCard:true) }.accessibilityLabel("定时任务操作")
                    }.phoneCard()
                }
                Text("长期目标").font(AppleTokens.Fonts.title2)
                PhonePageState(loading:model.loading,error:model.errors["goals"],empty:model.goals.isEmpty,title:"还没有长期目标",message:"在对话中设立一个持续推进的目标。") { reload() }
                ForEach(model.goals) { row in
                    HStack(alignment:.top) {
                        Button { Task { await model.open(row.source,app:app) } } label: {
                            VStack(alignment:.leading,spacing:AppleTokens.Space.p8) { Text(row.title).font(AppleTokens.Fonts.headline); Text(PhoneFeaturePolicy.goalStatus(row.phase)+" · "+row.progress).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("goals.goal."+row.id)
                        Menu { Button("查看对话与执行") { Task { await model.open(row.source,app:app) } }; if row.phase != "complete" { Button("标为完成") { goal(row,.complete) } }; Button("移出目标列表",role:.destructive) { archiving=row } } label: { WeftIcon("more").phoneMenuLabel(circle:true,onCard:true) }.accessibilityLabel("长期目标操作").disabled(model.busy.contains(row.id))
                    }.phoneCard()
                }
                if !model.recent.isEmpty { Text("最近执行").font(AppleTokens.Fonts.title2); ForEach(model.recent.prefix(5)) { row in task(row) } }
            }.padding(AppleTokens.Space.p16)
        }.background(Weave.canvas).navigationTitle("目标").toolbar { PhoneAccountMenu(model:app) }
            .task(id:app.accountEpoch) { model.prepare(app); deleting=nil; archiving=nil; scheduleDetail=nil; await model.read("goals",app:app) }
            .refreshable { await model.read("goals",app:app) }
            .alert("删除这项定时任务？",isPresented:Binding(get:{deleting != nil},set:{if !$0 { deleting=nil }})) {
                Button("取消",role:.cancel) { deleting=nil }
                Button("删除",role:.destructive) { if let row=deleting { manage(row,.delete) }; deleting=nil }
            } message: { Text("以后不会再执行这项安排，原对话保留。") }
            .alert("移出目标列表？",isPresented:Binding(get:{archiving != nil},set:{if !$0 { archiving=nil }})) {
                Button("取消",role:.cancel) { archiving=nil }; Button("移出",role:.destructive) { if let row=archiving { goal(row,.archive) }; archiving=nil }
            } message: { Text("停止继续推进这个目标，原对话和执行记录保留。") }
            .sheet(item:$scheduleDetail) { row in
                NavigationStack {
                    ScrollView { VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                        Text(row.text).font(AppleTokens.Fonts.title2)
                        Text(row.state == "paused" ? "已暂停" : "已安排")
                        if let result=row.lastResult { Text("最近一次："+(result.state == "delivered" ? "提醒已送达" : PhoneFeaturePolicy.taskStatus(result.state))) }
                        ForEach(model.recent.filter { $0.source.sessionId == row.sessionId }.prefix(5)) { task($0) }
                        Button("打开来源对话") { app.openedSessionID=row.sessionId; scheduleDetail=nil }.buttonStyle(OutlineActionStyle())
                    }.padding(AppleTokens.Space.p20) }.phoneSheet("最近执行",close:{ scheduleDetail=nil })
                }
            }
    }
    private func reload() { Task { await model.read("goals",app:app) } }
    private func manage(_ row: ManagedSchedule,_ action: ScheduleAction) { Task { await model.write(row.identity,page:"goals",app:app) { id in try await app.assistantClient.phoneManageSchedule(row,action:action,requestID:id) } } }
    private func goal(_ row: PhoneGoal,_ action: PhoneGoalAction) { Task { await model.write(row.id,page:"goals",app:app) { id in try await app.assistantClient.phoneManageGoal(row,action:action,requestID:id) } } }
    private func task(_ row: PhoneTask) -> some View {
        Button { Task { await model.open(row.source,app:app) } } label: {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p8) { Text(row.title).font(AppleTokens.Fonts.headline); Text(PhoneFeaturePolicy.taskStatus(row.status)+" · "+row.step); Text(row.conversationTitle).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
        }.buttonStyle(.plain).phoneCard().accessibilityIdentifier("goals.task."+row.id)
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
