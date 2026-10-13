import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const dir=import.meta.dirname,read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const [v,shots,report]=await Promise.all([read('validation.json'),read('screenshots.json'),read('native-report.json')]);
if(report.diagnosticOnly||report.failure||v.nativeUi.length!==4||v.nativeUi.some(r=>!r.passed)||v.notifications.length!==2||v.notifications.some(r=>!r.passed)||!v.darkControls.passed)throw Error('Final validation is incomplete');
if(v.androidJvm.failed||!v.androidJvm.tests||v.required.failed||v.vendor.failed||v.mobile.failed||!v.mobile.passed||v.statusBars.failed||v.statusBars.themeMismatches||!v.routeInventory?.tests||v.routeInventory.failed||v.longScroll?.length!==2||v.longScroll.some(r=>!r.totalFrames))throw Error('Final checks or frame evidence are incomplete');
let intro=(await readFile(join(dir,'README.md'),'utf8')).split('\n## 最终实测')[0];
intro=intro.replace('信息順序','信息顺序').replace('验证数量、通知结果、逐张系统栏色差将在本包最终实测后写入。','最终数量、通知结果与逐张系统栏色差如下。');
const lines=[intro.trim(),'','## 最终实测','',
`- 本包独立开发阶段完整必过：${v.required.files} 文件，${v.required.passed} 通过、${v.required.failed} 失败、${v.required.skipped} 项既有跳过。`,
`- 本包独立开发阶段固定运行时：${v.vendor.files} 文件，${v.vendor.passed} 通过、${v.vendor.failed} 失败。`,
`- 安卓 JVM（Java 虚拟机）：${v.androidJvm.tests} 项、${v.androidJvm.failed} 失败；离线 APK（安卓安装包）与仪器化包构建通过，路由库存自动比对通过。`,
`- 本包独立开发阶段手机交互组五文件：${v.mobile.passed} 通过、${v.mobile.failed} 失败；合入父分支后类型检查、8 项相关检查和公开卫生复验通过。`,
`- 原生 360／390 浅／深四组均通过；后台／冷启动两次均点击真实系统通知进入原生聊天。`,
'- 220 条历史的旧任务跳转验证包含全部事件 1–220，无中段缺口，屏幕定位到事件 2。分页、下拉手势、自动增量、记忆确认、已读及底栏清点均包含在四组测试内。','',
'| 通知场景 | 点击方式 | 进入页 | 进程验证 | 结果 |','|---|---|---|---|---|'];
for(const row of v.notifications)lines.push(`| ${row.cold?'冷启动':'后台'} | ${row.method} | 原生${row.tab==='chat'?'聊天':'动态'} | ${row.cold?'前后 PID（进程编号）不同':'保留后台进程'} | ${row.passed?'通过':'失败'} |`);
lines.push('','| 长对话主题 | 合成消息数 | 滑动次数 | 渲染帧 | 卡顿帧 | 比例 |','|---|---:|---:|---:|---:|---:|');
for(const row of v.longScroll||[])lines.push(`| ${row.theme==='dark'?'深色／固定磨砂面板':'浅色基准'} | ${row.rows} | ${row.swipes} | ${row.totalFrames} | ${row.jankyFrames} | ${row.totalFrames?(100*row.jankyFrames/row.totalFrames).toFixed(2):'未取得'}% |`);
lines.push('','这些是共享机器同一轮的观测值，不把单轮结果当成稳定性能保证。列表和消息文字本身没有模糊；菜单仅在打开时设置自身窗口背景模糊，关闭恢复。','',
'## 深色取值核对','','参考来自提供的 `controls-spec.json`，源码绑定核对见 `controls-audit.json`；透明度取最近的 8 位表示。','',
'| 令牌 | 规范深色值 | 安卓绑定 | 核对 |','|---|---|---|---|');
for(const row of v.darkControls.colors)lines.push(`| ${row.name} | ${row.css} | ${row.field} | ${row.passed?'一致':'不一致'} |`);
lines.push('','## 逐张系统栏','','原始整屏图均未裁切。系统版本、应用读取的系统深浅与实际底部区域写在 `screenshots.json`；测试没有修改模拟器系统主题。下面的色差比较真实状态栏与相邻顶栏中央背景。系统通知面板属于系统界面，其差值单独列出，不与应用主题作一致性判定。','',
'| 原始图 | 实际像素／逻辑尺寸 | 页面主题 | 系统版本／读取主题 | 状态栏色差 | 底部系统区域 |','|---|---|---|---|---:|---|');
for(const row of shots)lines.push(`| [${row.file}](${row.file}) | ${row.pixelWidth}×${row.pixelHeight}／${row.widthDp}×${row.heightDp} | ${row.systemPanel?'系统通知面板':row.actualPageTheme==='dark'?'深':'浅'} | ${row.systemVersion}／${row.systemTheme==='dark'?'深':'浅'} | ${row.difference.delta.toFixed(3)} | ${row.bottomNavigationVisible?'可见':'不可见，未验真机手势条'} |`);
lines.push('','两组尺寸每一种原生状态均已保留：未读与待处理、行菜单、类别菜单、已读待处理、各类对话去向、更多页、周回顾正文与来源、记忆正文／菜单／确认、原网页完整操作、全部已读、下拉刷新、自动更新、空、加载、错误与重试、手机独立空状态与最终底栏点。浅色三组网页并排、深色三组规范并排及每组三行说明见 `pairs.html`。','');
await writeFile(join(dir,'README.md'),lines.join('\n'));
console.log(`Wrote validation and ${shots.length} per-capture system-bar rows`);
