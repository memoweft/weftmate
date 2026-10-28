// Authoring helper only. The committed prototype itself needs no build or server.
import fs from 'node:fs';
const base = new URL('../../../', import.meta.url);
const tokens = JSON.parse(fs.readFileSync(new URL('design/tokens/tokens.json', base)));
const proposal = JSON.parse(fs.readFileSync(new URL('design/tokens/ios-prototype.json', base)));
const lines = ['/* Generated from design/tokens/tokens.json + ios-prototype.json. */', ':root {'];
for (const [group, prefix] of [['space','s'],['radius','r'],['fontSize','f'],['fontFamily','font']])
  for (const [key,value] of Object.entries(tokens.shared[group])) lines.push(`  --${prefix}-${key}: ${value};`);
for (const group of [tokens.motion.duration,tokens.motion.easing,proposal.layout,proposal.type,proposal.shadow])
  for (const [key,value] of Object.entries(group)) lines.push(`  --${key}: ${value};`);
lines.push('}');
for (const theme of ['light','dark']) {
  lines.push(`:root[data-theme="${theme}"] { color-scheme: ${theme};`);
  for (const [key,value] of Object.entries(proposal.color[theme])) {
    const match = value.match(/^\{apple.colors.(.+)\}$/);
    lines.push(`  --${key}: ${match ? tokens.apple.colors[match[1]][theme] : value};`);
  }
  for (const [key,value] of Object.entries(tokens.apple.colors)) if (key.startsWith('health') || ['danger','status'].includes(key))
    lines.push(`  --${key.replace(/[A-Z]/g, s => '-'+s.toLowerCase())}: ${value[theme]};`);
  lines.push('}');
}
fs.writeFileSync(new URL('tokens.css', import.meta.url),lines.join('\n')+'\n');
const icons = Object.fromEntries(fs.readdirSync(new URL('design/icons/ui/',base)).filter(f=>f.endsWith('.svg')).map(f=>[f.slice(0,-4),fs.readFileSync(new URL('design/icons/ui/'+f,base),'utf8').replace(/<title>[\s\S]*?<\/title>/g,'')]));
fs.writeFileSync(new URL('assets.js',import.meta.url),'// Generated exclusively from design/icons/ui; do not hand-edit.\nwindow.WEFT_ICONS = '+JSON.stringify(icons)+';\nwindow.IOS_MOTION = '+JSON.stringify(proposal.motion)+';\n');
