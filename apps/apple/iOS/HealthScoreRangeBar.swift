import SwiftUI
import WeftMateCore

struct HealthScoreNumber: View {
    let text: String
    var unit: String = ""
    @ScaledMetric(relativeTo: AppleTokens.TextStyle.largeTitle) private var size = AppleTokens.FontSize.f36
    var body: some View {
        HStack(alignment:.firstTextBaseline,spacing:AppleTokens.Space.p4) {
            Text(text).font(.system(size:size,weight:.bold,design:.rounded)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            if !unit.isEmpty { Text(unit).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).lineLimit(1) }
        }
    }
}
struct HealthScoreRangeBar: View {
    let score: Double?
    let low: Double?
    let high: Double?
    let state: String?
    var body: some View {
        let position=HealthPagePolicy.scorePosition(score)
        let lower=HealthPagePolicy.scorePosition(low)
        let upper=HealthPagePolicy.scorePosition(high)
        let color: Color = switch HealthPagePolicy.statusTint(state) { case .green: AppleTokens.Colors.healthRecovery; case .amber: AppleTokens.Colors.healthStressModerate; case .muted: Weave.muted }
        let track=Weave.line
        GeometryReader { @Sendable proxy in
            ZStack(alignment:.leading) {
                Capsule().fill(track).frame(height:AppleTokens.Space.p8)
                if let lower,let upper,upper >= lower {
                    Capsule().fill(AppleTokens.Colors.healthRecovery.opacity(AppleTokens.Opacity.disabled))
                        .frame(width:proxy.size.width*(upper-lower),height:AppleTokens.Space.p8)
                        .offset(x:proxy.size.width*lower)
                }
                if let position {
                    Circle().fill(color).frame(width:AppleTokens.Space.p12,height:AppleTokens.Space.p12)
                        .offset(x:max(0,proxy.size.width-AppleTokens.Space.p12)*position)
                }
            }.frame(height:AppleTokens.Space.p12)
        }.frame(height:AppleTokens.Space.p12).accessibilityHidden(true)
    }
}

struct HealthDurationNumber: View {
    var minutes: Double?
    var body: some View {
        HStack(alignment:.firstTextBaseline,spacing:AppleTokens.Space.p6) {
            if let minutes {
                let total=Int(minutes.rounded())
                if total >= 60 { HealthScoreNumber(text:String(total/60),unit:"小时") }
                HealthScoreNumber(text:String(total%60),unit:"分")
            } else { HealthScoreNumber(text:"—") }
        }.frame(maxWidth:.infinity,alignment:.leading)
    }
}
