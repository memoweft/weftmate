import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const agent = readFileSync(new URL('../src/agent.ts', import.meta.url), 'utf8');

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

  it('人格包 API 是严格 Manifest 根对象、64KB 导入且不会切换当前人格', () => {
    const routes = between(server, '// ── Persona API ──', '// 插件管理');
    const exportRoute = between(routes, "url.pathname === '/api/persona/export'", '// 导入不覆盖');
    const importRoute = between(routes, "url.pathname === '/api/persona/import'", '// 记忆读取权限');
    assert.match(exportRoute, /personaStore\.exportManifest\(id\)/);
    assert.doesNotMatch(exportRoute, /persona:|manifest:|setCurrent|activatePersona/);
    assert.match(importRoute, /readJson\(req, 64 \* 1024\)/);
    assert.match(importRoute, /personaStore\.importManifest\(body\)/);
    assert.match(importRoute, /personas: personaStore\.listSummaries\(\)/);
    assert.doesNotMatch(importRoute, /setCurrent|activatePersona/);
    assert.match(importRoute, /RequestBodyTooLargeError[\s\S]*413/);
  });

  it('记忆权限 API 类型严格，当前任务守卫在 Store 写前；服务端召回在所有记忆读取前硬短路', () => {
    const routes = between(server, '// ── Persona API ──', '// 插件管理');
    const memoryRoute = between(routes, "url.pathname === '/api/persona/memory-read'", '// 创建/编辑用户人格');
    assert.match(memoryRoute, /typeof body\.enabled !== 'boolean'/);
    assert.ok(memoryRoute.indexOf('rejectPersonaChangeDuringActiveTask') < memoryRoute.indexOf('personaStore.setMemoryRead'));
    assert.match(memoryRoute, /personaStore\.setMemoryRead\(id, body\.enabled\)/);
    assert.match(memoryRoute, /personas: personaStore\.listSummaries\(\)/);
    const recall = between(server, 'recall: async (query) => {', 'record: async');
    const guard = recall.indexOf("if (!personaStore.current().memoryReadEnabled) return '';");
    assert.ok(guard >= 0);
    for (const read of ['core.memory.listCognitions()', 'core.recall({ query })', 'profileOverrides.applyRecall']) {
      assert.ok(guard < recall.indexOf(read), `硬守卫必须早于 ${read}`);
    }
    assert.match(server, /seedFor\(conversationId: string\)[\s\S]*filterPersonaHistory\(history\.read\(conversationId\)/);
    assert.match(server, /recordChat: async[\s\S]*core\.ingestUserMessage/);
  });

  it('Agent 三路径按 runtime 权限跳过 recall，并给出关闭说明而不丢当前上下文', () => {
    for (const [start, end] of [
      ['async function converse(t: Task)', 'function taskUserMessage'],
      ['async function plan(t: Task)', '/** 执行循环'],
      ['async function drive(t: Task)', '// LLM 客户端工厂'],
    ]) {
      const block = between(agent, start, end);
      assert.ok(block.indexOf('deps.experience') < block.indexOf('safeRecall'));
      assert.match(block, /experience\?\.memoryReadEnabled !== false/);
    }
    assert.match(agent, /不能读取长期记忆，也不能声称记得以前长期保存的内容/);
    assert.match(agent, /可以使用本轮提供的当前对话上下文/);
    assert.match(agent, /\.\.\.t\.context/);
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

  it('管理页人格包与记忆开关有确认、大小、busy 和失败回读；快捷列表只显示记忆状态', () => {
    const quick = between(html, '<!-- 人格快捷弹层', '<header>');
    const manager = between(html, '<!-- 人格管理区', '<!-- 数据 / 备份区');
    const personaBlock = between(html, '// ══════════════════ Persona 快捷切换与完整管理', '// ══════════════════ 外壳接线');
    assert.match(manager, /id="personaImport"/);
    assert.match(manager, /id="personaImportFile"[^>]*hidden[^>]*accept="\.weftmate-persona\.json,\.json,application\/json"/);
    assert.doesNotMatch(quick, /personaImport|导出人格|persona-memory-switch/);
    assert.match(personaBlock, /persona\.memoryReadEnabled === false \? '不读取长期记忆' : '可读取长期记忆'/);
    assert.match(personaBlock, /persona\.source === 'user' \? ' no-i18n' : ''/);
    assert.match(personaBlock, /persona\.source === 'user' \? persona\.description : t\(persona\.description \|\| ''\)/);
    assert.match(personaBlock, /function exportPersona\(persona\)/);
    assert.match(personaBlock, /fetch\('\/api\/persona\/export\?id='/);
    assert.ok(personaBlock.indexOf('await memConfirm({', personaBlock.indexOf('function exportPersona'))
      < personaBlock.indexOf('new Blob(', personaBlock.indexOf('function exportPersona')));
    assert.match(personaBlock, /personaPackagePreview\(manifest\)/);
    assert.match(personaBlock, /bodyPreformatted: true/);
    assert.match(html, /\.mc-dialog \.mc-package-preview \{ white-space: pre-wrap; max-height: min\(360px, 42vh\); overflow-y: auto;/);
    assert.match(html, /\.mc-dialog\.mc-persona-preview[\s\S]*max-height: calc\(100vh - 40px\)[\s\S]*\.mc-dialog-actions \{ flex: 0 0 auto;/);
    assert.match(personaBlock, /safePersonaPackageName\(manifest\.name\)/);
    assert.match(personaBlock, /URL\.createObjectURL|URL\.revokeObjectURL/);
    assert.match(personaBlock, /if \(!file \|\| personaImportBusy\) return/);
    assert.match(personaBlock, /file\.size > 64 \* 1024/);
    assert.match(personaBlock, /const text = await file\.text\(\)/);
    const previewGuard = between(personaBlock, 'function personaPackagePreviewable(manifest)', 'function safePersonaPackageName');
    assert.match(previewGuard, /\['schemaVersion', 'id', 'name', 'description', 'systemPrompt'\]\.sort\(\)/);
    assert.match(previewGuard, /actual\.length === expected\.length/);
    assert.match(previewGuard, /manifest\.schemaVersion === 1/);
    assert.match(previewGuard, /typeof manifest\.id === 'string'/);
    assert.match(previewGuard, /manifest\.name\.length <= 80/);
    assert.match(previewGuard, /manifest\.description\.length <= 500/);
    assert.match(previewGuard, /manifest\.systemPrompt\.length <= 8000/);
    assert.ok(personaBlock.indexOf('if (!personaPackagePreviewable(manifest))')
      < personaBlock.indexOf('const confirmed = await memConfirm({', personaBlock.indexOf('function importPersonaFile')));
    assert.ok(personaBlock.indexOf('const confirmed = await memConfirm({', personaBlock.indexOf('function importPersonaFile'))
      < personaBlock.indexOf("fetch('/api/persona/import'", personaBlock.indexOf('function importPersonaFile')));
    assert.match(personaBlock, /body: text/);
    assert.match(personaBlock, /personaImportBusy/);
    assert.match(personaBlock, /className = 'persona-memory-switch'/);
    assert.match(personaBlock, /setAttribute\('role', 'switch'\)/);
    assert.match(personaBlock, /fetch\('\/api\/persona\/memory-read'/);
    assert.match(personaBlock, /await loadPersonas\(\); \/\/ 请求结果不确定时回读服务端真状态/);
    assert.match(personaBlock, /\.textContent\s*=/);
    assert.match(personaBlock, /no-i18n/);
    for (const busy of ['personaExportBusyId', 'personaImportBusy', 'personaMemoryBusyId']) assert.match(personaBlock, new RegExp(busy));
    assert.match(html, /'导入人格': 'Import persona'/);
    assert.match(html, /'允许这个人格读取我的长期记忆': 'Allow this persona to read my long-term memory'/);
    assert.match(html, /不包含记忆、聊天、密钥、文件路径、本机权限或本机状态/);
    assert.match(html, /关闭只是不读取旧记忆；仍能看到当前对话；你之后说的话仍会继续记入 MemoWeft/);
  });

  it('关于你不再展示旧插件页，两个独立 MCP 入口仍保持原接线', () => {
    assert.doesNotMatch(html, /id="tabPlugins"|id="memPlugins"|loadPluginsPanel/);
    assert.match(html, /\$\('ftPlugins'\)\.addEventListener\('click', openMcp\)/);
    assert.match(html, /\$\('toolSkill'\)\.addEventListener\('click', openMcp\)/);
    assert.match(server, /url\.pathname === '\/api\/plugins'/);
  });
});
