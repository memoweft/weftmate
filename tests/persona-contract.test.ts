import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start); const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return source.slice(from, to);
}

describe('Persona API / UI 接线', () => {
  it('旧切换接口和 canonical active 接口共用持久 Store，列表不泄漏提示词', () => {
    const routes = between(server, '// ── Persona API ──', '// 插件管理');
    const legacyList = between(routes, "url.pathname === '/api/experiences'", '// 新列表');
    assert.match(server, /new PersonaStore\([\s\S]*listBuiltinPersonas\(\)[\s\S]*DEFAULT_EXPERIENCE_ID/);
    assert.match(routes, /url\.pathname === '\/api\/experiences'/);
    assert.match(routes, /url\.pathname === '\/api\/experience'/);
    assert.match(routes, /url\.pathname === '\/api\/persona\/active'/);
    assert.match(routes, /activatePersona\(id\)/);
    assert.match(routes, /personaStore\.listSummaries\(\)/);
    assert.doesNotMatch(legacyList, /systemPrompt/);
  });

  it('详情单独返回完整人格，保存当前人格后下一条过滤旧助手历史', () => {
    const routes = between(server, '// ── Persona API ──', '// 插件管理');
    assert.match(routes, /req\.method === 'GET' && url\.pathname === '\/api\/persona'/);
    assert.match(routes, /personaStore\.get\(id\)/);
    assert.match(routes, /req\.method === 'POST' && url\.pathname === '\/api\/persona'/);
    assert.match(routes, /personaStore\.save/);
    assert.match(routes, /url\.pathname === '\/api\/persona\/name'/);
    assert.match(routes, /personaStore\.renamePersona\(id, body\.name\)/);
    assert.match(routes, /url\.pathname === '\/api\/persona\/delete'/);
    assert.match(routes, /personaStore\.removePersona\(id\)/);
    assert.match(routes, /personas: personaStore\.listSummaries\(\)/);
    assert.match(server, /filterPersonaHistory\(history\.read\(conversationId\), personaStore\.assistantHistoryBoundaryAt\(\)\)/);
    assert.doesNotMatch(server, /switchedExperienceConvs/);
    assert.match(server, /const current = personaStore\.current\(\)/);
  });

  it('Persona Store 错误按 validation/not_found/storage 映射 400/404/500', () => {
    const routes = between(server, '// ── Persona API ──', '// 插件管理');
    assert.match(server, /PersonaStoreError/);
    assert.match(server, /personaErrorResponse/);
    assert.match(routes, /personaErrorResponse\(res, error\)/);
    assert.match(server, /error\.code === 'storage' \? 500/);
    assert.match(server, /error\.code === 'not_found' \? 404/);
  });

  it('活跃任务守卫先于所有会改变当前人格语义的 Store 写入', () => {
    const routes = between(server, '// ── Persona API ──', '// 插件管理');
    const saveRoute = between(routes, "req.method === 'POST' && url.pathname === '/api/persona'", '// 名称是独立');
    const nameRoute = between(routes, "url.pathname === '/api/persona/name'", '// 内置人格删除');
    const deleteRoute = between(routes, "url.pathname === '/api/persona/delete'", '// canonical 当前人格入口');
    const activeRoute = between(routes, "url.pathname === '/api/persona/active'", '// 旧切换入口');
    const legacyRoute = between(server, "url.pathname === '/api/experience'", '// 插件管理');
    assert.match(server, /function rejectPersonaChangeDuringActiveTask\([\s\S]*activeAgentTask\(\)[\s\S]*onlyWhenCurrent[\s\S]*409[\s\S]*当前回复结束后再切换人格/);
    assert.ok(saveRoute.indexOf('rejectPersonaChangeDuringActiveTask(res, id, true)') < saveRoute.indexOf('personaStore.save'));
    assert.ok(nameRoute.indexOf('rejectPersonaChangeDuringActiveTask(res, id, true)') < nameRoute.indexOf('personaStore.renamePersona'));
    assert.ok(deleteRoute.indexOf('rejectPersonaChangeDuringActiveTask(res, id, true)') < deleteRoute.indexOf('personaStore.removePersona'));
    assert.ok(activeRoute.indexOf('rejectPersonaChangeDuringActiveTask(res)') < activeRoute.indexOf('activatePersona(id)'));
    assert.ok(legacyRoute.indexOf('rejectPersonaChangeDuringActiveTask(res)') < legacyRoute.indexOf('activatePersona(id)'));
  });

  it('快捷弹层是自绘列表且只负责切换；完整新建编辑删除都在关于你的人格页', () => {
    const quick = between(html, '<!-- 人格快捷弹层', '<header>');
    const manager = between(html, '<!-- 人格管理区', '<!-- 数据 / 备份区');
    assert.match(quick, /id="personaQuickList"/);
    assert.match(quick, /id="personaManage"/);
    assert.doesNotMatch(quick, /<select|id="personaForm"|id="personaNew"/);
    assert.doesNotMatch(html, /id="expSelect"|\$\('expSelect'\)/);
    assert.match(html, /id="tabPersonas" data-tab="personas">人格/);
    assert.match(manager, /id="memPersonas"/);
    assert.match(manager, /id="personaNew"/);
    assert.match(manager, /id="personaForm"/);
    assert.match(manager, /id="personaName"/);
    assert.match(manager, /id="personaDescription"/);
    assert.match(manager, /id="personaSystemPrompt"/);
    const editor = between(html, 'function openPersonaEditor(', '// ── Persona editor end ──');
    const personaBlock = between(html, '// ══════════════════ Persona 快捷切换与完整管理', '// ══════════════════ 外壳接线');
    assert.match(editor, /fetch\('\/api\/persona\?id='/);
    assert.match(editor, /endpoint = builtin \? '\/api\/persona\/name' : '\/api\/persona'/);
    assert.match(editor, /fetch\('\/api\/persona\/delete'/);
    assert.match(editor, /setPersonaSaveStatus/);
    assert.match(editor, /\.textContent\s*=/);
    assert.match(editor, /personaEditorToken/);
    assert.match(editor, /token !== personaEditorToken/);
    assert.match(editor, /personaEditorOpen/);
    assert.match(editor, /if \(!res\.ok \|\| data\.error\)/);
    assert.match(editor, /列表、当前项和打开的表单从未做乐观修改/);
    assert.match(editor, /if \(!confirmed\) return/);
    assert.match(editor, /personaMutationBusyId/);
    assert.match(editor, /if \(personaMutationBusyId \|\| personaDeleteConfirmingId \|\| !persona\.canDelete\) return/);
    assert.match(editor, /personaDeleteConfirmingId = persona\.id;[\s\S]*const confirmed = await memConfirm/);
    assert.match(editor, /finally \{[\s\S]*personaMutationBusyId = '';[\s\S]*personaDeleteConfirmingId = ''/);
    assert.match(editor, /\$\('personaCancel'\)\.disabled = true;[\s\S]*fetch\(endpoint/);
    assert.match(personaBlock, /if \(personaMutationBusyId && !force\) return/);
    assert.match(editor, /closePersonaEditor\(true\)/);
    assert.match(editor, /\$\('personaCancel'\)\.disabled = false/);
    assert.match(editor, /LANG === 'en'/);
    assert.match(personaBlock, /persona-card-name no-i18n/);
    assert.match(personaBlock, /persona-quick-name no-i18n/);
    assert.match(personaBlock, /persona\.safetyFallback/);
    assert.match(personaBlock, /persona\.canDelete/);
    assert.match(html, /maxlength="8000"/);
  });

  it('关于你不再展示旧插件页，两个独立 MCP 入口仍保持原接线', () => {
    assert.doesNotMatch(html, /id="tabPlugins"|id="memPlugins"|loadPluginsPanel/);
    assert.match(html, /\$\('ftPlugins'\)\.addEventListener\('click', openMcp\)/);
    assert.match(html, /\$\('toolSkill'\)\.addEventListener\('click', openMcp\)/);
    assert.match(server, /url\.pathname === '\/api\/plugins'/);
  });
});
