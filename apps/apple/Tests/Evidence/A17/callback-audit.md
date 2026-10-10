# CRASH-1 callback audit

Reviewed 48 sensitive callbacks and protocol entry points against the installed SDK. Swift 6 complete concurrency remains the type-checking gate.

No GeometryReader, geometry preference/anchor callback, visualEffect, alignmentGuide, onGeometryChange, Canvas, custom Shape, Layout, or AnimatableModifier remains. Native AppKit/UIKit main-thread observation delivers layout state.

The same API scan of apps/apple/Tests and Core test sources returned zero matches. UIKit and VisionKit UI delegates are explicitly MainActor in the installed SDK. No system automation, Accessibility, or security settings changed.

CI checks the file, API, and full call/callback hash against a reviewed allowlist. Added or changed callbacks fail until reviewed. This is a conservative review gate, not whole-program Swift dataflow analysis. Regression cases cover direct UI access, removal of MainActor dispatch, labelled actions/completions, strings, and comments.

| File / line | API | Review and handling |
|---|---|---|
| `apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/HealthKitReader.swift:93` | `detached` | Explicit @Sendable detached computation captures immutable files or health snapshots only. Awaiting task assigns results on the originating MainActor. |
| `apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/HealthKitReader.swift:115` | `initialResultsHandler` | Explicit @Sendable HealthKit result callback only resumes a Sendable continuation; no HealthKitReader or UI actor member access. |
| `apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/HealthKitReader.swift:129` | `HKSampleQuery` | Explicit @Sendable HealthKit result callback only resumes a Sendable continuation; no HealthKitReader or UI actor member access. |
| `apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/NativeUpdates.swift:174` | `urlSession` | Explicit nonisolated URLSession delegate reads immutable transport configuration or refuses redirects. No UI state or main-actor model access. |
| `apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/PublicUpdates.swift:245` | `urlSession` | Explicit nonisolated URLSession delegate reads immutable transport configuration or refuses redirects. No UI state or main-actor model access. |
| `apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/Transport.swift:43` | `urlSession` | Explicit nonisolated URLSession delegate reads immutable transport configuration or refuses redirects. No UI state or main-actor model access. |
| `apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/Transport.swift:66` | `urlSession` | Explicit nonisolated URLSession delegate reads immutable transport configuration or refuses redirects. No UI state or main-actor model access. |
| `apps/apple/UI/A11MacReview.swift:10` | `addObserver` | AppKit NSMenu tracking selector runs synchronously on the AppKit main thread. No worker closure. DEBUG review observer or native menu styling only. |
| `apps/apple/UI/A11MacReview.swift:12` | `track` | AppKit NSMenu tracking selector runs synchronously on the AppKit main thread. No worker closure. DEBUG review observer or native menu styling only. |
| `apps/apple/UI/A13MacReview.swift:144` | `addObserver` | AppKit NSMenu tracking selector runs synchronously on the AppKit main thread. No worker closure. DEBUG review observer or native menu styling only. |
| `apps/apple/UI/A13MacReview.swift:145` | `track` | AppKit NSMenu tracking selector runs synchronously on the AppKit main thread. No worker closure. DEBUG review observer or native menu styling only. |
| `apps/apple/UI/A15MacReview.swift:8` | `addObserver` | AppKit NSMenu tracking selector runs synchronously on the AppKit main thread. No worker closure. DEBUG review observer or native menu styling only. |
| `apps/apple/UI/A15MacReview.swift:9` | `track` | AppKit NSMenu tracking selector runs synchronously on the AppKit main thread. No worker closure. DEBUG review observer or native menu styling only. |
| `apps/apple/UI/A16MacReview.swift:11` | `addObserver` | AppKit NSMenu tracking selector runs synchronously on the AppKit main thread. No worker closure. DEBUG review observer or native menu styling only. |
| `apps/apple/UI/A16MacReview.swift:12` | `track` | AppKit NSMenu tracking selector runs synchronously on the AppKit main thread. No worker closure. DEBUG review observer or native menu styling only. |
| `apps/apple/UI/AppleAppModel.swift:361` | `detached` | Explicit @Sendable detached computation captures immutable files or health snapshots only. Awaiting task assigns results on the originating MainActor. |
| `apps/apple/UI/CloudBrowser.swift:30` | `ASWebAuthenticationSession` | Explicit @Sendable authentication callback captures weak model; URL/error and continuation processing occur inside Task @MainActor. |
| `apps/apple/UI/ComposerMedia.swift:62` | `imagePickerControllerDidCancel` | Platform SDK declares DataScannerViewControllerDelegate @MainActor and UIImagePickerControllerDelegate NS_SWIFT_UI_ACTOR. Native UI delegate delivery is main-actor isolated. |
| `apps/apple/UI/ComposerMedia.swift:63` | `imagePickerController` | Platform SDK declares DataScannerViewControllerDelegate @MainActor and UIImagePickerControllerDelegate NS_SWIFT_UI_ACTOR. Native UI delegate delivery is main-actor isolated. |
| `apps/apple/UI/ConversationAttachmentView.swift:130` | `fileExporter` | Explicit @Sendable completion transports its Result to Task @MainActor before reading or writing any view/model state. No UI actor access on the file-service callback executor. |
| `apps/apple/UI/ConversationAttachmentView.swift:161` | `detached` | Explicit @Sendable detached computation captures immutable files or health snapshots only. Awaiting task assigns results on the originating MainActor. |
| `apps/apple/UI/ConversationAttachmentView.swift:167` | `detached` | Explicit @Sendable detached computation captures immutable files or health snapshots only. Awaiting task assigns results on the originating MainActor. |
| `apps/apple/UI/ConversationView.swift:134` | `fileImporter` | Explicit @Sendable completion transports its Result to Task @MainActor before reading or writing any view/model state. No UI actor access on the file-service callback executor. |
| `apps/apple/UI/ConversationView.swift:854` | `onScrollTargetVisibilityChange` | Explicit @Sendable geometry transform and action. Transform uses immutable geometry only; all visibility/follow state writes occur inside Task @MainActor. |
| `apps/apple/UI/ConversationView.swift:855` | `onScrollPhaseChange` | Explicit @Sendable geometry transform and action. Transform uses immutable geometry only; all visibility/follow state writes occur inside Task @MainActor. |
| `apps/apple/UI/ConversationView.swift:856` | `onScrollGeometryChange` | Explicit @Sendable geometry transform and action. Transform uses immutable geometry only; all visibility/follow state writes occur inside Task @MainActor. |
| `apps/apple/UI/ExplicitReturnButton.swift:28` | `sizeThatFits` | NSViewRepresentable / UIViewRepresentable sizing protocol is MainActor in the platform SDK; returns geometry from the proposal, with no asynchronous closure or observable-state mutation. |
| `apps/apple/UI/MainChatPositionTracking.swift:13` | `sizeThatFits` | NSViewRepresentable / UIViewRepresentable sizing protocol is MainActor in the platform SDK; returns geometry from the proposal, with no asynchronous closure or observable-state mutation. |
| `apps/apple/UI/MainChatPositionTracking.swift:38` | `addObserver` | Explicit @Sendable NotificationCenter/KVO callback captures weak marker and invokes schedule only inside Task @MainActor. |
| `apps/apple/UI/MainChatPositionTracking.swift:59` | `sizeThatFits` | NSViewRepresentable / UIViewRepresentable sizing protocol is MainActor in the platform SDK; returns geometry from the proposal, with no asynchronous closure or observable-state mutation. |
| `apps/apple/UI/MainChatPositionTracking.swift:82` | `observe` | Explicit @Sendable NotificationCenter/KVO callback captures weak marker and invokes schedule only inside Task @MainActor. |
| `apps/apple/UI/MainChatView.swift:92` | `fileImporter` | Explicit @Sendable completion transports its Result to Task @MainActor before reading or writing any view/model state. No UI actor access on the file-service callback executor. |
| `apps/apple/UI/MessageActionsPresentation.swift:70` | `fileExporter` | Explicit @Sendable completion transports its Result to Task @MainActor before reading or writing any view/model state. No UI actor access on the file-service callback executor. |
| `apps/apple/UI/PhoneWatchTimelineBridge.swift:14` | `session` | Explicit nonisolated WCSession delegate snapshots typed input before Task @MainActor; empty activation callback needs no UI delivery. |
| `apps/apple/UI/PhoneWatchTimelineBridge.swift:17` | `session` | Explicit nonisolated WCSession delegate snapshots typed input before Task @MainActor; empty activation callback needs no UI delivery. |
| `apps/apple/UI/PhoneWatchTimelineBridge.swift:35` | `sendMessage` | WCSession sendMessage has nil reply/error handlers. The nonisolated delegate converts input to Sendable values before Task @MainActor. |
| `apps/apple/UI/ProjectsView.swift:21` | `begin` | NSOpenPanel completion is explicitly @Sendable; the response is processed inside Task @MainActor before touching panel, URL selection, or project model. |
| `apps/apple/UI/SessionHoverRegion.swift:91` | `addObserver` | AppKit NSMenu tracking selector runs synchronously on the AppKit main thread. No worker closure. DEBUG review observer or native menu styling only. |
| `apps/apple/UI/SessionHoverRegion.swift:93` | `styleMenu` | AppKit NSMenu tracking selector runs synchronously on the AppKit main thread. No worker closure. DEBUG review observer or native menu styling only. |
| `apps/apple/UI/TaskDirectoryModel.swift:77` | `withTaskCancellationHandler` | Cancellation handler captures a Sendable Task handle and only cancels that handle. It never accesses the surrounding MainActor model. |
| `apps/apple/UI/TaskWorkspaceModel.swift:390` | `withTaskCancellationHandler` | Cancellation handler captures a Sendable Task handle and only cancels that handle. It never accesses the surrounding MainActor model. |
| `apps/apple/UI/TimelineArtifactCard.swift:33` | `fileExporter` | Explicit @Sendable completion transports its Result to Task @MainActor before reading or writing any view/model state. No UI actor access on the file-service callback executor. |
| `apps/apple/iOS/PairingScannerView.swift:70` | `dataScanner` | Platform SDK declares DataScannerViewControllerDelegate @MainActor and UIImagePickerControllerDelegate NS_SWIFT_UI_ACTOR. Native UI delegate delivery is main-actor isolated. |
| `apps/apple/watchOS/WatchHomeView.swift:26` | `session` | Explicit nonisolated WCSession delegate snapshots typed input before Task @MainActor; empty activation callback needs no UI delivery. |
| `apps/apple/watchOS/WatchHomeView.swift:30` | `sessionReachabilityDidChange` | Explicit nonisolated WCSession delegate snapshots typed input before Task @MainActor; empty activation callback needs no UI delivery. |
| `apps/apple/watchOS/WatchHomeView.swift:34` | `session` | Explicit nonisolated WCSession delegate snapshots typed input before Task @MainActor; empty activation callback needs no UI delivery. |
| `apps/apple/watchOS/WatchHomeView.swift:38` | `session` | Explicit nonisolated WCSession delegate snapshots typed input before Task @MainActor; empty activation callback needs no UI delivery. |
| `apps/apple/watchOS/WatchHomeView.swift:86` | `sendMessage` | WatchMessageDelivery factories are nonisolated and return @Sendable reply/error closures, converting typed values before explicit Task @MainActor delivery. |
