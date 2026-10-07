# H1 HealthKit verification

H1 stores only account-scoped summaries, preferences and pending operations. Raw HealthKit samples exist only during local calculation. `HealthKitReader.requestRead` requests no write types. iPhone reads Apple Watch observations already synchronized into HealthKit; H1 adds neither Watch UI nor active workout/sensor sessions.

Run from `apps/apple`:

```sh
cd Packages/WeftMateCore
swift test
# Back in apps/apple:
make test-state
make build-mac build-phone build-watch
```

For the HealthKit integration scenario, **create a disposable simulator** and pass its ID. Do not target a physical device, personal simulator or real host:

```sh
xcrun simctl create 'WeftMate H1 isolated HealthKit' com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-26-3
xcodebuild -project WeftMate.xcodeproj -scheme WeftMatePhone \
  -destination 'platform=iOS Simulator,id=<disposable ID>' \
  -derivedDataPath Build/H1Derived -resultBundlePath Build/H1HealthKit.xcresult \
  -only-testing:WeftMatePhoneUITests/WeftMateUITests/testHealthKitSyntheticDailySummary \
  -only-testing:WeftMatePhoneUITests/WeftMateUITests/testHealthSettingsDefaultsAndReturnToConversation test
```

The synthetic XCTest launches a simulator-only DEBUG fixture with isolated app preferences/keychain namespace. It authorizes and writes sleep/step/HRV/workout fixtures, invokes the real reader, verifies 480 sleep minutes, 1234 steps, HRV 20% below the prior daily baseline, and a 30-minute workout, then deletes its synthetic samples. Its writer and write-purpose string are excluded from Release; the writer is also excluded from physical-device DEBUG builds. It never starts `AppleAppModel.start`, makes a host connection or reads a physical health store. Settings UI uses the existing in-memory client fixture and checks the cloud default and return to the conversation list.

HealthKit does not disclose read-denied status. Empty results are shown as “no data or read permission closed”; a successful request sheet is not reported as an authorization grant. Individual app switches stop queries and redact queued/cached metrics; the user can revoke system access in Health. Cloud-use changes propagate by replacing queued and previously uploaded daily summaries. Offline policy changes cannot change a server until it receives them.

Server POST/DELETE are a draft in `docs/CLIENT_API.md`, deferred quietly on 404/501. Queue replay runs on foreground, health-page open/manual refresh, and every 15 minutes while foreground. Background delivery, Windows ingestion/MemoWeft enforcement, physical iPhone/Watch synchronization, companion state and self-assessment questions remain follow-up work.

Review screenshots are from the disposable simulator and synthetic account only: [Health settings](H1-Evidence/health-settings.png), [HealthKit synthetic summary](H1-Evidence/synthetic-summary.png). No personal health records, credentials or runtime account data are included. Full local test results are in `Build/H1Delivery.xcresult`; build/unit/state logs remain in ignored `Build/`.
