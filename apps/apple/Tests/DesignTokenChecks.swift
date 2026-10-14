// Standalone native check: resolve every adaptive palette entry against the sole source.
// No App activation, accessibility permission, account data or network requests.
import Foundation
import SwiftUI
import AppKit

private struct PaletteCheckFailure: Error, CustomStringConvertible { let description: String }
private func requirePalette(_ value: Bool,_ reason: String) throws {
    guard value else { throw PaletteCheckFailure(description:reason) }
}

@main struct DesignTokenChecks {
    @MainActor static func main() {
        do { try run() } catch { print("FAIL DesignTokenChecks: \(error)");exit(1) }
    }
    @MainActor static func run() throws {
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("design/tokens/tokens.json")
        guard let tokens = try JSONSerialization.jsonObject(with: Data(contentsOf: source)) as? [String: Any],
              let apple=tokens["apple"] as? [String:Any],let recipes=apple["colors"] as? [String:[String:String]] else {
            throw PaletteCheckFailure(description:"Invalid native palette source")
        }
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
            "healthCanvas": AppleTokens.Colors.healthCanvas,
            "controlSurface": AppleTokens.Colors.controlSurface,
            "controlCanvas": AppleTokens.Colors.controlCanvas,
            "controlInk": AppleTokens.Colors.controlInk,
            "controlSecondary": AppleTokens.Colors.controlSecondary,
            "controlMuted": AppleTokens.Colors.controlMuted,
            "controlAccent": AppleTokens.Colors.controlAccent,
            "controlOnAccent": AppleTokens.Colors.controlOnAccent,
            "controlLine": AppleTokens.Colors.controlLine,
            "controlSoft": AppleTokens.Colors.controlSoft,
            "controlShadow": AppleTokens.Colors.controlShadow]
        try requirePalette(Set(recipes.keys) == Set(colors.keys), "Native palette differs from the source roles")
        var count = 0
        for (mode, appearanceName) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            guard let appearance=NSAppearance(named:appearanceName) else { throw PaletteCheckFailure(description:"Appearance unavailable: \(mode)") }
            for role in colors.keys.sorted() {
                guard let recipe=recipes[role]?[mode],let value=UInt32(recipe.dropFirst(),radix:16),let color=colors[role] else {
                    throw PaletteCheckFailure(description:"Missing or invalid \(mode) \(role)")
                }
                let expected = [CGFloat((value >> 16) & 255) / 255, CGFloat((value >> 8) & 255) / 255, CGFloat(value & 255) / 255]
                var actual: [CGFloat]?,alpha: CGFloat?
                appearance.performAsCurrentDrawingAppearance {
                    if let resolved=NSColor(color).usingColorSpace(.sRGB) {
                        actual=[resolved.redComponent,resolved.greenComponent,resolved.blueComponent];alpha=resolved.alphaComponent
                    }
                }
                guard let actual,let alpha else { throw PaletteCheckFailure(description:"Color resolution failed: \(mode) \(role)") }
                try requirePalette(zip(actual,expected).allSatisfy { abs($0-$1)<0.000001 },"Incorrect \(mode) \(role)")
                try requirePalette(alpha == 1,"Unexpected palette transparency")
                count += 1
            }
        }
        // Exercise real SwiftUI font and padding resolution rather than parsing Swift sources.
        let token=NSHostingView(rootView:Text("提醒 喝水 09:00").font(AppleTokens.Fonts.caption2))
        let native=NSHostingView(rootView:Text("提醒 喝水 09:00").font(.caption2))
        let padded=NSHostingView(rootView:Text("提醒 喝水 09:00").font(AppleTokens.Fonts.caption2).padding(AppleTokens.Space.p16))
        let actual=token.fittingSize,expected=native.fittingSize,withPadding=padded.fittingSize
        try requirePalette(actual.width > 0 && actual.height > 0,"Generated reminder font has empty layout")
        try requirePalette(abs(actual.width-expected.width)<0.01 && abs(actual.height-expected.height)<0.01,"Generated reminder font differs from system caption2")
        try requirePalette(abs(withPadding.width-actual.width-32)<0.01 && abs(withPadding.height-actual.height-32)<0.01,"Generated reminder padding is not applied by SwiftUI")
        print("3 real SwiftUI reminder font/padding layout checks passed")
        print("\(count) native light/dark palette checks passed; external HTTP/model requests: 0; GUI: not run")
    }
}
