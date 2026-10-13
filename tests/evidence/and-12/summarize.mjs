import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const root=import.meta.dirname;
const report={comparisons:[],frames:[],systemBars:[]};
const ff=(args)=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{windowsHide:true,maxBuffer:4*1024*1024});
for(const theme of ['light','dark']) {
  for(const state of ['content','sidebar']) {
    const web=join(root,`and12-${theme}-web-${state}.png`),native=join(root,`and12-${theme}-${state==='content'?'native-content':'sidebar'}.png`);
    const output=`comparison-${theme}-${state}.png`;
    ff(['-i',web,'-i',native,'-filter_complex','[0:v][1:v]hstack=inputs=2[out]','-map','[out]','-frames:v','1',join(root,output)]);
    report.comparisons.push({file:output,left:'web',right:'native',sameAccountAndData:true});
  }
  // Raw screenshot crop: includes the permission shield and the unchanged goal shield+check.
  ff(['-i',join(root,`and12-${theme}-tools-and-goal.png`),'-vf','crop=720:310:0:970,scale=1440:620:flags=neighbor','-frames:v','1',join(root,`tools-and-goal-${theme}.png`)]);
  for(const name of ['keyboard-open','keyboard-close','multiline-expand','multiline-collapse']) {
    const frames=JSON.parse(await readFile(join(root,`and12-${theme}-${name}-frames.json`),'utf8'));
    const metrics=JSON.parse(await readFile(join(root,`and12-${theme}-${name}${name.startsWith('keyboard')?'-real':''}-metrics.json`),'utf8'));
    const values=frames.map(frame=>frame[name.startsWith('multiline')?'top':'bottom']);
    report.frames.push({theme,action:name,observedFrames:frames.length,positions:new Set(values).size,start:values[0],end:values.at(-1),
      nonzeroIme:frames.some(frame=>frame.imeBottom>0),measuredFrames:metrics.frames,jankFrames:metrics.jankFrames,frameBudgetMs:metrics.frameBudgetNs/1e6,
      measurement:metrics.measurement});
    const csv='ms,top,bottom,imeVisible,imeBottom\n'+frames.map(frame=>[frame.ms,frame.top,frame.bottom,frame.imeVisible,frame.imeBottom].join(',')).join('\n');
    await writeFile(join(root,`and12-${theme}-${name}.csv`),csv+'\n');
    const min=Math.min(...values),max=Math.max(...values),width=700,height=220;
    const points=frames.map((frame,index)=>`${20+frame.ms/Math.max(1,frames.at(-1).ms)*width},${20+(values[index]-min)/Math.max(1,max-min)*height}`).join(' ');
    await writeFile(join(root,`trajectory-${theme}-${name}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="740" height="280" viewBox="0 0 740 280"><rect width="740" height="280" fill="white"/><text x="20" y="270" font-family="sans-serif" font-size="14">${theme} / ${name} / ${new Set(values).size} positions / ${min}–${max} px (downward screen axis)</text><polyline points="${points}" fill="none" stroke="#30332d" stroke-width="2"/></svg>\n`);
  }
  for(const state of ['approval-menu','model-menu','plus-menu','page-activity','page-health','page-library','settings-general','sidebar']) {
    const file=`and12-${theme}-${state}.png`;
    const sample=(crop)=>{const data=ff(['-i',join(root,file),'-vf',crop,'-f','rawvideo','-pix_fmt','rgb24','-frames:v','1','pipe:1']);const sum=[0,0,0];for(let i=0;i<data.length;i++)sum[i%3]+=data[i];return sum.map(x=>+(x/(data.length/3)).toFixed(2));};
    const status=sample('crop=120:8:300:12'),header=sample('crop=12:8:4:156');
    report.systemBars.push({file,pageTheme:theme,systemTheme:'unchanged',android:'15',fullScreen:true,statusRgb:status,headerRgb:header,maxChannelDifference:Math.max(...status.map((value,index)=>Math.abs(value-header[index]))),navigationRegion:'MuMu reports 0; real gesture bar needs device confirmation'});
  }
}
await writeFile(join(root,'summary.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.frames));
