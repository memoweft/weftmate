import Foundation
import WeftMateCore

@main struct PhoneReminderModelChecks {
    @MainActor static func main() async {
        do {
            let app=AppleAppModel(directory:URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true))
            let keys=PhoneCheckCredentials(),model=PhoneStandaloneModel(testCredentials:keys,testLoopback:false)
            var count=0
            func require(_ value: Bool,_ name: String) throws { if !value { throw NSError(domain:name,code:1) };count += 1 }
            model.activate(app:app)
            model.draft="2 分钟后提醒我 喝水";model.send()
            try require(model.reminders.count == 1 && !model.busy,"creates-without-model-or-computer")
            try require(model.messages.map(\.role) == ["user","assistant"],"records-source-chat")
            let row=model.reminders[0]
            try require(row.sessionID == model.state.selected && row.text == "喝水","source-route")
            try model.saveReminder(id:row.id,text:"温水",date:row.fireAt.addingTimeInterval(300))
            try require(model.reminders.count == 1 && model.reminders[0].fireAt == row.fireAt.addingTimeInterval(300),"edits-stable-id")
            let restored=PhoneStandaloneModel(testCredentials:keys,testLoopback:false);restored.activate(app:app)
            try require(restored.reminders == model.reminders,"restart-restores-reminders")
            try model.finishReminder(row.id,delete:false)
            try require(model.reminders[0].completed,"complete")
            try model.finishReminder(row.id,delete:true);try require(model.reminders.isEmpty,"delete")
            app.cloudLogin.subject="account-b";restored.activate(app:app)
            try require(restored.reminders.isEmpty,"account-switch-isolates")
            app.cloudLogin.subject="account-a";restored.activate(app:app)
            try require(restored.reminders.isEmpty,"deletion-persists")
            let data=try JSONSerialization.data(withJSONObject:["items":[["id":"r","sessionId":"s","text":"合成电脑提醒","kind":"reminder","state":"scheduled","timeZone":"UTC","nextRunAt":"2027-01-01T09:00:00Z"]]])
            let rows=try JSONDecoder().decode(ScheduleList.self,from:data).items
            let first=model.beginReminderRead(hostID:"host")
            try require(model.receiveReminders(rows,hostID:"host",read:first),"computer-snapshot-saved")
            let sealed=try PhoneChatStore(account:app.phoneAccountIdentity,directory:app.healthStateDirectory.deletingLastPathComponent().appendingPathComponent("PhoneChats"),credentials:keys)
            let before=try Data(contentsOf:sealed.file)
            let unchanged=model.beginReminderRead(hostID:"host")
            let accepted=try model.receiveReminders(rows,hostID:"host",read:unchanged)
            let after=try Data(contentsOf:sealed.file)
            try require(accepted && after == before,"unchanged-read-does-not-reencrypt-the-entire-chat-store")
            let stale=model.beginReminderRead(hostID:"host")
            try model.withdrawComputerReminder(rows[0],hostID:"host",action:.pause)
            try require(!model.receiveReminders(rows,hostID:"host",read:stale) && model.allReminders.isEmpty,"late-response-cannot-resurrect-paused-reminder")
            let rebooted=PhoneStandaloneModel(testCredentials:keys,testLoopback:false);rebooted.activate(app:app)
            try require(rebooted.allReminders.isEmpty && rebooted.reminderCancellations == model.reminderCancellations,"withdrawal-and-cancellation-survive-restart")
            let oldIDs=Set(model.reminderCancellations.map(\.id))
            try model.withdrawComputerReminder(rows[0],hostID:"host",action:.delete)
            try model.acknowledgeReminderCancellations(oldIDs)
            try require(model.reminderCancellations.count == 1,"older-reconciliation-does-not-clear-new-deletion")
            try require(model.pausedReminderCancellations.isEmpty,"delete-clears-current-pause-suppression")
            print("PASS: \(count) phone reminder model behavior checks")
        } catch { print("FAIL: \(error)");exit(1) }
    }
}
