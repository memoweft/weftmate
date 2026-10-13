# CI-3：CI-1 合并之后的全部检查失败

起点：#242 合并 2026-10-12T13:16:07Z；采集结束：2026-10-13T02:51:02.478Z。每个工作流所有运行、所有历史尝试均保留；重跑成功不抹掉首轮失败。历史失败仅为观察，定性另见 decisions.md。

| 工作流 | 运行数 | 历史任务尝试数 | 取证错误 |
|---|---:|---:|---:|
| ci.yml | 83 | 640 | 0 |
| review-gallery.yml | 58 | 61 | 0 |
| windows-package.yml | 84 | 83 | 0 |
| s1c-web.yml | 84 | 168 | 0 |
| relay.yml | 84 | 168 | 0 |
| host-certs.yml | 84 | 84 | 0 |
| vendor-tests.yml | 85 | 84 | 0 |

| 工作流 | 检查 / 平台 | 文件 | 用例 / 步骤 | 类型 | 失败尝试数 | run / attempt（运行 / 尝试） |
|---|---|---|---|---|---:|---|
| ci.yml | Required unit tests (summary) | workflow | Total passed, failed, skipped and retry recoveries | step-failure | 53 | 38336533493/1, 38334246599/1, 38330189442/1, 38328244218/1, 38327873837/1, 38324429449/1, 38324349558/1, 38321617649/1, 38321514575/1, 38317040817/1, 38311830042/1, 38309693305/1, 38309679841/1, 38308801463/1, 38306603542/1, 38306590651/1, 38306376755/1, 38306195224/1, 38305459551/1, 38305114908/1, 38304528791/1, 38298416230/1, 38298416230/2, 38297236762/1, 38297150931/1, 38294651091/1, 38293639218/1, 38292757955/1, 38291921568/1, 38291465741/1, 38289148768/1, 38288710627/1, 38288667886/1, 38286250940/1, 38285755558/1, 38285057447/1, 38282932545/1, 38275758423/1, 38275748942/1, 38274861486/1, 38274799102/1, 38274783212/1, 38273888476/1, 38269991658/1, 38269978124/1, 38267279161/1, 38267105790/1, 38266329264/1, 38265204893/1, 38263416884/1, 38256404822/1, 38256305332/1, 38254501999/1 |
| ci.yml | test (ubuntu-latest, shard 2/3) | tests/ui-core.test.ts | core registers distinct actions, constructs independent stores and has no DOM dependency | assertion | 12 | 38288667886/1, 38286250940/1, 38285755558/1, 38282932545/1, 38275758423/1, 38275748942/1, 38274783212/1, 38273888476/1, 38269991658/1, 38269978124/1, 38267279161/1, 38266329264/1 |
| ci.yml | test (windows-latest, shard 2/3) | tests/ui-core.test.ts | core registers distinct actions, constructs independent stores and has no DOM dependency | assertion | 10 | 38288667886/1, 38285755558/1, 38275758423/1, 38275748942/1, 38274783212/1, 38273888476/1, 38269991658/1, 38269978124/1, 38267279161/1, 38266329264/1 |
| ci.yml | test (windows-latest, shard 3/3) | tests/bl-29-timing-approval.test.ts | BL-29c account commit after an early native approval frame invalidates the empty decision read within 2s | timeout | 7 | 38330189442/1, 38327873837/1, 38306376755/1, 38305459551/1, 38298416230/1, 38298416230/2, 38288667886/1 |
| ci.yml | test (ubuntu-latest, shard 2/3) | tests/ui-core.test.ts | composed health settings keep serialized writes and reject queued work after an account change | assertion | 3 | 38306603542/1, 38306590651/1, 38306376755/1 |
| ci.yml | test (windows-latest, shard 2/3) | tests/ui-core.test.ts | composed health settings keep serialized writes and reject queued work after an account change | assertion | 3 | 38306603542/1, 38306590651/1, 38306376755/1 |
| ci.yml | test (windows-latest, shard 1/3) | tests/folder-choice.test.ts | UX-9 new-folder API uses existing permission revisions and never returns a full browser path | assertion | 3 | 38324429449/1, 38312846938/1, 38269978124/1 |
| ci.yml | test (ubuntu-latest, shard 3/3) | tests/polish-1.test.ts | r: consecutive weekly observations use all-week, date range or day count | assertion | 2 | 38306376755/1, 38305459551/1 |
| ci.yml | test (windows-latest, shard 3/3) | tests/polish-1.test.ts | r: consecutive weekly observations use all-week, date range or day count | assertion | 2 | 38306376755/1, 38305459551/1 |
| ci.yml | test (windows-latest, shard 3/3) | tests/personal-conversation-resources.test.ts | resources HTTP API requires account session ownership, validates cursors and preserves incremental pagination | assertion | 2 | 38305459551/1, 38282932545/1 |
| ci.yml | test (windows-latest, shard 3/3) | tests/personal-user-questions.test.ts | answer IDs collide in both directions with commands, task stops and approval decisions | assertion | 1 | 38309679841/1 |
| ci.yml | test (ubuntu-latest, shard 1/3) | tests/design-tokens.test.ts | Apple views consume generated typed tokens compiled by all three native targets | assertion | 1 | 38256404822/1 |
| ci.yml | test (windows-latest, shard 1/3) | tests/personal-mobile-ui-release.test.ts | authenticated mobile UI A to B and rollback use immutable assets, SSE and no host restart | timeout | 1 | 38317040817/1 |
| ci.yml | test (windows-latest, shard 3/3) | tests/bl-29-wait.test.ts | BL-29 existing chat changes wait for a native delta, wake immediately and retain exact cursor semantics | assertion | 1 | 38298416230/2 |
| ci.yml | test (ubuntu-latest, shard 3/3) | tests/bl-29-wait.test.ts | BL-29 existing chat changes wait for a native delta, wake immediately and retain exact cursor semantics | assertion | 1 | 38265204893/1 |
| ci.yml | test (ubuntu-latest, shard 2/3) | tests/bl-29-rework.test.ts | BL-29b M5/S2 gateway shutdown and runtime dispose respond SERVICE_CLOSING promptly | assertion | 1 | 38328244218/1 |
| ci.yml | test (windows-latest, shard 3/3) | tests/packaged-project-reader.test.ts | bundled project reader runs from a real ASAR without extracting an executable script | assertion | 1 | 38298416230/2 |
| ci.yml | test (windows-latest, shard 3/3) | tests/personal-access-multi-account.test.ts | concurrent accounts keep owner, text and duplicate request namespace through delayed dispatch | assertion | 1 | 38309679841/1 |
| ci.yml | test (windows-latest, shard 3/3) | tests/personal-conversation-adoption.test.ts | D37 moving an adopted owner conversation into a project preserves its phone binding and sends with both contexts | assertion | 1 | 38282932545/1 |
| ci.yml | test (windows-latest, shard 2/3) | tests/ia-2b-relay.test.ts | durable main sends bind once, queue during relay, keep attachments, recover unpublished target and preserve source receipts | assertion | 1 | 38273888476/1 |
| ci.yml | test (windows-latest, shard 2/3) | tests/personal-cloud.test.ts | FX-11 first native write registers a cloud owner's artifact in project conversation | assertion | 1 | 38298416230/1 |
| ci.yml | test (windows-latest, shard 3/3) | tests/personal-activity.test.ts | FX-18 recovered memory appears as one quiet progress event and completes without a pause | assertion | 1 | 38298416230/2 |
| ci.yml | test (ubuntu-latest, shard 2/3) | workflow | Install dependencies | step-failure | 1 | 38256305332/1 |
| ci.yml | test (ubuntu-latest, shard 2/3) | tests/offline-task-queue.test.ts | phone encrypts using the existing replica envelope; wrong key, host and ciphertext fail without leaking text | assertion | 1 | 38334246599/1 |
| ci.yml | test (windows-latest, shard 1/3) | tests/rob-1-electron.test.ts | real Windows Electron survives first-run and legacy-upgrade interruption at every credential commit phase | process-exit | 1 | 38324349558/1 |
| ci.yml | test (windows-latest, shard 3/3) | tests/personal-user-questions.test.ts | revoked source credentials and a changed model destination cannot receive late information answers | assertion | 1 | 38309693305/1 |
| ci.yml | test (windows-latest, shard 3/3) | tests/personal-tool-approvals.test.ts | task reply projection forwards a known limit cause while retaining an existing observed artifact | assertion | 1 | 38285265478/1 |
| ci.yml | test (windows-latest, shard 1/3) | tests/personal-dynamic-write-targets.test.ts | tests\\personal-dynamic-write-targets.test.ts | process-exit | 1 | 38309679841/1 |
| ci.yml | test (windows-latest, shard 3/3) | tests/vendor-cache-safety.test.ts | tests\\vendor-cache-safety.test.ts | process-exit | 1 | 38330189442/1 |
| review-gallery.yml | Synthetic multi-device review gallery | tests/integration/review-capture-mobile.mjs | question (dark): 等待「提问条」页面元素超时 | timeout | 3 | 38334246587/1, 38329373620/1, 38329373620/2 |
| review-gallery.yml | Synthetic multi-device review gallery | tests/integration/review-capture-mobile.mjs | question (light): 等待「提问条」页面元素超时 | timeout | 2 | 38329373620/1, 38329373620/2 |
| review-gallery.yml | Synthetic multi-device review gallery | workflow | synthetic command not accepted | step-failure | 1 | 38330313294/1 |
| windows-package.yml | Windows package and startup smoke | scripts/nightly/installed-smoke.mjs | locator.waitFor: Timeout 15000ms exceeded. | timeout | 4 | 38317040857/1, 38312997948/1, 38309679872/1, 38305459180/1 |
| windows-package.yml | Windows package and startup smoke | tests/helpers/migration-host.mjs | Error: MIGRATION_SMOKE_TIMEOUT | step-failure | 1 | 38324429475/1 |
| s1c-web.yml | Web cloud login interactions | apps/mobile-ui/tests/composer-viewport.test.mjs | the fifth mobile tab opens health, keeps other tabs reachable and quotes without sending | assertion | 3 | 38273888252/1, 38269991844/1, 38269978163/1 |
| s1c-web.yml | Android debug and JVM tests | workflow | Run gradle --no-daemon :app:assembleDebug :app:testDebugUnitTest | step-failure | 1 | 38324429450/1 |
| relay.yml | Relay full chain (443) | services/cloud/test/relay-e2e.test.mjs | S2 real frp + cloud + host + HAProxy on 443: private content, browser auth, SSE, history, attachments, reconnect, pin and revoke | assertion | 7 | 38288667714/1, 38286250894/1, 38285265795/1, 38285057330/1, 38282932613/1, 38275758476/1, 38275748922/1 |
| relay.yml | Relay phone first input and file task | services/cloud/test/relay-phone.test.mjs | Relay phone first input and file task | assertion | 1 | 38329373626/1 |
| relay.yml | Relay phone first input and file task | services/cloud/test/relay-phone.test.mjs | Relay phone first input and file task | timeout | 1 | 38329373626/2 |
| host-certs.yml | Host certificates (Pebble DNS-01) | services/cloud/test/host-certificates-pebble.test.mjs | Pebble DNS-01: real host proof → AliDNS API/TXT → issuance → installed TLS/pairing pin → daily renewal without adapter restart | timeout | 7 | 38288667711/1, 38286250924/1, 38285265471/1, 38285057387/1, 38282932519/1, 38275758351/1, 38275748921/1 |
| host-certs.yml | Host certificates (Pebble DNS-01) | workflow | Download official test tools (SHA256 checked) | step-failure | 1 | 38255458497/1 |
| vendor-tests.yml | Pinned DSH vendor unit tests | tests/bl-29-runtime-close.test.ts | BL-29c N5 parent deadline cleans owned children without retrying or changing product limits | assertion | 2 | 38289148501/1, 38275758395/1 |
| vendor-tests.yml | Pinned DSH vendor unit tests | tests/bl-29-runtime-close.test.ts | BL-29c N5 parent cleans the whole owned Electron set when the driver is terminated after first window | assertion | 1 | 38290471674/1 |

原始日志只存本包 .local；公开 JSON（结构化数据）保留清理身份后的诊断片段、完整运行链接和每次任务结论。
起点统计之后的新增现场与定性：[补充观测](additional-observations.md)，详情也保存在 flaky-table.json 的 additionalObservations（补充观测）中。

## 六轮及本机最终门禁新增条目

起点快照562次运行／43组保持原样，下表保留验收时新增的实红，不把后续通过覆盖为无失败。完整定性和限制见 [final-observations.md](final-observations.md)。

| 工作流 | 平台 | 文件／用例 | 失败类型 | 次数 | 运行 |
|---|---|---|---|---:|---|
| relay.yml | ubuntu-latest | services/cloud/test/relay-phone.test.mjs / phone approval must be inside the conversation above the composer | assertion | 1 | [38357073116](https://github.com/memoweft/weftmate/actions/runs/38357073116) |
| relay.yml | ubuntu-latest | services/cloud/test/relay-phone.test.mjs / first send did not complete | assertion | 1 | [38359433300](https://github.com/memoweft/weftmate/actions/runs/38359433300) |
| ci.yml | macos-latest | tests/bl-29-rework.test.ts / all bridge methods count in 31s healthy idle | assertion | 1 | [38359286867](https://github.com/memoweft/weftmate/actions/runs/38359286867) |
| ci.yml | ubuntu-latest | services/cloud/test/identity.test.mjs / registration → verification → device-confirmed code/PKCE login → refresh → reset → new device | assertion: 299 !== 300 | 1 | [38367509701](https://github.com/memoweft/weftmate/actions/runs/38367509701) |
| ci.yml | windows-latest | tests/vendor-cache-safety.test.ts / all leaves pass, file exit 1 | file-exit: Managed temp lease ownership changed | 1 | [38367509701](https://github.com/memoweft/weftmate/actions/runs/38367509701) |
| local-required | Windows / Node24.21.0 | tests/bl-29-timing-approval.test.ts / foreground reply 恢复到最新electron | locator.waitFor: Timeout 1000ms exceeded | 1 | 本机保留日志 |
| local-vendor | Windows / Node24.21.0 | tests/bl-29-runtime-close.test.ts / BL-29b M5 real tray/update shutdown and both runtime orders drain protocol waits | update-restart preparation: page.waitForFunction 30000ms | 1 | 本机保留日志 |
