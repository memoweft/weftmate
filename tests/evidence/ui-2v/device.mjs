/** Drive the installed WebView over CDP; taps and captures use the real Android device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const adb=process.env.UI2V_ADB||'D:/Software/MuMuPlayer/nx_main/adb.exe';
const serial=process.env.UI2V_SERIAL||'127.0.0.1:7555';
const shell=(...args)=>execFileSync(adb,['-s',serial,'shell',...args],{encoding:'utf8'});
const targets=await(await fetch('http://127.0.0.1:19222/json')).json();
const ws=new WebSocket(targets.find(t=>t.url.includes('appassets.androidplatform.net')).webSocketDebuggerUrl);
await new Promise(done=>ws.addEventListener('open',done,{once:true}));let id=0;
const cdp=(method,params)=>new Promise((resolve,reject)=>{const current=++id;const listener=e=>{const message=JSON.parse(e.data);if(message.id===current){ws.removeEventListener('message',listener);message.error?reject(message.error):resolve(message.result)}};ws.addEventListener('message',listener);ws.send(JSON.stringify({id:current,method,params}))});
const evaluate=async expression=>{const reply=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(reply.exceptionDetails)throw new Error(JSON.stringify(reply.exceptionDetails));return reply.result.value};
const wait=async expression=>{for(let i=0;i<60;i++){if(await evaluate(expression))return;await new Promise(done=>setTimeout(done,250));}throw new Error(`Timed out: ${expression}`)};
const tap=async selector=>{const pos=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing target');let r=n.getBoundingClientRect();if(r.y<0||r.bottom>innerHeight){n.scrollIntoView({block:'nearest'});r=n.getBoundingClientRect()}return {x:(r.x+r.width/2)*devicePixelRatio,y:(r.y+r.height/2)*devicePixelRatio+24*devicePixelRatio}})()`);shell('input','tap',String(Math.round(pos.x)),String(Math.round(pos.y)));await new Promise(done=>setTimeout(done,350));};
const textTap=async text=>{await evaluate(`(()=>{const n=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!n)throw Error('Missing button');n.dataset.ui2vTarget='true'})()`);await tap('[data-ui2v-target]');await evaluate("document.querySelector('[data-ui2v-target]')?.removeAttribute('data-ui2v-target')")};
const capture=async name=>{await new Promise(done=>setTimeout(done,500));writeFileSync(new URL(name,import.meta.url),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{maxBuffer:12*1024*1024}));};
try{
  if(process.argv[2]==='login'){
    if(await evaluate("state.page==='home'"))await textTap('登录或连接');
    console.log(await evaluate("document.body.innerText"));
    const login=JSON.parse(readFileSync(new URL('../../../.local/ui-2v/login.json',import.meta.url)));
    await evaluate(`(()=>{const inputs=[...document.querySelectorAll('#page-content input')];const values=${JSON.stringify([login.origin,login.username,login.password,'MuMu 合成验收',''])};inputs.forEach((n,i)=>{n.value=values[i];n.dispatchEvent(new Event('input',{bubbles:true}))})})()`);
    await textTap('登录');await wait('state.loggedIn');
    await tap('#page-back');await wait("state.page==='home' && document.querySelectorAll('.home-conversation').length===3");
    await capture('01-light-list.png');console.log('Login and real native session list passed');
  }else if(process.argv[2]==='flow'){
    const checks=[];
    if(await evaluate("state.page!=='home'"))await tap('#page-back');
    await wait("state.page==='home'");
    await capture('01-light-list.png');
    await tap('#home-conversations [data-id="session-22222222-2222-4222-8222-222222222222"]');
    await wait("document.body.innerText.includes('正在处理…')");
    assert.equal(await evaluate("document.querySelector('.execution-block').open"),false);
    await capture('02-light-running.png');checks.push('running and collapsed steps');
    await tap('#page-back');await tap('#home-conversations [data-id="session-33333333-3333-4333-8333-333333333333"]');
    await wait("document.body.innerText.includes('允许一次')");
    for(const name of ['允许一次','总是允许此类','拒绝'])assert.ok(await evaluate(`[...document.querySelectorAll('button')].some(n=>n.textContent.trim()===${JSON.stringify(name)}&&n.getBoundingClientRect().height>=47.9)`));
    await capture('03-light-approval.png');await tap('#approval-mode-button');
    await wait("!document.querySelector('#approval-mode-popover').hidden");
    assert.equal(await evaluate("document.querySelectorAll('#approval-mode-popover [role=menuitemradio]').length"),5);
    await capture('04-mode-menu.png');
    await evaluate("document.querySelectorAll('#approval-mode-popover [role=menuitemradio]')[1].dataset.ui2vTarget='true'");
    await tap('[data-ui2v-target]');await wait("document.querySelector('#approval-mode-label').textContent.includes('每次询问')");
    checks.push('five modes and native save');
    await textTap('允许一次');await wait("!document.body.innerText.includes('总是允许此类')");
    await capture('05-resolved-approval.png');checks.push('three buttons and allow once native POST');
    await tap('#page-back');await tap('#home-conversations [data-id="session-11111111-1111-4111-8111-111111111111"]');
    await wait("document.querySelector('.execution-block')");
    await tap('.execution-block > summary');await capture('06-readable-steps.png');
    await tap('.execution-step > summary');await wait("document.querySelector('.execution-step pre')?.innerText.includes('本周已经完成')");
    await capture('07-raw-step.png');checks.push('step summary and lazy native detail');
    await evaluate("document.querySelector('#draft').value='MuMu synthetic draft';document.querySelector('#draft').dispatchEvent(new Event('input',{bubbles:true}))");
    await tap('#outputs-button');await wait("document.querySelectorAll('.resource-row').length===2");
    await capture('08-outputs-sources.png');
    await evaluate("[...document.querySelectorAll('.resource-row')].find(n=>n.textContent.includes('项目进展.md')).dataset.ui2vTarget='artifact'");
    await tap('[data-ui2v-target="artifact"]');await wait("document.querySelector('#resource-content table')");
    await capture('09-artifact-fullscreen.png');await tap('#resource-back');
    assert.equal(await evaluate("document.querySelector('#draft').value"),'MuMu synthetic draft');
    await evaluate("document.querySelector('#chat-scroll').scrollTop=150");const scroll=await evaluate("document.querySelector('#chat-scroll').scrollTop");
    await tap('#outputs-button');
    await evaluate("[...document.querySelectorAll('.resource-row')].find(n=>n.textContent.includes('notes.md')).dataset.ui2vTarget='source'");
    await tap('[data-ui2v-target="source"]');await wait("document.querySelector('.resource-usage')");
    await capture('10-source-fullscreen.png');await tap('.resource-usage > summary');await wait("document.querySelector('.resource-usage pre')");
    await tap('#resource-back');assert.equal(await evaluate("document.querySelector('#chat-scroll').scrollTop"),scroll);
    assert.equal(await evaluate("document.querySelector('#draft').value"),'MuMu synthetic draft');checks.push('fullscreen artifact/source native reads and return scroll/draft');
    if(await evaluate("state.page==='home'"))await tap('#home-conversations [data-id="session-11111111-1111-4111-8111-111111111111"]');
    await evaluate("document.querySelector('#draft').blur()");
    await evaluate("document.querySelector('#draft').value='MuMu synthetic draft';document.querySelector('#draft').dispatchEvent(new Event('input',{bubbles:true}))");
    const before=await evaluate("({height:innerHeight,header:document.querySelector('header').getBoundingClientRect().top,draft:document.querySelector('#draft').value})");
    await tap('#draft');
    await wait(`innerHeight<${before.height}-150`);
    const ime=shell('dumpsys','input_method');assert.match(ime,/mInputShown=true|mIsInputViewShown=true/);
    const windowState=shell('dumpsys','window');
    const imeFrame=windowState.match(/type=ime frame=\[0,(\d+)\]\[(\d+),(\d+)\] visible=true/);
    assert.ok(imeFrame,'visible real IME must have a nonzero frame');assert.ok(Number(imeFrame[3])>Number(imeFrame[1]));
    shell('input','tap',String(Math.round(Number(imeFrame[2])/20)),String(Number(imeFrame[1])+Math.round(60*1.275)));
    await wait("document.querySelector('#draft').value==='MuMu synthetic draftq'");
    const opened=await evaluate("({height:innerHeight,header:document.querySelector('header').getBoundingClientRect().top,composer:document.querySelector('#composer-dock').getBoundingClientRect().toJSON(),draft:document.querySelector('#draft').value})");
    assert.ok(opened.composer.bottom<=opened.height+1);assert.equal(opened.header,before.header);assert.equal(opened.draft,'MuMu synthetic draftq');
    await capture('11-real-ime.png');shell('input','keyevent','4');await wait(`innerHeight===${before.height}`);
    await capture('12-ime-dismissed-draft.png');checks.push('real IME, composer above keyboard, fixed header and retained draft');
    await tap('#page-back');await tap('#home-settings');
    await evaluate("[...document.querySelectorAll('button')].find(n=>n.textContent.includes('跟随系统、浅色或深色')).dataset.ui2vTarget='appearance'");
    await tap('[data-ui2v-target="appearance"]');
    await evaluate("[...document.querySelectorAll('#page-content button')].find(n=>n.textContent.startsWith('深色')).dataset.ui2vTarget='dark'");
    await tap('[data-ui2v-target="dark"]');await wait("document.documentElement.dataset.theme==='dark'");
    await tap('#page-back');await wait("state.page==='home'");await capture('13-dark-list.png');
    await tap('#home-conversations [data-id="session-11111111-1111-4111-8111-111111111111"]');await capture('14-dark-chat.png');
    assert.equal(await evaluate("document.querySelector('#draft').value"),'MuMu synthetic draftq');
    await cdp('Page.reload',{});await wait("typeof state!=='undefined'&&state.booted&&state.page==='home'");
    await tap('#home-conversations [data-id="session-11111111-1111-4111-8111-111111111111"]');await wait("document.querySelector('#draft').value==='MuMu synthetic draftq'");
    assert.equal(await evaluate("document.documentElement.dataset.theme"),'dark');checks.push('dark theme persisted and draft retained across WebView reload');
    writeFileSync(new URL('./verification.json',import.meta.url),JSON.stringify({device:'MuMu Android 15',apk:'0.8.4 / code17',testPackage:'com.memoweft.weftmate.mobile.ui2vqa',capture:'adb exec-out screencap -p',screen:{width:720,height:1280},synthetic:true,realNativeBridge:true,realPersonalAuthentication:true,realDsh:false,modelRequests:0,checks,keyboard:{provider:'test APK InputMethodService',before,opened,androidInputShown:true,frame:imeFrame[0],typedByImeTap:true}},null,2)+'\n');
    console.log(JSON.stringify({checks,keyboard:{before,opened}},null,2));
  }else if(process.argv[2]==='inspect'){
    console.log(await evaluate("JSON.stringify({text:document.body.innerText,inputs:[...document.querySelectorAll('button')].map(n=>({text:n.textContent,height:n.getBoundingClientRect().height}))})"));
  }
}finally{ws.close();}




