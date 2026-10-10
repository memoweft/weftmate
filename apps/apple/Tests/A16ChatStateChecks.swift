import Foundation
import WeftMateCore
private struct Failed: Error { let message:String }
private func require(_ condition:Bool,_ message:String)throws{if !condition{throw Failed(message:message)}}
private final class Credentials:CredentialStore,@unchecked Sendable {
    private let lock=NSLock();private var values:[String:Data]=[:]
    func load(key:String)->Data?{lock.withLock{values[key]}}
    func save(_ data:Data,key:String){lock.withLock{values[key]=data}}
    func delete(key:String){lock.withLock{values[key]=nil}}
}
private struct Drafts: AppleDraftPersisting {
    let store: LocalConversationStore
    func loadDrafts(account: LocalAccountScope) async throws -> [String: String] { try await store.loadDrafts(account: account) }
    func saveDraft(account: LocalAccountScope, conversationId: String, text: String) async throws { _ = try await store.saveDraft(account: account, conversationId: conversationId, text: text) }
}
private actor HTTP:HTTPTransport {
    var logical=false,reset=false,revision=1,pauseResources=false,expired=false,capabilityVersion=1
    var pause:CheckedContinuation<Void,Never>?
    var resourceCalls:[String]=[]
    func enable(){logical=true}
    func expire(){expired=true}
    func unsupported(){capabilityVersion=2;reset=true}
    func triggerReset(){reset=true;revision=2}
    func holdResources(){pauseResources=true}
    func release(){pause?.resume();pause=nil;pauseResources=false}
    func waiting()async{while pause==nil{await Task.yield()}}
    func calls()->[String]{resourceCalls}
    func send(_ request:URLRequest)async throws->HTTPResponse{
        let path=request.url!.path,query=request.url!.query ?? ""
        let auth:[String:Any]=["account":["ownerId":"owner-fixture","username":"tester","displayName":"Synthetic"],"device":["id":"device-fixture","name":"Fixture"],"csrfToken":String(repeating:"b",count:43)]
        var object:[String:Any]=[:],headers:[String:String]=[:]
        let chat:[String:Any]=["chatId":"chat-main","kind":"main","title":"WeftMate","activeSessionId":"session-fixture","timeZone":"UTC","revision":1,"contentRevision":revision,"running":false,"sendAvailable":true,"pinned":true,"archived":false,"unread":false]
        var temporary = chat; temporary["chatId"]="chat-temporary"; temporary["kind"]="side"; temporary["activeSessionId"]="session-temp"
        temporary["temporary"]=true; temporary["memoryMode"]="off"; temporary["hasTemporaryContent"]=true; temporary["recallEnabled"]=true; temporary["autoDeleteDays"]=1
        switch path{
        case "/personal/v1/auth/login":object=auth;headers["set-cookie"]="wm_personal_session="+String(repeating:"a",count:43)
        case "/personal/v1/auth/me":object=auth
        case "/personal/v1/status":object=["ownerId":"owner-fixture","hostId":"host-fixture","personalCapabilities":logical ? ["chats":capabilityVersion,"chatTimeline":1,"chatSearch":1,"chatResources":1]:[:]]
        case "/personal/v1/auth/devices":object=["devices":[["id":"device-fixture","name":"Fixture","current":true]]]
        case "/personal/v1/sync/capabilities":object=["deviceId":"device-fixture","platform":"macos","sharedConversations":1]
        case "/personal/v1/sync/events":object=["events":[],"nextSeq":0,"hasMore":false]
        case "/personal/v1/session-groups":object=["groups":[]]
        case "/personal/v1/sessions":object=["sessions":[["sessionId":"session-fixture","title":"Synthetic","running":false,"sendAvailable":true]]]
        case "/personal/v1/models":object=["models":[]]
        case "/personal/v1/projects":object=["projects":[],"canManage":false]
        case "/personal/v1/chats/main":object=["chat":chat]
        case "/personal/v1/chats":object=["items":expired ? []:[temporary],"hasMore":false]
        case "/personal/v1/chats/chat-temporary":object=["chat":temporary]
        case "/personal/v1/sessions/session-temp/events":
            if expired { return .init(status:404,body:Data("{\"error\":{\"code\":\"SESSION_UNAVAILABLE\"}}".utf8)) }
            object=["events":[],"nextSeq":-1,"hasMore":false,"cacheAllowed":false]
        case "/personal/v1/chats/chat-main/events":
            object=["items":[["eventId":"event-\(revision)","chatId":"chat-main","orderKey":"01","revision":revision,"type":"assistant.message","at":"2026-10-09T00:00:00Z","sourceRef":["kind":"native","hostId":"host-fixture","sessionId":"session-fixture","seq":1],"data":["text":revision==1 ? "合成旧正文":"合成新正文"]]],"hasOlder":false,"hasNewer":false,"syncCursor":"sync-\(revision)","contentRevision":revision,"indexState":"ready","timeZone":"UTC"]
        case "/personal/v1/chats/chat-main/changes":
            if reset{reset=false;return .init(status:409,headers:[:],body:try JSONSerialization.data(withJSONObject:["error":["code":"CURSOR_RESET_REQUIRED"]]))}
            object=["upserts":[],"removals":[],"nextCursor":"sync-next","hasMore":false,"contentRevision":revision,"indexState":"ready","timeZone":"UTC"]
        case "/personal/v1/chats/chat-main/dates":object=["days":[["date":"2026-10-09","count":1]],"contentRevision":revision,"indexState":"ready","timeZone":"UTC"]
        case "/personal/v1/chats/chat-main/search":object=["hits":[["eventId":"event-1","snippet":"合成旧正文","highlights":[["start":0,"end":2]]]],"hasMore":false,"contentRevision":revision,"indexState":"building","timeZone":"UTC"]
        case "/personal/v1/chats/chat-main/resources":
            let responseRevision=revision;resourceCalls.append(query)
            if pauseResources{await withCheckedContinuation{pause=$0}}
            let second=query.contains("cursor=resource-next")
            object=["outputs":second ? [["artifactId":"artifact-old","fileName":"合成旧资源"]]:[],"sources":[],"nextCursor":second ? NSNull():"resource-next","hasMore":!second,"contentRevision":responseRevision]
        default:throw APIFailure.invalidResponse
        }
        return .init(status:200,headers:headers,body:try JSONSerialization.data(withJSONObject:object))
    }
}
@main private struct A16ChatStateChecks {
    @MainActor static func main()async throws{
        let directory=URL(fileURLWithPath:CommandLine.arguments[1]),http=HTTP(),store=try LocalConversationStore(directory:directory)
        let app=AppleAppModel(client:PersonalClient(credentialStore:Credentials(),transport:http),draftPersistence:Drafts(store:store),server:try ServerConfiguration(input:"https://a16-state.unit.example"),commandStore:store,stateDirectory:directory)
        await app.authenticate(username:"tester",password:"synthetic-test-only",displayName:nil,register:false)
        await http.enable();let model=app.mainChat;await model.configure();await model.read(replace:true)
        try require(model.window.events.first?.text=="合成旧正文","Initial tail")
        model.query="合成";await model.search();try require(model.hits.count==1,"Search loaded")
        await model.loadResources();try require(model.resources.count==1,"Empty resource page did not advance")
        try require(await http.calls().contains{$0.contains("cursor=resource-next")},"Opaque next resource cursor")
        await http.holdResources();let old=Task{await model.loadResources()};await http.waiting()
        let generation=model.window.generation;await http.triggerReset();await model.changes()
        try require(model.window.generation != generation,"Reset generation")
        try require(model.resources.isEmpty && model.hits.isEmpty && model.query.isEmpty,"409 must clear resources/search before reread")
        try require(model.window.events.first?.text=="合成新正文","Fresh page after 409")
        await http.release();await old.value;try require(model.resources.isEmpty,"Old callback revived deleted resource")
        let state=TemporaryChatState(temporary:true,memoryMode:"off",hasTemporaryContent:true)
        let temporary=ConversationSummary(id:"temp",title:"临时对话",conversationId:nil,sessionId:"session-temp",running:false,sendAvailable:true,originalModelLabel:nil,temporaryState:state)
        app.setDraft("合成临时草稿",for:temporary,accountEpoch:app.accountEpoch)
        let account=try LocalAccountScope(server:app.session!.server,ownerId:app.session!.account.ownerId)
        try require(try await store.draft(account:account,conversationId:AppleAppModel.draftKey(for:temporary))==nil,"Temporary draft became offline cache")
        await app.refresh()
        guard let expiredRow = app.conversations.first(where: { $0.chatId == "chat-temporary" }) else { throw Failed(message: "Temporary live projection") }
        await app.open(expiredRow); app.setDraft("合成到期草稿", for: expiredRow, accountEpoch: app.accountEpoch)
        await http.expire(); await app.open(expiredRow)
        try require(app.messages.isEmpty && app.timeline.events.isEmpty && app.draftText(for: expiredRow, accountEpoch: app.accountEpoch).isEmpty, "404 did not clear native display/draft cache")
        try require(!app.conversations.contains { $0.id == expiredRow.id }, "Expired row remained visible")
        await http.unsupported(); await model.changes()
        try require(model.chat == nil && !app.conversations.contains(where: \.isMainChat), "Unknown version did not return to legacy session list after reset")
        print("PASS A16: unknown-version legacy fallback; expired 404 display/draft cleanup; reset ordering, stale callback, resource empty-page cursor, temporary draft isolation")
    }
}
