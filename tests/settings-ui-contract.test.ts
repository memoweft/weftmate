import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// R6/R8 设置面收口契约：官方设置页 settings.section「WeftMate」节 = 感知/桌宠/设备配对
// 唯一控制面（感知/桌宠浮动胶囊已删）；动作 = 确定性 set-* + value（宿主白名单校验 →
// main 消费落盘 → 采集面/桌宠热读生效），客户端乐观覆盖与轮询真值对账。
// P1-02：感知/桌宠动作面（白名单 + value 校验）下沉 gateway/legacy。
const gatewayPerception = readFileSync(new URL('../src/runtime/gateway/legacy/perception.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gatewayPet = readFileSync(new URL('../src/runtime/gateway/legacy/pet.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return source.slice(from, to);
}

// 取顶层函数体（列 0 的收尾 `}` 为止；嵌套闭合均缩进）。
function fnBody(source: string, name: string): string {
  const match = new RegExp(`^(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`, 'm').exec(source);
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

describe('R6/R8 设置面收口契约（官方设置页 WeftMate 节）', () => {
  it('设置节注册：settings.section 槽位、id/order/label、感知/桌宠/设备三块', () => {
    const reg = between(client, "ctx.slots.inject('settings.section'", "ctx.slots.inject('shell.overlay'");
    assert.match(reg, /name: 'settings\.section'/);
    assert.match(reg, /id: 'weftmate'/);
    assert.match(reg, /order: 5000/);
    assert.match(reg, /label: 'WeftMate'/);
    assert.match(client, /桌面感知（R6 · opt-in）/);
    assert.match(client, /桌面宠物（R6）/);
    assert.match(client, /设备配对（R8 · 手机 App）/);
  });

  it('宿主动作面：感知/桌宠 set-* 白名单 + value 校验（BAD_ACTION/BAD_VALUE）', () => {
    const perception = fnBody(gatewayPerception, 'writePerceptionRequest');
    assert.match(perception, /code: 'BAD_ACTION'/);
    assert.match(perception, /code: 'BAD_VALUE'/);
    assert.match(perception, /value !== 'app_title' && value !== 'app_only'/);
    assert.match(perception, /typeof value !== 'boolean'/);
    const pet = fnBody(gatewayPet, 'writePetRequest');
    assert.match(pet, /action !== 'set-visible' && action !== 'set-free-activity'/);
    assert.match(pet, /typeof value !== 'boolean'/);
  });

  it('main 消费确定性语义：不按当前值翻转，只按请求 value 落盘', () => {
    const perception = between(main, 'function handlePerceptionRequests()', '// R6-01 · 感知采集面');
    assert.match(perception, /raw\.value === true/);
    assert.match(perception, /raw\.value === 'app_only' \? 'app_only' : 'app_title'/);
    const pet = between(main, 'function handlePetRequests()', 'writeHostState();');
    assert.match(pet, /want !== desktopPetVisible\(\)/);
    assert.match(pet, /want !== desktopPetFreeActivity\(\)/);
    assert.match(pet, /setDesktopPetFreeActivity\(want\)/);
  });

  it('设置节设备块：轮询 device/state、token 展示+复制、设备列表', () => {
    assert.match(client, /fetch\('\/weftmate\/device\/state\.json', \{ cache: 'no-store' \}\)/);
    assert.match(client, /pairing\.token/);
    assert.match(client, /navigator\.clipboard/);
    assert.match(client, /'有效期 ' \+ fmtTokenLeft\(leftMs\)/);
    assert.match(client, /暂无已配对设备/);
  });

  it('乐观覆盖：local 覆盖与轮询真值对账（值追上即清键，不闪烁）', () => {
    const effect = between(client, '// 乐观覆盖', 'var eff = function');
    assert.match(effect, /prev\[key\] !== truth\[key\]/);
    assert.match(effect, /petVisible: pet \? pet\.visible : false/);
  });
});
