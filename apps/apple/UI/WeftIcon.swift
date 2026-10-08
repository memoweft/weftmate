import SwiftUI

/// Generated template assets inherit foregroundStyle, including disabled/menu tint.
struct WeftIcon: View {
    let id: String
    private let opticalSize: CGFloat
    @ScaledMetric private var size: CGFloat
    init(_ id: String, size: CGFloat = 20) {
        self.id = id; opticalSize = size
        _size = ScaledMetric(wrappedValue: size)
    }
    var body: some View {
        Image("wm-" + id + (opticalSize <= 16 ? "-small" : ""))
            .renderingMode(.template).resizable().scaledToFit()
            .frame(width: size, height: size).accessibilityHidden(true)
    }
}

struct WeftLabel: View {
    let title: String
    let icon: String
    var size: CGFloat = 20
    init(_ title: String, icon: String, size: CGFloat = 20) {
        self.title = title; self.icon = icon; self.size = size
    }
    var body: some View { Label { Text(title) } icon: { WeftIcon(icon, size: size) } }
}
