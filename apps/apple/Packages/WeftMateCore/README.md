# WeftMateCore

Shared native Swift core for macOS 14+, iOS 17+ and watchOS 10+, without external dependencies. `PersonalClient` owns account state; views own their presentation generation and keep passwords out of preferences.

The package uses the existing `/personal/v1` client contracts. The main repository's `docs/PLAN.md` tracks their consolidation in M0-5. Auth/device routes are implemented in `src/personal-access/index.mjs`; source event paging comes from `src/personal-sync/index.mjs`. Protocol changes must be coordinated with the host; local transport tests do not establish deployed compatibility.

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

The merged candidate also includes typed shared send/adoption requests and receipts, per-account durable drafts/history caches and operation records, memory reads/mutations, task discovery/detail/stop, permission approvals, information answers, original attachment metadata and UTF-8 text artifact downloads. The App declares Apple shared-conversation capabilities through the public client method when continuing a conversation; it never supplies an Android `nativeVersionCode` or declares model-secret transfer. Existing bound host commands and new-source adoption retain distinct identities. Availability comes from the authenticated server projection, rather than a hard-coded claim that sending is ready. Model-secret transfer and general attachment upload are still outside this candidate.

## Temporary DEBUG network route

`URLSessionTransport(developmentProxyPort: Int)` is available only in DEBUG builds. It installs an HTTP CONNECT proxy at `127.0.0.1` using an explicit port in `1024...65535`. Requests to any origin other than `https://home.weftmate.com:8443` are rejected before networking; redirects and proxy failover are refused. The original URL, Host, SNI and normal URLSession certificate verification stay in use. There is no custom TLS challenge handler. Removing the launch argument removes this session override; it never changes system proxy/DNS settings or saved preferences.

This uses Apple's [URLSession proxy configuration](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/proxyconfigurations) and [HTTP CONNECT initializer](https://developer.apple.com/documentation/network/proxyconfiguration/init(httpconnectproxy:tlsoptions:)). The API is available at the package's macOS 14, iOS 17 and watchOS 10 minimum versions. Default/release transport sessions keep the existing system route. A loopback development result proves the specified local route only, not a public-network or physical-device result.

## Tests

```sh
swift test --scratch-path "$(mktemp -d /tmp/weftmate-apple-core.XXXXXX)"
```

Swift Testing covers account/device restoration and isolation, history/attachment decoding, shared send/adoption, durable stores and recovery, memory changes/redaction, task reads/stops, approval/question receipts, UTF-8 text artifacts and public update/download validation. Scripted transports and temporary storage keep these checks independent of the backend and daily data. The App's standalone state checks are run from `apps/apple` with `make test-state`; neither group proves a deployed service, physical device or GUI flow.

## Native acceptance executable

`AppleAcceptance --probe --server https://home.weftmate.com:8443` checks the real native URLSession route without a password. Failure is an exit status 1 with a safe code.

The DEBUG executable accepts `--development-proxy-port <port>` for both the read-only probe and isolated account flow. Start the bounded loopback relay from `apps/apple/Scripts` first and use its actual port. The relay must only CONNECT the formal server to the explicitly authorized development destination. Console results label this route `developmentLoopbackCONNECT`.

To create an isolated account and record-only fixture on an authorized test server:

```sh
swift run AppleAcceptance --create-test-account --server https://home.weftmate.com:8443 --credentials-file /absolute/private/new-test-account.json
```

The credentials file is created exclusively with mode 0600, before the register request, so it is retained after a lost reply. Never pass a daily account file to this test. The executable checks distinct issued Mac/iPhone/Watch devices, Apple platform declarations with no model transfer, the same original fixture conversation, devices, Keychain restore, wrong password and a second account's isolation. The wrong-password probe and second account have separate Keychain namespaces so they cannot delete the first account's saved credentials. The second account's credentials are saved to `<credentials-file>.second-account.json` before registration and reused on a repeat run; unknown registration results retain that same identity. Finally it verifies that all three main platform credentials have been removed by logout. It writes an explicit interrupted fixture turn and does not run a model or tool. Console output includes only result/stage/code/counts; credentials and message text are excluded.

An existing **isolated test** credential file can be used with `--credentials-file` without `--create-test-account`. The required private JSON fields are `server`, `username`, `password`, `conversationID` and `marker`; `conversationTitle` is optional. This form logs in and reads the existing fixture rather than creating another one. Private input files must be regular files with no group/other permissions; symlinks are refused. Unknown write outcomes require inspecting the same test identity; do not repeat fixture creation with a new account to infer that the original failed.
