# 清理身份后的失败片段

## 1 · workflow · Total passed, failed, skipped and retry recoveries

run / attempt（运行 / 尝试）：38336533493/1

```text
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	﻿2026-10-13T02:37:25.6781895Z ##[group]Run node .github/scripts/ci-test-summary.mjs unit-reports
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	2026-10-13T02:37:25.6782340Z ^[[36;1mnode .github/scripts/ci-test-summary.mjs unit-reports^[[0m
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	2026-10-13T02:37:25.6839766Z shell: /usr/bin/bash -e {0}
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	2026-10-13T02:37:25.6840015Z ##[endgroup]
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	2026-10-13T02:37:25.7234799Z file:///home/runner/work/weftmate/weftmate/.github/scripts/ci-test-summary.mjs:11
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	2026-10-13T02:37:25.7236042Z   if (new Set(keys).size !== keys.length || expected.some(key => !keys.includes(key)) || keys.some(key => !expected.includes(key))) throw Error(`Missing, duplicate or unexpected shard report: expected ${expected}; received ${keys}`);
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	2026-10-13T02:37:25.7237254Z                                                                                                                                           ^
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	2026-10-13T02:37:25.7237720Z 
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	2026-10-13T02:37:25.7239192Z Error: Missing, duplicate or unexpected shard report: expected ubuntu-latest:1/3,ubuntu-latest:2/3,ubuntu-latest:3/3,windows-latest:1/3,windows-latest:2/3,windows-latest:3/3; received ubuntu-latest:1/3,ubuntu-latest:2/3,ubuntu-latest:3/3
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	2026-10-13T02:37:25.7240991Z     at aggregateReports (file:///home/runner/work/weftmate/weftmate/.github/scripts/ci-test-summary.mjs:11:139)
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	2026-10-13T02:37:25.7241766Z     at file:///home/runner/work/weftmate/weftmate/.github/scripts/ci-test-summary.mjs:19:17
Required unit tests (summary)	Total passed, failed, skipped and retry recoveries	2026-10-13T02:37:25.7242235Z     a
```

## 2 · tests/ui-core.test.ts · core registers distinct actions, constructs independent stores and has no DOM dependency

run / attempt（运行 / 尝试）：38288667886/1

```text
not ok 13 - core registers distinct actions, constructs independent stores and has no DOM dependency
  ---
  duration_ms: 2.795326
  type: 'test'
  location: '/home/runner/work/weftmate/weftmate/tests/ui-core.test.ts:229:1'
  failureType: 'testCodeFailure'
  error: 'duplicate action saveHealthSettings'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  stack: |-
    TestContext.<anonymous> (file:///home/runner/work/weftmate/weftmate/tests/ui-core.test.ts:233:12)
    Test.runInAsyncScope (node:async_hooks:227:14)
    Test.run (node:internal/test_runner/test:1402:25)
    Test.processPendingSubtests (node:internal/test_runner/test:974:18)
    Test.postRun (node:internal/test_runner/test:1542:19)
    Test.run (node:internal/test_runner/test:1467:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 3 · tests/ui-core.test.ts · core registers distinct actions, constructs independent stores and has no DOM dependency

run / attempt（运行 / 尝试）：38288667886/1

```text
not ok 13 - core registers distinct actions, constructs independent stores and has no DOM dependency
  ---
  duration_ms: 4.276
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\ui-core.test.ts:229:1'
  failureType: 'testCodeFailure'
  error: 'duplicate action saveHealthSettings'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  stack: |-
    TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/ui-core.test.ts:233:12)
    Test.runInAsyncScope (node:async_hooks:227:14)
    Test.run (node:internal/test_runner/test:1402:25)
    Test.processPendingSubtests (node:internal/test_runner/test:974:18)
    Test.postRun (node:internal/test_runner/test:1542:19)
    Test.run (node:internal/test_runner/test:1467:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 4 · tests/bl-29-timing-approval.test.ts · BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s

run / attempt（运行 / 尝试）：38330189442/1

```text
not ok 1 - BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s
  ---
  duration_ms: 26149.8327
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\bl-29-timing-approval.test.ts:11:1'
  failureType: 'testCodeFailure'
  error: |-
    {
      "status": null,
      "signal": "SIGTERM",
      "error": "spawnSync C:\\hostedtoolcache\\windows\\node\\24.21.0\\x64\\node.exe ETIMEDOUT",
      "stdout": "BL-29 lifecycle: startup / synthetic cloud authentication started (1ms)\nBL-29 lifecycle: fixture / verified synthetic cloud authentication ready (19910ms)\nBL-29 lifecycle: main warmup started (19910ms)\nBL-29 lifecycle: main warmup ready (20114ms)\nBL-29 lifecycle: desktop launch started (20115ms)\nBL-29 lifecycle: desktop window ready (21222ms)\nBL-29 lifecycle: desktop native initialization started (21334ms)\ndesktop logged in\nBL-29 lifecycle: desktop ready / mobile launch started (23625ms)\n",
      "stderr": ""
    }
    
    null !== 0
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 0
  actual: ~
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/bl-29-timing-approval.test.ts:19:12)
    Test.runInAsyncScope (node:async_hooks:227:14)
    Test.run (node:internal/test_runner/test:1402:25)
    Test.start (node:internal/test_runner/test:1262:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17)
  ...
```

## 5 · tests/ui-core.test.ts · composed health settings keep serialized writes and reject queued work after an account change

run / attempt（运行 / 尝试）：38306603542/1

```text
not ok 14 - composed health settings keep serialized writes and reject queued work after an account change
  ---
  duration_ms: 2.54649
  type: 'test'
  location: '/home/runner/work/weftmate/weftmate/tests/ui-core.test.ts:241:1'
  failureType: 'testCodeFailure'
  error: 'f.core.saveHealthSettings is not a function'
  code: 'ERR_TEST_FAILURE'
  name: 'TypeError'
  stack: |-
    TestContext.<anonymous> (file:///home/runner/work/weftmate/weftmate/tests/ui-core.test.ts:247:25)
    Test.runInAsyncScope (node:async_hooks:227:14)
    Test.run (node:internal/test_runner/test:1402:25)
    Test.processPendingSubtests (node:internal/test_runner/test:974:18)
    Test.postRun (node:internal/test_runner/test:1542:19)
    Test.run (node:internal/test_runner/test:1467:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 6 · tests/ui-core.test.ts · composed health settings keep serialized writes and reject queued work after an account change

run / attempt（运行 / 尝试）：38306603542/1

```text
not ok 14 - composed health settings keep serialized writes and reject queued work after an account change
  ---
  duration_ms: 2.0819
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\ui-core.test.ts:241:1'
  failureType: 'testCodeFailure'
  error: 'f.core.saveHealthSettings is not a function'
  code: 'ERR_TEST_FAILURE'
  name: 'TypeError'
  stack: |-
    TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/ui-core.test.ts:247:25)
    Test.runInAsyncScope (node:async_hooks:227:14)
    Test.run (node:internal/test_runner/test:1402:25)
    Test.processPendingSubtests (node:internal/test_runner/test:974:18)
    Test.postRun (node:internal/test_runner/test:1542:19)
    Test.run (node:internal/test_runner/test:1467:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 7 · tests/folder-choice.test.ts · UX-9 new-folder API uses existing permission revisions and never returns a full browser path

run / attempt（运行 / 尝试）：38324429449/1

```text
not ok 8 - UX-9 new-folder API uses existing permission revisions and never returns a full browser path
  ---
  duration_ms: 18106.5894
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\folder-choice.test.ts:31:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    503 !== 201
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 201
  actual: 503
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/folder-choice.test.ts:42:272)
    process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    async Test.run (node:internal/test_runner/test:1409:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 8 · tests/polish-1.test.ts · r: consecutive weekly observations use all-week, date range or day count

run / attempt（运行 / 尝试）：38306376755/1

```text
not ok 2 - r: consecutive weekly observations use all-week, date range or day count
  ---
  duration_ms: 1.428497
  type: 'test'
  location: '/home/runner/work/weftmate/weftmate/tests/polish-1.test.ts:17:1'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /这周每天凌晨一点后/. Input:
    
    '主要在忙：这周还没有对话记录。\n完成 0 件事，产出 0 份成果；没有记录到卡住的任务。\n这一周的使用主要在白天和晚间。'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: |-
    主要在忙：这周还没有对话记录。
    完成 0 件事，产出 0 份成果；没有记录到卡住的任务。
    这一周的使用主要在白天和晚间。
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (file:///home/runner/work/weftmate/weftmate/tests/polish-1.test.ts:23:9)
    Test.runInAsyncScope (node:async_hooks:227:14)
    Test.run (node:internal/test_runner/test:1402:25)
    Test.processPendingSubtests (node:internal/test_runner/test:974:18)
    Test.postRun (node:internal/test_runner/test:1542:19)
    Test.run (node:internal/test_runner/test:1467:12)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
  ...
```

## 9 · tests/polish-1.test.ts · r: consecutive weekly observations use all-week, date range or day count

run / attempt（运行 / 尝试）：38306376755/1

```text
not ok 2 - r: consecutive weekly observations use all-week, date range or day count
  ---
  duration_ms: 2.2495
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\polish-1.test.ts:17:1'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /这周每天凌晨一点后/. Input:
    
    '主要在忙：这周还没有对话记录。\n完成 0 件事，产出 0 份成果；没有记录到卡住的任务。\n这一周的使用主要在白天和晚间。'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: |-
    主要在忙：这周还没有对话记录。
    完成 0 件事，产出 0 份成果；没有记录到卡住的任务。
    这一周的使用主要在白天和晚间。
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/polish-1.test.ts:23:9)
    Test.runInAsyncScope (node:async_hooks:227:14)
    Test.run (node:internal/test_runner/test:1402:25)
    Test.processPendingSubtests (node:internal/test_runner/test:974:18)
    Test.postRun (node:internal/test_runner/test:1542:19)
    Test.run (node:internal/test_runner/test:1467:12)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
  ...
```

## 10 · tests/personal-conversation-resources.test.ts · resources HTTP API requires account session ownership, validates cursors and preserves incremental pagination

run / attempt（运行 / 尝试）：38305459551/1

```text
not ok 5 - resources HTTP API requires account session ownership, validates cursors and preserves incremental pagination
  ---
  duration_ms: 6632.6937
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\personal-conversation-resources.test.ts:86:1'
  failureType: 'testCodeFailure'
  error: |-
    fresh personal conversations have no native log yet
    
    1 !== 0
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 0
  actual: 1
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/personal-conversation-resources.test.ts:112:12)
    process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    async Test.run (node:internal/test_runner/test:1409:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 11 · tests/personal-user-questions.test.ts · answer IDs collide in both directions with commands, task stops and approval decisions

run / attempt（运行 / 尝试）：38309679841/1

```text
not ok 10 - answer IDs collide in both directions with commands, task stops and approval decisions
  ---
  duration_ms: 4547.2792
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\personal-user-questions.test.ts:353:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + '{"version":3,"hostId":"host-2eee617a-e617-4fac-99c9-aa557431b670","legacyOwnerId":"owner-05d98cef-f384-45cc-a220-187cdef38bba","unknownAuthLimits":{"failures":0,"lastFailureAt":0,"lockUntil":0},"sharedModelProfiles":[],"accounts":{"owner-05d98cef-f384-45cc-a220-187cdef38bba":{"devices":{"device-4f7bec20-f16b-429f-957f-82779dfe485e":{"name":"Synthetic question phone","tokenHash":"f2bcc0ce1ff0362edacd4d0c5e1863e4be4a62a7a69177247641a0014ca147a1","csrfHash":"cfcea4fcc3eb82ee616bdb9a87e6fd08e6b33eaaaa7456ba1967f9c966dd97ca","scopes":["sessions:read","commands:write","account:manage"],"revoked":false,"enrolledAt":"2026-10-12T21:33:40.398Z","authKind":"password","authEpoch":1,"expiresAt":"2026-11-11T21:33:40.398Z"}},"sessions":{"session-7b239c64-8053-415e-aee6-1e96e2ff8b2e":{"ownerId":"owner-05d98cef-f384-45cc-a220-187cdef38bba","attachedAt":"2026-10-12T21:33:40.827Z","approvalMode":"auto","deepThinking":false,"origin":"personal-remote","modelProfileId":"local"}},"commands":{"cmd-9f902312-f85b-466c-9a0f-66790485180a":{"commandId":"cmd-9f902312-f85b-466c-9a0f-66790485180a","ownerId":"owner-05d98cef-f384-45cc-a220-187cdef38bba","requestId":"question-session","payloadHash":"c0cb68855a314d6f2a754130ff413ac42a9154e72eabeb5cc9e49704cf3c21f4","payload":{"requestId":"question-session","kind":"session.create","targetDeviceId":"host-2eee617a-e617-4fac-99c9-aa557431b670","modelProfileId":"local"},"sourceDeviceId":"device-4f7bec20-f16b-429f-957f-82779dfe485e","sourceAuthEpoch":1,"targetDeviceId":"host-2eee617a-e617-4fac-99c9-aa557431b670","kind":"session.create","sessionId":"session-7b239c64-8053-415e-aee6-1e96e2ff8b2e","state":"accepted_by_dsh","createdAt":"2026-10-12T21:33:40.482Z","updatedAt":"2026-10-12T21:33:40.827Z"},"cmd-b4011613-0346-42bd-b100-27929c716d92":{"commandId":"cmd-b4011613-0346-42bd-b100-27929c716d92","ownerId":"owner-05d98cef-f384-45cc-a220-187cdef38bba","requestId":"question-source","payloadHash":"06667987adf065df0ea5cd2971822754204fefe59c671a75187a2b8eb0c54f77","payload":{"requestId":"question-source","kind
```

## 12 · tests/design-tokens.test.ts · Apple views consume generated typed tokens compiled by all three native targets

run / attempt（运行 / 尝试）：38256404822/1

```text
not ok 4 - Apple views consume generated typed tokens compiled by all three native targets
  ---
  duration_ms: 11.145463
  type: 'test'
  location: '/home/runner/work/weftmate/weftmate/tests/design-tokens.test.ts:32:1'
  failureType: 'testCodeFailure'
  error: |-
    The input was expected to not match the regular expression /\.font\(\.(?:body|caption|callout|title|headline|footnote|subheadline)/. Input:
    
    'import SwiftUI\n' +
      'import WeftMateCore\n' +
      '\n' +
      'struct HealthAISettingsRow: View {\n' +
      '    @ObservedObject var app: AppleAppModel\n' +
      '    @State private var settings: HealthPageSettings?\n' +
      '    @State private var message: String?\n' +
      '    @State private var updating=false\n' +
      '    var body: some View {\n' +
      '        if let settings {\n' +
      '            Toggle("今日解读使用 AI",isOn:Binding(get:{self.settings?.modelInsightsEnabled == true},set:{value in Task { await change(top:value) } })).disabled(updating)\n' +
      '            if settings.itemAnalysisEnabled != nil {\n' +
      '                Toggle("各项 AI 分析",isOn:Binding(get:{self.settings?.itemAnalysisEnabled == true},set:{value in Task { await change(item:value) } })).disabled(updating)\n' +
      '            }\n' +
      '            Text("会把每天的汇总数字发给你设置的模型，不发明细。各项分析只有展开时才生成。") .font(.footnote).foregroundStyle(.secondary)\n' +
      '        }\n' +
      '        if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }\n' +
      '        Color.clear.frame(height:0).task(id:app.accountEpoch) {\n' +
      '            let [secret]; settings=nil; message=nil\n' +
      '            if let reply=try? await app.assistantClient.healthPageSettings(),[secret] app.accountEpoch { settings=reply.settings }\n' +
      '        }\n' +
      '    }\n' +
      '    private func change(top: Bool? = nil,item: Bool? = nil) async {\n' +
      '        let [secret];updating=true;defer { if [secret] app.accountEpoch { updating=false } }\n' +
      '        do {\n' +
      '            let reply: HealthPageSettingsReply\n' +
      '            if let top { reply=try await app.assistantClient.healthTopInsightSetting(top) }\n' +
      '            else { reply=try await app.assistantClient.healthPageSettings(enabled:item) }\n' +
      '            if [secret] app.accountEpoch { settings=reply.settings;message=nil }\n' +
 
```

## 13 · tests/personal-mobile-ui-release.test.ts · authenticated mobile UI A to B and rollback use immutable assets, SSE and no host restart

run / attempt（运行 / 尝试）：38317040817/1

```text
not ok 1 - authenticated mobile UI A to B and rollback use immutable assets, SSE and no host restart
  ---
  duration_ms: 20015.9949
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\personal-mobile-ui-release.test.ts:17:1'
  failureType: 'testTimeoutFailure'
  error: 'test timed out after 20000ms'
  code: 'ERR_TEST_FAILURE'
  ...
```

## 14 · tests/bl-29-wait.test.ts · BL-29 existing chat changes wait for a native delta, wake immediately and retain exact cursor semantics

run / attempt（运行 / 尝试）：38298416230/2

```text
not ok 1 - BL-29 existing chat changes wait for a native delta, wake immediately and retain exact cursor semantics
  ---
  duration_ms: 11294.3437
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\bl-29-wait.test.ts:7:1'
  failureType: 'testCodeFailure'
  error: "Cannot read properties of undefined (reading 'data')"
  code: 'ERR_TEST_FAILURE'
  name: 'TypeError'
  stack: |-
    TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/bl-29-wait.test.ts:18:40)
    process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    async Test.run (node:internal/test_runner/test:1409:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
  ...
```

## 15 · tests/bl-29-wait.test.ts · BL-29 existing chat changes wait for a native delta, wake immediately and retain exact cursor semantics

run / attempt（运行 / 尝试）：38265204893/1

```text
not ok 1 - BL-29 existing chat changes wait for a native delta, wake immediately and retain exact cursor semantics
  ---
  duration_ms: 4526.303508
  type: 'test'
  location: '/home/runner/work/weftmate/weftmate/tests/bl-29-wait.test.ts:7:1'
  failureType: 'testCodeFailure'
  error: "Cannot read properties of undefined (reading 'data')"
  code: 'ERR_TEST_FAILURE'
  name: 'TypeError'
  stack: |-
    TestContext.<anonymous> (file:///home/runner/work/weftmate/weftmate/tests/bl-29-wait.test.ts:18:40)
    async Test.run (node:internal/test_runner/test:1409:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
  ...
```

## 16 · tests/bl-29-rework.test.ts · BL-29b M5/S2 gateway shutdown and runtime dispose respond SERVICE_CLOSING promptly

run / attempt（运行 / 尝试）：38328244218/1

```text
not ok 4 - BL-29b M5/S2 gateway shutdown and runtime dispose respond SERVICE_CLOSING promptly
  ---
  duration_ms: 2402.584746
  type: 'test'
  location: '/home/runner/work/weftmate/weftmate/tests/bl-29-rework.test.ts:46:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    false !== true
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///home/runner/work/weftmate/weftmate/tests/bl-29-rework.test.ts:48:12)
    Test.runInAsyncScope (node:async_hooks:227:14)
    Test.run (node:internal/test_runner/test:1402:25)
    Test.processPendingSubtests (node:internal/test_runner/test:974:18)
    Test.postRun (node:internal/test_runner/test:1542:19)
    Test.run (node:internal/test_runner/test:1467:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 17 · tests/packaged-project-reader.test.ts · bundled project reader runs from a real ASAR without extracting an executable script

run / attempt（运行 / 尝试）：38298416230/2

```text
not ok 1 - bundled project reader runs from a real ASAR without extracting an executable script
  ---
  duration_ms: 18871.2526
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\packaged-project-reader.test.ts:11:1'
  failureType: 'testCodeFailure'
  error: |-
    electronApplication.evaluate: Error: PROJECT_READER_TIMEOUT
        at issue (file:///C:/weftmate-temp/weftmate-ci-file-LHwnYy/weftmate-fx21-asar-mwRkyE/app.asar/index.mjs:16:24)
        at Timeout.<anonymous> (file:///C:/weftmate-temp/weftmate-ci-file-LHwnYy/weftmate-fx21-asar-mwRkyE/app.asar/index.mjs:38:59)
        at listOnTimeout (node:internal/timers:685:17)
        at process.processTimers (node:internal/timers:618:7)
  code: 'ERR_TEST_FAILURE'
  stack: |-
    issue (file:///C:/weftmate-temp/weftmate-ci-file-LHwnYy/weftmate-fx21-asar-mwRkyE/app.asar/index.mjs:16:24)
    Timeout.<anonymous> (file:///C:/weftmate-temp/weftmate-ci-file-LHwnYy/weftmate-fx21-asar-mwRkyE/app.asar/index.mjs:38:59)
    listOnTimeout (node:internal/timers:685:17)
    process.processTimers (node:internal/timers:618:7)
    TestContext.<anonymous> (D:\a\weftmate\weftmate\tests\packaged-project-reader.test.ts:22:28)
  ...
```

## 18 · tests/personal-access-multi-account.test.ts · concurrent accounts keep owner, text and duplicate request namespace through delayed dispatch

run / attempt（运行 / 尝试）：38309679841/1

```text
not ok 5 - concurrent accounts keep owner, text and duplicate request namespace through delayed dispatch
  ---
  duration_ms: 12931.286
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\personal-access-multi-account.test.ts:320:1'
  failureType: 'testCodeFailure'
  error: 'fixture command did not settle'
  code: 'ERR_TEST_FAILURE'
  stack: |-
    eventually (file:///D:/a/weftmate/weftmate/tests/personal-access-multi-account.test.ts:84:9)
    async TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/personal-access-multi-account.test.ts:351:7)
    async Test.run (node:internal/test_runner/test:1409:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 19 · tests/personal-conversation-adoption.test.ts · D37 moving an adopted owner conversation into a project preserves its phone binding and sends with both contexts

run / attempt（运行 / 尝试）：38282932545/1

```text
not ok 10 - D37 moving an adopted owner conversation into a project preserves its phone binding and sends with both contexts
  ---
  duration_ms: 7471.9359
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\personal-conversation-adoption.test.ts:479:1'
  failureType: 'testCodeFailure'
  error: 'command did not settle'
  code: 'ERR_TEST_FAILURE'
  stack: |-
    waitCommand (file:///D:/a/weftmate/weftmate/tests/personal-conversation-adoption.test.ts:60:9)
    async TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/personal-conversation-adoption.test.ts:490:18)
    async Test.run (node:internal/test_runner/test:1409:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 20 · tests/ia-2b-relay.test.ts · durable main sends bind once, queue during relay, keep attachments, recover unpublished target and preserve source receipts

run / attempt（运行 / 尝试）：38273888476/1

```text
not ok 1 - durable main sends bind once, queue during relay, keep attachments, recover unpublished target and preserve source receipts
  ---
  duration_ms: 12633.3869
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\ia-2b-relay.test.ts:10:1'
  failureType: 'testCodeFailure'
  error: 'pending command did not settle'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  operator: 'fail'
  stack: |-
    wait (file:///D:/a/weftmate/weftmate/tests/ia-2b-relay.test.ts:45:14)
    runNextTicks (node:internal/process/task_queues:65:5)
    process.processTimers (node:internal/timers:615:9)
    async TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/ia-2b-relay.test.ts:54:19)
    async Test.run (node:internal/test_runner/test:1409:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
  ...
```

## 21 · tests/personal-cloud.test.ts · FX-11 first native write registers a cloud owner's artifact in project conversation

run / attempt（运行 / 尝试）：38298416230/1

```text
not ok 16 - FX-11 first native write registers a cloud owner's artifact in project conversation
  ---
  duration_ms: 23395.6943
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\personal-cloud.test.ts:550:3'
  failureType: 'testCodeFailure'
  error: |-
    {"error":{"code":"PROJECT_READER_TIMEOUT"},"status":503}
    
    503 !== 201
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 201
  actual: 503
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/personal-cloud.test.ts:572:14)
    process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    async Test.run (node:internal/test_runner/test:1409:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 22 · tests/personal-activity.test.ts · FX-18 recovered memory appears as one quiet progress event and completes without a pause

run / attempt（运行 / 尝试）：38298416230/2

```text
not ok 6 - FX-18 recovered memory appears as one quiet progress event and completes without a pause
  ---
  duration_ms: 3549.2361
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\personal-activity.test.ts:93:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + '正在继续整理上次没做完的记忆'
    - '上次没做完的记忆已整理完成'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: '上次没做完的记忆已整理完成'
  actual: '正在继续整理上次没做完的记忆'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/personal-activity.test.ts:104:10)
    process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    async Test.run (node:internal/test_runner/test:1409:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 23 · workflow · Install dependencies

run / attempt（运行 / 尝试）：38256305332/1

```text
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:20.4216081Z env:
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:20.4216389Z   WEFTMATE_TEST_HOST_NAME: synthetic-host
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:20.4216747Z   CI_TEST_OS: ubuntu-latest
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:20.4217244Z   PLAYWRIGHT_BROWSERS_PATH: /home/runner/work/weftmate/weftmate/.local/ci-browser-cache
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:20.4218152Z ##[endgroup]
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:22.7165686Z npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:22.7503002Z npm warn deprecated rimraf@2.6.3: Rimraf versions prior to v4 are no longer supported
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:22.7681080Z npm warn deprecated lodash.isequal@4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:22.8251691Z npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:22.8267148Z npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:23.7034579Z npm warn deprecated glob@10.5.0: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
test (ubuntu-latest, shard 2/3)	UNKNOWN STEP	2026-10-12T13:32:28.7678088Z npm error code 1
test (ubuntu-latest, shard 2/3)	UNKNOWN
```

## 24 · tests/offline-task-queue.test.ts · phone encrypts using the existing replica envelope; wrong key, host and ciphertext fail without leaking text

run / attempt（运行 / 尝试）：38334246599/1

```text
not ok 1 - phone encrypts using the existing replica envelope; wrong key, host and ciphertext fail without leaking text
  ---
  duration_ms: 109.611713
  type: 'test'
  location: '/home/runner/work/weftmate/weftmate/tests/offline-task-queue.test.ts:17:1'
  failureType: 'testCodeFailure'
  error: 'Missing expected exception.'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
    code: 'OFFLINE_TASK_INVALID'
  operator: 'throws'
  stack: |-
    TestContext.<anonymous> (file:///home/runner/work/weftmate/weftmate/tests/offline-task-queue.test.ts:23:12)
    async Test.run (node:internal/test_runner/test:1409:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
  ...
```

## 25 · tests/rob-1-electron.test.ts · real Windows Electron survives first-run and legacy-upgrade interruption at every credential commit phase

run / attempt（运行 / 尝试）：38324349558/1

```text
not ok 1 - real Windows Electron survives first-run and legacy-upgrade interruption at every credential commit phase
  ---
  duration_ms: 260912.5783
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\rob-1-electron.test.ts:5:1'
  failureType: 'testCodeFailure'
  error: |-
    node:internal/modules/run_main:107
        triggerUncaughtException(
        ^
    
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    + actual - expected
    
    + '0x0000004A'
    - '0x00000000'
               ^
    
        at file:///D:/a/weftmate/weftmate/tests/integration/rob-1-vault-matrix.mjs:26:28
        at process.processTicksAndRejections (node:internal/process/task_queues:104:5) {
      generatedMessage: true,
      code: 'ERR_ASSERTION',
      actual: '0x0000004A',
      expected: '0x00000000',
      operator: 'strictEqual',
      diff: 'simple'
    }
    
    Node.js v24.21.0
    
    
    1 !== 0
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 0
  actual: 1
  operator: 'strictEqual'
  stack: |-
    file:///D:/a/weftmate/weftmate/tests/integration/rob-1-vault-matrix.mjs:26:28
    process.processTicksAndRejections (node:internal/process/task_queues:104:5) {
    TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/rob-1-electron.test.ts:9:39)
    process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    async Test.run (node:internal/test_runner/test:1409:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
  ...
```

## 26 · tests/personal-user-questions.test.ts · revoked source credentials and a changed model destination cannot receive late information answers

run / attempt（运行 / 尝试）：38309693305/1

```text
not ok 12 - revoked source credentials and a changed model destination cannot receive late information answers
  ---
  duration_ms: 5229.2944
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\personal-user-questions.test.ts:415:1'
  failureType: 'testCodeFailure'
  error: 'synthetic source not accepted'
  code: 'ERR_TEST_FAILURE'
  stack: |-
    command (file:///D:/a/weftmate/weftmate/tests/personal-user-questions.test.ts:77:11)
    async fixture (file:///D:/a/weftmate/weftmate/tests/personal-user-questions.test.ts:80:18)
    async TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/personal-user-questions.test.ts:417:15)
    async Test.run (node:internal/test_runner/test:1409:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 27 · tests/personal-tool-approvals.test.ts · task reply projection forwards a known limit cause while retaining an existing observed artifact

run / attempt（运行 / 尝试）：38285265478/1

```text
not ok 7 - task reply projection forwards a known limit cause while retaining an existing observed artifact
  ---
  duration_ms: 5586.6871
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\personal-tool-approvals.test.ts:251:1'
  failureType: 'testCodeFailure'
  error: 'synthetic command did not acquire a receipt'
  code: 'ERR_TEST_FAILURE'
  stack: |-
    command (file:///D:/a/weftmate/weftmate/tests/personal-tool-approvals.test.ts:115:11)
    async fixture (file:///D:/a/weftmate/weftmate/tests/personal-tool-approvals.test.ts:129:18)
    async TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/personal-tool-approvals.test.ts:252:13)
    async Test.run (node:internal/test_runner/test:1409:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 28 · tests/personal-dynamic-write-targets.test.ts · tests\\personal-dynamic-write-targets.test.ts

run / attempt（运行 / 尝试）：38309679841/1

```text
not ok 1 - tests\\personal-dynamic-write-targets.test.ts
  ---
  duration_ms: 455.6619
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\personal-dynamic-write-targets.test.ts:1:1'
  failureType: 'testCodeFailure'
  exitCode: 3221225477
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
Preceding file output:
ok 23 - pwsh: new and existing targets: Set-Location sub; $p='TARGET'; Set-Content $p data
  ---
  duration_ms: 5.0627
  type: 'test'
  ...
# Subtest: pwsh: new and existing targets: Push-Location sub; $p='TARGET'; Set-Content $p data; Pop-Location
ok 24 - pwsh: new and existing targets: Push-Location sub; $p='TARGET'; Set-Content $p data; Pop-Location
  ---
  duration_ms: 5.3341
  type: 'test'
  ...
# Subtest: pwsh: new and existing targets: Push-Location sub; Pop-Location; Set-Content TARGET data
ok 25 - pwsh: new and existing targets: Push-Location sub; Pop-Location; Set-Content TARGET data
  ---
  duration_ms: 5.0018
  type: 'test'
  ...
# Subtest: pwsh: new and existing targets: $env:APR_TEST_DIR=$PWD.Path; $p=Join-Path $env:APR_TEST_DIR 'TARGET'; Out-File $p
ok 26 - pwsh: new and existing targets: $env:APR_TEST_DIR=$PWD.Path; $p=Join-Path $env:APR_TEST_DIR 'TARGET'; Out-File $p
  ---
  duration_ms: 5.8688
  type: 'test'
  ...
# Subtest: pwsh: new and existing targets: $p=Join-Path $env:TEMP 'APR_TEST_TARGET'; Set-Content $p data
ok 27 - pwsh: new and existing targets: $p=Join-Path $env:TEMP 'APR_TEST_TARGET'; Set-Content $p data
  ---
  duration_ms: 5.0185
  type: 'test'
  ...
# Subtest: bash: new and existing targets: DIR=$(pwd); P="$DIR/TARGET"; echo data > "$P"
ok 28 - bash: new and existing targets: DIR=$(pwd); P="$DIR/TARGET"; echo data > "$P"
  ---
  duration_ms: 5.0696
  type: 'test'
  ...
# Subtest: bash: new and existing targets: cd sub; P=TARGET; echo data >> "$P"
ok 29 - bash: new and existing targets: cd sub; P=TARGET; echo data >> "$P"
  ---
  duration_ms: 5.0853
  type: 'test'
  ...
# Subtest: bash: new and existing targets: P=TARGET; curl https://example.org -o "$P"
ok 30 - bash: new and existing targets: P=TARGET; curl https://example.org -o "$P"
  ---
  duration_ms: 5.2662
  type: 'test'
  ...
# Subtest: bash: new and existing targets: P="$PWD/TARGET"; curl --output "$P" https://example.org
ok 31 - bash: new and existing targets: P="$PWD/TARGET"; curl --output "$P" https://example.org
  ---
  duration_
```

## 29 · tests/vendor-cache-safety.test.ts · tests\\vendor-cache-safety.test.ts

run / attempt（运行 / 尝试）：38330189442/1

```text
not ok 1 - tests\\vendor-cache-safety.test.ts
  ---
  duration_ms: 161784.5237
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\vendor-cache-safety.test.ts:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
Preceding file output:
  ...
# Subtest: UX-3 timeline borrows observed killed job state only from the matching session/turn/call, leaving records intact
ok 9 - UX-3 timeline borrows observed killed job state only from the matching session/turn/call, leaving records intact
  ---
  duration_ms: 0.483
  type: 'test'
  ...
# Subtest: UX-3 recovered failed writes never count as successfully modified files
ok 10 - UX-3 recovered failed writes never count as successfully modified files
  ---
  duration_ms: 0.4186
  type: 'test'
  ...
# Subtest: UX-3 confirmed user stop overrides an error generated during cancellation but never changes a completed round
ok 11 - UX-3 confirmed user stop overrides an error generated during cancellation but never changes a completed round
  ---
  duration_ms: 0.196
  type: 'test'
  ...
# Subtest: UX-3 same filename without a recorded location never drops an ambiguous final delivery
ok 12 - UX-3 same filename without a recorded location never drops an ambiguous final delivery
  ---
  duration_ms: 0.141
  type: 'test'
  ...
# Subtest: UX-3 signal words in filenames never invent an interruption, but structured tool signals do
ok 13 - UX-3 signal words in filenames never invent an interruption, but structured tool signals do
  ---
  duration_ms: 0.2604
  type: 'test'
  ...
# Subtest: UX-3 successful reads of JSON status data never become interrupted steps when their details expand
ok 14 - UX-3 successful reads of JSON status data never become interrupted steps when their details expand
  ---
  duration_ms: 0.2405
  type: 'test'
  ...
1..14
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 190.0206
{"directory":"weftmate-ci-file-cCWSA8","root":"C:\\weftmate-temp","bytes":200,"lastWriteTime":"2026-10-13T01:20:07.766Z","owner":{"schemaVersion":1,"pid":7324,"processStartedAt":"2026-10-13T01:06:44.636Z","createdAt":"2026-10-13T01:20:07.762Z","heartbeatAt":"2026-10-13T01:20:07.764Z","id":"5594dff1-226d-456b-8f9e-aa571484fa68"},"mode":"owned-dispose","result":"deleting"}
{"directory":"weftmate-ci-file-cCWSA8","root":"C:\\we
```

## 30 · tests/integration/review-capture-mobile.mjs · question (dark): 等待「提问条」页面元素超时

run / attempt（运行 / 尝试）：38334246587/1

```text
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:39.3387774Z Desktop dark: question prepare started
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:40.8247243Z Desktop dark: question home ready
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:40.9897433Z Desktop dark: question reject clicked
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.0329923Z Desktop dark: question decision response {"status":200,"approvalStatus":"answered","outcome":"rejected"}
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.0570718Z Desktop dark: question native approval resolved
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.3344504Z Desktop dark: question region visible
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.4174101Z Desktop dark: question option visible
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.8892417Z Desktop dark: question captured
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.8893272Z Desktop dark: suggestions switch unroute started
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.8917088Z Desktop dark: suggestions switch unroute ended
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.8917938Z Desktop dark: suggestions switch renderer stop started
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.8931327Z Desktop dark: suggestions switch renderer stop ended
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.8931865Z Desktop dark: suggestions switch renderer unload started
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.9329885Z Desktop dark: suggestions switch renderer unload ended
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.9333598Z Desktop dark: suggestions switch native close started
Synthetic multi-device review gallery	Capture isolated synthetic scenes	2026-10-13T01:56:41.9546436Z Desktop dark: suggestions switch native cl
```

## 31 · tests/integration/review-capture-mobile.mjs · question (light): 等待「提问条」页面元素超时

run / attempt（运行 / 尝试）：38329373620/1

```text
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.5887511Z Desktop dark: finally primary fixture close started
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.6059084Z Desktop dark: finally primary fixture close ended
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.6059567Z Desktop dark: finally main fixture close started
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.6073593Z Desktop dark: finally main fixture close ended
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.6074334Z Desktop dark: finally suggestions fixture close started
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.6088051Z Desktop dark: finally suggestions fixture close ended
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.6089459Z Desktop dark: finally profiles remove started
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.7521856Z Desktop dark: finally profiles remove ended
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.7522643Z Desktop dark: finally primary root remove started
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.7563919Z Desktop dark: finally primary root remove ended
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.7564566Z Desktop dark: finally main root remove started
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.7585563Z Desktop dark: finally main root remove ended
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.7586126Z Desktop dark: finally suggestions root remove started
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:55:58.7623622Z Desktop dark: finally suggestions root remove ended
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:57:12.3181514Z mobile-web/question/light: 截图失败：等待「提问条」页面元素超时
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:57:21.6668650Z Mobile light: scene outcomes recorded.
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:58:32.6298564Z mobile-web/question/dark: 截图失败：等待「提问条」页面元素超时
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:58:41.8269486Z Mobile dark: scene outcomes recorded.
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T00:58:41.9025865Z Primary mobile cap
```

## 32 · workflow · synthetic command not accepted

run / attempt（运行 / 尝试）：38330313294/1

```text
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T01:09:57.5013977Z     at async shot (file:///D:/a/weftmate/weftmate/tests/integration/review-capture-mobile.mjs:81:24)
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T01:09:57.5015177Z     at async file:///D:/a/weftmate/weftmate/tests/integration/review-capture-mobile.mjs:155:7 Error: command not accepted
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T01:09:57.5016544Z     at command (file:///D:/a/weftmate/weftmate/tests/integration/timeline-ui-candidate.mjs:142:314)
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T01:09:57.5017574Z     at async startTimelineCandidate (file:///D:/a/weftmate/weftmate/tests/integration/timeline-ui-candidate.mjs:145:18)
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T01:09:57.5018533Z     at async file:///D:/a/weftmate/weftmate/tests/integration/review-capture-mobile.mjs:155:70
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T01:09:57.5019093Z     at async runScene (file:///D:/a/weftmate/weftmate/scripts/review-gallery/common.mjs:25:9)
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T01:09:57.5019613Z     at async shot (file:///D:/a/weftmate/weftmate/tests/integration/review-capture-mobile.mjs:81:24)
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T01:09:57.5026517Z     at async file:///D:/a/weftmate/weftmate/tests/integration/review-capture-mobile.mjs:155:7
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T01:09:57.5337013Z {"directory":"weftmate-m0-3-vyIAjS","root":"C:\\weftmate-temp","bytes":43345,"lastWriteTime":"2026-10-13T01:09:52.767Z","owner":{"schemaVersion":1,"pid":7752,"processStartedAt":"2026-10-13T01:08:27.270Z","createdAt":"2026-10-13T01:08:52.763Z","heartbeatAt":"2026-10-13T01:09:52.766Z","id":"a97ed9ba-d353-4d82-848c-f7d7bc38bd04"},"mode":"owned-dispose","result":"deleting"}
Synthetic multi-device review gallery	UNKNOWN STEP	2026-10-13T01:09:57.5372154Z {"directory":"weftmate-m0-3-vyIAjS","root":"C:\\weftmate-temp","bytes":43345,"lastWriteTime":"2026-10-13T01:09:52.767Z","owner":{"schemaVersion":1,"pid":7752,"processStartedAt":"2026-10-13T01:08:27.270Z","createdAt":"2026-10-13T01:08:52.763Z","heartbeatAt":"2026-10-13T01:09:52.766Z","id":"a97ed9ba-d353-4d82-848c-f7d7bc38bd04"},"mode":"owned-dispose","result":"deleted"}
Synthetic multi-device revie
```

## 33 · scripts/nightly/installed-smoke.mjs · locator.waitFor: Timeout 15000ms exceeded.

run / attempt（运行 / 尝试）：38317040857/1

```text
locator.waitFor: Timeout 15000ms exceeded.
Call log:
[2m  - waiting for locator('[data-conversation-approval="b8c07d43-6cea-4390-a155-3f83c62b6b2c"]').getByRole('button', { name: '批准', exact: true }) to be visible[22m

    at D:\a\weftmate\weftmate\scripts\nightly\installed-smoke.mjs:98:21
    at async until (D:\a\weftmate\weftmate\tests\helpers\migration-host.mjs:18:44)
    at async file:///D:/a/weftmate/weftmate/scripts/nightly/installed-smoke.mjs:93:3
```

## 34 · tests/helpers/migration-host.mjs · Error: MIGRATION_SMOKE_TIMEOUT

run / attempt（运行 / 尝试）：38324429475/1

```text
Error: MIGRATION_SMOKE_TIMEOUT
    at until (file:///D:/a/weftmate/weftmate/tests/helpers/migration-host.mjs:19:9)
    at async file:///D:/a/weftmate/weftmate/scripts/nightly/installed-smoke.mjs:74:20
```

## 35 · apps/mobile-ui/tests/composer-viewport.test.mjs · the fifth mobile tab opens health, keeps other tabs reachable and quotes without sending

run / attempt（运行 / 尝试）：38273888252/1

```text
✖ the fifth mobile tab opens health, keeps other tabs reachable and quotes without sending (4886.14591ms)
  Error: Unknown synthetic health route
      at Object.reply (file:///home/runner/work/weftmate/weftmate/tests/helpers/health-page-synthetic.mjs:18:538)
      at file:///home/runner/work/weftmate/weftmate/apps/mobile-ui/tests/composer-viewport.test.mjs:84:198
      at RouteHandler._handleInternal (/home/runner/work/weftmate/weftmate/apps/mobile-ui/node_modules/playwright-core/lib/client/network.js:695:7)
      at RouteHandler._handleImpl (/home/runner/work/weftmate/weftmate/apps/mobile-ui/node_modules/playwright-core/lib/client/network.js:662:25)
      at /home/runner/work/weftmate/weftmate/apps/mobile-ui/node_modules/playwright-core/lib/client/network.js:656:55
      at AsyncLocalStorage.run (node:internal/async_local_storage/async_context_frame:65:14)
      at Zone.run (/home/runner/work/weftmate/weftmate/apps/mobile-ui/node_modules/playwright-core/lib/server/utils/zones.js:42:36)
      at NodeZone.run (/home/runner/work/weftmate/weftmate/apps/mobile-ui/node_modules/playwright-core/lib/server/utils/nodePlatform.js:58:23)
      at RouteHandler.handle (/home/runner/work/weftmate/weftmate/apps/mobile-ui/node_modules/playwright-core/lib/client/network.js:656:34)
      at Page._onRoute (/home/runner/work/weftmate/weftmate/apps/mobile-ui/node_modules/playwright-core/lib/client/page.js:146:42)
##[error]Process completed with exit code 1.
##[group]Run actions/upload-artifact@v4
with:
  name: s1c-web-synthetic
  path: .local/s1c-web/*.png
.local/ui-2a/*.png
.local/ui-2/*.png

  if-no-files-found: ignore
  compression-level: 6
  overwrite: false
  include-hidden-files: false
##[endgroup]
(node:3379) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
Multiple search paths detected. Calculating the least common ancestor of all paths
The least common ancestor is /home/runner/work/weftmate/weftmate/.local. This will be the root directory of the artifact
With the provided path, there will be 17 files uploaded
Artifact name is valid!
Root directory input is valid!
Beginning upload of artifact content to blob storage
(node:3379) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have securi
```

## 36 · workflow · Run gradle --no-daemon :app:assembleDebug :app:testDebugUnitTest

run / attempt（运行 / 尝试）：38324429450/1

```text
Android debug and JVM tests	UNKNOWN STEP	2026-10-12T23:59:54.4203232Z w: file:///home/runner/work/weftmate/weftmate/apps/android/app/src/main/java/com/memoweft/weftmate/mobile/MainActivity.kt:792:80 'static field SOFT_INPUT_ADJUST_RESIZE: Int' is deprecated. Deprecated in Java.
Android debug and JVM tests	UNKNOWN STEP	2026-10-12T23:59:55.8959603Z 
Android debug and JVM tests	UNKNOWN STEP	2026-10-12T23:59:55.8961046Z > Task :app:compileDebugJavaWithJavac
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:00.2972506Z > Task :app:dexBuilderDebug
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:00.3033227Z > Task :app:mergeDebugGlobalSynthetics
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:00.3122989Z > Task :app:processDebugJavaRes
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:00.3963353Z > Task :app:bundleDebugClassesToRuntimeJar
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:00.4013077Z > Task :app:bundleDebugClassesToCompileJar
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:00.6972836Z > Task :app:mergeProjectDexDebug
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:01.1993448Z > Task :app:mergeDebugJavaResource
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:01.9973387Z > Task :app:packageDebug
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:02.0973323Z > Task :app:createDebugApkListingFileRedirect
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:02.1032917Z > Task :app:assembleDebug
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:02.7967608Z 
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:02.7993054Z > Task :app:compileDebugUnitTestKotlin
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:02.8023544Z w: file:///home/runner/work/weftmate/weftmate/apps/android/app/src/test/java/com/memoweft/weftmate/mobile/ClientRouteInventoryUnitTest.kt:10:25 Java type mismatch: inferred type is 'kotlin.String?', but 'kotlin.String' was expected.
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:02.8052323Z 
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:02.8052703Z > Task :app:compileDebugUnitTestJavaWithJavac NO-SOURCE
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:02.8053286Z > Task :app:processDebugUnitTestJavaRes
Android debug and JVM tests	UNKNOWN STEP	2026-10-13T00:00:04.7960057Z 
Android debug and JVM tests	UNK
```

## 37 · services/cloud/test/relay-e2e.test.mjs · S2 real frp + cloud + host + HAProxy on 443: private content, browser auth, SSE, history, attachments, reconnect, pin and revoke

run / attempt（运行 / 尝试）：38288667714/1

```text
✖ S2 real frp + cloud + host + HAProxy on 443: private content, browser auth, SSE, history, attachments, reconnect, pin and revoke (31922.943454ms)
  Error: frpc did not become online: {"state":"stopped","baseUrl":null,"certificateExpiresAt":null,"certificateErrorCode":null}
      at waitFor (file:///home/runner/work/weftmate/weftmate/services/cloud/test/relay-fixture.mjs:33:9)
      at async TestContext.<anonymous> (file:///home/runner/work/weftmate/weftmate/services/cloud/test/relay-e2e.test.mjs:71:7)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
##[error]Process completed with exit code 1.
Post job cleanup.
[command]/usr/bin/git version
git version 2.55.0
Temporarily overriding HOME='/home/runner/work/_temp/25f94e0d-6f13-41b3-a5d4-790249e14d19' before making global git config changes
Adding repository directory to the temporary git global config as a safe directory
[command]/usr/bin/git config --global --add safe.directory /home/runner/work/weftmate/weftmate
[command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
[command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
[command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
http.https://github.com/.extraheader
[command]/usr/bin/git config --local --unset-all http.https://github.com/.extraheader
[command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
[command]/usr/bin/git config --local --name-only --get-regexp ^includeIf\.gitdir:
[command]/usr/bin/git submodule foreach --recursive git config --local --show-origin --name-only --get-regexp remote.origin.url
Cleaning up orphan processes
##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

```

## 38 · services/cloud/test/relay-phone.test.mjs · Relay phone first input and file task

run / attempt（运行 / 尝试）：38329373626/1

```text
✖ Relay phone first input and file task (48197.586348ms)
  Error: first send did not complete
      at waitFor (file:///home/runner/work/weftmate/weftmate/services/cloud/test/relay-fixture.mjs:33:9)
      at async TestContext.<anonymous> (file:///home/runner/work/weftmate/weftmate/services/cloud/test/relay-phone.test.mjs:168:7)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
##[error]Process completed with exit code 1.
##[group]Run actions/upload-artifact@v4
with:
  name: relay-phone-diagnostics
  path: /home/runner/work/_temp/relay-phone
  if-no-files-found: warn
  retention-days: 7
  compression-level: 6
  overwrite: false
  include-hidden-files: false
env:
  DSH_PIN: 47f943859bef60e4160492346772ded9b24f765a
  PNPM_HOME: /home/runner/setup-pnpm/node_modules/.bin
##[endgroup]
(node:4230) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
With the provided path, there will be 5 files uploaded
Artifact name is valid!
Root directory input is valid!
Beginning upload of artifact content to blob storage
(node:4230) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
Uploaded bytes 44350
Finished uploading artifact content to blob storage!
SHA256 digest of uploaded artifact zip is 2fe88090e2338fb63968e8d2198ad981b46b8777bc37f71f9cf2a892e3f92ea0
Finalizing artifact upload
Artifact relay-phone-diagnostics.zip successfully finalized. Artifact ID 11782053997
Artifact relay-phone-diagnostics has been successfully uploaded! Final size is 44350 bytes. Artifact ID is 11782053997
Artifact download URL: https://github.com/memoweft/weftmate/actions/runs/38329373626/artifacts/11782053997
Post job cleanup.
Pruning is unnecessary.
Post job cleanup.
[command]/usr/bin/git version
git version 2.55.0
Temporarily overriding HOME='/home/runner/work/_temp/dcc22e59-8ada-4714-9598-e0f9a6b321e2' before making global git config changes
Adding repository directory to the temporary git global config as a safe directory
[command]/usr/bin/git config --global --add safe.directory /home/runner/work/weftmate
```

## 39 · services/cloud/test/relay-phone.test.mjs · Relay phone first input and file task

run / attempt（运行 / 尝试）：38329373626/2

```text
✖ Relay phone first input and file task (102132.611657ms)
  locator.waitFor: Timeout 15000ms exceeded.
  Call log:
    - waiting for getByRole('button', { name: '批准', exact: true }) to be visible
  
      at /home/runner/work/weftmate/weftmate/services/cloud/test/relay-phone.test.mjs:195:95
      at async waitFor (/home/runner/work/weftmate/weftmate/services/cloud/test/relay-fixture.mjs:32:39)
      at async TestContext.<anonymous> (/home/runner/work/weftmate/weftmate/services/cloud/test/relay-phone.test.mjs:191:5) {
    name: 'TimeoutError',
    log: [ "  - waiting for getByRole('button', { name: '批准', exact: true }) to be visible" ]
  }
##[error]Process completed with exit code 1.

```

## 40 · services/cloud/test/host-certificates-pebble.test.mjs · Pebble DNS-01: real host proof → AliDNS API/TXT → issuance → installed TLS/pairing pin → daily renewal without adapter restart

run / attempt（运行 / 尝试）：38288667711/1

```text
✖ Pebble DNS-01: real host proof → AliDNS API/TXT → issuance → installed TLS/pairing pin → daily renewal without adapter restart (34151.476217ms)
  Error: Timed out: certificate and TLS adapter installed
      at waitFor (file:///home/runner/work/weftmate/weftmate/services/cloud/test/host-certificates-pebble.test.mjs:28:9)
      at async TestContext.<anonymous> (file:///home/runner/work/weftmate/weftmate/services/cloud/test/host-certificates-pebble.test.mjs:93:7)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
##[error]Process completed with exit code 1.
Post job cleanup.
[command]/usr/bin/git version
git version 2.55.0
Temporarily overriding HOME='/home/runner/work/_temp/2a6b4934-0899-4531-b7c0-7ea160653c1b' before making global git config changes
Adding repository directory to the temporary git global config as a safe directory
[command]/usr/bin/git config --global --add safe.directory /home/runner/work/weftmate/weftmate
[command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
[command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
[command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
http.https://github.com/.extraheader
[command]/usr/bin/git config --local --unset-all http.https://github.com/.extraheader
[command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
[command]/usr/bin/git config --local --name-only --get-regexp ^includeIf\.gitdir:
[command]/usr/bin/git submodule foreach --recursive git config --local --show-origin --name-only --get-regexp remote.origin.url
Cleaning up orphan processes
##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

```

## 41 · workflow · Download official test tools (SHA256 checked)

run / attempt（运行 / 尝试）：38255458497/1

```text
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.2240495Z Updating files:  88% (18922/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.2679675Z Updating files:  89% (19137/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.3011093Z Updating files:  90% (19352/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.3344142Z Updating files:  91% (19567/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.3853184Z Updating files:  92% (19782/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.4554273Z Updating files:  93% (19997/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.4908908Z Updating files:  94% (20212/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.5303287Z Updating files:  95% (20427/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.5609987Z Updating files:  96% (20642/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.5710846Z Updating files:  97% (20857/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.5828247Z Updating files:  98% (21072/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.5948755Z Updating files:  99% (21287/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.5949395Z Updating files: 100% (21502/21502)
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.5949608Z Updating files: 100% (21502/21502), done.
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.6733645Z Switched to a new branch 'main'
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.6738757Z branch 'main' set up to track 'origin/main'.
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.6898945Z ##[endgroup]
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.6942412Z [command]/usr/bin/git log -1 --format=%H
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.6965433Z 5e1766ca700e90217f16a5142f81cdfed1b68595
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.7253090Z ##[group]Run actions/setup-node@v4
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.7253245Z with:
Host certificates (Pebble DNS-01)	UNKNOWN STEP	2026-10-12T13:24:45.7253360Z   node-version: 24
```

## 42 · tests/bl-29-runtime-close.test.ts · BL-29c N5 parent deadline cleans owned children without retrying or changing product limits

run / attempt（运行 / 尝试）：38289148501/1

```text
not ok 22 - BL-29c N5 parent deadline cleans owned children without retrying or changing product limits
  ---
  duration_ms: 2860.704012
  type: 'test'
  location: '/home/runner/work/weftmate/weftmate/tests/bl-29-runtime-close.test.ts:38:1'
  failureType: 'testCodeFailure'
  error: 'Owned processes remain: [6355]'
  code: 'ERR_TEST_FAILURE'
  stack: |-
    superviseExit (file:///home/runner/work/weftmate/weftmate/tests/integration/bl29-rework/exit-supervisor.mjs:105:33)
    process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    async TestContext.<anonymous> (file:///home/runner/work/weftmate/weftmate/tests/bl-29-runtime-close.test.ts:39:13)
    async Test.run (node:internal/test_runner/test:1409:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```

## 43 · tests/bl-29-runtime-close.test.ts · BL-29c N5 parent cleans the whole owned Electron set when the driver is terminated after first window

run / attempt（运行 / 尝试）：38290471674/1

```text
not ok 21 - BL-29c N5 parent cleans the whole owned Electron set when the driver is terminated after first window
  ---
  duration_ms: 2338.407993
  type: 'test'
  location: '/home/runner/work/weftmate/weftmate/tests/bl-29-runtime-close.test.ts:27:1'
  failureType: 'testCodeFailure'
  error: 'Owned processes remain: [6075]'
  code: 'ERR_TEST_FAILURE'
  stack: |-
    superviseExit (file:///home/runner/work/weftmate/weftmate/tests/integration/bl29-rework/exit-supervisor.mjs:105:33)
    process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    async TestContext.<anonymous> (file:///home/runner/work/weftmate/weftmate/tests/bl-29-runtime-close.test.ts:28:15)
    async Test.run (node:internal/test_runner/test:1409:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```
