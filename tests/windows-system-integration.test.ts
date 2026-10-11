import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWindowsSendTo, forwardWindowsSendTo, sendToRegistryKeys, windowsSendToCommand, createWindowsSendTo, windowsApprovalNotification, actOnWindowsApproval } from '../src/windows-system-integration.mjs';

test('Explorer launch preserves spaces, Chinese and multiple absolute paths without consuming startup options', () => {
  assert.deepEqual(parseWindowsSendTo(['app.exe', '--access-port=0']), []);
  assert.deepEqual(parseWindowsSendTo(['app.exe', '--access-port=0', '--send-to-weftmate', 'D:\\工作 文件\\报告.md', 'D:\\Work files\\two.txt', '--start-in-tray', 'relative.txt', 'D:\\工作 文件\\报告.md']), ['D:\\工作 文件\\报告.md', 'D:\\Work files\\two.txt']);
  assert.equal(windowsSendToCommand('D:\\Program files\\WeftMate.exe'), '"D:\\Program files\\WeftMate.exe" --send-to-weftmate "%1"');
});
test('second instance hands all files to the running desktop, or retains them until the first window is ready', () => {
  const pending: string[] = [], received: string[][] = [];
  const argv = ['second.exe', '--send-to-weftmate', 'D:\\Synthetic\\资料 one.txt', 'D:\\Synthetic\\two.md'];
  forwardWindowsSendTo(argv, {sendTo:(paths: string[])=>received.push(paths)}, pending);
  assert.deepEqual(received,[argv.slice(2)]);assert.deepEqual(pending,[]);
  forwardWindowsSendTo(argv,null,pending);assert.deepEqual(pending,argv.slice(2));
  forwardWindowsSendTo(['second.exe'],{sendTo:()=>assert.fail()},pending);assert.deepEqual(pending,argv.slice(2));
});
test('setting registers only HKCU identity-specific file and folder verbs and removes both on disable', () => {
  const values = new Set<string>(), calls: string[][] = [];
  const registration = createWindowsSendTo({appId:'com.memoweft.weftmate.sys3qa',executable:'D:\\Synthetic\\WeftMate.exe',platform:'win32',run:(_file: string,args: string[])=>{
    calls.push(args); if(args[0]==='query') return {status:values.has(args[1])?0:1};
    if(args[0]==='add')values.add(args[1]);if(args[0]==='delete')for(const key of values)if(key.startsWith(args[1]))values.delete(key);
    return {status:0};
  }});
  assert.equal(registration.enabled(),false);assert.equal(registration.setEnabled(true),true);
  assert.equal(registration.setEnabled(false),false);
  assert.ok(calls.every(args=>args[1].startsWith('HKCU\\')));
  for(const key of sendToRegistryKeys('com.memoweft.weftmate.sys3qa')) assert.ok(calls.some(args=>args[0]==='delete' && args[1]===key));
  assert.ok(calls.some(args=>args.includes('SendToEnabled')&&args.includes('0')));
  assert.equal(createWindowsSendTo({appId:'qa',executable:'test',platform:'darwin'}).enabled(),false);
});
const approval = {status:'pending',approvalId:'synthetic-approval',sessionId:'synthetic-session',runtimeId:'synthetic-runtime',turn:1,callId:'call-1',argumentsHash:'hash',messageHash:'message',riskCategories:['execute'],reason:'private path and command'};
test('Windows approval copy contains no path or full command and only execution-only risk offers decisions', () => {
  assert.deepEqual(windowsApprovalNotification(approval).actions.map((a: any)=>a.text),['允许','拒绝']);
  assert.equal(windowsApprovalNotification(approval).body,'想要运行一条命令');
  for(const category of ['delete','overwrite','system','install','external','spend']) {
    const value=windowsApprovalNotification({...approval,riskCategories:['execute',category]});
    assert.deepEqual(value.actions.map((a: any)=>a.text),['查看']);assert.equal(value.direct,false);
    assert.equal(value.body.includes('private'),false);
  }
  assert.equal(windowsApprovalNotification({...approval,riskCategories:[]}).direct,false);
  assert.equal(windowsApprovalNotification({...approval,riskCategories:undefined,reason:'[weftmate:execute] private'}).direct,true);
});
test('native action indexes produce existing once-only approval outcomes without opening the window', async () => {
  const decisions: string[]=[];let opened=0;
  for(const index of [0,1]) await actOnWindowsApproval({index,original:approval,read:async()=>approval,decide:async(outcome: string)=>decisions.push(outcome),open:()=>opened++});
  assert.deepEqual(decisions,['allowed-once','rejected']);assert.equal(opened,0);
  await actOnWindowsApproval({index:0,original:{...approval,riskCategories:['spend']},read:async()=>approval,decide:async()=>assert.fail(),open:()=>opened++});
  assert.equal(opened,1);
});
test('stale or changed approval cannot be answered from an old notification', async () => {
  for(const fresh of [{...approval,status:'resolved'},{...approval,argumentsHash:'changed'},{...approval,riskCategories:['delete']},null]) {
    const result=await actOnWindowsApproval({index:0,original:approval,read:async()=>fresh,decide:async()=>assert.fail(),open:()=>assert.fail()});
    assert.equal(result.title,'审批已变化');
  }
});
