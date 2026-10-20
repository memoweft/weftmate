import test from 'node:test';
import assert from 'node:assert/strict';
import { presentPersonalPrompt } from '../src/plugins/personal-prompt.mjs';

const assembly = () => presentPersonalPrompt({ sections: [], tools: [] });
test('ordinary memory guidance uses user-facing memory wording rather than a backend brand', () => {
  const sections=assembly().sections.filter((section: any)=>['weftmate:memory-guidance','weftmate:shared-decisions'].includes(section.name));
  assert.equal(sections.length,2);
  assert.doesNotMatch(sections.map((section: any)=>section.text).join('\n'), /MemoWeft/,
    'ordinary preference acknowledgements must not be primed to name the implementation');
});
test('ordinary reply instructions keep planning private and allow explicitly requested technical explanations', () => {
  const text=assembly().sections.find((section: any)=>section.name==='weftmate:memory-guidance').text;
  assert.match(text,/give the answer, not private planning, question classification or tool-selection deliberation/);
  assert.match(text,/never backend component names or tool identifiers/);
  assert.match(text,/only when the user explicitly asks about that technical subject/);
});
test('plain reply guidance preserves callable tool identities, schemas and source instructions', () => {
  const parameters={type:'object',properties:{names:{type:'array',items:{type:'string'}}},required:['names']};
  const tool={name:'load_tools',description:'Load named tools',parameters};
  const source={sections:[{name:'user-technical-task',text:'Explain what load_tools and MemoWeft mean.'}],tools:[tool]};
  const result=presentPersonalPrompt(source,new Set(['load_tools']));
  assert.deepEqual(result.tools,[tool]);
  assert.equal(result.sections.find((section: any)=>section.name==='user-technical-task').text,source.sections[0].text);
  assert.equal(source.tools[0].parameters,parameters);
});
test('simple memory replies exclude storage and scheduling explanations', () => {
  const text=assembly().sections.find((section: any)=>section.name==='weftmate:memory-guidance').text;
  assert.match(text,/Memory questions need only the remembered fact; preferences need only the shared-decisions acknowledgement, not storage or scheduling explanations/);
});
test('pending preference acknowledgement guidance does not prime storage-receipt jargon', () => {
  const text=assembly().sections.find((section: any)=>section.name==='weftmate:shared-decisions').text;
  assert.doesNotMatch(text,/异步|成功回执|回执状态/);
  assert.match(text,/只需说“我记下了，稍后整理进记忆”，不附加处理过程/);
});
