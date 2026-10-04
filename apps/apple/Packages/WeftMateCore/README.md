# WeftMateCore

Shared native Swift core for macOS 14+, iOS 17+ and watchOS 10+, without external dependencies. `PersonalClient` owns account state; views own their presentation generation and keep passwords out of preferences.

The package uses the existing `/personal/v1` contracts indexed by `docs/ARCHITECTURE.md`. Auth/device routes are implemented in `src/personal-access/index.mjs`; source event paging comes from `src/personal-sync/index.mjs`; the original phone/host history merge follows `apps/mobile-ui/www/app.js` and the Android conversation handoff. These remain the authority for protocol changes.

## Current candidate

- Canonical HTTPS server configuration; explicit loopback HTTP is available only to callers that opt in for local development.
- Register, password login, logout, owner/device/host checks, devices and original conversation/history reads.
- Cookie/CSRF credentials in a Keychain item per server and Apple platform, with `ThisDeviceOnly` accessibility and synchronizable disabled. Public `AccountSession` contains no cookie or CSRF token.
- Separately persisted installation identity for Mac, iPhone and Watch. The backend currently issues a new device on each password login, so restart restores its existing cookie/device instead of logging in again. Watch credentials/IDs are never copied from iPhone.
- Every asynchronous account operation checks its generation. Logout and account transitions clear in-memory conversation state. Unauthorized reads remove persisted credentials.
- Temporary restore failure retains the saved owner/device with `verification = unverifiedOffline`; the UI can retry restoration without creating a new server device. Remote reads verify the owner/device and host before returning fresh data.
- Original phone history uses the shared binding cut. Adopted messages are joined by the server's exact receipt identity; late phone records have `pendingContext = true` rather than implying they entered host context.
- Strict certificates, no redirects, no shared cookie jar, bounded response bytes and monotonic paginated history. A network/protocol error cannot become an empty successful list.
- Logout reports both local credential removal and remote acknowledgement. A Keychain failure is not reported as persisted logout success.

Sending, model selection/secret transfer, attachments and durable offline history are later milestones. `sendAvailable` is false in this read candidate. The backend capability declaration still accepts an Android `nativeVersionCode`; Apple does not supply a fake Android version. Existing bound host commands and new-source adoption have different requirements; see the actual backend routes before extending the write flow.

## Tests

```sh
swift test --scratch-path /tmp/weftmate-apple-core-tests-844429c
```

The 16 Swift Testing cases cover valid/invalid server settings, distinct stable platform identity, issued-device restoration, cookie/owner checks, account changes with late responses, revocation, valid/bad cursors, exact original-history merging, safe errors, offline restore and both local/remote logout failures. Scripted transport tests validate the client; they do not prove a deployed service or physical device.

## Native acceptance executable

`AppleAcceptance --probe --server https://home.weftmate.com:8443` checks the real native URLSession route without a password. Failure is an exit status 1 with a safe code.

To create an isolated account and record-only fixture on an authorized test server:

```sh
swift run AppleAcceptance --create-test-account --server https://home.weftmate.com:8443 --credentials-file /absolute/private/new-test-account.json
```

The credentials file is created exclusively with mode 0600, before the register request, so it is retained after a lost reply. Never pass a daily account file to this test. The executable checks distinct issued Mac/iPhone/Watch devices, the same original fixture conversation, devices, Keychain restore, wrong password and a second account's isolation. It writes an explicit interrupted fixture turn and does not run a model or tool. Console output includes only result/stage/code/counts; credentials and message text are excluded.

An existing **isolated test** credential file can be used with `--credentials-file` without `--create-test-account`. The required private JSON fields are `server`, `username`, `password`, `conversationID` and `marker`. This form logs in and reads the existing fixture rather than creating another one. Unknown write outcomes require inspecting the same test identity; do not repeat fixture creation with a new account to infer that the original failed.
