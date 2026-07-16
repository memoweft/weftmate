import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start); const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return source.slice(from, to);
}

describe('画像控制与本机数据删除接线', () => {
  it('指正只允许 active inferred，并走幂等摄入、整理和公开失效兜底', () => {
    const route = between(server, "url.pathname === '/api/cognition/correct'", '// 标失效一条理解');
    assert.match(route, /cognition\.formedBy !== 'inferred'/);
    assert.match(route, /cognitionCorrectionOriginId\(id, content\)/);
    assert.match(route, /core\.ingestUserMessage\(\{ content, originId \}\)/);
    assert.match(route, /scheduler\.refreshNow\(\)/);
    assert.match(route, /core\.memory\.invalidateCognition/);
    assert.match(route, /if \(invalidated\) profileOverrides\.markRejected\(id\)/);
    assert.match(route, /url\.pathname === '\/api\/cognition\/rejection\/undo'/);
    assert.match(route, /profileOverrides\.hasRejection\(id\)/);
    assert.match(route, /profileOverrides\.restoreRejected\(source\)/);
    assert.doesNotMatch(route, /reactivate/i);
  });

  it('覆盖层用于列表、图谱和 Agent recall，MemoWeft export 仍是原始 bundle', () => {
    const recall = between(server, 'recall: async (query)', 'record: async');
    const exportRoute = between(server, "url.pathname === '/api/export-bundle'", "url.pathname === '/api/import-bundle'");
    assert.match(server, /profileOverrides\.applyCognitions\(core\.memory\.listCognitions\(\)\)/);
    assert.match(recall, /applyRecall\(await core\.recall/);
    assert.match(recall, /matchingOverrides/);
    assert.match(server, /override\/keep/);
    assert.match(server, /keepIndependent/);
    assert.match(server, /c\.overridden \|\| c\.rejectedByUser \? c :/);
    assert.match(server, /userConfirmed: true/);
    assert.match(server, /confidence: _confidence, credStatus: _credStatus/);
    assert.match(html, /confidenceEligible = activeAll\.filter\(\(c\) => !c\.overridden\)/);
    assert.match(html, /d\.userConfirmed/);
    assert.match(exportRoute, /core\.portable\.exportBundle\(\)/);
    assert.doesNotMatch(exportRoute, /profileOverrides/);
  });

  it('画像分组区分用户确认与停用，空指正只能走明确的次级动作', () => {
    const groups = between(html, 'function memRenderCognitions()', 'function memCognitionCard(c)');
    const prompt = between(html, 'function memPromptText(', '// 进 / 出记忆管理页');
    const correction = between(html, 'async function memCorrectCog(c)', '// ── 操作：标失效认知');
    assert.match(groups, /const confirmedEdits = \[\]/);
    assert.match(groups, /const inactive = \[\]/);
    assert.match(groups, /if \(c\.invalidAt \|\| c\.archivedAt\) \{ inactive\.push\(c\)/);
    assert.match(groups, /if \(c\.overridden \|\| c\.independent\) \{ confirmedEdits\.push\(c\)/);
    assert.match(groups, /section\('你确认过的画像', confirmedEdits\)/);
    assert.match(groups, /'已停用 \/ 已收起的'/);
    assert.doesNotMatch(groups, /你改过 \/ 删过的/);
    assert.doesNotMatch(prompt, /allowEmpty/);
    assert.match(prompt, /okBtn\.disabled = !editor\.value\.trim\(\)/);
    assert.match(prompt, /emptyActionBtn\.onclick = \(\) => done\(''\)/);
    assert.match(prompt, /emptyActionBtn\.remove\(\)/);
    assert.match(correction, /emptyActionText: '仅否定这条推断'/);
    assert.doesNotMatch(correction, /allowEmpty/);
  });

  it('用户否定项只提供撤销，恢复项使用独立标签且不显示旧把握度', () => {
    const card = between(html, 'function memCognitionCard(c)', '// ── 记忆线索（证据）列表');
    const undo = between(html, 'async function memUndoRejection(c)', 'async function memMuteCog(c, muted)');
    assert.match(card, /if \(c\.rejectedByUser\) meta\.appendChild\(memPill\('你已否定'/);
    assert.match(card, /else if \(c\.overridden\) meta\.appendChild\(memPill\(c\.restoredFromRejection \? '你恢复使用' : '你确认的'/);
    assert.match(card, /if \(c\.rejectedByUser\) \{[\s\S]*undo\.textContent = '撤销否定'/);
    assert.match(undo, /会保留你曾否定过的记录，但从现在起重新使用这条内容。/);
    assert.match(undo, /fetch\('\/api\/cognition\/rejection\/undo'/);
    assert.match(html, /if \(d\.userRestored\) rows\.push\(\['把握度', '你恢复使用'\]\)/);
    assert.match(server, /userRestored: true/);
    assert.match(server, /view\.rejectedByUser \? \{ userRejected: true \}/);
    assert.match(html, /if \(d\.userRejected\) rows\.push\(\['把握度', '你已否定'\]\)/);
  });

  it('renderer 只经窄 preload IPC 请求删除，擦除发生在单实例锁之前', () => {
    assert.match(preload, /deleteAllLocalData: \(confirmation\) => ipcRenderer\.invoke\('wm:delete-all-local-data', confirmation\)/);
    assert.match(html, /deleteWord = LANG === 'en' \? 'Delete WeftMate' : '删除 WeftMate'/);
    assert.match(html, /window\.wmData\.deleteAllLocalData\(deleteWord\)/);
    assert.doesNotMatch(html, /fetch\([^\n]*wipe/i);
    assert.ok(main.indexOf('wipeLocalDataFromMarker') < main.indexOf('app.requestSingleInstanceLock()'));
    assert.match(main, /await serverMod\?\.prepareLocalDataWipe/);
    assert.ok(main.indexOf('createLocalDataWipeMarker') < main.indexOf('collectorMod?.stopCollector?.()', main.indexOf("ipcMain.handle('wm:delete-all-local-data'")));
    assert.match(main, /confirmation !== '删除 WeftMate' && confirmation !== 'Delete WeftMate'/);
    assert.match(server, /scheduler\.freeze\(\)/);
    assert.match(server, /await waitForMutationDrain\(\)/);
    assert.match(server, /finally \{[\s\S]*finishMutation\(\)/);
    assert.match(server, /scheduler\.resume\(\)/);
    assert.match(server, /localDataWipePrepared[\s\S]*WIPE_PREPARING/);
    assert.match(html, /clearWord = LANG === 'en' \? 'Clear' : '清空'/);
    assert.match(server, /body\.confirm !== '清空' && body\.confirm !== 'Clear'/);
  });
});
