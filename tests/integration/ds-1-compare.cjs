/** Electron helper invoked by ds-1-compare.mjs. */
const {app,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
app.whenReady().then(()=>{
const dir=path.resolve('tests/evidence/ds-1'),results=[];
for(const name of fs.readdirSync(dir).filter(n=>n.startsWith('before-')&&n.endsWith('.png'))){const other=name.replace('before-','after-');if(!fs.existsSync(path.join(dir,other)))throw Error('Missing '+other);
const a=nativeImage.createFromPath(path.join(dir,name)),b=nativeImage.createFromPath(path.join(dir,other));const {width,height}=a.getSize();if(JSON.stringify(a.getSize())!==JSON.stringify(b.getSize()))throw Error(name+' size differs');
const ab=a.toBitmap(),bb=b.toBitmap(),diff=Buffer.alloc(ab.length);let changed=0,maxDelta=0;let box=[width,height,0,0];
for(let i=0;i<ab.length;i+=4){let delta=0;for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(ab[i+c]-bb[i+c]));maxDelta=Math.max(maxDelta,delta);if(delta){changed++;const x=(i/4)%width,y=Math.floor(i/4/width);box=[Math.min(box[0],x),Math.min(box[1],y),Math.max(box[2],x),Math.max(box[3],y)];diff[i+2]=255;diff[i+3]=255;}}
const item={before:name,after:other,width,height,changedPixels:changed,totalPixels:width*height,maxChannelDelta:maxDelta,bounds:changed?box:null};results.push(item);
const diffPath=path.join(dir,'diff-'+name.slice(7));
if(changed)fs.writeFileSync(diffPath,nativeImage.createFromBitmap(diff,{width,height}).toPNG());
else if(fs.existsSync(diffPath))fs.unlinkSync(diffPath);
}
fs.writeFileSync(path.join(dir,'comparison.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({pairs:results.length,changedPixels:results.reduce((n,r)=>n+r.changedPixels,0)}));if(results.some(r=>r.changedPixels))throw Error('DS-1 screenshot pixels differ');
const before=JSON.parse(fs.readFileSync(path.join(dir,'before-desktop-settings.json'))),after=JSON.parse(fs.readFileSync(path.join(dir,'after-desktop-settings.json')));
if(JSON.stringify(before)!==JSON.stringify(after))throw Error('DS-1 appearance settings differ');
app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
