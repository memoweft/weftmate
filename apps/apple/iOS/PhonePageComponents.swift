import SwiftUI
import WeftMateCore

/// Content-page rows share the shell's tokens; identity belongs to each data item.
struct PhoneSectionHeading: View {
    let title: String
    var body: some View {
        Text(title).font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, AppleTokens.Space.p16)
            .accessibilityAddTraits(.isHeader)
    }
}

struct PhoneFeatureRow: View {
    var icon: String? = nil
    let title: String
    var subtitle: String? = nil
    var value: String? = nil
    var chevron = true
    var body: some View {
        HStack(alignment: .center, spacing: AppleTokens.Space.p12) {
            if let icon { WeftIcon(icon).foregroundStyle(Weave.secondary).accessibilityHidden(true) }
            VStack(alignment: .leading, spacing: AppleTokens.Space.p6) {
                Text(title).font(AppleTokens.Fonts.body).foregroundStyle(Weave.ink)
                if let subtitle { Text(subtitle).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if let value { Text(value).font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted).monospacedDigit() }
            if chevron { WeftIcon("right", size: AppleTokens.Space.p16).foregroundStyle(Weave.muted).accessibilityHidden(true) }
        }.frame(minHeight: AppleTokens.Space.p44).padding(.vertical, AppleTokens.Space.p12).contentShape(Rectangle())
    }
}

struct PhoneRowGroup<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .padding(.horizontal, AppleTokens.Space.p16)
            .background(Weave.surface, in: RoundedRectangle(cornerRadius: AppleTokens.Phone.groupRadius))
    }
}

func phoneDateGroup(_ value: String) -> String {
    guard let date = HealthInputMath.parseISO(value) else { return "日期暂不可用" }
    if Calendar.current.isDateInToday(date) { return "今天" }
    if Calendar.current.isDateInYesterday(date) { return "昨天" }
    return date.formatted(.dateTime.year().month().day().locale(Locale(identifier: "zh_CN")))
}
