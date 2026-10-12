import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
class Node {
 tag:string;attrs:Record<string,string>={};children:Node[]=[];textContent='';style={setProperty(){}};
 constructor(tag:string){this.tag=tag;}
 setAttribute(k:string,v:any){this.attrs[k]=String(v);}append(...nodes:Node[]){this.children.push(...nodes);}
}
function setup(){const context:any={WeftUiCore:{factories:{}},Intl,URLSearchParams,document:{createElementNS:(_:string,tag:string)=>new Node(tag)}};runInNewContext(read('src/ui-core/health.js'),context);runInNewContext(read('src/personal-access-ui/components/health-view.js'),context);return context;}
function nodes(n:Node):Node[]{return [n,...n.children.flatMap(nodes)];}
function geometry(n:Node){const all=nodes(n);for(const node of all){for(const value of Object.values(node.attrs))assert.doesNotMatch(value,/NaN|Infinity|undefined/);for(const key of ['width','height','r'])if(key in node.attrs)assert.ok(Number(node.attrs[key])>=0);}return all;}
test('every authored SVG handles no data, one observation, both outliers and narrow scalable widths',()=>{
 const {WeftHealthGraphics:G}=setup();
 for(const value of [null,0,42,-900,900])for(const svg of [G.band(value),G.dualBars(value,450),G.range(value,30,65),G.halfGauge(value),G.area(value===null?[]:[{value}]),G.comparison(value,34),G.progress(value,60),G.stages({deepMinutes:value,remMinutes:null,awakeMinutes:null},value)]){
  const all=geometry(svg);assert.equal(svg.attrs['aria-hidden'],'true');assert.match(svg.attrs.viewBox,/^0 0 300 \d+$/);for(const point of all.filter(n=>n.tag==='circle')){assert.ok(Number(point.attrs.cx)>=0&&Number(point.attrs.cx)<=300);assert.ok(Number(point.attrs.cy)>=0&&Number(point.attrs.cy)<=180);}
 }
 const empty=G.area([]);assert.equal(empty.attrs['data-empty'],'true');assert.equal(nodes(empty).filter(n=>n.tag==='circle').length,0);
 const one=G.area([{value:47}]);assert.equal(nodes(one).filter(n=>n.tag==='circle').length,1);assert.ok(nodes(one).find(n=>n.tag==='path'&&n.attrs.class.includes('health-line'))?.attrs.d.startsWith('M150,'));
 const gapped=G.area([{value:45},{value:null},{value:67}]);assert.equal((nodes(gapped).find(n=>n.attrs.class?.includes('health-line'))!.attrs.d.match(/M/g)||[]).length,2);assert.equal(nodes(gapped).filter(n=>n.tag==='circle').length,1);
 for(const width of [32,64,132]){const ratio=width/300;assert.ok(nodes(G.range(999,30,70)).filter(n=>n.tag==='circle').every(n=>Number(n.attrs.cx)*ratio<=width));}
 const partial=nodes(G.stages({deepMinutes:null,remMinutes:100,awakeMinutes:0},400));assert.equal(Number(partial.find(n=>n.attrs.class?.includes('health-stage-rem'))!.attrs.width),73);assert.equal(Number(partial.find(n=>n.attrs.class==='health-graphic-track')!.attrs.width),225,'unknown stages retain the remaining track rather than magnifying recorded time');geometry(G.stages(null,null));
});
test('outliers clamp to the graphic edges without changing any displayed source value',()=>{const {WeftHealthGraphics:G,WeftHealth:H}=setup();assert.equal(G.percent(-23),0);assert.equal(G.percent(999),100);assert.equal(G.percent(null),null);assert.equal(H.value(999),'999');assert.equal(H.value(null),'—');});
test('trend area keeps missing-day gaps and a single point has no invented polygon',()=>{const {WeftHealthGraphics:G,WeftHealth:H}=setup();const points=[{value:0},{value:4},{value:null},{value:5},{value:7}];assert.equal((G.fillPath(points,H.chart(points)).match(/Z/g)||[]).length,2);assert.equal(G.fillPath([{value:5}],H.chart([{value:5}])),'');});
test('reduced motion queues no frame and the count-up ends exactly on the formatted measurement',()=>{
 const {WeftHealthGraphics:G}=setup(),n:any={textContent:'52',dataset:{countTo:'52.1',countMetric:'stress'},isConnected:true},root={querySelectorAll:()=>[n]},frames:Function[]=[];
 G.animateNumbers(root,{reducedMotion:true,request:()=>{throw Error('reduced motion must not animate');}});assert.equal(n.textContent,'52');
 G.animateNumbers(root,{clock:()=>0,request:(fn:Function)=>{frames.push(fn);return frames.length;},cancel:()=>{}});frames.shift()!(0);assert.equal(n.textContent,'0');frames.shift()!(400);assert.equal(n.textContent,'52');assert.equal(frames.length,0);
});
test('health motion follows both the app preference and system setting',()=>{const context=setup(),G=context.WeftHealthGraphics;context.matchMedia=()=>({matches:false});context.WeftReplyMotion={reduced:true};assert.equal(G.reducedMotion(),true);context.WeftReplyMotion.reduced=false;assert.equal(G.reducedMotion(),false);context.matchMedia=()=>({matches:true});assert.equal(G.reducedMotion(),true);assert.match(read('src/personal-access-ui/health.css'),/\[data-reduced-motion\] \.health-page \* \{ animation:none!important/);});
test('red status follows an explicit server conclusion without inventing a severity threshold',()=>{const {WeftHealthGraphics:G}=setup();for(const label of ['明显偏离','明显偏高','明显偏低'])assert.equal(G.criticalStatus({label}),true);for(const data of [null,{label:'正常'},{label:'比平时高',value:999},{label:'比平时低',value:-999}])assert.equal(G.criticalStatus(data),false);assert.match(read('src/personal-access-ui/health.css'),/\.health-page \.health-status\.is-critical \{ color:var\(--health-stress-extreme\)/);});
const luminance=(hex:string)=>{const rgb=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
const contrast=(a:string,b:string)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
test('health text tokens have both themes and at least 4.5:1 contrast on card and own tinted backgrounds',()=>{
 const tokens=JSON.parse(read('design/tokens/tokens.json')),colors=tokens.shared.color;
 const {WeftHealth:H,WeftHealthGraphics:G}=setup();for(const id of Object.keys(H.metrics))for(const theme of ['light','dark'])assert.ok(colors['health-'+G.metricPalette(id)+'-'+theme],`Missing metric palette: ${id}/${theme}`);
 for(const name of ['recovery','sleep','load','stress-calm','stress-moderate','stress-high','stress-extreme','energy-low','energy-mid','energy-high','fitness-age','hrv','resting-heart-rate','respiratory','oxygen','temperature'])for(const theme of ['light','dark']){
  const color=colors['health-'+name+'-'+theme],soft=colors['health-'+name+'-soft-'+theme],card=colors['health-card-'+theme];assert.match(color,/^#[0-9A-F]{6}$/);for(const background of [soft,card])assert.ok(contrast(color,background)>=4.5,`${name}/${theme}: ${contrast(color,background)}`);
  const native='health'+name.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join('');assert.equal(tokens.apple.colors[native][theme],color);
 }
 for(const theme of ['light','dark'])for(const name of ['ink','muted'])assert.ok(contrast(colors['health-'+name+'-'+theme],colors['health-card-'+theme])>=4.5);
 const swift=read('design/tokens/generated/apple/DesignTokens.swift');assert.match(swift,/public static let healthRecovery = adaptive/);assert.match(swift,/public static let healthSleepSoft = adaptive/);
});
test('the health notice exists once in settings and receipt disclaimers are never rendered',()=>{
 const source=read('src/personal-access-ui/components/health-view.js'),[page,settings]=source.split('globalThis.WeftHealthView.settings=');assert.doesNotMatch(page,/disclaimer|医学结论|趋势估计|粗略估计|免责声明|不表示因果/);assert.equal((settings.match(/按公开方法做的估计，不是医学结论/g)||[]).length,1);assert.match(settings,/health-settings-notice/);
});
test('graphic widths and reduced-motion overrides remain scoped to the health page',()=>{const css=read('src/personal-access-ui/health.css');assert.match(css,/\.health-graphic \{[^}]*width:100%/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)[\s\S]*animation:none!important/);assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);});
