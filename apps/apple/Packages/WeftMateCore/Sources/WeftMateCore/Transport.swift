import Foundation

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
    public init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false; config.urlCache = nil
        config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = 30
        session = URLSession(configuration: config, delegate: RedirectRefuser(), delegateQueue: nil)
    }
    public func send(_ request: URLRequest) async throws -> HTTPResponse {
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
