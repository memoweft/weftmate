import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
test('#661 search finds individual settings, including advanced appearance controls',()=>{
  const context:any={WeftUiCore:{}};
  runInNewContext(readFileSync(new URL('../src/ui-core/settings-registry.js',import.meta.url),'utf8'),context);
  const registry=context.WeftUiCore.settingsRegistry();
  for(const [query,id] of [['半透明侧边栏','appearance'],['开机自启','general'],['固定说明','personalization'],['对比度','appearance'],['诊断包','system'],['更新通道','about'],['睡眠目标','reviewHealth'],['生成时间','notifications'],['动手前多看一眼','approvals'],['对外发送','approvals']])
    assert.equal(registry.list({desktop:true,query})[0]?.id,id,query);
});
