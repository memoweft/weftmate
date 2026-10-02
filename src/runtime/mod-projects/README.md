# Mod project runtime contract

`ModProjectRuntime` stores each project beneath its configured durable root. A
project has an editable `workspace`, immutable `versions/<versionId>/source`,
its own `data`, run receipts, requirements, and an incident outbox. This is a
Node ESM multi-file Mod runtime for cooperative application code. It does not
claim to run arbitrary languages or to sandbox hostile code.

Create and maintain projects with `createProject`, `importProject`,
`updateWorkspace`, `createCandidate`, `validateVersion`, and
`activateVersion`. A candidate copies the workspace before validation; a
validated digest is checked again before activation and before each run. A
version never runs from the editable workspace. `manifest` is deliberately
small:

```js
{
  entry: 'src/main.mjs',
  state: 'data/state.json',
  validate: 'selfTest',
  stateSchemaVersion: 1,
  ui: { assets: 'ui' },
}
```

The entry exports `async start(api)` and `async selfTest(api)`. `selfTest` must
return `{ ok: true, assertions: [...] }`; that is project-test evidence only.
`validateVersion` also requires its parent to provide `assertValidation` when
constructing the runtime. That host-owned callback receives the isolated
validation state root and decides whether the candidate can become
`validated`; it cannot be replaced by the candidate source. `validationModel`
is separate from the real `model` broker. A validation call without that
explicit safe broker fails, so candidate testing cannot silently consume the
user's active model route or context.

The child gets `api.state.read/write`, `api.model.call`, `api.emit`, and
`api.paths.state`. Model calls reach only the parent broker with
`projectId/versionId/runId/controlRevision/mode`; the child receives neither
credentials nor parent environment. The Node permission model limits child
filesystem reads to its immutable source and runner, while all state writes go
through parent IPC. Network access is not represented as a Node permission
boundary and this runtime is therefore not a security sandbox.

`start`, `stop`, `restart`, and `resume` return health-bearing run/project
objects. Runs and every bridge response are fenced by `runId` and
`controlRevision`. `stop` writes durable `desiredState: 'stopped'` before it
signals the child, aborts model admission, drains state writes, then requests a
clean exit with a bounded force-stop. It sets `stopLatch: true` and
`stopReason: 'user-stop'`. Automation, a repair flow, `activateVersion`, or an
old result cannot clear that latch. Only the UI's explicit user action should
call `start`/`restart`/`resume` with `{ userInitiated: true }`. A crash or host
restart records a different `stopReason` and becomes `failed` or
`needs-review`; the runtime never blindly replays it.

`describeUi` and `readUiAsset` expose only declared, size-bounded ordinary
files from the active immutable version. `invokeUi` calls exported
`handleUi(api, request)` only while the Mod is running. The DSH host adapter in `src/plugins/weftmate-mod-projects.mjs` binds those
calls to the owning project/session and a frame capability, enforces bounded
requests and file MIME policy, and serves a Content Security Policy. Opening
or reading a Mod UI never starts a child process.

`recordRequirement`, `listRequirements`, `claimRequirement`, and
`resolveRequirement` retain user changes during a run. Runtime failures create
deduplicated durable incidents before emitting an event. Incidents have a
reclaimable lease; an adapter acknowledges delivery only with the maintenance
message id and flushed session sequence, and resolution must retain repair,
validation, and activation receipts.
