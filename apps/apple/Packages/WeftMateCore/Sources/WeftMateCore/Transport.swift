import Foundation
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
}

private final class RedirectRefuser: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}

public final class URLSessionTransport: HTTPTransport, Sendable {
    private let session: URLSession
    #if DEBUG
    private let developmentRoute: DevelopmentProxyRoute?
    #endif
    public init() {
        #if DEBUG
        developmentRoute = nil
        #endif
        session = URLSession(configuration: Self.standardConfiguration(), delegate: RedirectRefuser(), delegateQueue: nil)
    }
    private static func standardConfiguration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false; config.urlCache = nil
        config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = 30
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
    }
    #endif
    public func send(_ request: URLRequest) async throws -> HTTPResponse {
        #if DEBUG
        if let developmentRoute { try developmentRoute.validate(request.url) }
        #endif
        do {
            let (bytes, response) = try await session.bytes(for: request)
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
