import Foundation
import Testing
@testable import WeftMateCore

@Test func a17MessageTimeUsesAccountDayAcrossMidnight() {
    let now = ChatDay.date("2026-10-10T00:30:00Z")!
    let zone = TimeZone(identifier: "America/Los_Angeles")!
    #expect(DeviceDateText.messageTimestamp("2026-10-09T23:11:00.123Z", timeZone: zone, now: now) == "16:11")
    #expect(DeviceDateText.messageTimestamp("2026-10-09T23:11:00Z", timeZone: .gmt, now: now) == "10月9日 23:11")
    #expect(DeviceDateText.messageTimestamp(nil, timeZone: zone, now: now) == "时间未记录")
}
@Test func a17RelativeCardAcceptsFractionalDatesWithoutSeconds() {
    let now = ChatDay.date("2026-10-10T00:30:00Z")!
    #expect(DeviceDateText.relativeTimestamp("2026-10-10T00:13:00.000Z", now: now) == "17 分")
    #expect(DeviceDateText.relativeTimestamp("2026-10-10T00:29:55Z", now: now) == "刚刚")
    #expect(DeviceDateText.relativeTimestamp(nil, now: now) == "时间未记录")
}
@Test func a17DayLabelsRespectAccountTimezone() {
    let now = ChatDay.date("2026-10-10T00:30:00Z")!
    let zone = TimeZone(identifier: "America/Los_Angeles")!
    #expect(DeviceDateText.chatDay("2026-10-09", timeZone: zone, now: now) == "今天")
    #expect(DeviceDateText.chatDay("2026-10-08", timeZone: zone, now: now) == "昨天")
    #expect(DeviceDateText.chatDay("2026-10-08", timeZone: .gmt, now: now) == "2026 年 10 月 8 日")
}
