#if DEBUG
import AppKit
import UserNotifications
import Vision
import Darwin
import WeftMateCore

@MainActor enum MacReminderReview {
    static func run(app: AppleAppModel, chat: PhoneStandaloneModel, notifications: MacReminderNotifications) async {
        do {
            log("APPLE12_NOTIFICATION_PID: \(ProcessInfo.processInfo.processIdentifier)")
            chat.activate(app: app); notifications.attach(chat)
            NSApplication.shared.setActivationPolicy(.regular)
            NSApplication.shared.activate(ignoringOtherApps: true)
            for window in NSApplication.shared.windows { window.makeKeyAndOrderFront(nil) }
            NSApplication.shared.accessibilitySetValue(true, forAttribute: NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface"))
            for _ in 0..<100 {
                if NSRunningApplication.current.isFinishedLaunching { break }
                try await Task.sleep(for: .milliseconds(100))
            }
            try await Task.sleep(for: .seconds(3))
            NSApplication.shared.activate(ignoringOtherApps: true)
            _ = NSRunningApplication.current.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
            for window in NSApplication.shared.windows { window.makeKeyAndOrderFront(nil) }
            for _ in 0..<30 {
                if NSApplication.shared.isActive { break }
                try await Task.sleep(for: .milliseconds(100))
            }
            log("APPLE12_NOTIFICATION_LAUNCHED: \(NSRunningApplication.current.isFinishedLaunching); active \(NSApplication.shared.isActive)")
            let center = UNUserNotificationCenter.current()
            var settings = await center.notificationSettings()
            log("APPLE12_NOTIFICATION_INITIAL: \(settings.authorizationStatus.rawValue)")
            try chat.saveModel(.init(name: "Synthetic", baseURL: "https://model.example.invalid/v1", model: "synthetic", apiKey: "synthetic-test-only"))
            _ = try await A10MacReview.wait("macChat.draft")
            try await MacStandaloneReview.set("macChat.draft", "1分钟后提醒我APPLE12喝水")
            try await A10MacReview.press("macChat.send")
            for _ in 0..<50 {
                if !chat.reminders.isEmpty { break };try await Task.sleep(for: .milliseconds(100))
            }
            let reminder = try require(chat.reminders.first)
            if settings.authorizationStatus == .notDetermined {
                await notifications.requestPermission()
                settings = await center.notificationSettings()
            }
            log("APPLE12_NOTIFICATION_AUTH: \(settings.authorizationStatus.rawValue); alert \(settings.alertSetting.rawValue)")
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                log("APPLE12_NOTIFICATION_BLOCKED: native permission unavailable; saved reminder and visible permission failure; no system banner claim")
                try await Task.sleep(for: .milliseconds(500))
                try await A10MacReview.capture("fix1-notification-system-rejected", identifier: "macChat.draft")
                throw NSError(domain: "NotificationPermissionUnavailable", code: settings.authorizationStatus.rawValue)
            }
            await notifications.reconcile()
            let pending = await center.pendingNotificationRequests()
            guard pending.contains(where: { $0.content.body == "APPLE12喝水" && $0.trigger != nil }) else { throw NSError(domain: "NativeNotificationNotScheduled", code: 1) }
            log("APPLE12_NOTIFICATION_SCHEDULED: actual UNCalendarNotificationTrigger; 60 second chat command; no model request")
            try await A10MacReview.capture("fix1-reminder-scheduled", identifier: "macChat.draft")
            for _ in 0..<800 {
                if notifications.lastPresented?.route.reminderID == reminder.id { break }
                try await Task.sleep(for: .milliseconds(100))
            }
            guard notifications.lastPresented?.route.reminderID == reminder.id else { throw NSError(domain: "NativeNotificationDidNotPresent", code: 1) }
            log("APPLE12_NOTIFICATION_PRESENTED: actual native willPresent callback after due time")
            try await Task.sleep(for: .milliseconds(600))
            var captured = false
            for _ in 0..<8 {
                if try captureOwnBanner() { captured = true; break }
                try await Task.sleep(for: .milliseconds(250))
            }
            guard captured else { throw NSError(domain: "SystemBannerCaptureUnavailable", code: 1) }
            center.removePendingNotificationRequests(withIdentifiers: [ReminderNotification(account: app.phoneAccountIdentity, reminder: reminder).identifier])
            center.removeDeliveredNotifications(withIdentifiers: [ReminderNotification(account: app.phoneAccountIdentity, reminder: reminder).identifier])
            log("APPLE12_NOTIFICATION_GREEN: native due delivery and own system banner screenshot verified with synthetic text")
            await RunLogRuntime.shared.ready(); await RunLogRuntime.shared.store.exit(reason: "user_quit", code: 0)
            Darwin.exit(0)
        } catch {
            let value = error as NSError
            log("APPLE12_NOTIFICATION_FAILED: \(value.domain) \(value.code)")
            await RunLogRuntime.shared.ready(); await RunLogRuntime.shared.store.exit(reason: "user_quit", code: 1)
            Darwin.exit(1)
        }
    }
    private static func log(_ value: String) { FileHandle.standardOutput.write(Data((value + "\n").utf8)) }
    private static func require<T>(_ value: T?) throws -> T {
        guard let value else { throw NSError(domain: "ReminderMissing", code: 1) }; return value
    }
    private static func captureOwnBanner() throws -> Bool {
        typealias Images = @convention(c) (CGRect, CFArray, UInt32) -> Unmanaged<CGImage>?
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImageFromArray") else { return false }
        let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
        for item in windows where item[kCGWindowOwnerName as String] as? String == "NotificationCenter" {
            guard let raw = item[kCGWindowBounds as String] as? [String: Any], let bounds = CGRect(dictionaryRepresentation: raw as CFDictionary),
                  bounds.width <= 600, bounds.height <= 190, let id = item[kCGWindowNumber as String] as? Int else { continue }
            var ids = [UnsafeRawPointer(bitPattern: id)]
            let array = CFArrayCreate(kCFAllocatorDefault, &ids, 1, nil)!
            guard let image = unsafeBitCast(symbol, to: Images.self)(.null, array, 1)?.takeRetainedValue() else { continue }
            let request = VNRecognizeTextRequest(); request.recognitionLanguages = ["zh-Hans", "en-US"]; request.recognitionLevel = .accurate
            try VNImageRequestHandler(cgImage: image).perform([request])
            let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined().replacingOccurrences(of: " ", with: "")
            guard text.contains("APPLE12"), text.contains("喝水"), let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { continue }
            // Only this synthetic reminder's small OS banner is emitted, never the desktop or other notifications.
            FileHandle.standardOutput.write(Data(("A10_CAPTURE:fix1-native-reminder-banner:" + png.base64EncodedString() + "\n").utf8))
            return true
        }
        return false
    }
}
#endif
