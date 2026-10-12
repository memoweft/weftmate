import Foundation

/// One policy for main chat and side chats; keyboard and focus transitions are independent.
public struct PhoneComposerState: Equatable, Sendable {
    public var focused: Bool
    public var draft: String
    public var attachmentCount: Int
    public var keyboardVisible: Bool
    public var reduceMotion: Bool
    public init(focused: Bool = false, draft: String = "", attachmentCount: Int = 0, keyboardVisible: Bool = false, reduceMotion: Bool = false) {
        self.focused = focused; self.draft = draft; self.attachmentCount = attachmentCount
        self.keyboardVisible = keyboardVisible; self.reduceMotion = reduceMotion
    }
    public var expanded: Bool { focused || !draft.isEmpty || attachmentCount > 0 }
    public var showsNavigation: Bool { !keyboardVisible }
    public var animates: Bool { !reduceMotion }
    public var maximumLines: Int { expanded ? 6 : 1 }
}
