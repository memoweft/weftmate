import SwiftUI

/// The user-selected Xiao Wei master. State artwork remains a design reference.
struct SpiritView: View {
    let size: CGFloat

    var body: some View {
        Image("WeftMateSpiritMaster")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
