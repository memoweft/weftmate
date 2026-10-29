import SwiftUI
import WeftMateCore

struct PhoneLocalRemindersView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var phone: PhoneStandaloneModel
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text("电脑不在线，也能准时提醒。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                PhoneLocalRemindersSection(app:app,phone:phone)
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.grouped).navigationTitle("手机提醒").navigationBarTitleDisplayMode(.large)
            .accessibilityIdentifier("reminders.page")
    }
}

func phoneReminderTime(_ date: Date) -> String {
    date.formatted(.dateTime.month().day().hour().minute().locale(Locale(identifier:"zh_CN")))
}

struct PhoneLocalRemindersSection: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var phone: PhoneStandaloneModel
    @ObservedObject private var notifications=PhoneReminderNotifications.shared
    @Environment(\.phoneOpenConversation) private var openConversation
    @State private var editing: LocalReminder?
    @State private var creating=false
    @State private var deleting: LocalReminder?
    @State private var detail: LocalReminder?
    @State private var error: String?
    var body: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
            Text(notifications.notificationsEnabled ? "通知已开启" : "通知未开启").font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
            if !notifications.notificationsEnabled {
                Text("没开通知，到点不会弹。请在 iPhone 设置 → 通知 → WeftMate 中开启。").font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted).accessibilityIdentifier("reminders.permission")
                Button(notifications.denied ? "去系统设置" : "开启通知") {
                    if notifications.denied { if let url=URL(string:UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) } }
                    else { Task { await notifications.requestPermission() } }
                }.buttonStyle(OutlineActionStyle())
            }
            if let notice=notifications.deliveryNotice { Text(notice).foregroundStyle(Weave.muted) }
            if phone.allReminders.filter({!$0.completed && $0.fireAt > Date()}).count > 64 {
                Text("先安排最近的提醒；打开 App 时会继续补上后面的提醒。").font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
            }
            if phone.reminders.isEmpty { Text("告诉我“明天 9 点提醒我喝水”，也可以在这里新建。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted) }
            PhoneRowGroup {
            ForEach(phone.reminders.sorted { $0.fireAt < $1.fireAt }) { row in
                HStack(alignment:.top) {
                    Button { detail=row } label: {
                        VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                            Text(row.text).font(AppleTokens.Fonts.headline)
                            Text((row.completed ? "已完成 · " : "")+phoneReminderTime(row.fireAt)).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("reminders.row."+row.id)
                    PhoneActionMenu {
                        Button("修改") { editing=row }
                        if !row.completed { Button("标为完成") { finish(row,delete:false) } }
                        Button("删除",role:.destructive) { deleting=row }
                    } label: { WeftIcon("more").phoneMenuLabel(circle:true,onCard:true) }.accessibilityLabel("提醒操作")
                }.padding(.vertical,AppleTokens.Space.p12)
                Divider()
            }
            }
            Button { creating=true } label: { Text("新建提醒").frame(maxWidth:.infinity) }.buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("reminders.new")
            Text("提醒按手机当地时间显示："+TimeZone.current.identifier).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            if let error { Text(error).foregroundStyle(Weave.muted) }
        }
        .sheet(isPresented:$creating) { PhoneReminderEditor(phone:phone,row:nil,close:{creating=false}) }
        .sheet(item:$editing) { row in PhoneReminderEditor(phone:phone,row:row,close:{editing=nil}) }
        .sheet(item:$detail) { row in
            NavigationStack {
                VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                    Text(row.text).font(AppleTokens.Fonts.title2)
                    Text(row.fireAt.formatted(date:.abbreviated,time:.shortened))
                    if row.hostID == nil,let id=row.sessionID,phone.state.threads.contains(where:{$0.id == id}) {
                        Button("打开来源对话") { phone.select(id);app.openedSessionID=id;openConversation?(id);detail=nil }.buttonStyle(OutlineActionStyle())
                    } else if row.hostID != nil { Text("连上这条提醒所属的电脑后，可以打开原对话或修改。") }
                }.padding(AppleTokens.Space.p20).frame(maxWidth:.infinity,alignment:.leading).phoneSheet("提醒",close:{detail=nil})
            }
        }
        .alert("删除这条提醒？",isPresented:Binding(get:{deleting != nil},set:{if !$0 {deleting=nil}})) {
            Button("取消",role:.cancel) { deleting=nil }
            Button("删除",role:.destructive) { if let row=deleting { finish(row,delete:true) };deleting=nil }
        } message: { Text("到点不会再提醒，原对话保留。") }
        .onChange(of:notifications.openedReminder) { _,route in locate(route) }
        .onAppear { locate(notifications.openedReminder) }
    }
    private func locate(_ route: ReminderRoute?) {
        guard let route,!notifications.opensConversation else { return }
        detail=phone.allReminders.first { $0.id == route.reminderID && $0.hostID == route.hostID }
        if detail == nil { error="这条提醒已删除或完成，可以在这里查看其他提醒。" }
        notifications.openedReminder=nil
    }
    private func finish(_ row: LocalReminder,delete: Bool) {
        do { try phone.finishReminder(row.id,delete:delete);error=nil }
        catch { self.error="提醒没能更新，请重试。" }
    }
}
private struct PhoneReminderEditor: View {
    @ObservedObject var phone: PhoneStandaloneModel
    let row: LocalReminder?
    let close: () -> Void
    @State private var text: String
    @State private var date: Date
    @State private var error: String?
    init(phone: PhoneStandaloneModel,row: LocalReminder?,close: @escaping () -> Void) {
        self.phone=phone;self.row=row;self.close=close;_text=State(initialValue:row?.text ?? "");_date=State(initialValue:row?.fireAt ?? Date().addingTimeInterval(120))
    }
    var body: some View {
        NavigationStack {
            Form {
                TextField("提醒内容",text:$text).accessibilityIdentifier("reminders.text")
                DatePicker("提醒时间",selection:$date,in:Date()...,displayedComponents:[.date,.hourAndMinute]).accessibilityIdentifier("reminders.time")
                Text("按手机当地时间保存："+TimeZone.current.identifier).font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
                if let error { Text(error) }
                Button("保存") {
                    do { try phone.saveReminder(id:row?.id,text:text.trimmingCharacters(in:.whitespacesAndNewlines),date:date);close() }
                    catch { self.error="提醒没能保存，请检查手机存储后重试。" }
                }.buttonStyle(PrimaryActionStyle()).disabled(text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || date <= Date()).accessibilityIdentifier("reminders.save")
            }.phoneSheet(row == nil ? "新建提醒" : "修改提醒",close:close)
        }
    }
}
