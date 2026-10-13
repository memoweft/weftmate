import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {systemBarDifference} from '../../../scripts/nightly/system-bars.mjs';
const dir=import.meta.dirname;
const perf=JSON.parse(await readFile(join(dir,'performance-report.json')));
const ui=JSON.parse(await readFile(join(dir,'native-report.json')));
const files=(await readdir(dir)).filter(n=>/^and4-(360|390)-(light|dark)-.*\.png$/.test(n));
const shots=[];
for(const file of files){
  const difference=systemBarDifference(await readFile(join(dir,file)),{statusHeight:perf.insets.statusHeight});
  const actualPageTheme=difference.header.reduce((a,b)=>a+b)/3>127?'light':'dark';
  shots.push({file,widthDp:Number(file.split('-')[1]),requestedTheme:file.split('-')[2],actualPageTheme,systemTheme:'MuMu existing dark setting; unchanged',systemVersion:ui.systemVersion,bottomNavigationVisible:perf.insets.navigationBottom>0,navigationBottom:perf.insets.navigationBottom,difference});
}
const stats=text=>({frames:Number(text.match(/Total frames rendered: (\d+)/)?.[1]),janky:Number(text.match(/Janky frames: (\d+)/)?.[1]),jankyPercent:Number(text.match(/Janky frames: \d+ \(([\d.]+)%/ )?.[1]),p95Ms:Number(text.match(/95th percentile: (\d+)ms/)?.[1]),p99Ms:Number(text.match(/99th percentile: (\d+)ms/)?.[1])});
await writeFile(join(dir,'screenshots.json'),JSON.stringify(shots,null,2)+'\n');
await writeFile(join(dir,'metrics.json'),JSON.stringify({baselineApkBytes:perf.baselineApkBytes,nativeApkBytes:perf.nativeApkBytes,increaseBytes:perf.nativeApkBytes-perf.baselineApkBytes,baselineColdStart:perf.baselineColdStart,nativeColdStart:perf.nativeColdStart,baselineFrames:stats(perf.baselineFrameStats),nativeFrames:stats(perf.frameStats),restoredDraft:perf.restoredDraft,limits:perf.measurementLimit},null,2)+'\n');
console.log(JSON.stringify({shots:shots.length,statusBarFailures:shots.filter(s=>!s.difference.passed).map(s=>s.file),themeMismatches:shots.filter(s=>!s.file.endsWith('-login.png')&&s.requestedTheme!==s.actualPageTheme).map(s=>s.file)}));
