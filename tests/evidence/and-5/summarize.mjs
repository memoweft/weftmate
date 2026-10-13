import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {systemBarDifference} from '../../../scripts/nightly/system-bars.mjs';
const dir=import.meta.dirname,ui=JSON.parse(await readFile(join(dir,'native-report.json'))),shots=[];
for(const file of ui.screenshots.map(s=>s.file).filter(n=>/^and5-(360|390)-(light|dark)-.*\.png$/.test(n))){
  const [_,width,theme]=file.split('-');
  const insets=JSON.parse(await readFile(join(dir,`and5-${width}-${theme}-done.json`)));
  const png=await readFile(join(dir,file)),pixelWidth=png.readUInt32BE(16),pixelHeight=png.readUInt32BE(20);
  const difference=systemBarDifference(png,{statusHeight:insets.statusHeight});
  const systemPanel=file.includes('notification-panel');
  shots.push({file,widthDp:Number(width),pixelWidth,pixelHeight,heightDp:Number((pixelHeight*Number(width)/pixelWidth).toFixed(1)),requestedTheme:systemPanel?'system panel':theme,actualPageTheme:difference.header.reduce((a,b)=>a+b)/3>127?'light':'dark',systemPanel,systemTheme:insets.systemDark?'dark':'light',systemSettingChanged:false,systemVersion:ui.systemVersion,bottomNavigationVisible:insets.navigationBottom>0,navigationBottom:insets.navigationBottom,difference});
}
await writeFile(join(dir,'screenshots.json'),JSON.stringify(shots,null,2)+'\n');
console.log(JSON.stringify({shots:shots.length,statusBarFailures:shots.filter(s=>!s.systemPanel&&!s.difference.passed).map(s=>s.file),themeMismatches:shots.filter(s=>!s.systemPanel&&s.requestedTheme!==s.actualPageTheme).map(s=>s.file)}));
