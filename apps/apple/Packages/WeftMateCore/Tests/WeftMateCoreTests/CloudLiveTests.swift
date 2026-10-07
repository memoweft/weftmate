import Foundation
import Testing
@testable import WeftMateCore

@Suite struct CloudLiveTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["WEFTMATE_S1C_LIVE"] == "1"))
    @MainActor func actualCloudCodeRefreshDPoPAndHostApproval() async throws {
        let driver = "http://127.0.0.1:18765"
        let (bytes, _) = try await URLSession.shared.data(from: URL(string: driver + "/ready")!)
        let ready = try JSONSerialization.jsonObject(with: bytes) as! [String: String]
        let key = try CloudDeviceKey(softwareStore: MemoryStore())
        let configuration = CloudConfiguration(server: try ServerConfiguration(input: ready["cloud"]!, allowLoopbackHTTP: true))
        let cloud = CloudAccountClient(configuration: configuration, key: key, store: MemoryStore())
        try await cloud.authorize(hostID: ready["hostId"]) { authorization, publicJwk in
            var request = URLRequest(url: URL(string: driver + "/browser")!); request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["authorizationURL": authorization.url.absoluteString, "publicJwk": publicJwk])
            let (data, response) = try await URLSession.shared.data(for: request)
            #expect((response as? HTTPURLResponse)?.statusCode == 200)
            let fields = try JSONSerialization.jsonObject(with: data) as! [String: String]
            return URL(string: fields["callback"]!)!
        }
        let token = try await cloud.accessToken(hostID: ready["hostId"]!)
        let host = PersonalClient(credentialStore: MemoryStore())
        let server = try ServerConfiguration(input: ready["host"]!, allowLoopbackHTTP: true)
        let pending = try await host.exchangeCloudSession(server: server, hostID: ready["hostId"]!, accessToken: token, deviceName: "Mac · synthetic live test", key: key)
        guard case .pending = pending else { Issue.record("New key bypassed approval"); return }
        #expect(await host.currentSession() == nil)
        var decision = URLRequest(url: URL(string: driver + "/decision")!); decision.httpMethod = "POST"
        decision.httpBody = Data("{\"decision\":\"allow\"}".utf8)
        decision.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (_, response) = try await URLSession.shared.data(for: decision)
        #expect((response as? HTTPURLResponse)?.statusCode == 200)
        let accepted = try await host.exchangeCloudSession(server: server, hostID: ready["hostId"]!, accessToken: token, deviceName: "Mac · synthetic live test", key: key)
        guard case .authenticated = accepted else { Issue.record("Approved key could not enter"); return }
        #expect(try await host.conversations().contains { $0.title == "Synthetic cloud conversation" })
        try await cloud.forget(); try await host.logout()
    }
}
