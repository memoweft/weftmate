import assert from 'node:assert/strict';
import test from 'node:test';
import { birthdayForgetDecisions } from './helpers/birthday-forget-decisions.mjs';

// Safe literal projections captured from official Core2112 at a732.
// Original trace SHA256: b308c88e2535fef65d23463ca17513404875bd43c61bd8b225448bc1185710d4.
// World wording is deliberately different from its original Evidence wording.
const selfWorld={key:'world-self',kind:'cognition',text:'用户的生日是五月一日。',graphSubject:'self',sourceTexts:['我的生日是五月一日。']};
const selfEvidence={key:'evidence-self',kind:'evidence',text:'我的生日是五月一日。\n我的生日是五月一日。',graphSubject:null,sourceTexts:['我的生日是五月一日。','我的生日是五月一日。']};
const mother={key:'world-mother',kind:'cognition',text:'妈妈的生日是六月一日。',graphSubject:'other:妈妈',sourceTexts:['妈妈的生日是六月一日。']};
const coworker={key:'world-coworker',kind:'cognition',text:'同事小王的生日是七月一日。',graphSubject:'other:同事小王',sourceTexts:['同事小王的生日是七月一日。']};
const decide=(candidates:any[],subject='self',options={})=>birthdayForgetDecisions({request:{subject,topic:'生日'},candidates},options);

test('captured self World and original Evidence independently identify the same birthday fact',()=>{
  const rows=decide([selfWorld,selfEvidence]);
  for(const [index,candidate] of [selfWorld,selfEvidence].entries())assert.deepEqual(rows[index],{
    key:candidate.key,matchesTopic:true,hasTargetFact:true,subjects:['self'],targetSubjects:['self'],sourceFullyAuthorized:true,
  });
});

test('the original synthetic self World wording remains a known representation',()=>{
  const [row]=decide([{...selfWorld,text:'我的生日是五月一日。'}]);
  assert.equal(row.hasTargetFact,true);assert.deepEqual(row.targetSubjects,['self']);assert.equal(row.sourceFullyAuthorized,true);
});

test('the two other birthday facts keep their separate subjects for both World and Evidence',()=>{
  const candidates=[mother,coworker,...[mother,coworker].map(row=>({...row,key:'evidence-'+row.key,kind:'evidence',graphSubject:null}))];
  const rows=decide(candidates);
  for(const [index,subject] of ['other:妈妈','other:同事小王','other:妈妈','other:同事小王'].entries()){
    assert.equal(rows[index].matchesTopic,true);assert.equal(rows[index].hasTargetFact,true);
    assert.deepEqual(rows[index].subjects,[subject]);assert.deepEqual(rows[index].targetSubjects,[subject]);
    assert.equal(rows[index].sourceFullyAuthorized,false);
  }
});

test('a request for mother authorizes only her known complete source',()=>{
  const [own,mom,colleague]=decide([selfWorld,mother,coworker],'other:妈妈');
  assert.equal(own.sourceFullyAuthorized,false);assert.equal(mom.sourceFullyAuthorized,true);assert.equal(colleague.sourceFullyAuthorized,false);
});

test('a normalized self World does not authorize a source shared with mother',()=>{
  const [row]=decide([{...selfWorld,sourceTexts:['我的生日是五月一日。妈妈的生日是六月一日。']}]);
  assert.equal(row.hasTargetFact,true);assert.deepEqual(row.targetSubjects,['self']);
  assert.deepEqual(row.subjects,['self','other:妈妈']);assert.equal(row.sourceFullyAuthorized,false);
});

test('a shared Evidence contains both target subjects rather than becoming only self',()=>{
  const [row]=decide([{...selfEvidence,text:'我的生日是五月一日。妈妈的生日是六月一日。',sourceTexts:['我的生日是五月一日。妈妈的生日是六月一日。']}]);
  assert.equal(row.hasTargetFact,true);assert.deepEqual(row.targetSubjects,['self','other:妈妈']);
  assert.deepEqual(row.subjects,['self','other:妈妈']);assert.equal(row.sourceFullyAuthorized,false);
});

test('unknown World wording cannot borrow self attribution from the graph or known source text',()=>{
  for(const text of ['用户的生日是八月一日。','另一位用户的生日是五月一日。','别人的话：我的生日是五月一日。','我的生日是五月一日吗？']){
    const [row]=decide([{...selfWorld,text}]);
    assert.equal(row.matchesTopic,false);assert.equal(row.hasTargetFact,false);assert.deepEqual(row.targetSubjects,[]);
  }
});

test('the new World spelling is not silently accepted as an unobserved source spelling',()=>{
  const [row]=decide([{...selfEvidence,text:'用户的生日是五月一日。',sourceTexts:['用户的生日是五月一日。']}]);
  assert.equal(row.hasTargetFact,false);assert.deepEqual(row.targetSubjects,[]);assert.equal(row.sourceFullyAuthorized,false);
});

test('captured unrelated tea seed remains outside the birthday authorization',()=>{
  const rows=decide([
    {key:'seed-world',kind:'cognition',text:'用户记住：我喜欢喝乌龙茶。',graphSubject:'self',sourceTexts:['记住：我喜欢喝乌龙茶。']},
    {key:'seed-evidence',kind:'evidence',text:'记住：我喜欢喝乌龙茶。\n记住：我喜欢喝乌龙茶。',graphSubject:null,sourceTexts:['记住：我喜欢喝乌龙茶。','记住：我喜欢喝乌龙茶。']},
  ]);
  for(const row of rows){assert.equal(row.matchesTopic,false);assert.equal(row.hasTargetFact,false);assert.deepEqual(row.targetSubjects,[]);assert.equal(row.sourceFullyAuthorized,false);}
});

test('semantic misattribution stays a deliberate fault for both other people',()=>{
  const rows=decide([mother,coworker],'self',{misattribute:true});
  for(const [index,candidate] of [mother,coworker].entries())assert.deepEqual(rows[index],{
    key:candidate.key,matchesTopic:true,hasTargetFact:true,subjects:['self'],targetSubjects:['self'],sourceFullyAuthorized:true,
  });
});
