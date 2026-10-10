import Foundation
import Security
#if DEBUG
import Network
#endif

public struct HTTPResponse: Sendable {
    public let status: Int
    public let headers: [String: String]
    public let body: Data
    public init(status: Int, headers: [String: String] = [:], body: Data) {
        self.status = status; self.headers = headers; self.body = body
    }
}

public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> HTTPResponse
    func upload(_ request: URLRequest, file: URL) async throws -> HTTPResponse
    func download(_ request: URLRequest, to file: URL, maximumBytes: Int) async throws -> HTTPResponse
}

extension HTTPTransport {
    public func upload(_ request: URLRequest, file: URL) async throws -> HTTPResponse {
        var request = request; request.httpBody = try Data(contentsOf: file)
        return try await send(request)
    }
    public func download(_ request: URLRequest, to file: URL, maximumBytes: Int) async throws -> HTTPResponse {
        let response = try await send(request)
        guard response.body.count <= maximumBytes else { throw APIFailure.responseTooLarge }
        if (200...299).contains(response.status) { try response.body.write(to: file) }
        return response
    }
}

private final class RedirectRefuser: NSObject, URLSessionTaskDelegate, Sendable {
    let pins: HostPinStore
    #if DEBUG
    let testAnchor: Data?
    init(pins: HostPinStore = HostPinStore(), testAnchor: Data? = nil) { self.pins = pins; self.testAnchor = testAnchor }
    #else
    init(pins: HostPinStore = HostPinStore()) { self.pins = pins }
    #endif
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else {
            completionHandler(.performDefaultHandling, nil); return
        }
        let space = challenge.protectionSpace
        let origin = "https://" + space.host.lowercased() + (space.port == 443 ? "" : ":\(space.port)")
        do {
            guard let expected = try pins.pin(for: origin) else { completionHandler(.performDefaultHandling, nil); return }
            guard let trust = space.serverTrust else { completionHandler(.cancelAuthenticationChallenge, nil); return }
            #if DEBUG
            if let testAnchor, let anchor = SecCertificateCreateWithData(nil, testAnchor as CFData) {
                SecTrustSetAnchorCertificates(trust, [anchor] as CFArray)
                SecTrustSetAnchorCertificatesOnly(trust, true)
            }
            #endif
            guard SecTrustEvaluateWithError(trust, nil), let key = SecTrustCopyKey(trust),
                  try HostPinStore.spkiFingerprint(key) == expected else {
                completionHandler(.cancelAuthenticationChallenge, nil); return
            }
            completionHandler(.useCredential, URLCredential(trust: trust))
        } catch { completionHandler(.cancelAuthenticationChallenge, nil) }
    }
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}

public final class URLSessionTransport: HTTPTransport, Sendable {
    private let session: URLSession
    private let transferSession: URLSession
    #if DEBUG
    private let developmentRoute: DevelopmentProxyRoute?
    #endif
    public init(hostPins: HostPinStore = HostPinStore()) {
        #if DEBUG
        developmentRoute = nil
        #endif
        session = URLSession(configuration: Self.standardConfiguration(), delegate: RedirectRefuser(pins: hostPins), delegateQueue: nil)
        transferSession = URLSession(configuration: Self.standardConfiguration(fileTransfer: true), delegate: RedirectRefuser(pins: hostPins), delegateQueue: nil)
    }
    #if DEBUG
    /// Internal XCTest-only CA anchor. No system trust changes; normal CA/domain evaluation still runs.
    init(testHostPins: HostPinStore, testAnchorDER: Data) {
        developmentRoute = nil
        session = URLSession(configuration: Self.standardConfiguration(), delegate: RedirectRefuser(pins: testHostPins, testAnchor: testAnchorDER), delegateQueue: nil)
        transferSession = URLSession(configuration: Self.standardConfiguration(fileTransfer: true), delegate: RedirectRefuser(pins: testHostPins, testAnchor: testAnchorDER), delegateQueue: nil)
    }
    #endif
    private static func standardConfiguration(fileTransfer: Bool = false) -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false; config.urlCache = nil
        if !fileTransfer { config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = 30 }
        return config
    }
    #if DEBUG
    /// Explicit, temporary development routing. CONNECT carries the original end-to-end TLS stream.
    /// Default/release sessions never install this override or read a proxy option from preferences.
    public init(developmentProxyPort: Int) throws {
        let route = try DevelopmentProxyRoute(port: developmentProxyPort)
        let config = Self.standardConfiguration()
        var proxy = ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1",
            port: NWEndpoint.Port(rawValue: UInt16(route.port))!))
        proxy.allowFailover = false
        proxy.matchDomains = ["home.weftmate.com"]
        config.proxyConfigurations = [proxy]
        developmentRoute = route
        session = URLSession(configuration: config, delegate: RedirectRefuser(), delegateQueue: nil)
        let transferConfig = Self.standardConfiguration(fileTransfer: true)
        transferConfig.proxyConfigurations = [proxy]
        transferSession = URLSession(configuration: transferConfig, delegate: RedirectRefuser(), delegateQueue: nil)
    }
    #endif
    public func upload(_ request: URLRequest, file: URL) async throws -> HTTPResponse {
        #if DEBUG
        if let developmentRoute { try developmentRoute.validate(request.url) }
        #endif
        let (data, response) = try await transferSession.upload(for: request, fromFile: file)
        guard let http = response as? HTTPURLResponse else { throw APIFailure.invalidResponse }
        guard data.count <= 1_048_576 else { throw APIFailure.responseTooLarge }
        return .init(status: http.statusCode, headers: Self.headers(http), body: data)
    }
    public func download(_ request: URLRequest, to file: URL, maximumBytes: Int) async throws -> HTTPResponse {
        #if DEBUG
        if let developmentRoute { try developmentRoute.validate(request.url) }
        #endif
        let (bytes, response) = try await transferSession.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIFailure.invalidResponse }
        guard !(300...399).contains(http.statusCode) else { throw APIFailure.transport(.redirect) }
        guard (200...299).contains(http.statusCode) else {
            var error = Data()
            for try await byte in bytes { guard error.count < 1_048_576 else { throw APIFailure.responseTooLarge }; error.append(byte) }
            return .init(status: http.statusCode, headers: Self.headers(http), body: error)
        }
        guard response.expectedContentLength <= maximumBytes else { throw APIFailure.responseTooLarge }
        FileManager.default.createFile(atPath: file.path, contents: nil)
        let output = try FileHandle(forWritingTo: file)
        var success = false
        defer { try? output.close(); if !success { try? FileManager.default.removeItem(at: file) } }
        var buffer = Data(), count = 0
        for try await byte in bytes {
            guard count < maximumBytes else { throw APIFailure.responseTooLarge }
            count += 1; buffer.append(byte)
            if buffer.count == 65_536 { try output.write(contentsOf: buffer); buffer.removeAll(keepingCapacity: true) }
        }
        try output.write(contentsOf: buffer); success = true
        return .init(status: http.statusCode, headers: Self.headers(http), body: Data())
    }
    private static func headers(_ http: HTTPURLResponse) -> [String: String] {
        var headers: [String: String] = [:]
        for (key, value) in http.allHeaderFields { headers[String(describing: key).lowercased()] = String(describing: value) }
        return headers
    }
    public func send(_ request: URLRequest) async throws -> HTTPResponse {
        #if DEBUG
        if let developmentRoute { try developmentRoute.validate(request.url) }
        #endif
        do {
            let (bytes, response) = try await (request.timeoutInterval > 60 ? transferSession : session).bytes(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIFailure.invalidResponse }
            if (300...399).contains(http.statusCode) { throw APIFailure.transport(.redirect) }
            if response.expectedContentLength > 1_048_576 { throw APIFailure.responseTooLarge }
            var data = Data()
            for try await byte in bytes {
                guard data.count < 1_048_576 else { throw APIFailure.responseTooLarge }
                data.append(byte)
            }
            var headers: [String: String] = [:]
            for (key, value) in http.allHeaderFields { headers[String(describing: key).lowercased()] = String(describing: value) }
            return HTTPResponse(status: http.statusCode, headers: headers, body: data)
        } catch let error as APIFailure { throw error }
        catch let error as URLError {
            switch error.code {
            case .timedOut: throw APIFailure.transport(.timeout)
            case .cancelled: throw APIFailure.transport(.cancelled)
            case .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot,
                 .serverCertificateNotYetValid, .secureConnectionFailed: throw APIFailure.transport(.certificate)
            default: throw APIFailure.transport(.unavailable)
            }
        } catch { throw APIFailure.transport(.unavailable) }
    }
}

#if DEBUG
struct DevelopmentProxyRoute: Sendable {
    let port: Int
    init(port: Int) throws {
        guard (1024...65535).contains(port) else { throw APIFailure.invalidServer }
        self.port = port
    }
    func validate(_ url: URL?) throws {
        guard let url, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https", parts.host?.lowercased() == "home.weftmate.com",
              parts.port == 8443, parts.user == nil, parts.password == nil, parts.fragment == nil else {
            throw APIFailure.invalidServer
        }
    }
}
#endif
