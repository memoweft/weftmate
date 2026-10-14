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
            print("PASS: \(count) phone reminder model behavior checks")
        } catch { print("FAIL: \(error)");exit(1) }
    }
}
