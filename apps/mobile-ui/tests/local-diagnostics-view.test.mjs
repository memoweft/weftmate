import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source=readFileSync(new URL('../../../src/ui-core/controls.js',import.meta.url),'utf8')+'\n;\n'+readFileSync(new URL('../../../src/personal-access-ui/components/presence.js',import.meta.url),'utf8');
class Node {
    constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.listeners={};this.hidden=false;}
    append(...nodes){for(const node of nodes){this.children.push(node);node.parent=this;}}
    prepend(...nodes){this.children.unshift(...nodes);for(const node of nodes)node.parent=this;}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(event,handler){this.listeners[event]=handler;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
    async click(){return this.listeners.click?.();}
}
function all(node){return [node,...node.children.flatMap(all)];}
function fixture(){const context={document:{createElement:tag=>new Node(tag),querySelectorAll:()=>[]},WeftIcons:{create:()=>new Node('svg')}};
    runInNewContext(source,context);return context;}
test('local phone previous failure is visible before login in the single existing status strip',async()=>{
    const c=fixture(),composer=new Node('div'),badge=new Node('div');let opened=0;
    const value={kind:'login_required',label:'请登录'},core={state:{},connectionView:()=>value,observeConnection:()=>()=>{}};
    c.WeftPresenceView.mount({core,composerTarget:composer,badgeTarget:badge,openRunRecords:()=>opened++,
        readLocalDiagnostics:async()=>({state:'ready',previous:{normal:false,reason:'crash'}})});
    for(let n=0;n<5;n++)await Promise.resolve();
    assert.equal(composer.children.length,1);const bar=composer.children[0];assert.equal(bar.hidden,false);
    assert.match(all(bar).find(node=>node.className==='presence-copy').textContent,/这部手机上次未正常结束.*程序崩溃/);
    await all(bar).find(node=>node.textContent==='查看详情').click();assert.equal(opened,1);
    assert.equal(all(bar).find(node=>node.className==='presence-copy').textContent,'请重新登录 · 草稿会保留');
});
test('background termination and first launch do not show the abnormal-exit notice',async()=>{
    const reasons=fixture().WeftRunRecords;
    assert.match(reasons.reason({normal:false,reason:'unknown',dumps:[{name:'synthetic.dmp'}]}),/检测到崩溃转储/);
    assert.equal(reasons.reason({normal:false,reason:'unknown',exitTimeKnown:false},'android'),'原因未知');
    assert.equal(reasons.reason({normal:true,reason:'unknown',exitCode:0}),'退出原因未记录');
    for(const previous of [null,{normal:true,reason:'terminated_in_background'}]){
        const c=fixture(),composer=new Node('div'),value={kind:'online',label:'在线'},core={connectionView:()=>value,observeConnection:()=>()=>{}};
        c.WeftPresenceView.mount({core,composerTarget:composer,readLocalDiagnostics:async()=>({state:'ready',previous})});
        for(let n=0;n<5;n++)await Promise.resolve();assert.equal(composer.children[0].hidden,true);
    }
});
test('acknowledged local failure stays dismissed after navigating back and remounting',async()=>{
    const c=fixture(),value={kind:'online',label:'在线'},core={connectionView:()=>value,observeConnection:()=>()=>{}};
    const previous={normal:false,reason:'crash',runId:'synthetic-diagnostic-run'};
    const mount=()=>{const composer=new Node('div');const view=c.WeftPresenceView.mount({core,composerTarget:composer,
        readLocalDiagnostics:async()=>({state:'ready',previous})});return {composer,view};};
    const first=mount();for(let n=0;n<5;n++)await Promise.resolve();
    assert.equal(first.composer.children[0].hidden,false);
    await all(first.composer).find(node=>node.textContent==='查看详情').click();first.view.close();
    const second=mount();for(let n=0;n<5;n++)await Promise.resolve();
    assert.equal(second.composer.children[0].hidden,true);
});
test('records have loading/error/empty, human preview, structured copy and user initiated share',async()=>{
    const c=fixture(),target=new Node('div'),copied=[],shared=[];let retries=0;
    const view=c.WeftRunRecords.mount(target,{core:{dateText:()=> '今天 9:00'},title:'本机（这部手机）',local:true,desktop:null,
        retry:()=>retries++,copySummary:async text=>copied.push(text),shareLogs:async()=>shared.push(true)});
    assert.equal(view.section.dataset.state,'loading');assert.ok(all(target).find(node=>node.attributes.role==='status'&&node.attributes['aria-label']==='内容加载中'),'loading keeps an accessible skeleton');
    assert.doesNotMatch(all(target).map(node=>node.textContent).join(' '),/正在读取/);
    view.paint({state:'error'});await all(target).find(node=>node.textContent==='重试读取').click();assert.equal(retries,1);
    view.paint({state:'ready',startedAt:'synthetic',abnormalCountsLast7Days:{},summary:'{"platform":"android"}',summaryPreview:'本机预览'});
    assert.equal(shared.length,0);assert.match(all(target).map(node=>node.textContent).join(' '),/没有异常记录/);
    const preview=all(target).find(node=>node.className==='run-record-preview');assert.equal(preview.hidden,true);
    await all(target).find(node=>node.textContent==='复制诊断摘要').click();assert.equal(preview.hidden,false);
    assert.equal(all(preview).find(node=>node.tag==='pre').textContent,'本机预览');
    await all(preview).find(node=>node.textContent==='复制摘要').click();assert.deepEqual(copied,['{"platform":"android"}']);
    await all(target).find(node=>node.textContent==='分享日志文件').click();assert.deepEqual(shared,[true]);
});
test('known Android exit time and seven-day abnormal event total are shown',()=>{
    const c=fixture(),target=new Node('div');const view=c.WeftRunRecords.mount(target,{core:{dateText:()=> '今天 9:00'},local:true,desktop:null});
    view.paint({state:'ready',startedAt:'synthetic',previous:{normal:false,reason:'native_crash',at:'synthetic',exitTimeKnown:true},
        abnormalCountsLast7Days:{'app.failure':2,'sync.failure':3},summary:'{}'});
    const text=all(target).map(node=>node.textContent).join(' ');assert.match(text,/今天 9:00 · 未正常结束/);
    assert.match(text,/原生组件崩溃/);assert.match(text,/5 条异常记录/);assert.doesNotMatch(text,/结束时间未知/);
});
