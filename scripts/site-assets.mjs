// Recreate the compressed, reviewed product images from committed synthetic evidence.
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repo } from './build-site.mjs';
const sources={
 'windows-light':'tests/evidence/ux-3/quieter-replies/desktop-light-five-collapsed.png',
 'windows-dark':'tests/evidence/ux-3/quieter-replies/desktop-dark-five-collapsed.png',
 'mac-light':'tests/evidence/qa-3/apple/a10/mac-light/main.png',
 'mac-dark':'tests/evidence/qa-3/apple/a10/mac-dark/main.png',
 'android-light':'tests/evidence/mob-2/after/phone-system-390-light-chat.png',
 'android-dark':'tests/evidence/mob-2/after/phone-system-390-dark-chat.png',
 'iphone-light':'tests/evidence/qa-1/apple/iphone/review-iphone-conversation-light-20261009T092639Z.png',
 'iphone-dark':'tests/evidence/qa-1/apple/iphone/review-iphone-conversation-dark-20261009T093104Z.png',
 'watch-light':'tests/evidence/qa-3/apple/watch/approve-pending-watch.png',
 'watch-dark':'tests/evidence/qa-3/apple/watch/approve-ended-watch.png'
};
const dest=join(repo,'site/src/assets');await mkdir(dest,{recursive:true});
for(const [name,path]of Object.entries(sources)){const width=/^(windows|mac)/.test(name)?1080:name.startsWith('watch')?400:480;const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',join(repo,path),'-vf',`scale=${width}:-1`,'-c:v','libwebp','-quality','84',join(dest,name+'.webp')],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||'ffmpeg failed');}
await writeFile(join(repo,'site/ASSETS.json'),JSON.stringify({reviewed:'2026-10-12',sources,review:'Every source opened and visually checked: fictional test identities only, no personal names, emails, user directories or machine names. Apple captures are older native client evidence. Watch uses its actual black UI in both site themes; the two images show waiting and completed.',derived:'Resized and compressed only. No interface text or content was altered. Keyframes and share image are screenshots of the new synthetic site demo; see scripts/capture-site.mjs.'},null,2)+'\n');
