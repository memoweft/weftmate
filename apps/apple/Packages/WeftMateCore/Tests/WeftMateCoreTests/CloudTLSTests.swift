import Foundation
import Testing
@testable import WeftMateCore

@Suite struct CloudTLSTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["WEFTMATE_S1C_LIVE"] == "1"))
    func nativeTransportRequiresCAHostnameAndPairedSPKI() async throws {
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18765/tls-fixture")!)
        let fixture = try JSONSerialization.jsonObject(with: data) as! [String: String]
        let ca = Data(base64Encoded: fixture["ca"]!)!
        let pin = fixture["pin"]!
        let origin = "https://localhost:18766"
        let pins = HostPinStore(store: MemoryStore()); try pins.save(pin, for: origin)
        let transport = URLSessionTransport(testHostPins: pins, testAnchorDER: ca)
        let accepted = try await transport.send(URLRequest(url: URL(string: origin + "/content")!))
        #expect(accepted.status == 200)
        #expect(String(data: accepted.body, encoding: .utf8) == "synthetic pinned content")
        // Correct pin is insufficient when CA is not trusted.
        await #expect(throws: (any Error).self) { try await URLSessionTransport(hostPins: pins).send(URLRequest(url: URL(string: origin + "/content")!)) }
        let wrong = HostPinStore(store: MemoryStore()); try wrong.save(String(repeating: "b", count: 43), for: origin)
        await #expect(throws: (any Error).self) {
            try await URLSessionTransport(testHostPins: wrong, testAnchorDER: ca).send(URLRequest(url: URL(string: origin + "/content")!))
        }
        // Another leaf with the same hostname and trusted CA still fails the original host pin.
        let foreign = "https://localhost:18767"
        let foreignPins = HostPinStore(store: MemoryStore()); try foreignPins.save(pin, for: foreign)
        await #expect(throws: (any Error).self) {
            try await URLSessionTransport(testHostPins: foreignPins, testAnchorDER: ca).send(URLRequest(url: URL(string: foreign + "/content")!))
        }
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("s1c-transfer-" + UUID().uuidString)
        try Data("synthetic upload".utf8).write(to: temporary)
        defer { try? FileManager.default.removeItem(at: temporary) }
        await #expect(throws: (any Error).self) {
            try await URLSessionTransport(testHostPins: foreignPins, testAnchorDER: ca).upload(URLRequest(url: URL(string: foreign + "/content")!), file: temporary)
        }
        await #expect(throws: (any Error).self) {
            try await URLSessionTransport(testHostPins: foreignPins, testAnchorDER: ca).download(URLRequest(url: URL(string: foreign + "/content")!), to: temporary, maximumBytes: 1000)
        }
        // Same leaf/pin does not waive hostname validation.
        let wrongName = "https://127.0.0.1:18766"
        let namePins = HostPinStore(store: MemoryStore()); try namePins.save(pin, for: wrongName)
        await #expect(throws: (any Error).self) {
            try await URLSessionTransport(testHostPins: namePins, testAnchorDER: ca).send(URLRequest(url: URL(string: wrongName + "/content")!))
        }
    }
}
