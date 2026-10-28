import Foundation
import Testing
@testable import WeftMateCore

struct AppleStorageProfileTests {
    @Test func candidateRelaunchKeepsDraftAndStorageIdentity() async throws {
        let launchedByXcode = AppleStorageProfile(bundleID: AppleStorageProfile.windowBundleID, uiTesting: true, testNamespace: "ignored")
        let launchedByOwner = AppleStorageProfile(bundleID: AppleStorageProfile.windowBundleID, uiTesting: false)
        #expect(launchedByXcode == launchedByOwner)
        let native = AppleStorageProfile(bundleID: "com.weftmate.apple.weftmatephone", uiTesting: false)
        #expect(launchedByOwner.credentials != native.credentials)
        #expect(launchedByOwner.cloud != native.cloud)
        #expect(launchedByOwner.stateSubdirectory != nil)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let first = try LocalConversationStore(directory: root.appendingPathComponent(launchedByXcode.stateSubdirectory!))
        let account = try LocalAccountScope(server: ServerConfiguration(input: "https://synthetic.example"), ownerId: "window-owner")
        _ = try await first.saveDraft(account: account, conversationId: "conversation:window", text: "合成原话草稿")
        let reopened = try LocalConversationStore(directory: root.appendingPathComponent(launchedByOwner.stateSubdirectory!))
        let draft = try await reopened.draft(account: account, conversationId: "conversation:window")
        #expect(draft?.text == "合成原话草稿")
        let other = try LocalConversationStore(directory: root.appendingPathComponent("native/LocalState"))
        let absent = try await other.draft(account: account, conversationId: "conversation:window")
        #expect(absent == nil)
    }

    @Test func nativeAndExistingUITestScopesKeepTheirIdentities() {
        let native = AppleStorageProfile(bundleID: "com.weftmate.apple.weftmatemac", uiTesting: false)
        #expect(native.preferencesSuite == nil)
        #expect(native.stateSubdirectory == nil)
        #expect(native.cloud == "com.weftmate.apple.cloud")
        let a = AppleStorageProfile(bundleID: nil, uiTesting: true, testNamespace: "a")
        let b = AppleStorageProfile(bundleID: nil, uiTesting: true, testNamespace: "b")
        #expect(a.cloud == "com.weftmate.apple.ui-tests.a.cloud")
        #expect(a.credentials != b.credentials)
        #expect(a.stateSubdirectory != b.stateSubdirectory)
    }
}

@Test func candidateUsesItsOwnDefaultsWithoutAnInvalidSelfNamedSuite() {
    let candidate = AppleStorageProfile(bundleID: AppleStorageProfile.windowBundleID, uiTesting: false)
    #expect(candidate.preferencesSuite == nil)
    #expect(candidate.credentials == AppleStorageProfile.windowBundleID + ".credentials")
    #expect(candidate.cloud == AppleStorageProfile.windowBundleID + ".cloud")
    #expect(candidate.stateSubdirectory == "WeftMate/WindowTest/LocalState")
}
