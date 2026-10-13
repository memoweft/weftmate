import Testing
import Foundation
@testable import WeftMateCore

private actor ServiceHTTP: HTTPTransport {
    var requests:[URLRequest]=[]
    var missingStatus: Int?
    let serviceID="model-service-11111111-1111-4111-8111-111111111111"
    let cookie=Data((0..<32).map { _ in UInt8.random(in:0...255) }).base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")
    let csrf=Data((0..<32).map { _ in UInt8.random(in:0...255) }).base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")
    func old(_ status: Int) { missingStatus=status }
    func recorded() -> [URLRequest] { requests }
    func send(_ request: URLRequest) throws -> HTTPResponse {
        requests.append(request)
        let path=request.url?.path ?? ""
        func json(_ value:[String:Any],status: Int = 200,headers:[String:String]=[:]) throws -> HTTPResponse { .init(status:status,headers:headers,body:try JSONSerialization.data(withJSONObject:value)) }
        let auth:[String:Any]=["account":["ownerId":"owner-test","username":"tester","displayName":"Test"],"device":["id":"device-test","name":"Phone"],"csrfToken":csrf]
        if path.hasSuffix("/auth/login") { return try json(auth,headers:["set-cookie":"wm_personal_session="+cookie]) }
        if path.hasSuffix("/auth/me") { return try json(auth) }
        if path.hasSuffix("/status") { return try json(["ownerId":"owner-test","hostId":"host-test","backend":["capabilities":[:]]]) }
        guard path.contains("/model-services") else { throw APIFailure.invalidResponse }
        #expect(request.value(forHTTPHeaderField:"Cookie") == "wm_personal_session="+cookie)
        if request.httpMethod != "GET" { #expect(request.value(forHTTPHeaderField:"X-WeftMate-CSRF") == csrf) }
        if path == "/personal/v1/model-services",request.httpMethod == "GET",let missingStatus { return try json(["error":["code":"NOT_FOUND"]],status:missingStatus) }
        let service:[String:Any]=["serviceId":serviceID,"name":"Synthetic","baseUrl":"https://model.example.com/v1","interfaceType":"openai-compatible","revision":1,"models":[["modelId":"chat-a","name":"Chat A","enabled":true,"profileId":"profile-a"]],"selectedModelId":"chat-a","catalog":["status":"available","message":"已查到模型清单。"]]
        if path.hasSuffix("/check") { return try json(["status":"available","message":"已查到模型清单。","models":service["models"]!]) }
        if path.hasSuffix("/select") { return try json(["profileId":"profile-a","service":service,"models":[]]) }
        if request.httpMethod == "DELETE" { return try json(["removed":true]) }
        if path == "/personal/v1/model-services",request.httpMethod == "GET" { return try json(["services":[service],"canManage":true,"models":[],"modelSettings":["defaultModelProfileId":"profile-a"]]) }
        return try json(["service":service],status:request.httpMethod == "POST" && path == "/personal/v1/model-services" ? 201 : 200)
    }
}
@Suite struct ModelServiceSDKTests {
    private func login(_ http: ServiceHTTP) async throws -> PersonalClient {
        let client=PersonalClient(credentialStore:MemoryStore(),transport:http)
        _ = try await client.login(server:ServerConfiguration(input:"https://service.unit.example"),username:"tester",password:UUID().uuidString,deviceName:"Phone")
        return client
    }
    @Test func exactPathsCSRFRevisionAndActiveSessionSelection() async throws {
        let http=ServiceHTTP(),client=try await login(http),id=await http.serviceID
        let list=try #require(await client.modelServices());#expect(list.modelSettings?.defaultModelProfileId == "profile-a")
        _ = try await client.modelService(id:id)
        _ = try await client.checkModelService(baseUrl:"https://model.example.com/v1",apiKey:UUID().uuidString)
        let service=try await client.writeModelService(.init(name:"Synthetic",baseUrl:"https://model.example.com/v1",apiKey:UUID().uuidString))
        _ = try await client.writeModelService(.init(name:"Renamed",expectedRevision:service.revision),id:id)
        _ = try await client.refreshModelService(id:id)
        _ = try await client.selectServiceModel(serviceId:id,modelId:"chat-a",sessionId:"session-synthetic")
        try await client.removeModelService(service)
        let requests=await http.recorded().filter {$0.url?.path.contains("/model-services") == true}
        #expect(requests.count == 8)
        let selection=try #require(requests.first {$0.url?.path.hasSuffix("/select") == true})
        let body=try #require(selection.httpBody),fields=try #require(JSONSerialization.jsonObject(with:body) as? [String:Any])
        #expect(fields["modelId"] as? String == "chat-a");#expect(fields["sessionId"] as? String == "session-synthetic");#expect(fields["requestId"] != nil)
        let deletion=try #require(requests.first {$0.httpMethod == "DELETE"}),deleteBody=try #require(deletion.httpBody)
        #expect((try JSONSerialization.jsonObject(with:deleteBody) as? [String:Any])?["expectedRevision"] as? Int == 1)
    }
    @Test func onlyAbsentRouteFallsBackNetworkAndAuthRemainErrors() async throws {
        let http=ServiceHTTP(),client=try await login(http)
        await http.old(404);#expect(try await client.modelServices() == nil)
        await http.old(503);await #expect(throws:APIFailure.server(status:503,code:"NOT_FOUND")) { try await client.modelServices() }
        await http.old(401);await #expect(throws:APIFailure.server(status:401,code:"NOT_FOUND")) { try await client.modelServices() }
    }
}
