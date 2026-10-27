import Foundation
import WeftMateCore

private struct Failure: Error { let text: String }
private struct Drafts: AppleDraftPersisting {
    let store: LocalConversationStore
    func loadDrafts(account: LocalAccountScope) async throws -> [String:String] { try await store.loadDrafts(account:account) }
    func saveDraft(account: LocalAccountScope, conversationId: String, text: String) async throws { _ = try await store.saveDraft(account:account,conversationId:conversationId,text:text) }
}
@main private struct Mode2IFixStateChecks {
    @MainActor static func make(_ directory: URL) async throws -> (AppleAppModel,Mode2ITransport) {
        let transport=Mode2ITransport(),store=try LocalConversationStore(directory:directory)
        let app=AppleAppModel(client:PersonalClient(credentialStore:Mode2IKeys(),transport:transport),draftPersistence:Drafts(store:store),server:try ServerConfiguration(input:"https://a2-ui.unit.example"),commandStore:store,stateDirectory:directory)
        await app.authenticate(username:"synthetic",password:"synthetic-only",displayName:nil,register:false)
        await app.mainChat.configure()
        return (app,transport)
    }
    @MainActor static func main() async throws {
        let directory=URL(fileURLWithPath:CommandLine.arguments[1]);var failures:[String]=[]
        do {
            let (app,transport)=try await make(directory.appendingPathComponent("creation"))
            await transport.loseNextCreation(beforeAccept:true)
            await app.mainChat.createSide(fresh:true)
            guard app.mainChat.pending != nil else { throw Failure(text:"Fixture did not retain uncertain creation") }
            // Recreate the actual model to prove the journal does not wedge creation after restart.
            let restarted=MainChatModel(app:app);await restarted.configure();restarted.restoreRequest()
            await restarted.createSide(fresh:true)
            guard restarted.pending == nil,app.openedSessionID != nil else { throw Failure(text:"Original creation blocks retry after confirmed missing lookup") }
            let (acceptedApp,acceptedTransport)=try await make(directory.appendingPathComponent("accepted-creation"))
            await acceptedTransport.loseNextCreation(beforeAccept:false)
            await acceptedApp.mainChat.createSide(fresh:true)
            let original=acceptedApp.mainChat.pending?["requestId"]?.string
            let acceptedRestart=MainChatModel(app:acceptedApp);await acceptedRestart.configure();acceptedRestart.restoreRequest()
            await acceptedRestart.createSide(fresh:true)
            let posts=await acceptedTransport.recorded().filter { $0.httpMethod == "POST" && $0.url?.path.hasSuffix("/commands") == true }
            guard original != nil,posts.count == 1,acceptedApp.openedSessionID != nil,acceptedRestart.pending == nil else { throw Failure(text:"Accepted creation was duplicated instead of reconciled") }
            print("PASS FIX-2 creation missing/accepted lookup and original retry after restart")
        } catch { failures.append("FIX-2: \(error)");print("FAIL FIX-2: \(error)") }
        do {
            let (app,transport)=try await make(directory.appendingPathComponent("chat-first-message"))
            await app.mainChat.createSide(fresh:true)
            guard let id=app.openedSessionID,let row=app.conversations.first(where:{$0.id == id}) else { throw Failure(text:"No new chat") }
            await app.open(row)
            app.setDraft("创建一个文件夹叫 她",for:row,accountEpoch:app.accountEpoch)
            await app.send(row,accountEpoch:app.accountEpoch)
            let posts=await transport.recorded().filter { $0.httpMethod == "POST" && $0.url?.path.hasSuffix("/commands") == true }
            let bodies=try posts.map { try JSONDecoder().decode(JSONValue.self,from:$0.httpBody!) }
            guard bodies.contains(where:{$0["kind"]?.string == "chat.message" && $0["text"]?.string == "创建一个文件夹叫 她"}),
                  !bodies.contains(where:{$0["kind"]?.string == "session.message"}),
                  app.draftText(for:row,accountEpoch:app.accountEpoch).isEmpty else { throw Failure(text:"Chat did not complete through the logical message channel") }
            print("PASS IOS-WORK-TURN first chat phrase uses chat.message only")
        } catch { failures.append("chat route: \(error)");print("FAIL chat route: \(error)") }
        do {
            let (app,_)=try await make(directory.appendingPathComponent("attachments"))
            let first=MainChatModel(app:app,chatID:"main");await first.configure()
            let file=directory.appendingPathComponent("synthetic-draft.txt");try Data("synthetic attachment bytes".utf8).write(to:file)
            first.addFiles([file]);let id=first.attachments.first!.id,bytes=try Data(contentsOf:first.attachments.first!.file)
            let other=MainChatModel(app:app,chatID:"side");await other.configure()
            guard other.attachments.isEmpty else { throw Failure(text:"Attachment crossed conversations") }
            let returned=MainChatModel(app:app,chatID:"main");await returned.configure()
            guard returned.attachments.first?.id == id,let restored=returned.attachments.first,try Data(contentsOf:restored.file) == bytes else { throw Failure(text:"Unsent attachment vanished on conversation return") }
            print("PASS FIX-3 attachment identity and bytes survive conversation switch")
        } catch { failures.append("FIX-3: \(error)");print("FAIL FIX-3: \(error)") }
        if !failures.isEmpty { throw Failure(text:failures.joined(separator:"; ")) }
    }
}
