import AuthenticationServices
import WeftMateCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif

@MainActor
final class CloudBrowser: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    func open(_ authorization: CloudAuthorization, publicJwk: [String: String]) async throws -> URL {
        // The cloud browser must bind this installation's public JWK during its email-confirmed interaction.
        // S1a's current HTML form does not do so yet; no native password form bypass is provided.
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-testing"), let index = args.firstIndex(of: "--s1c-browser-driver"), args.indices.contains(index + 1),
           let base = URL(string: args[index + 1]), ["localhost", "127.0.0.1"].contains(base.host), base.scheme == "http" {
            var request = URLRequest(url: base); request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["authorizationURL": authorization.url.absoluteString, "publicJwk": publicJwk])
            let (bytes, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let json = try JSONSerialization.jsonObject(with: bytes) as? [String: String], let raw = json["callback"], let url = URL(string: raw) else {
                throw CloudLoginFailure.token
            }
            return url
        }
        #endif
        return try await withCheckedThrowingContinuation { continuation in
            let authentication = ASWebAuthenticationSession(url: authorization.url,
                callbackURLScheme: URL(string: authorization.configuration.redirectURI)?.scheme) { [weak self] url, error in
                Task { @MainActor in
                    self?.session = nil
                    if let url { continuation.resume(returning: url) }
                    else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        continuation.resume(throwing: CloudLoginFailure.browserCancelled)
                    } else { continuation.resume(throwing: CloudLoginFailure.callback) }
                }
            }
            authentication.presentationContextProvider = self
            authentication.prefersEphemeralWebBrowserSession = true
            session = authentication
            if !authentication.start() { session = nil; continuation.resume(throwing: CloudLoginFailure.callback) }
        }
    }
    func cancel() { session?.cancel() }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(macOS)
        NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
        #else
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        #endif
    }
}
