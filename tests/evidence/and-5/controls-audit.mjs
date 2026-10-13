import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const dir=import.meta.dirname,root=resolve(dir,'../../..');
const spec=JSON.parse(await readFile(join(dir,'controls-spec.json'),'utf8'));
const source=await readFile(join(root,'apps/android/app/src/main/java/com/memoweft/weftmate/mobile/DesignTokens.kt'),'utf8');
const names={canvas:'Canvas',surface:'Surface','surface-soft':'Soft','surface-float':'SurfaceFloat','selected-on-soft':'SelectedOnSoft',line:'Line',ink:'Ink','ink-secondary':'Secondary','ink-muted':'Muted',accent:'Accent','accent-hover':'AccentHover','on-accent':'OnAccent','accent-soft':'AccentSoft',danger:'Danger','danger-soft':'DangerSoft'};
function argb(css){
  if(css.startsWith('#'))return 'ff'+css.slice(1).toLowerCase();
  const values=css.match(/rgba\(([^)]+)\)/)[1].split(',').map(Number),[r,g,b,a]=values;
  return [Math.round(a*255),r,g,b].map(n=>n.toString(16).padStart(2,'0')).join('');
}
const colors=spec.color.tokens.map(row=>{
  const field='nativeDark'+names[row.name],expected=argb(row.value.dark),actual=source.match(new RegExp(`const val ${field} = 0x([0-9a-f]+)`))?.[1];
  return {name:row.name,field,css:row.value.dark,expectedArgb:expected,actualArgb:actual,passed:actual===expected};
});
const report={source:'controls-spec/tokens.json supplied 2026-10-13',alpha:'nearest 8-bit ARGB',colors,passed:colors.every(r=>r.passed)};
await writeFile(join(dir,'controls-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({colors:colors.length,failed:colors.filter(r=>!r.passed)}));if(!report.passed)process.exitCode=1;
