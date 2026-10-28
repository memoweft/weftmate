import Foundation

/// The installed candidate keeps its identity when launched from the Home Screen.
public struct AppleStorageProfile: Equatable, Sendable {
    public static let windowBundleID = "com.weftmate.apple.windowtest"
    public let isWindowTest: Bool
    public let preferencesSuite: String?
    public let credentials: String
    public let cloud: String
    public let stateSubdirectory: String?

    public init(bundleID: String?, uiTesting: Bool, testNamespace: String = "default") {
        isWindowTest = bundleID == Self.windowBundleID
        if isWindowTest {
            // Standard defaults already use this app's independent bundle domain.
            // Foundation forbids passing the current bundle identifier as a suite name.
            preferencesSuite = nil
            credentials = Self.windowBundleID + ".credentials"
            cloud = Self.windowBundleID + ".cloud"
            stateSubdirectory = "WeftMate/WindowTest/LocalState"
        } else if uiTesting {
            let service = "com.weftmate.apple.ui-tests." + testNamespace
            preferencesSuite = service
            credentials = service + ".credentials"
            cloud = service + ".cloud"
            stateSubdirectory = "WeftMate/UITests/" + testNamespace + "/LocalState"
        } else {
            preferencesSuite = nil
            credentials = "com.weftmate.apple.credentials"
            cloud = "com.weftmate.apple.cloud"
            stateSubdirectory = nil
        }
    }
}
