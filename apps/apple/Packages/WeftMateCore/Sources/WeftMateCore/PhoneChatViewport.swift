import Foundation

/// The scroll viewport excludes the footer's occupied layout space, including the keyboard.
public enum PhoneChatViewport {
    public static func reservedBottom(composer: Double, navigation: Double, gap: Double) -> Double { max(0,composer)+max(0,navigation)+max(0,gap) }
    public static func intersects(top: Double, bottom: Double, height: Double) -> Bool { height>0 && bottom>0 && top<height }
    public static func fullyVisible(top: Double, bottom: Double, height: Double) -> Bool { height>0 && top >= -1 && bottom <= height+1 }
    public static func showsDecisionNotice(pending: Bool, top: Double?, bottom: Double?, height: Double) -> Bool {
        guard pending else { return false }
        guard let top,let bottom else { return true }
        return !intersects(top:top,bottom:bottom,height:height)
    }
    public static func atBottom(lastTop: Double?, lastBottom: Double?, endTop: Double?, endBottom: Double?, height: Double) -> Bool {
        if let lastTop,let lastBottom,lastBottom-lastTop <= height {
            return fullyVisible(top:lastTop,bottom:lastBottom,height:height)
        }
        // A long reply cannot fit at once; reaching its end still means the scroll is at bottom.
        guard let endTop,let endBottom else { return false }
        return fullyVisible(top:endTop,bottom:endBottom,height:height)
    }
}
