#if DEBUG
import Foundation
import WeftMateCore

/// Only double-gated loopback XCTest/capture fixtures may supply an already approved
/// synthetic session, matching M3-A's test callback. Normal login/DPoP paths are unchanged.
enum A14TestSupport {
    static var driver: URL? {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("--ui-testing"), args.contains("--a5-local-server"),
              let index = args.firstIndex(of: "--a14-driver"), args.indices.contains(index + 1),
              let url = URL(string: args[index + 1]), url.scheme == "http", url.host == "127.0.0.1" else { return nil }
        return url
    }
    static func get(_ path: String) async throws -> Data {
        guard let driver else { throw APIFailure.notAuthenticated }
        let response = try await URLSessionTransport().send(URLRequest(url: driver.appendingPathComponent(path)))
        guard response.status == 200 else { throw APIFailure.server(status: response.status, code: "TEST_CONTROL_UNAVAILABLE") }
        return response.body
    }
}
struct A14ApprovedSessionTransport: HTTPTransport {
    let base: any HTTPTransport
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        guard request.url?.path == "/personal/v1/auth/login", request.url?.host == "127.0.0.1", A14TestSupport.driver != nil else { return try await base.send(request) }
        let bytes = try await A14TestSupport.get("session")
        let body = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
        return HTTPResponse(status: 200, headers: ["set-cookie": body["cookie"] as! String], body: bytes)
    }
}
#endif
