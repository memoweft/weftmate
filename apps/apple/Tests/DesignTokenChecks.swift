// Standalone native check: resolve every adaptive palette entry against the sole source.
// No App activation, accessibility permission, account data or network requests.
import Foundation
import SwiftUI
import AppKit

@main struct DesignTokenChecks {
    @MainActor static func main() throws {
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("design/tokens/tokens.json")
        let tokens = try JSONSerialization.jsonObject(with: Data(contentsOf: source)) as! [String: Any]
        let apple = tokens["apple"] as! [String: Any]
        let recipes = apple["colors"] as! [String: [String: String]]
        let colors: [String: Color] = ["accent": Weave.accent, "accentSoft": Weave.accentSoft,
            "ink": Weave.ink, "secondary": Weave.secondary, "muted": Weave.muted,
            "canvas": Weave.canvas, "surface": Weave.surface, "soft": Weave.soft,
            "line": Weave.line, "onAccent": Weave.onAccent, "status": Weave.status, "danger": Weave.danger,
            "healthRecovery": AppleTokens.Colors.healthRecovery,
            "healthRecoverySoft": AppleTokens.Colors.healthRecoverySoft,
            "healthSleep": AppleTokens.Colors.healthSleep,
            "healthSleepSoft": AppleTokens.Colors.healthSleepSoft,
            "healthLoad": AppleTokens.Colors.healthLoad,
            "healthLoadSoft": AppleTokens.Colors.healthLoadSoft,
            "healthStressCalm": AppleTokens.Colors.healthStressCalm,
            "healthStressCalmSoft": AppleTokens.Colors.healthStressCalmSoft,
            "healthStressModerate": AppleTokens.Colors.healthStressModerate,
            "healthStressModerateSoft": AppleTokens.Colors.healthStressModerateSoft,
            "healthStressHigh": AppleTokens.Colors.healthStressHigh,
            "healthStressHighSoft": AppleTokens.Colors.healthStressHighSoft,
            "healthStressExtreme": AppleTokens.Colors.healthStressExtreme,
            "healthStressExtremeSoft": AppleTokens.Colors.healthStressExtremeSoft,
            "healthEnergyLow": AppleTokens.Colors.healthEnergyLow,
            "healthEnergyLowSoft": AppleTokens.Colors.healthEnergyLowSoft,
            "healthEnergyMid": AppleTokens.Colors.healthEnergyMid,
            "healthEnergyMidSoft": AppleTokens.Colors.healthEnergyMidSoft,
            "healthEnergyHigh": AppleTokens.Colors.healthEnergyHigh,
            "healthEnergyHighSoft": AppleTokens.Colors.healthEnergyHighSoft,
            "healthFitnessAge": AppleTokens.Colors.healthFitnessAge,
            "healthFitnessAgeSoft": AppleTokens.Colors.healthFitnessAgeSoft,
            "healthHrv": AppleTokens.Colors.healthHrv,
            "healthHrvSoft": AppleTokens.Colors.healthHrvSoft,
            "healthRestingHeartRate": AppleTokens.Colors.healthRestingHeartRate,
            "healthRestingHeartRateSoft": AppleTokens.Colors.healthRestingHeartRateSoft,
            "healthRespiratory": AppleTokens.Colors.healthRespiratory,
            "healthRespiratorySoft": AppleTokens.Colors.healthRespiratorySoft,
            "healthOxygen": AppleTokens.Colors.healthOxygen,
            "healthOxygenSoft": AppleTokens.Colors.healthOxygenSoft,
            "healthTemperature": AppleTokens.Colors.healthTemperature,
            "healthTemperatureSoft": AppleTokens.Colors.healthTemperatureSoft,
            "healthSleepDeep": AppleTokens.Colors.healthSleepDeep,
            "healthSleepDeepSoft": AppleTokens.Colors.healthSleepDeepSoft,
            "healthSleepCore": AppleTokens.Colors.healthSleepCore,
            "healthSleepCoreSoft": AppleTokens.Colors.healthSleepCoreSoft,
            "healthSleepRem": AppleTokens.Colors.healthSleepRem,
            "healthSleepRemSoft": AppleTokens.Colors.healthSleepRemSoft,
            "healthSleepAwake": AppleTokens.Colors.healthSleepAwake,
            "healthSleepAwakeSoft": AppleTokens.Colors.healthSleepAwakeSoft,
            "healthCard": AppleTokens.Colors.healthCard,
            "healthTrack": AppleTokens.Colors.healthTrack,
            "healthInk": AppleTokens.Colors.healthInk,
            "healthMuted": AppleTokens.Colors.healthMuted,
            "healthCanvas": AppleTokens.Colors.healthCanvas]
        precondition(Set(recipes.keys) == Set(colors.keys), "Native palette differs from the source roles")
        var count = 0
        for (mode, appearanceName) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            let appearance = NSAppearance(named: appearanceName)!
            for role in colors.keys.sorted() {
                let value = UInt32(recipes[role]![mode]!.dropFirst(), radix: 16)!
                let expected = [CGFloat((value >> 16) & 255) / 255, CGFloat((value >> 8) & 255) / 255, CGFloat(value & 255) / 255]
                appearance.performAsCurrentDrawingAppearance {
                    let resolved = NSColor(colors[role]!).usingColorSpace(.sRGB)!
                    let actual = [resolved.redComponent, resolved.greenComponent, resolved.blueComponent]
                    precondition(zip(actual, expected).allSatisfy { abs($0 - $1) < 0.000001 }, "Incorrect \(mode) \(role)")
                    precondition(resolved.alphaComponent == 1, "Unexpected palette transparency")
                }
                count += 1
            }
        }
        print("\(count) native light/dark palette checks passed; external HTTP/model requests: 0; GUI: not run")
    }
}
