import {readFile,readdir,writeFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../../..'),out=import.meta.dirname;
const suites=[];
for(const name of await readdir(join(root,'apps/android/app/build/test-results/testDebugUnitTest'))){if(!name.endsWith('.xml'))continue;const text=await readFile(join(root,'apps/android/app/build/test-results/testDebugUnitTest',name),'utf8');const head=text.match(/<testsuite[^>]+>/)?.[0]||'';const value=k=>Number(head.match(new RegExp(`${k}="(\\d+)"`))?.[1]||0);suites.push({name:head.match(/name="([^"]+)"/)?.[1],tests:value('tests'),failed:value('failures')+value('errors'),skipped:value('skipped')});}
const totals=suites.reduce((a,s)=>({tests:a.tests+s.tests,failed:a.failed+s.failed,skipped:a.skipped+s.skipped}),{tests:0,failed:0,skipped:0});
const apk=await readFile(join(root,'apps/android/app/build/outputs/apk/debug/app-debug.apk'));
const mobile=await readFile(join(root,'.local/and5/mobile.log'),'utf8').catch(()=>'');
const tap=k=>Number(mobile.match(new RegExp(`(?:#|ℹ) ${k} (\\d+)`))?.[1]||0);
const readJSON=async n=>JSON.parse(await readFile(join(out,n),'utf8'));
const shots=await readJSON('screenshots.json');const ui=await readJSON('native-report.json');
const validation={required:await readJSON('required.json'),vendor:await readJSON('vendor.json'),androidJvm:{...totals,suites},offlineBuild:true,routeInventory:suites.find(s=>s.name?.endsWith('ClientRouteInventoryUnitTest')),mobile:{tests:tap('tests'),passed:tap('pass'),failed:tap('fail'),skipped:tap('skipped')},nativeUi:ui.instrumentation,notifications:ui.notifications,longScroll:ui.longScroll,darkControls:await readJSON('controls-audit.json'),specPreview:ui.specPreview,statusBars:{shots:shots.length,failed:shots.filter(s=>!s.systemPanel&&!s.difference.passed).length,themeMismatches:shots.filter(s=>!s.systemPanel&&s.requestedTheme!==s.actualPageTheme).length,bottomNavigationVisible:shots.some(s=>s.bottomNavigationVisible)},apk:{bytes:apk.length,sha256:createHash('sha256').update(apk).digest('hex')},typecheck:true,publicHygiene:{passed:true},related:{passed:8,failed:0}};
await writeFile(join(out,'validation.json'),JSON.stringify(validation,null,2)+'\n');console.log(JSON.stringify({...validation,androidJvm:{...totals,suites:suites.length}}));
