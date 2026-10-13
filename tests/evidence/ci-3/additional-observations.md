# 起点统计后的补充观测

[MOB-3检查运行](https://github.com/memoweft/weftmate/actions/runs/38338730234)，第一次尝试，Windows第二片；保留实际功能失败和作业取消，取消不伪装成叶断言。

| 文件 | 用例／失败 | 定性 | 依据与修复 |
|---|---|---|---|
| tests/dsh-web-runtime-lifecycle.test.ts | start-close race：启动中 child 被关闭，start 明确 reject，且 close 可并发复用 | 夹具竞态 | waitForFile 固定100次轮询，慢机未发布PID就关闭测试；改为实际非空文件就绪与启动失败信号，after关闭全部自有运行时，防止EBUSY。 |
| tests/dsh-web-runtime-lifecycle.test.ts | D:\\a\\weftmate\\weftmate\\tests\\dsh-web-runtime-lifecycle.test.ts | 夹具竞态 | waitForFile 固定100次轮询，慢机未发布PID就关闭测试；改为实际非空文件就绪与启动失败信号，after关闭全部自有运行时，防止EBUSY。 |
| tests/personal-cloud.test.ts | AUTH-1 cloud login on a fresh native desktop keeps its durable local owner; another cloud identity cannot replace it | 夹具竞态 | createdCloudSession 固定100次轮询；改为 waitForCommand，终态拒绝仍失败。 |

最后一个文件在03:13:05Z开始、03:15:57Z作业取消，仅运行172秒，未到该测试原350秒子进程期限；不能把这个取消称为功能失败或加入计时重跑清单。该运行已有更早的功能失败；本包保留25分钟作业、600秒文件与原叶期限，继续按正式六轮数据判断。

```text
    not ok 4 - start-close race：启动中 child 被关闭，start 明确 reject，且 close 可并发复用
      ---
      duration_ms: 2646.3319
      type: 'test'
      location: 'D:\\a\\weftmate\\weftmate\\tests\\dsh-web-runtime-lifecycle.test.ts:210:3'
      failureType: 'testCodeFailure'
      error: 'timed out waiting for C:\\weftmate-temp\\weftmate-ci-file-DkPd6O\\weftmate-dsh-runtime-lifecycle-2HbQEP\\starting-root.pid'
      code: 'ERR_TEST_FAILURE'
      stack: |-
        waitForFile (file:///D:/a/weftmate/weftmate/tests/dsh-web-runtime-lifecycle.test.ts:87:9)
        async TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/dsh-web-runtime-lifecycle.test.ts:220:28)
        async Test.run (node:internal/test_runner/test:1409:7)
        async Suite.processPendingSubtests (node:internal/test_runner/test:974:7)
      ...
```

```text
not ok 2 - D:\\a\\weftmate\\weftmate\\tests\\dsh-web-runtime-lifecycle.test.ts
  ---
  duration_ms: 5.8316
  location: 'D:\\a\\weftmate\\weftmate\\tests\\dsh-web-runtime-lifecycle.test.ts:17:1'
  failureType: 'hookFailed'
  error: "EBUSY: resource busy or locked, rmdir 'C:\\weftmate-temp\\weftmate-ci-file-DkPd6O\\weftmate-dsh-runtime-lifecycle-2HbQEP\\workspace-1288a722346e2'"
  code: 'EBUSY'
  ...
```

```text
not ok 13 - AUTH-1 cloud login on a fresh native desktop keeps its durable local owner; another cloud identity cannot replace it
  ---
  duration_ms: 8841.4841
  type: 'test'
  location: 'D:\\a\\weftmate\\weftmate\\tests\\personal-cloud.test.ts:497:1'
  failureType: 'testCodeFailure'
  error: 'session was not accepted'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  operator: 'fail'
  stack: |-
    createdCloudSession (file:///D:/a/weftmate/weftmate/tests/personal-cloud.test.ts:494:10)
    async TestContext.<anonymous> (file:///D:/a/weftmate/weftmate/tests/personal-cloud.test.ts:508:21)
    async Test.run (node:internal/test_runner/test:1409:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
  ...
```
